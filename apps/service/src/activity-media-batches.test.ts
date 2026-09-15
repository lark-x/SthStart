import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import {
  prepareMediaBatch,
  createMediaBatch as createBatchService,
  processMediaBatch,
  retryFailedBatchItems,
  getMediaBatch,
  listMediaBatches,
  cancelMediaBatch,
  reconcileMediaBatchesOnStartup,
} from './activities/media-batches.js';
import { selectMediaForSlots, uploadActivityAsset } from './activities/media.js';
import { getPromptRecipe } from './activities/image-prompt-compiler.js';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockFetch: typeof fetch = async () => Response.json({ prompt_id: 'test_prompt', number: 1 });
function createMediaBatch(...args: Parameters<typeof createBatchService>) {
  args[6] = mockFetch;
  return createBatchService(...args);
}
const adminToken = 'activity-media-batches-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function sampleDocumentWithMediaSlots() {
  return {
    schemaVersion: 1 as const,
    activity: {
      title: '海边野餐日',
      type: '日常生活',
      theme: '野餐聚会',
      location: '银沙滩',
      rules: '',
      generationMode: 'fill_details' as const,
      scheduledDate: '2026-09-10',
    },
    actors: [
      {
        id: 'actor_alice',
        displayName: '爱丽丝',
        activityRole: '甜点师',
        outfitDescription: '白色蕾丝连衣裙，系粉色围裙',
        appearanceReferenceAssetKeys: [],
        persona: { displayName: '爱丽丝', identity: '甜品师' },
      },
    ],
    relationships: [],
    stages: [
      {
        id: 'stage_beach',
        title: '沙滩野餐',
        order: 1,
        actorIds: ['actor_alice'],
        location: '银沙滩',
        instruction: '铺设野餐垫，摆放甜点',
        requiredBeats: [],
        locked: false,
        endCondition: '野餐开始',
      },
      {
        id: 'stage_sunset',
        title: '日落收摊',
        order: 2,
        actorIds: ['actor_alice'],
        location: '银沙滩',
        instruction: '收拾餐垫并拍照留念',
        requiredBeats: [],
        locked: false,
        endCondition: '活动结束',
      },
    ],
    conversations: [
      { id: 'conv_picnic', kind: 'group' as const, title: '野餐组', memberActorIds: ['actor_alice'] },
    ],
    messages: [
      {
        id: 'msg_1',
        conversationId: 'conv_picnic',
        stageId: 'stage_beach',
        kind: 'message' as const,
        speakerActorId: 'actor_alice',
        text: '甜点和野餐垫都准备好啦！',
        mediaSlotIds: ['slot_picnic_mat'],
        storyOrder: 1,
      },
    ],
    posts: [],
    comments: [],
    likes: [],
    mediaSlots: [
      {
        id: 'slot_picnic_mat',
        kind: 'image' as const,
        stageId: 'stage_beach',
        caption: '铺在沙滩上的碎花野餐垫与精致水果塔',
        shotDescription: '俯拍特写镜头，自然阳光照耀',
        actorIds: ['actor_alice'],
        sourceFactIds: [],
      },
    ],
    facts: [],
    stageResults: [],
  };
}

