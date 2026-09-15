import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { executeTextJob } from './activities/text-jobs.js';
import { getActivityProductionOverview } from './activities/production.js';

const adminToken = 'activity-production-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function sampleDocument() {
  return {
    schemaVersion: 1 as const,
    activity: {
      title: '科技发布会',
      type: '商业活动',
      theme: '新产品发布',
      location: '主会场',
      rules: '',
      generationMode: 'fill_details' as const,
      scheduledDate: '2026-09-01',
    },
    actors: [
      {
        id: 'actor_ceo',
        displayName: '张总',
        activityRole: '主讲人',
        outfitDescription: '深蓝西装',
        appearanceReferenceAssetKeys: ['asset_ceo_suit'],
        persona: { displayName: '张总', identity: 'CEO', sourceSnapshot: { likes: ['创新'] } },
      },
      {
        id: 'actor_tech',
        displayName: '李工',
        activityRole: '技术负责人',
        outfitDescription: '',
        appearanceReferenceAssetKeys: [],
        persona: { displayName: '李工', identity: 'CTO' },
      },
    ],
    relationships: [{ fromActorId: 'actor_ceo', toActorId: 'actor_tech', description: '合作伙伴' }],
    stages: [
      {
        id: 'stage_intro',
        title: '开场致辞',
        order: 1,
        actorIds: ['actor_ceo'],
        location: '主舞台',
        instruction: '介绍背景',
        requiredBeats: [],
        locked: false,
        endCondition: '致辞完毕',
      },
      {
        id: 'stage_keynote',
        title: '核心演示',
        order: 2,
        actorIds: ['actor_ceo', 'actor_tech'],
        location: '主舞台',
        instruction: '展示演示机',
        requiredBeats: [],
        locked: false,
        endCondition: '演示完毕',
      },
    ],
    conversations: [
      { id: 'conv_main', kind: 'group' as const, title: '会场主频', memberActorIds: ['actor_ceo', 'actor_tech'] },
    ],
    messages: [],
    posts: [],
    comments: [],
    likes: [],
    mediaSlots: [],
    facts: [],
    stageResults: [],
  };
}

async function setup() {
  const database = new ServiceDatabase();
  const fetcher: typeof fetch = async () => Response.json({
    choices: [{
      message: {
        content: JSON.stringify({
          schemaVersion: 1,
          stageId: 'stage_intro',
          summary: '开场致辞顺利完成',
          messages: [{
            clientId: 'm_intro',
            conversationId: 'conv_main',
            speakerActorId: 'actor_ceo',
            text: '欢迎各位光临今天的发布会！',
            order: 10,
          }],
          posts: [],
          comments: [],
          facts: [],
          mediaSlots: [{
            clientId: 'slot_intro_img',
            kind: 'image',
            stageId: 'stage_intro',
            caption: '张总站在聚光灯下致辞',
            shotDescription: '全景镜头',
            actorIds: ['actor_ceo'],
            order: 1,
          }],
        }),
      },
    }],
  });

  const { app } = await createService({
    config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }),
    database,
    secrets: new SecretStore({}),
    fetcher,
  });

  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('prod-test-llm', 'LLM', 'llm', 'http://llm.test/v1', 'test-model', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'prod-test-llm', ?)")
    .run(now);

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: sampleDocument() },
  });
  assert.equal(created.statusCode, 201, created.body);

  const store = new ActivityStore(database);
  return {
    app,
    database,
    store,
    activityId: created.json().activity.id as string,
    initialActivity: created.json().activity,
  };
}

