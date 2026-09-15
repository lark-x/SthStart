import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { adoptCandidate } from './activities/text-jobs.js';
import { selectMediaForSlots } from './activities/media.js';
import { previewSourceImpact } from './activities/image-impact.js';

const adminToken = 'activity-locking-token-123456789012345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function sampleDocumentWithLocks() {
  return {
    schemaVersion: 1 as const,
    activity: {
      title: '庆功宴会',
      type: '庆功宴',
      theme: '年度表彰',
      location: '宴会厅',
      rules: '',
      generationMode: 'fill_details' as const,
      scheduledDate: '2026-09-15',
    },
    actors: [
      {
        id: 'actor_alice',
        displayName: '爱丽丝',
        activityRole: '主持人',
        outfitDescription: '晚礼服',
        appearanceReferenceAssetKeys: [],
        persona: { displayName: '爱丽丝', identity: '主持人' },
      },
      {
        id: 'actor_bob',
        displayName: '鲍勃',
        activityRole: '领奖代表',
        outfitDescription: '正装西服',
        appearanceReferenceAssetKeys: [],
        persona: { displayName: '鲍勃', identity: '代表' },
      },
    ],
    relationships: [],
    stages: [
      {
        id: 'stage_1',
        title: '开场致辞',
        order: 1,
        actorIds: ['actor_alice'],
        location: '宴会厅舞台',
        instruction: '欢迎来宾',
        requiredBeats: [],
        locked: true, // Stage 1 is locked!
        endCondition: '',
      },
      {
        id: 'stage_2',
        title: '颁奖环节',
        order: 2,
        actorIds: ['actor_alice', 'actor_bob'],
        location: '颁奖台',
        instruction: '颁发年度奖项',
        requiredBeats: [],
        locked: false, // Stage 2 is unlocked
        endCondition: '',
      },
    ],
    conversations: [{ id: 'conv_main', stageId: 'stage_1', title: '主群聊', actorIds: ['actor_alice', 'actor_bob'] }],
    messages: [
      {
        id: 'msg_locked_1',
        conversationId: 'conv_main',
        stageId: 'stage_1',
        kind: 'message' as const,
        speakerActorId: 'actor_alice',
        text: '欢迎大家参加今晚的宴会！',
        mediaSlotIds: ['slot_stage1_pic'],
        storyOrder: 10,
      },
      {
        id: 'msg_normal_2',
        conversationId: 'conv_main',
        stageId: 'stage_2',
        kind: 'message' as const,
        speakerActorId: 'actor_bob',
        text: '感谢大家的认可。',
        mediaSlotIds: [],
        storyOrder: 20,
      },
    ],
    posts: [
      {
        id: 'post_locked_1',
        stageId: 'stage_1',
        authorActorId: 'actor_alice',
        text: '盛大的开场！',
        mediaSlotIds: ['slot_stage1_pic'],
        storyOrder: 15,
        sourceFactIds: [],
      },
    ],
    comments: [],
    likes: [],
    mediaSlots: [
      {
        id: 'slot_stage1_pic',
        stageId: 'stage_1',
        kind: 'image' as const,
        caption: '开场舞台全景',
        shotDescription: '华丽的宴会厅舞台',
        actorIds: ['actor_alice'],
        sourceFactIds: [],
      },
      {
        id: 'slot_stage2_award',
        stageId: 'stage_2',
        kind: 'image' as const,
        caption: '鲍勃领奖特写',
        shotDescription: '手捧奖杯微笑',
        actorIds: ['actor_bob'],
        sourceFactIds: [],
      },
    ],
    facts: [],
    stageResults: [],
    editingPolicy: {
      lockedRecords: [
        { kind: 'message' as const, id: 'msg_locked_1' },
        { kind: 'post' as const, id: 'post_locked_1' },
      ],
      lockedMediaSlotIds: [], // Start unlocked so initial binding succeeds
    },
  };
}