async function setup() {
  const database = new ServiceDatabase();
  const fetcher: typeof fetch = async () => Response.json({
    prompt_id: 'prompt_test_123',
    number: 1,
  });

  const { app } = await createService({
    config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }),
    database,
    secrets: new SecretStore({}),
    fetcher,
  });

  const now = new Date().toISOString();
  // Register an engine profile and workflow assignment for activities image generation
  database.connection.prepare(
    'INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)'
  ).run('test-comfy-profile', 'COMFYUI', 'image', 'http://comfy.test/v1', 'sd-xl', null, now, now);

  database.connection.prepare(
    'INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)'
  ).run('engine_comfy', 'Comfy Test Engine', 'comfyui', 'http://comfy.test', null, 1, 2, now, now);

  database.connection.prepare(
    'INSERT INTO generation_workflows (id, name, description, engine_kind, latest_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run('wf_text2img', 'Text to Image Test', '', 'comfyui', 1, now, now);

  database.connection.prepare(
    'INSERT INTO generation_workflow_versions (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run('wf_text2img', 1, 'engine_comfy', '{}', JSON.stringify({ prompt: ['1.inputs.text'] }), '[]', JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }), 1, now);

  database.connection.prepare(
    'INSERT INTO app_generation_assignments (app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES (?,?,?,?,?,?)'
  ).run('activities', 'activity_image_text', 'wf_text2img', 1, 'engine_comfy', now);

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: sampleDocumentWithMediaSlots() },
  });
  assert.equal(created.statusCode, 201, created.body);

  const store = new ActivityStore(database);
  const activityId = created.json().activity.id as string;
  const initialActivity = created.json().activity;
  const contentRevisionId = initialActivity.currentContentRevisionId as string;

  // Create an initial image config revision for testing
  const imgRevId = `rev_img_${Date.now()}`;
  database.connection.prepare(`
    INSERT INTO activity_image_config_revisions (id, activity_id, parent_id, document_json, hash, created_at)
    VALUES (?, ?, NULL, ?, 'hash_img_1', ?)
  `).run(imgRevId, activityId, JSON.stringify({ schemaVersion: 1, stylePreset: 'anime', globalStylePrompt: '', globalNegativePrompt: '', slotConfigs: [] }), now);

  return {
    app,
    database,
    store,
    activityId,
    initialActivity,
    contentRevisionId,
    imageConfigRevisionId: imgRevId,
  };
}

test('prepareMediaBatch checks slot readiness, execution plan, and preflight warnings', async () => {
  const { app, database, store, activityId, contentRevisionId, imageConfigRevisionId } = await setup();
  try {
    const result = prepareMediaBatch(database, store, activityId, {
      contentRevisionId,
      imageConfigRevisionId,
      slotIds: ['slot_picnic_mat', 'non_existent_slot'],
    });

    assert.equal(result.readyItems.length, 1);
    assert.equal(result.readyItems[0].slotId, 'slot_picnic_mat');
    assert.equal(result.readyItems[0].ready, true);
    assert.equal(result.readyItems[0].workflowPurpose, 'activity_image_text');

    assert.equal(result.unreadyItems.length, 1);
    assert.equal(result.unreadyItems[0].slotId, 'non_existent_slot');
    assert.ok(result.unreadyItems[0].reason.includes('不存在'));
  } finally {
    await app.close();
    database.close();
  }
});

test('createMediaBatch validates version, enforces idempotency, and queues items', async () => {
  const { app, database, store, activityId, initialActivity, contentRevisionId, imageConfigRevisionId } = await setup();
  try {
    const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken });
    const secrets = new SecretStore({});

    const batch = await createMediaBatch(
      config,
      database,
      secrets,
      store,
      activityId,
      {
        expectedHeadVersion: initialActivity.headVersion,
        contentRevisionId,
        imageConfigRevisionId,
        items: [{ slotId: 'slot_picnic_mat', candidateCount: 2 }],
        idempotencyKey: 'idemp_batch_test_1',
      },
      async () => Response.json({ prompt_id: 'pid_1', number: 1 }),
    );

    assert.equal(batch.activityId, activityId);
    assert.equal(batch.items.length, 2);
    assert.equal(batch.summary.total, 2);
    assert.equal(batch.stopRequested, false);

    // Calling again with same idempotencyKey returns the same batch
    const repeatBatch = await createMediaBatch(
      config,
      database,
      secrets,
      store,
      activityId,
      {
        expectedHeadVersion: initialActivity.headVersion,
        contentRevisionId,
        imageConfigRevisionId,
        items: [{ slotId: 'slot_picnic_mat', candidateCount: 2 }],
        idempotencyKey: 'idemp_batch_test_1',
      },
    );
    assert.equal(repeatBatch.id, batch.id);

    // Verify GET routes
    const list = listMediaBatches(database, activityId);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, batch.id);

    const fetched = getMediaBatch(database, activityId, batch.id);
    assert.ok(fetched);
    assert.equal(fetched.id, batch.id);
  } finally {
    await app.close();
    database.close();
  }
});

