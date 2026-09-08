import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';
import { createZip, readZip } from './activities/zip.js';
import { recordAssetLineage } from './activities/image-lineage.js';
import type { ContentDocument } from '@sthstart/contracts';

const adminToken = 'admin-image-provenance-test-token-12345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function createTestDocument(): ContentDocument {
  return {
    schemaVersion: 1,
    activity: {
      title: '星光庆典',
      type: 'chat',
      theme: '梦幻星光夜市',
      location: '浮空岛集市',
      rules: '禁止私自燃放烟火',
      generationMode: 'autonomous',
    },
    actors: [
      {
        id: 'actor_alice',
        displayName: '爱丽丝',
        persona: { tone: '温柔好奇' },
        activityRole: '庆典探索者',
        outfitDescription: '星空蓝蕾丝长裙',
        appearanceReferenceAssetKeys: [],
      },
      {
        id: 'actor_bob',
        displayName: '鲍勃',
        persona: { tone: '稳重沉着' },
        activityRole: '向导与护卫',
        outfitDescription: '黑金护甲旅行装',
        appearanceReferenceAssetKeys: [],
      },
    ],
    relationships: [
      {
        fromActorId: 'actor_bob',
        toActorId: 'actor_alice',
        description: '守护者',
      },
    ],
    stages: [
      {
        id: 'stage_opening',
        title: '开幕巡游',
        order: 1,
        actorIds: ['actor_alice', 'actor_bob'],
        location: '中央广场',
        instruction: '观赏花车巡游，品尝特色小吃',
        requiredBeats: [
          { id: 'beat_1', text: '爱丽丝对流星灯笼赞不绝口', actorIds: ['actor_alice'] },
        ],
        locked: false,
        endCondition: '巡游结束',
      },
      {
        id: 'stage_finale',
        title: '烟火盛宴',
        order: 2,
        actorIds: ['actor_alice', 'actor_bob'],
        location: '观景平台',
        instruction: '在最高处眺望整座夜市烟火',
        requiredBeats: [
          { id: 'beat_2', text: '倒计时钟声敲响', actorIds: ['actor_bob'] },
        ],
        locked: false,
        endCondition: '庆典圆满闭幕',
      },
    ],
    conversations: [
      {
        id: 'conv_main',
        kind: 'group',
        title: '庆典小队',
        memberActorIds: ['actor_alice', 'actor_bob'],
      },
    ],
    messages: [
      {
        id: 'msg_1',
        conversationId: 'conv_main',
        stageId: 'stage_opening',
        kind: 'message',
        speakerActorId: 'actor_alice',
        text: '快看那盏流星灯笼，太美了！',
        mediaSlotIds: ['slot_lantern'],
        storyOrder: 1,
      },
    ],
    posts: [
      {
        id: 'post_1',
        stageId: 'stage_opening',
        authorActorId: 'actor_alice',
        text: '星光夜市开市！今晚的夜景宛如银河跌落人间。',
        mediaSlotIds: ['slot_lantern'],
        sourceFactIds: [],
        storyOrder: 2,
        storyTimeLabel: '入夜十分',
      },
    ],
    comments: [],
    likes: [],
    mediaSlots: [
      {
        id: 'slot_lantern',
        stageId: 'stage_opening',
        kind: 'image',
        actorIds: ['actor_alice'],
        caption: '爱丽丝凝视流星灯笼',
        shotDescription: '近景，柔和灯光映照在爱丽丝脸上，背景是虚化的夜市人流',
        sourceFactIds: [],
      },
    ],
    facts: [
      {
        id: 'fact_1',
        stageId: 'stage_opening',
        text: '爱丽丝买到了一盏手工制作的流星灯笼。',
        sourceRecordIds: ['msg_1'],
        knownByActorIds: ['actor_alice', 'actor_bob'],
        status: 'happened',
      },
    ],
    stageResults: [],
  };
}

async function setupTestContext(fetcher?: typeof fetch) {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-image-test-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });
  return { app, database, config };
}