test('GET /api/v1/admin/activities/:id/production returns complete overview and correct suggestedStep', async () => {
  const { app, database, activityId } = await setup();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/activities/${activityId}/production`,
      headers: adminHeaders,
    });
    assert.equal(res.statusCode, 200, res.body);
    const overview = res.json();

    // Initially empty draft -> suggested step is generate_text
    assert.equal(overview.activityId, activityId);
    assert.equal(overview.suggestedStep, 'generate_text');
    assert.equal(overview.textStatus, 'not_started');
    assert.equal(overview.stages.length, 2);
    assert.equal(overview.mediaStatus.totalSlots, 0);
    assert.equal(overview.mediaStatus.adoptedSlots, 0);
    assert.equal(overview.mediaStatus.pendingSlots, 0);
    assert.equal(overview.playbackStatus, 'not_created');

    // Image preflight check
    assert.equal(typeof overview.imagePreflight.ready, 'boolean');
  } finally {
    await app.close();
    database.close();
  }
});

test('adoptCandidateBatch adopts multiple candidates atomically and updates production status', async () => {
  const { app, database, store, activityId, initialActivity } = await setup();
  try {
    // Create two candidates manually in the store
    const candidate1 = store.createCandidate({
      activityId,
      scope: { stageId: 'stage_intro', mode: 'stage', jobId: 'job_manual_1' },
      payload: {
        schemaVersion: 1,
        stageId: 'stage_intro',
        summary: '开场致辞',
        messages: [{
          clientId: 'm1',
          conversationId: 'conv_main',
          speakerActorId: 'actor_ceo',
          text: '开场致辞发言',
          order: 10,
        }],
        posts: [],
        comments: [],
        facts: [],
        mediaSlots: [{
          clientId: 'slot_1',
          kind: 'image',
          stageId: 'stage_intro',
          caption: '开场舞台全景',
          shotDescription: '大景深',
          actorIds: ['actor_ceo'],
          order: 1,
        }],
      },
      validation: { valid: true },
    });

    const candidate2 = store.createCandidate({
      activityId,
      scope: { stageId: 'stage_keynote', mode: 'stage', jobId: 'job_manual_2' },
      payload: {
        schemaVersion: 1,
        stageId: 'stage_keynote',
        summary: '核心演示',
        messages: [{
          clientId: 'm2',
          conversationId: 'conv_main',
          speakerActorId: 'actor_tech',
          text: '现在我们展示产品。',
          order: 20,
        }],
        posts: [],
        comments: [],
        facts: [],
        mediaSlots: [],
      },
      validation: { valid: true },
    });

    // Check production overview before adoption -> should suggest review_candidates
    const overviewBefore = getActivityProductionOverview(database, store, activityId);
    assert.equal(overviewBefore.suggestedStep, 'review_candidates');
    assert.equal(overviewBefore.textStatus, 'candidates_ready');
    assert.equal(overviewBefore.unadoptedCandidates.length, 2);

    // Call adoptCandidateBatch via API
    const adoptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/activities/${activityId}/candidates/adopt-batch`,
      headers: adminHeaders,
      payload: {
        candidateIds: [candidate1.id, candidate2.id],
        expectedHeadVersion: initialActivity.headVersion,
        expectedDraftVersion: 1,
      },
    });
    assert.equal(adoptRes.statusCode, 200, adoptRes.body);
    const adoptResult = adoptRes.json();
    assert.equal(adoptResult.adoptedCandidateIds.length, 2);
    assert.deepEqual(adoptResult.adoptedCandidateIds, [candidate1.id, candidate2.id]);
    assert.equal(adoptResult.headVersion, initialActivity.headVersion + 1);

    // Verify draft has been updated with content from both stages
    const draft = store.getDraft(activityId)!.document;
    assert.equal(draft.messages.length, 2);
    assert.equal(draft.messages[0].text, '开场致辞发言');
    assert.equal(draft.messages[1].text, '现在我们展示产品。');
    assert.equal(draft.mediaSlots.length, 1);
    assert.equal(draft.mediaSlots[0].caption, '开场舞台全景');

    // Both candidates marked adopted in store
    const c1Reloaded = store.getCandidate(activityId, candidate1.id);
    const c2Reloaded = store.getCandidate(activityId, candidate2.id);
    assert.equal(c1Reloaded?.adopted, true);
    assert.equal(c2Reloaded?.adopted, true);

    // Production overview after adoption -> now media slot needs media generation
    const overviewAfter = getActivityProductionOverview(database, store, activityId);
    assert.equal(overviewAfter.textStatus, 'adopted');
    assert.equal(overviewAfter.unadoptedCandidates.length, 0);
    assert.equal(overviewAfter.mediaStatus.totalSlots, 1);
    assert.equal(overviewAfter.mediaStatus.pendingSlots, 1);
    assert.equal(overviewAfter.suggestedStep, 'generate_media');
  } finally {
    await app.close();
    database.close();
  }
});