test('cancelMediaBatch sets stop_requested and skips pending items', async () => {
  const { app, database, store, activityId, initialActivity, contentRevisionId, imageConfigRevisionId } = await setup();
  try {
    const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken });
    const secrets = new SecretStore({});

    const batch = await createMediaBatch(
      config,
      database,
      secrets,
      store,
      activityId,
      {
        expectedHeadVersion: initialActivity.headVersion,
        contentRevisionId,
        imageConfigRevisionId,
        items: [{ slotId: 'slot_picnic_mat', candidateCount: 1 }],
        idempotencyKey: 'idemp_cancel_test',
      },
    );

    const cancelled = await cancelMediaBatch(config, database, secrets, store, activityId, batch.id);
    assert.equal(cancelled.stopRequested, true);
  } finally {
    await app.close();
    database.close();
  }
});

test('reconcileMediaBatchesOnStartup preserves pending items for safe recovery', async () => {
  const { app, database, store, activityId, initialActivity, contentRevisionId, imageConfigRevisionId } = await setup();
  try {
    const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken });
    const secrets = new SecretStore({});

    const batch = await createMediaBatch(
      config,
      database,
      secrets,
      store,
      activityId,
      {
        expectedHeadVersion: initialActivity.headVersion,
        contentRevisionId,
        imageConfigRevisionId,
        items: [{ slotId: 'slot_picnic_mat', candidateCount: 1 }],
        idempotencyKey: 'idemp_reconcile_test',
      },
    );

    const count = reconcileMediaBatchesOnStartup(database);
    assert.ok(count >= 1);

    const reloaded = getMediaBatch(database, activityId, batch.id)!;
    assert.ok(reloaded.items.every((it) => it.state === 'waiting'));
    assert.equal(reloaded.summary.failed, 0);
  } finally {
    await app.close();
    database.close();
  }
});

test('selectMediaForSlots strictly rejects non-existent or empty 0-byte fake dummy assets', async () => {
  const { app, database, store, activityId, initialActivity } = await setup();
  try {
    // Attempting to select an arbitrary non-existent assetKey must throw invalid_asset error
    assert.throws(
      () => {
        selectMediaForSlots(database, store, activityId, {
          expectedHeadVersion: initialActivity.headVersion,
          slotBindings: [
            {
              slotId: 'slot_picnic_mat',
              slotFingerprint: 'dummy_fp',
              assets: [{ assetKey: 'completely_fake_asset_key', order: 1 }],
            },
          ],
        });
      },
      (err: any) => err.code === 'invalid_asset' || String(err).includes('不存在或文件为空'),
    );

    // Verify that NO dummy artifact was inserted into the artifacts table
    const fakeArtifacts = database.connection.prepare(
      "SELECT count(*) as cnt FROM artifacts WHERE app_id = 'activities' AND byte_size = 0"
    ).get() as { cnt: number };
    assert.equal(fakeArtifacts.cnt, 0);
  } finally {
    await app.close();
    database.close();
  }
});