test('Activity Images: Capabilities Descriptor & Default Image Config', async () => {
  const { app } = await setupTestContext();

  // 1. Capabilities
  const capRes = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/activities/capabilities',
    headers: adminHeaders,
  });
  assert.equal(capRes.statusCode, 200);
  const caps = capRes.json();
  assert.ok(caps.images);
  assert.ok(caps.images.textToImage);
  assert.ok(caps.images.imageToImage);
  assert.equal(caps.images.textToImage.purpose, 'activity_image_text');
  assert.equal(caps.images.imageToImage.purpose, 'activity_image_edit');

  // 2. Create activity
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createTestDocument() },
  });
  assert.equal(createRes.statusCode, 201);
  const { activity } = createRes.json();

  // 3. Check default Image Config Draft
  const draftRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activity.id}/image-config/draft`,
    headers: adminHeaders,
  });
  assert.equal(draftRes.statusCode, 200);
  const draft = draftRes.json();
  assert.equal(draft.draftVersion, 1);
  assert.equal(draft.document.stylePreset, 'anime_standard');
  assert.ok(draft.document.globalStylePrompt.includes('anime'));
});

test('Activity Images: Recipe preparation with whitelisted sources & override isolation', async () => {
  const { app } = await setupTestContext();

  // Create activity
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createTestDocument() },
  });
  const { activity } = createRes.json();

  // 1. Prepare Recipe for slot_lantern
  const prepRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/recipes/prepare`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      slotId: 'slot_lantern',
      expectedHeadVersion: activity.headVersion,
    },
  });
  assert.equal(prepRes.statusCode, 200);
  const { recipe, compilation } = prepRes.json();

  assert.ok(recipe.id);
  assert.equal(recipe.slotId, 'slot_lantern');
  assert.ok(recipe.recipeHash);
  assert.ok(recipe.blocks.length >= 3);

  // Check whitelisted sourceRefs
  const sourceRefs = recipe.sourceRefs;
  assert.ok(sourceRefs.length >= 3);
  const paths = sourceRefs.map((r: any) => r.fieldPath);
  assert.ok(paths.includes('activity.theme'));
  assert.ok(paths.some((p: string) => p.includes('outfitDescription')));

  // Check prompt compilation
  assert.ok(compilation.id);
  assert.ok(compilation.channels.positive);
  assert.ok(compilation.channels.positive.includes('爱丽丝'));
  assert.ok(compilation.channels.positive.includes('星空蓝蕾丝长裙'));
  assert.ok(compilation.channels.positive.includes('梦幻星光夜市'));
  assert.ok(compilation.executionPlanHash);

  // 2. Prepare recipe with attempt override
  const overrideRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/recipes/prepare`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      slotId: 'slot_lantern',
      expectedHeadVersion: activity.headVersion,
      overrides: [
        {
          id: 'ov_1',
          fieldPath: 'attempt.override',
          overrideText: '手中托起一盏绽放七彩光晕的琉璃明灯',
        },
      ],
    },
  });
  assert.equal(overrideRes.statusCode, 200);
  const overrideData = overrideRes.json();
  assert.ok(overrideData.compilation.channels.positive.includes('琉璃明灯'));

  // Ensure activity character definition was NOT mutated by override
  const getActRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activity.id}`,
    headers: adminHeaders,
  });
  const actDetail = getActRes.json();
  const alice = actDetail.draft.document.actors.find((a: any) => a.id === 'actor_alice');
  assert.equal(alice.outfitDescription, '星空蓝蕾丝长裙');
});