async function createTestContext() {
  const database = new ServiceDatabase();
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
  });
  const secrets = new SecretStore({});

  const { app } = await createService({ config, database, secrets });

  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('prod-test-llm', 'LLM', 'llm', 'http://llm.test/v1', 'test-model', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'prod-test-llm', ?)")
    .run(now);

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: sampleDocumentWithLocks() },
  });
  assert.equal(created.statusCode, 201, created.body);
  const activityId = created.json().activity.id;

  const store = new ActivityStore(database);

  // Insert real artifact for slot_stage1_pic
  database.connection.prepare(`
    INSERT INTO artifacts (id, app_id, local_path, content_type, byte_size, pinned, created_at)
    VALUES ('art_stage1_img', 'activities', 'activities/test.png', 'image/png', 1024, 0, '2026-09-15T00:00:00Z')
  `).run();

  database.connection.prepare(`
    INSERT INTO activity_assets (activity_id, asset_key, artifact_id, source, type, hash, created_at)
    VALUES (?, 'key_stage1', 'art_stage1_img', 'upload', 'image', 'hash1234', '2026-09-15T00:00:00Z')
  `).run(activityId);

  // Set initial media binding
  selectMediaForSlots(database, store, activityId, {
    expectedHeadVersion: created.json().activity.headVersion,
    slotBindings: [
      {
        slotId: 'slot_stage1_pic',
        slotFingerprint: 'fp1',
        assets: [{ assetKey: 'key_stage1', order: 0 }],
      },
    ],
  });

  // Now lock slot_stage1_pic in content document and commit
  const draft = store.getDraft(activityId)!;
  const docWithLockedSlot = {
    ...draft.document,
    editingPolicy: {
      ...draft.document.editingPolicy,
      lockedRecords: draft.document.editingPolicy?.lockedRecords || [],
      lockedMediaSlotIds: ['slot_stage1_pic'],
    },
  };
  const updatedDraft = store.updateDraft(activityId, draft.draftVersion, docWithLockedSlot);
  store.commitDraft(activityId, store.getActivity(activityId)!.headVersion, updatedDraft.draftVersion);

  return { app, database, secrets, store, activityId };
}

test('M4 Locking: generation jobs reject locked stages and locked records', async () => {
  const { app, activityId } = await createTestContext();

  // 1. Trying to generate content for locked stage_1 should return 400 stage_locked
  const stageRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/generation-jobs`,
    headers: adminHeaders,
    payload: {
      mode: 'stage',
      scope: { stageId: 'stage_1' },
      userInstruction: '重新生成开场致辞',
    },
  });
  assert.equal(stageRes.statusCode, 400);
  const stageJson = stageRes.json();
  assert.equal(stageJson.error, 'stage_locked');

  // 2. Trying to rewrite a locked message should return 400 record_locked
  const rewriteRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/generation-jobs`,
    headers: adminHeaders,
    payload: {
      mode: 'rewrite-records',
      scope: { recordIds: ['msg_locked_1'] },
      userInstruction: '优化语气',
    },
  });
  assert.equal(rewriteRes.statusCode, 400);
  const rewriteJson = rewriteRes.json();
  assert.equal(rewriteJson.error, 'record_locked');

  await app.close();
});

test('M4 Locking: adoptCandidate rejects overwriting locked stage or locked message', async () => {
  const { app, database, store, activityId } = await createTestContext();

  // Create candidate targeting locked stage_1
  const candStage = store.createCandidate({
    activityId,
    scope: { mode: 'stage', stageId: 'stage_1' },
    payload: {
      stageId: 'stage_1',
      summary: '新的致辞',
      facts: [],
      conversations: [],
      messages: [{ conversationId: 'conv_main', stageId: 'stage_1', speakerActorId: 'actor_alice', text: '全新致辞' }],
      posts: [],
      comments: [],
      likes: [],
      mediaSlots: [],
    },
    validation: { isValid: true, errors: [] },
  });

  const head = store.getActivity(activityId)!;
  assert.throws(
    () => adoptCandidate(database, store, activityId, candStage.id, head.headVersion),
    (err: any) => err.code === 'stage_locked',
  );

  // Create candidate rewriting locked message msg_locked_1
  const candRewrite = store.createCandidate({
    activityId,
    scope: { mode: 'rewrite-records', recordIds: ['msg_locked_1'] },
    payload: {
      rewrittenMessages: [{ id: 'msg_locked_1', text: '被非法改写的文本' }],
    },
    validation: { isValid: true, errors: [] },
  });

  assert.throws(
    () => adoptCandidate(database, store, activityId, candRewrite.id, head.headVersion),
    (err: any) => err.code === 'record_locked',
  );

  await app.close();
});