test('batch dispatch freezes a valid plan, recovers attempt links, and retries without erasing history', async () => {
  const { app, database, store, activityId, initialActivity, contentRevisionId, imageConfigRevisionId } = await setup();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken });
  const secrets = new SecretStore({});
  try {
    const input = { expectedHeadVersion: initialActivity.headVersion, contentRevisionId, imageConfigRevisionId,
      items: [{ slotId: 'slot_picnic_mat', candidateCount: 1 as const }], idempotencyKey: 'dispatch-regression' };
    const batch = await createMediaBatch(config, database, secrets, store, activityId, input);
    await assert.rejects(createMediaBatch(config, database, secrets, store, activityId, { ...input, idempotencyKey: 'another-click' }), /已有未完成/);
    await assert.rejects(createMediaBatch(config, database, secrets, store, activityId, { ...input, items: [{ slotId: 'slot_picnic_mat', candidateCount: 2 }] }), /幂等键/);
    await processMediaBatch(config, database, secrets, store, activityId, batch.id, mockFetch);
    let current = getMediaBatch(database, activityId, batch.id)!;
    assert.ok(current.items[0].attemptId, JSON.stringify(current.items[0].error));
    assert.equal(database.connection.prepare('SELECT count(*) AS n FROM generation_tasks').get()!.n, 1);
    const attemptId = current.items[0].attemptId!;
    const taskId = current.items[0].generationTaskId!;
    database.connection.prepare("UPDATE activity_media_batch_items SET attempt_id=NULL,generation_task_id=NULL,state='preparing' WHERE id=?").run(current.items[0].id);
    await processMediaBatch(config, database, secrets, store, activityId, batch.id, mockFetch);
    current = getMediaBatch(database, activityId, batch.id)!;
    assert.equal(current.items[0].attemptId, attemptId);
    assert.equal(database.connection.prepare('SELECT count(*) AS n FROM generation_tasks').get()!.n, 1);
    database.connection.prepare("UPDATE generation_tasks SET status='failed',error_code='submission_outcome_unknown' WHERE id=?").run(taskId);
    assert.equal(getMediaBatch(database, activityId, batch.id)!.summary.displayState, 'needs_attention');
    await assert.rejects(retryFailedBatchItems(config, database, secrets, store, activityId, batch.id, mockFetch), /没有可直接重试/);
    database.connection.prepare("UPDATE generation_tasks SET status='failed',error_code='provider_failed' WHERE id=?").run(taskId);
    const retried = await retryFailedBatchItems(config, database, secrets, store, activityId, batch.id, mockFetch);
    assert.notEqual(retried.id, batch.id);
    assert.equal(retried.items[0].retryOfItemId, current.items[0].id);
    assert.equal(getMediaBatch(database, activityId, batch.id)!.items[0].attemptId, attemptId);
    await cancelMediaBatch(config, database, secrets, store, activityId, retried.id, mockFetch);
  } finally { await app.close(); database.close(); }
});

test('batch preparation freezes reference images and uses the edit purpose', async () => {
  const { app, database, store, activityId, imageConfigRevisionId } = await setup();
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-batch-reference-'));
  const config = readConfig({ STHSTART_ARTIFACT_DIR: artifactDirectory });
  const secrets = new SecretStore({});
  try {
    const image = await uploadActivityAsset(config, database, activityId, {
      stream: Readable.from([Buffer.from('test image bytes')]), contentType: 'image/png', customAssetKey: 'reference_face',
    });
    const draft = store.getDraft(activityId)!;
    draft.document.actors[0].appearanceReferenceAssetKeys = [image.assetKey];
    const updated = store.updateDraft(activityId, draft.draftVersion, draft.document);
    store.commitDraft(activityId, store.getActivity(activityId)!.headVersion, updated.draftVersion);
    const activity = store.getActivity(activityId)!;
    database.connection.prepare('INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES (?,?,?,?,?,?)')
      .run('activities', 'activity_image_edit', 'wf_text2img', 1, 'engine_comfy', new Date().toISOString());
    database.connection.prepare('UPDATE generation_workflow_versions SET node_bindings_json=?,input_capabilities_json=?,definition_json=? WHERE workflow_id=?')
      .run(JSON.stringify({ prompt: ['1.inputs.text'], sourceImage: ['2.inputs.image'] }),
        JSON.stringify({ sourceImage: { required: true, mediaTypes: ['image/png'], semantic: 'identity' } }),
        JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '2': { class_type: 'LoadImage', inputs: { image: '' } } }), 'wf_text2img');
    const batch = await createMediaBatch(config, database, secrets, store, activityId, {
      expectedHeadVersion: activity.headVersion, contentRevisionId: activity.currentContentRevisionId!, imageConfigRevisionId, idempotencyKey: "reference_batch",
      items: [{ slotId: 'slot_picnic_mat', candidateCount: 1 }],
    });
    const compiled = getPromptRecipe(database, activityId, String(batch.items[0].inputSnapshot.recipeId))!;
    assert.equal(compiled.recipe.references[0].artifactId, image.artifactId);
    assert.equal(compiled.recipe.references[0].role, 'identity');
    assert.equal(compiled.recipe.references[0].inputKey, 'sourceImage');
    assert.equal(compiled.compilation.executionPlan?.purpose, 'activity_image_edit');
    await cancelMediaBatch(config, database, secrets, store, activityId, batch.id, mockFetch);
  } finally { await app.close(); database.close(); rmSync(artifactDirectory, { recursive: true, force: true }); }
});