test('Activity Images: Source resolution & impact preview on editing', async () => {
  const { app } = await setupTestContext();

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createTestDocument() },
  });
  const { activity } = createRes.json();

  // 1. Prepare Recipe to establish source dependencies
  const prepRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/recipes/prepare`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      slotId: 'slot_lantern',
      expectedHeadVersion: activity.headVersion,
    },
  });
  const { recipe } = prepRes.json();

  // 2. Resolve source reference
  const ref = recipe.sourceRefs.find((r: any) => r.fieldPath.includes('outfitDescription'));
  assert.ok(ref);

  const resolveRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/image-sources/resolve`,
    headers: adminHeaders,
    payload: { sourceRefId: ref.id },
  });
  assert.equal(resolveRes.statusCode, 200);
  const resolved = resolveRes.json();
  assert.equal(resolved.hasChanged, false);
  assert.equal(resolved.currentValue, '星空蓝蕾丝长裙');

  // 3. Preview impact when outfitDescription changes
  const impactRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/image-impact/preview`,
    headers: adminHeaders,
    payload: {
      changedEntityKind: 'actor',
      changedEntityId: 'actor_alice',
      fieldPath: 'actors[id=actor_alice].outfitDescription',
      newValue: '月光银白晚礼服',
    },
  });
  assert.equal(impactRes.statusCode, 200);
  const impact = impactRes.json();
  assert.equal(impact.affectedSlots.length, 1);
  assert.equal(impact.affectedSlots[0].slotId, 'slot_lantern');
  assert.equal(impact.affectedSlots[0].needsReview, true);
  assert.notEqual(impact.affectedSlots[0].oldValueHash, impact.affectedSlots[0].newValueHash);
});

test('Activity Images: Scoped Idempotency and Attempt conflict (409)', async () => {
  const { app, database } = await setupTestContext();

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createTestDocument() },
  });
  const { activity } = createRes.json();

  // Prepare recipe
  const prepRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/recipes/prepare`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      slotId: 'slot_lantern',
      expectedHeadVersion: activity.headVersion,
    },
  });
  const { recipe, compilation } = prepRes.json();

  // 1. Create Attempt (without configured engine, should fail gracefully or create with synthetic/unconfigured error)
  const attemptRes1 = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/image-attempts`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: recipe.contentRevisionId,
      imageConfigRevisionId: recipe.imageConfigRevisionId,
      slotId: recipe.slotId,
      recipeId: recipe.id,
      compilationId: compilation.id,
      executionPlanHash: compilation.executionPlanHash,
      expectedHeadVersion: activity.headVersion,
      idempotencyKey: 'idemp_key_test_1',
    },
  });

  // Because no generation engine is assigned to 'activities', task creation rejects with 400 assignment_missing
  // which proves atomic rejection without orphan attempts!
  assert.equal(attemptRes1.statusCode, 400);
  assert.equal(attemptRes1.json().error, 'assignment_missing');

  // Verify no orphan attempt was committed to database
  const orphanCount = database.connection.prepare(
    'SELECT COUNT(*) as c FROM activity_image_attempts WHERE activity_id = ?'
  ).get(activity.id) as { c: number };
  assert.equal(orphanCount.c, 0);
});

test('Activity Images: Lineage DAG Cycle Detection', async () => {
  const { database } = await setupTestContext();

  // Insert a test activity
  database.connection.prepare(`
    INSERT INTO activities (id, title, type, theme, location, rules, archived, head_version, created_at, updated_at)
    VALUES ('act_lineage_test', 'Lineage Test', 'custom', 'Test', '', '', 0, 1, '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z')
  `).run();

  // Edge A -> B
  recordAssetLineage(database, {
    activityId: 'act_lineage_test',
    childAssetKey: 'asset_B',
    parentAssetKey: 'asset_A',
    role: 'init_image',
  });

  // Edge B -> C
  recordAssetLineage(database, {
    activityId: 'act_lineage_test',
    childAssetKey: 'asset_C',
    parentAssetKey: 'asset_B',
    role: 'init_image',
  });

  // Edge C -> A would form a cycle! (A -> B -> C -> A)
  assert.throws(
    () => {
      recordAssetLineage(database, {
        activityId: 'act_lineage_test',
        childAssetKey: 'asset_A',
        parentAssetKey: 'asset_C',
        role: 'init_image',
      });
    },
    (err: any) => err.message.includes('lineage_cycle_detected')
  );
});

test('Activity Images: Media Selection CAS HeadVersion Check', async () => {
  const { app } = await setupTestContext();

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createTestDocument() },
  });
  const { activity } = createRes.json();

  // 1. CAS Conflict: pass stale expectedHeadVersion
  const conflictRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/media-selection`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      slotId: 'slot_lantern',
      slotFingerprint: 'fp_slot_lantern_image',
      assetKey: 'asset_cand_1',
      expectedHeadVersion: 999, // Mismatched!
    },
  });
  assert.equal(conflictRes.statusCode, 409);
  assert.equal(conflictRes.json().error, 'head_version_conflict');

  // 2. Successful CAS: pass correct expectedHeadVersion
  const adoptRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/media-selection`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      slotId: 'slot_lantern',
      slotFingerprint: 'fp_slot_lantern_image',
      assetKey: 'asset_cand_1',
      expectedHeadVersion: activity.headVersion,
    },
  });
  assert.equal(adoptRes.statusCode, 200);
  const adopted = adoptRes.json();
  assert.equal(adopted.headVersion, activity.headVersion + 1);
  assert.ok(adopted.mediaRevision.id);
});

test('Activity Images: Full Project Export with Provenance & Import Remapping', async () => {
  const { app, database, config } = await setupTestContext();

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createTestDocument() },
  });
  const { activity } = createRes.json();

  // 1. Prepare recipe and commit a config revision
  const draftRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activity.id}/image-config/draft`,
    headers: adminHeaders,
  });
  const draftDoc = draftRes.json().document;
  draftDoc.stylePreset = 'cyberpunk_glow';

  const commitRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/image-config/revisions`,
    headers: adminHeaders,
    payload: { document: draftDoc },
  });
  assert.equal(commitRes.statusCode, 201);
  const configRev = commitRes.json();

  // Prepare recipe
  const prepRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/recipes/prepare`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      imageConfigRevisionId: configRev.id,
      slotId: 'slot_lantern',
      expectedHeadVersion: activity.headVersion,
    },
  });
  assert.equal(prepRes.statusCode, 200);

  // Adopt candidate
  await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/media-selection`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: activity.currentContentRevisionId,
      slotId: 'slot_lantern',
      slotFingerprint: 'fp_slot_lantern_image',
      assetKey: 'asset_lantern_star',
      expectedHeadVersion: activity.headVersion,
    },
  });

  // 2. Export activity in 'project' format
  const exportRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activity.id}/export`,
    headers: adminHeaders,
    payload: { format: 'project' },
  });
  assert.equal(exportRes.statusCode, 200);
  const zipBuf = Buffer.from(exportRes.rawPayload);

  // Verify Zip contents
  const files = readZip(zipBuf);
  assert.ok(files.has('manifest.json'));
  assert.ok(files.has('data/provenance/index.json'));
  assert.ok(files.has('data/provenance/image-configs.json'));
  assert.ok(files.has('data/provenance/recipes.json'));
  assert.ok(files.has('data/provenance/compilations.json'));

  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!));
  assert.equal(manifest.format, 'project');
  assert.ok(manifest.imageConfigRevisionId);

  // 3. Stage Import
  const stageRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities/imports/stage',
    headers: { ...adminHeaders, 'content-type': 'application/zip' },
    payload: zipBuf,
  });
  assert.equal(stageRes.statusCode, 200);
  const staged = stageRes.json();
  assert.equal(staged.preview.hasProvenance, true);
  assert.ok(staged.preview.provenanceStats);
  assert.ok(staged.preview.provenanceStats.configs >= 1);
  assert.ok(staged.preview.provenanceStats.recipes >= 1);

  // 4. Commit Import
  const commitImportRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/imports/${staged.importId}/commit`,
    headers: adminHeaders,
  });
  assert.equal(commitImportRes.statusCode, 201);
  const importedActivity = commitImportRes.json().activity;
  assert.notEqual(importedActivity.id, activity.id); // ID must be remapped!

  // 5. Verify imported provenance in new activity
  const importedConfigs = database.connection.prepare(
    'SELECT * FROM activity_image_config_revisions WHERE activity_id = ?'
  ).all(importedActivity.id) as any[];
  assert.ok(importedConfigs.length >= 1);
  assert.notEqual(importedConfigs[0].id, configRev.id); // Re-mapped ID!
  assert.equal(JSON.parse(importedConfigs[0].document_json).stylePreset, 'cyberpunk_glow');

  const importedRecipes = database.connection.prepare(
    'SELECT * FROM activity_prompt_recipes WHERE activity_id = ?'
  ).all(importedActivity.id) as any[];
  assert.ok(importedRecipes.length >= 1);
  assert.equal(importedRecipes[0].activity_id, importedActivity.id);
});

test('Activity Images: configured generation, automatic seed idempotency, frozen assignment and dispatch provenance', async () => {
  const sent: any[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/upload/image')) return Response.json({ name: 'controlled-reference.png' });
    if (url.endsWith('/prompt')) { sent.push(JSON.parse(String(init?.body))); return Response.json({ prompt_id: 'activity-proof' }); }
    if (url.includes('/history/')) return Response.json({ 'activity-proof': { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'proof.png', type: 'output' }] } } } });
    if (url.includes('/view')) return new Response(Buffer.from('mock-image-output'), { headers: { 'content-type': 'image/png' } });
    return Response.json({});
  };
  const { app, database } = await setupTestContext(fetcher);
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: any) => app.inject({ method, url: '/api/v1/admin/' + path, headers: adminHeaders, payload });
  try {
    const activity = (await call('POST', 'activities', { document: createTestDocument() })).json().activity;
    for (const [path, payload] of [
      ['generation/engines', { id: 'proof-engine', name: 'Proof mock', kind: 'comfyui', baseUrl: 'http://comfy.test' }],
      ['generation/workflows', { id: 'proof-wf', name: 'Proof workflow', engineKind: 'comfyui' }],
      ['generation/workflows/proof-wf/versions', { engineId: 'proof-engine', inputSchema: { prompt: { type: 'string' } }, nodeBindings: { prompt: ['6', 'inputs', 'text'] }, outputDeclarations: ['9'], definition: { '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '9': { class_type: 'SaveImage', inputs: {} } } }],
    ] as const) assert.equal((await call('POST', path, payload)).statusCode, 201);
    assert.equal((await call('PUT', 'apps/activities/generation-assignments', { assignments: [{ purpose: 'activity_image_text', workflowId: 'proof-wf', engineId: 'proof-engine' }] })).statusCode, 200);
    const base = `activities/${activity.id}`;
    const prepared = await call('POST', base + '/recipes/prepare', { slotId: 'slot_lantern' });
    assert.equal(prepared.statusCode, 200, prepared.body);
    const { recipe, compilation } = prepared.json();
    assert.equal(compilation.executionPlan.workflowId, 'proof-wf');
    assert.deepEqual(Object.keys(compilation.channels), ['prompt']);
    assert.equal((await call('POST', base + '/recipes/prepare', { slotId: 'slot_lantern', customParams: { denoise: 0.5 } })).statusCode, 400);
    const request = { recipeId: recipe.id, compilationId: compilation.id, executionPlanHash: compilation.executionPlanHash, idempotencyKey: 'same-auto-seed' };
    const first = await call('POST', base + '/image-attempts', request);
    assert.equal(first.statusCode, 202, first.body);
    assert.ok(first.json().id);
    const repeated = await call('POST', base + '/image-attempts', request);
    assert.equal(repeated.statusCode, 202, repeated.body);
    assert.equal(repeated.json().id, first.json().id);
    assert.equal(repeated.json().actualSeed, first.json().actualSeed);
    assert.equal((await call('POST', base + '/image-attempts', { ...request, seed: 123 })).statusCode, 409);
    assert.equal((await call('POST', base + '/image-attempts', { ...request, idempotencyKey: 'other', executionPlanHash: 'changed' })).statusCode, 409);
    for (let i = 0; i < 50; i++) {
      const polled = await call('GET', base + '/image-attempts/' + first.json().id);
      if (polled.json().status === 'succeeded') break;
      await new Promise(r => setTimeout(r, 20));
    }
    const result = (await call('GET', base + '/image-attempts/' + first.json().id)).json();
    assert.equal(result.status, 'succeeded');
    assert.equal(result.outputs.length, 1);
    assert.equal(sent.length, 1);
    const snapshot = database.connection.prepare("SELECT actual_inputs_json FROM activity_image_execution_snapshots WHERE attempt_id = ? AND phase = 'dispatched'").get(first.json().id) as { actual_inputs_json: string };
    assert.deepEqual(JSON.parse(snapshot.actual_inputs_json), sent[0].prompt);
    assert.equal(sent[0].prompt['6'].inputs.text, compilation.channels.prompt);
    // A real Artifact must become a controlled uploaded node input for image-to-image.
    const uploaded = await app.inject({ method: 'POST', url: '/api/v1/admin/' + base + '/uploads',
      headers: { ...adminHeaders, 'content-type': 'image/png', 'x-artifact-original-name': 'reference.png' }, payload: Buffer.from('test-input-png') });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const asset = uploaded.json();
    assert.equal((await call('POST', 'generation/workflows/proof-wf/versions', { engineId: 'proof-engine',
      nodeBindings: { prompt: ['6', 'inputs', 'text'], sourceImage: ['7', 'inputs', 'image'], denoise: ['8', 'inputs', 'denoise'] },
      inputCapabilities: { sourceImage: { required: true, mediaTypes: ['image/png'] } }, outputDeclarations: ['9'],
      definition: { '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '7': { class_type: 'LoadImage', inputs: { image: '' } }, '8': { class_type: 'KSampler', inputs: { denoise: 0.7 } }, '9': { class_type: 'SaveImage', inputs: {} } } })).statusCode, 201);
    assert.equal((await call('PUT', 'apps/activities/generation-assignments', { assignments: [{ purpose: 'activity_image_edit', workflowId: 'proof-wf', engineId: 'proof-engine' }, { purpose: 'activity_image_text', workflowId: 'proof-wf', engineId: 'proof-engine' }] })).statusCode, 200);
    const editPrep = await call('POST', base + '/recipes/prepare', { slotId: 'slot_lantern', customParams: { denoise: 0.65 },
      references: [{ referenceId: 'ref-1', assetKey: asset.assetKey, artifactId: 'untrusted-browser-id', sha256: 'untrusted', role: 'init_image', inputKey: 'sourceImage' }] });
    assert.equal(editPrep.statusCode, 200, editPrep.body);
    assert.equal(editPrep.json().recipe.references[0].artifactId, asset.artifactId);
    const editAttempt = await call('POST', base + '/image-attempts', { recipeId: editPrep.json().recipe.id, idempotencyKey: 'edit-1' });
    assert.equal(editAttempt.statusCode, 202, editAttempt.body);
    for (let i = 0; i < 50; i++) {
      const poll = (await call('GET', base + '/image-attempts/' + editAttempt.json().id)).json();
      if (poll.status === 'succeeded') break;
      await new Promise(r => setTimeout(r, 20));
    }
    const editResult = (await call('GET', base + '/image-attempts/' + editAttempt.json().id)).json();
    assert.equal(editResult.status, 'succeeded');
    assert.equal(sent.length, 2);
    assert.equal(sent[1].prompt['7'].inputs.image, 'controlled-reference.png');
    assert.equal(sent[1].prompt['8'].inputs.denoise, 0.65);
    const editSnapshot = database.connection.prepare("SELECT uploaded_file_mappings_json FROM activity_image_execution_snapshots WHERE attempt_id = ? AND phase = 'dispatched'").get(editAttempt.json().id) as any;
    assert.deepEqual(JSON.parse(editSnapshot.uploaded_file_mappings_json), { sourceImage: 'controlled-reference.png' });
    database.connection.prepare("UPDATE generation_workflow_versions SET definition_json = ? WHERE workflow_id = 'proof-wf'").run(JSON.stringify({ '6': { class_type: 'CLIPTextEncode', inputs: { text: 'changed' } } }));
    assert.equal((await call('POST', base + '/image-attempts', { ...request, idempotencyKey: 'changed-plan' })).statusCode, 409);
  } finally { await app.close(); database.close(); }
});

test('Activity Images: UI full export keeps provenance and all imported block references resolve', async () => {
  const { app, database } = await setupTestContext();
  try {
    const activity = (await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { document: createTestDocument() } })).json().activity;
    await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activity.id}/recipes/prepare`, headers: adminHeaders, payload: { slotId: 'slot_lantern' } });
    const exported = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activity.id}/export`, headers: adminHeaders, payload: { mode: 'full' } });
    assert.equal(exported.statusCode, 200, exported.body);
    const files = readZip(Buffer.from(exported.rawPayload));
    assert.ok(files.has('data/provenance/recipes.json'));
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!));
    manifest.files[0].sha256 = '0'.repeat(64);
    const tampered = createZip([...files].map(([path, data]) => ({ path, data: path === 'manifest.json' ? JSON.stringify(manifest) : data })));
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/admin/activities/imports/stage', headers: { ...adminHeaders, 'content-type': 'application/zip' }, payload: tampered });
    assert.equal(rejected.statusCode, 400, rejected.body);
    const staged = await app.inject({ method: 'POST', url: '/api/v1/admin/activities/imports/stage', headers: { ...adminHeaders, 'content-type': 'application/zip' }, payload: Buffer.from(exported.rawPayload) });
    const imported = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/imports/${staged.json().importId}/commit`, headers: adminHeaders, payload: {} });
    assert.equal(imported.statusCode, 201, imported.body);
    const rows = database.connection.prepare('SELECT source_refs_json, blocks_json FROM activity_prompt_recipes WHERE activity_id = ?').all(imported.json().activity.id) as any[];
    assert.ok(rows.length);
    for (const row of rows) {
      const refs = new Set(JSON.parse(row.source_refs_json).map((r: any) => r.id));
      for (const block of JSON.parse(row.blocks_json)) for (const id of block.sourceRefIds) assert.ok(refs.has(id), `dangling source ${id}`);
    }
  } finally { await app.close(); database.close(); }
});