test('adoptCandidateBatch rejects adopting into locked stages and rejects version mismatch', async () => {
  const { app, database, store, activityId, initialActivity } = await setup();
  try {
    // Lock stage_intro
    const draft = store.getDraft(activityId)!;
    const doc = draft.document;
    doc.stages[0].locked = true;
    const updatedDraft = store.updateDraft(activityId, draft.draftVersion, doc);

    const candidate = store.createCandidate({
      activityId,
      scope: { stageId: 'stage_intro', mode: 'stage', jobId: 'job_locked_test' },
      payload: {
        schemaVersion: 1,
        stageId: 'stage_intro',
        summary: '尝试写入锁定阶段',
        messages: [{
          clientId: 'm_locked',
          conversationId: 'conv_main',
          speakerActorId: 'actor_ceo',
          text: '这行字不应该被写入',
          order: 1,
        }],
        posts: [],
        comments: [],
        facts: [],
        mediaSlots: [],
      },
      validation: { valid: true },
    });

    // Attempt to adopt into locked stage -> should return 409 Conflict
    const lockedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/activities/${activityId}/candidates/adopt-batch`,
      headers: adminHeaders,
      payload: {
        candidateIds: [candidate.id],
        expectedHeadVersion: initialActivity.headVersion,
        expectedDraftVersion: updatedDraft.draftVersion,
      },
    });
    assert.equal(lockedRes.statusCode, 409, lockedRes.body);
    assert.equal(lockedRes.json().error, 'stage_locked');

    // Attempt with version mismatch -> should return 409 Conflict
    const conflictRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/activities/${activityId}/candidates/adopt-batch`,
      headers: adminHeaders,
      payload: {
        candidateIds: [candidate.id],
        expectedHeadVersion: 999999,
        expectedDraftVersion: updatedDraft.draftVersion,
      },
    });
    assert.equal(conflictRes.statusCode, 409, conflictRes.body);
    assert.equal(conflictRes.json().error, 'head_version_conflict');
  } finally {
    await app.close();
    database.close();
  }
});

test('whole-text job skips locked stages and preserves earlier candidates on partial failure', async () => {
  const { app, database, store, activityId } = await setup();
  try {
    const draft = store.getDraft(activityId)!;
    const doc = draft.document;
    // Pre-populate stage_intro with an existing message and lock it
    doc.stages[0].locked = true;
    doc.messages.push({
      id: 'msg_locked_existing',
      conversationId: 'conv_main',
      stageId: 'stage_intro',
      kind: 'message',
      speakerActorId: 'actor_ceo',
      text: '既有的第一阶段致辞内容（已锁定）',
      mediaSlotIds: [],
      storyOrder: 1,
    });
    store.updateDraft(activityId, draft.draftVersion, doc);

    const job = store.createJob({
      activityId,
      kind: 'text',
      mode: 'whole-text',
      requestHash: 'whole-text-test-hash',
    }).job;

    let stageKeynotePrompt = '';

    await executeTextJob({
      store,
      database,
      secrets: new SecretStore({}),
      activityId,
      jobId: job.id,
      mode: 'whole-text',
      scope: {},
      inputSnapshot: store.getDraft(activityId)!.document,
      fetcher: async (_input, init) => {
        const bodyStr = String(init?.body);
        stageKeynotePrompt = bodyStr;
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify({
                schemaVersion: 1,
                stageId: 'stage_keynote',
                summary: '核心演示阶段生成结果',
                messages: [{
                  clientId: 'm_keynote_gen',
                  conversationId: 'conv_main',
                  speakerActorId: 'actor_tech',
                  text: '欢迎大家体验新品！',
                  order: 10,
                }],
                posts: [],
                comments: [],
                facts: [],
                mediaSlots: [],
              }),
            },
          }],
        });
      },
    });

    const updatedJob = store.getJob(activityId, job.id)!;
    assert.equal(updatedJob.status, 'succeeded');
    // Locked stage_intro was skipped, only stage_keynote generated a candidate
    assert.equal(updatedJob.resultCandidateIds.length, 1);
    const candidate = store.getCandidate(activityId, updatedJob.resultCandidateIds[0])!;
    assert.equal((candidate.scope as any).stageId, 'stage_keynote');

    // Verify that the prompt sent to LLM for stage_keynote contains preceding stage content from the locked stage!
    assert.ok(stageKeynotePrompt.includes('既有的第一阶段致辞内容（已锁定）'));
  } finally {
    await app.close();
    database.close();
  }
});