test('image rework is associated with a manually started mocked batch, without resolving on submission',async()=>{
  const {listReviewItems,decideReviewItems}=await import('./activities/review-items.js');
  const {app,database,store,activityId,imageConfigRevisionId}=await setup();
  const artifactDirectory=mkdtempSync(join(tmpdir(),'rework-output-'));
  const config=readConfig({STHSTART_ADMIN_TOKEN:adminToken,STHSTART_ARTIFACT_DIR:artifactDirectory});const secrets=new SecretStore({});
  try{
    const draft=store.getDraft(activityId)!;draft.document.actors[0].outfitDescription='待生成的新服装';
    const saved=store.updateDraft(activityId,draft.draftVersion,draft.document);const committed=store.commitDraft(activityId,store.getActivity(activityId)!.headVersion,saved.draftVersion);
    const item=listReviewItems(database,store,activityId).find(i=>i.targetId==='slot_picnic_mat'&&i.decision==='pending')!;assert.ok(item);
    decideReviewItems(database,store,activityId,{items:[item],decision:'rework',expectedHeadVersion:committed.activity.headVersion});
    const batch=await createMediaBatch(config,database,secrets,store,activityId,{expectedHeadVersion:committed.activity.headVersion,contentRevisionId:committed.contentRevisionId,imageConfigRevisionId,items:[{slotId:'slot_picnic_mat',candidateCount:1}],idempotencyKey:'rework-mock'});
    const linked=listReviewItems(database,store,activityId).find(i=>i.id===item.id)!;assert.equal(linked.execution?.kind,'image');assert.equal(linked.execution?.id,batch.id);assert.equal(linked.decision,'rework');
    await cancelMediaBatch(config,database,secrets,store,activityId,batch.id,mockFetch);
    // Simulate a provider result with an exact frozen recipe, without calling any GPU service.
    const prepared=getPromptRecipe(database,activityId,String(batch.items[0].inputSnapshot.recipeId))!;
    const image=await uploadActivityAsset(config,database,activityId,{stream:Readable.from([Buffer.from('mock generated image')]),contentType:'image/png',customAssetKey:'rework_result'});
    const attemptId=`mock_${crypto.randomUUID()}`;const now=new Date().toISOString();
    database.connection.prepare("INSERT INTO activity_image_attempts(id,activity_id,base_content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,recipe_id,compilation_id,recipe_hash,execution_plan_hash,task_id,status,actual_seed,business_request_hash,created_at,updated_at) VALUES(?,?,?,?,?, ?,?,?,'mock','mock','mock','succeeded',1,'mock',?,?)").run(attemptId,activityId,committed.contentRevisionId,imageConfigRevisionId,'slot_picnic_mat',prepared.recipe.slotFingerprint,prepared.recipe.id,prepared.compilation.id,now,now);
    database.connection.prepare('INSERT INTO activity_image_attempt_outputs(attempt_id,artifact_id,asset_key,created_at) VALUES(?,?,?,?)').run(attemptId,image.artifactId,image.assetKey,now);
    assert.equal(listReviewItems(database,store,activityId).find(i=>i.id===item.id)!.decision,'rework');
    const bindings=[{slotId:'slot_picnic_mat',slotFingerprint:prepared.recipe.slotFingerprint,assets:[{assetKey:image.assetKey,order:1}]}];
    store.saveMediaSelection(activityId,store.getActivity(activityId)!.headVersion,bindings);
    assert.equal(listReviewItems(database,store,activityId).find(i=>i.id===item.id)!.decision,'resolved');
    const next=store.getDraft(activityId)!;next.document.actors[0].outfitDescription='又修改了一次服装';const nextDraft=store.updateDraft(activityId,next.draftVersion,next.document);store.commitDraft(activityId,store.getActivity(activityId)!.headVersion,nextDraft.draftVersion);
    store.saveMediaSelection(activityId,store.getActivity(activityId)!.headVersion,bindings);
    assert.ok(listReviewItems(database,store,activityId).some(i=>i.targetId==='slot_picnic_mat'&&i.decision==='pending'));

  }finally{await app.close();database.close();rmSync(artifactDirectory,{recursive:true,force:true});}
});