test('M4 Locking: draft update rejects deleting locked stages or locked records without unlocking', async () => {
  const { app, store, activityId } = await createTestContext();

  const draft = store.getDraft(activityId)!;
  const doc = draft.document;

  // 1. Try to delete locked stage_1
  const docWithoutStage1 = {
    ...doc,
    stages: doc.stages.filter((s) => s.id !== 'stage_1'),
  };

  const deleteStageRes = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: {
      expectedDraftVersion: draft.draftVersion,
      document: docWithoutStage1,
    },
  });
  assert.equal(deleteStageRes.statusCode, 400);
  assert.equal(deleteStageRes.json().error, 'stage_locked');

  // 2. Try to delete locked message msg_locked_1
  const docWithoutMsg = {
    ...doc,
    messages: doc.messages.filter((m) => m.id !== 'msg_locked_1'),
  };

  const deleteMsgRes = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: {
      expectedDraftVersion: draft.draftVersion,
      document: docWithoutMsg,
    },
  });
  assert.equal(deleteMsgRes.statusCode, 400);
  assert.equal(deleteMsgRes.json().error, 'record_locked');

  // 3. Try to unlink media slot from locked message
  const docWithUnlinkedSlot = {
    ...doc,
    messages: doc.messages.map((m) => m.id === 'msg_locked_1' ? { ...m, mediaSlotIds: [] } : m),
  };

  const unlinkRes = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: {
      expectedDraftVersion: draft.draftVersion,
      document: docWithUnlinkedSlot,
    },
  });
  assert.equal(unlinkRes.statusCode, 400);
  assert.equal(unlinkRes.json().error, 'record_locked');

  await app.close();
});

test('M4 Locking: selectMediaForSlots rejects altering bindings of locked media slot', async () => {
  const { database, store, activityId } = await createTestContext();
  const head = store.getActivity(activityId)!;

  // Register another asset
  database.connection.prepare(`
    INSERT INTO artifacts (id, app_id, local_path, content_type, byte_size, pinned, created_at)
    VALUES ('art_stage1_alt', 'activities', 'activities/alt.png', 'image/png', 1024, 0, '2026-09-15T00:00:00Z')
  `).run();
  database.connection.prepare(`
    INSERT INTO activity_assets (activity_id, asset_key, artifact_id, source, type, hash, created_at)
    VALUES (?, 'key_alt', 'art_stage1_alt', 'upload', 'image', 'hashalt', '2026-09-15T00:00:00Z')
  `).run(activityId);

  // Attempt to replace locked slot_stage1_pic with key_alt
  assert.throws(
    () => selectMediaForSlots(database, store, activityId, {
      expectedHeadVersion: head.headVersion,
      slotBindings: [
        {
          slotId: 'slot_stage1_pic',
          slotFingerprint: 'fp1',
          assets: [{ assetKey: 'key_alt', order: 0 }],
        },
      ],
    }),
    (err: any) => err.code === 'slot_locked',
  );
});

test('M4 Impact Analysis: previewSourceImpact identifies structural dependencies of uncompiled slots', async () => {
  const { database, store, activityId } = await createTestContext();

  // Changing actor_alice's outfit affects slot_stage1_pic structurally even without compiled recipe
  const impactAlice = previewSourceImpact(database, store, activityId, {
    changedEntityKind: 'actor',
    changedEntityId: 'actor_alice',
    fieldPath: 'outfitDescription',
    newValue: '银白晚礼服',
  });

  assert.equal(impactAlice.affectedSlots.length, 1);
  assert.equal(impactAlice.affectedSlots[0].slotId, 'slot_stage1_pic');
  assert.equal(impactAlice.affectedSlots[0].needsReview, true);

  // Changing actor_bob's outfit affects slot_stage2_award
  const impactBob = previewSourceImpact(database, store, activityId, {
    changedEntityKind: 'actor',
    changedEntityId: 'actor_bob',
    fieldPath: 'outfitDescription',
    newValue: '红色领结',
  });

  assert.equal(impactBob.affectedSlots.length, 1);
  assert.equal(impactBob.affectedSlots[0].slotId, 'slot_stage2_award');
});

test('locks also protect edits and stage replacement through the shared store', async () => {
  const { app, database, store, activityId } = await createTestContext();
  try {
    const draft = store.getDraft(activityId)!;
    const changed = structuredClone(draft.document);
    changed.messages.find(message => message.id === 'msg_locked_1')!.text = '绕过页面直接修改';
    assert.throws(() => store.updateDraft(activityId, draft.draftVersion, changed), /锁定/);
    assert.equal(store.getDraft(activityId)!.draftVersion, draft.draftVersion);
    const next = structuredClone(draft.document);
    next.editingPolicy!.lockedRecords.push({ kind: 'message', id: 'msg_normal_2' });
    store.updateDraft(activityId, draft.draftVersion, next);
    const response = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/generation-jobs`,
      headers: adminHeaders, payload: { mode: 'stage', scope: { stageId: 'stage_2' } } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'record_locked');
  } finally { await app.close(); database.close(); }
});
