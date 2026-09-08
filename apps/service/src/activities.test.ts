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
import { readZip } from './activities/zip.js';
import { executeTextJob } from './activities/text-jobs.js';
import { ActivityStore } from './activities/store.js';
import { compileHyperFramesComposition } from '@sthstart/activity-playback';
import type { ContentDocument, PlaybackDocument } from '@sthstart/contracts';

const adminToken = 'admin-activities-test-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function createMinimalDocument(title = '海边露营日'): ContentDocument {
  return {
    schemaVersion: 1,
    activity: {
      title,
      type: 'chat',
      theme: '夏日海边露营',
      location: '银沙海滩',
      rules: '保持轻松愉快的氛围',
      generationMode: 'autonomous',
    },
    actors: [
      {
        id: 'actor_lumine',
        displayName: '荧',
        persona: { tone: '活泼敏锐' },
        activityRole: '露营发起人',
        outfitDescription: '夏日休闲服',
        appearanceReferenceAssetKeys: [],
      },
      {
        id: 'actor_paimon',
        displayName: '派蒙',
        persona: { tone: '贪吃活泼' },
        activityRole: '向导与向导',
        outfitDescription: '经典服饰',
        appearanceReferenceAssetKeys: [],
      },
    ],
    relationships: [
      {
        fromActorId: 'actor_paimon',
        toActorId: 'actor_lumine',
        description: '最好的伙伴',
      },
    ],
    stages: [
      {
        id: 'stage_1',
        title: '到达营地',
        order: 1,
        actorIds: ['actor_lumine', 'actor_paimon'],
        location: '营地入口',
        instruction: '整理装备，准备扎营',
        requiredBeats: [
          { id: 'beat_1', text: '派蒙抱怨肚子饿了', actorIds: ['actor_paimon'] },
        ],
        locked: false,
        endCondition: '帐篷搭建完毕',
      },
      {
        id: 'stage_2',
        title: '生火野炊',
        order: 2,
        actorIds: ['actor_lumine', 'actor_paimon'],
        location: '海滩火堆旁',
        instruction: '收集干柴，烤鱼煮汤',
        requiredBeats: [
          { id: 'beat_2', text: '荧捕获了一条大鱼', actorIds: ['actor_lumine'] },
        ],
        locked: false,
        endCondition: '野炊结束',
      },
    ],
    conversations: [
      {
        id: 'conv_main',
        kind: 'group',
        title: '海边露营小队',
        memberActorIds: ['actor_lumine', 'actor_paimon'],
      },
    ],
    messages: [
      {
        id: 'msg_1',
        conversationId: 'conv_main',
        stageId: 'stage_1',
        kind: 'message',
        speakerActorId: 'actor_paimon',
        text: '终于到啦！派蒙的肚子已经咕咕叫了！',
        mediaSlotIds: [],
        storyOrder: 1,
        storyTimeLabel: '下午 3:00',
      },
    ],
    posts: [
      {
        id: 'post_1',
        stageId: 'stage_1',
        authorActorId: 'actor_lumine',
        text: '今天的海风很舒适，准备扎营。',
        mediaSlotIds: [],
        storyOrder: 2,
        storyTimeLabel: '下午 3:15',
        sourceFactIds: [],
      },
    ],
    comments: [
      {
        id: 'comment_1',
        postId: 'post_1',
        authorActorId: 'actor_paimon',
        text: '快点生火烤鱼啦！',
        storyOrder: 3,
      },
    ],
    likes: [
      {
        postId: 'post_1',
        actorId: 'actor_paimon',
      },
    ],
    mediaSlots: [],
    facts: [
      {
        id: 'fact_1',
        stageId: 'stage_1',
        text: '队伍已经安全抵达银沙海滩。',
        sourceRecordIds: ['msg_1'],
        knownByActorIds: ['actor_lumine', 'actor_paimon'],
        status: 'happened',
      },
    ],
    stageResults: [],
  };
}

test('Activity Studio: lifecycle, 2-stage verification, CAS draft auto-save, and revision commit', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-activities-test-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // 1. Rejects creation with fewer than 2 stages (R01)
  const invalidDoc = createMinimalDocument();
  invalidDoc.stages = [invalidDoc.stages[0]]; // Only 1 stage
  const rejectRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: invalidDoc },
  });
  assert.equal(rejectRes.statusCode, 400);
  assert.equal(rejectRes.json().error, 'minimum_two_stages_required');

  // 2. Successful creation with 2 stages
  const validDoc = createMinimalDocument();
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: validDoc },
  });
  assert.equal(createRes.statusCode, 201);
  const created = createRes.json();
  assert.ok(created.activity.id);
  assert.equal(created.activity.headVersion, 1);
  assert.ok(created.activity.currentContentRevisionId);
  assert.equal(created.draft.draftVersion, 1);
  assert.equal(created.draft.document.stages.length, 2);

  const activityId = created.activity.id;

  // 3. Get activity detail & draft
  const getRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}`,
    headers: adminHeaders,
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json().activity.id, activityId);

  const draftRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
  });
  assert.equal(draftRes.statusCode, 200);
  assert.equal(draftRes.json().draftVersion, 1);

  // 4. Draft auto-save CAS conflict on stale version
  const updatedDoc: ContentDocument = {
    ...validDoc,
    messages: [
      ...validDoc.messages,
      {
        id: 'msg_2',
        conversationId: 'conv_main',
        stageId: 'stage_1',
        kind: 'message',
        speakerActorId: 'actor_lumine',
        text: '先把帐篷搭好吧。',
        mediaSlotIds: [],
        storyOrder: 4,
      },
    ],
  };

  const conflictRes = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: {
      expectedDraftVersion: 999, // Stale!
      document: updatedDoc,
    },
  });
  assert.equal(conflictRes.statusCode, 409);
  assert.equal(conflictRes.json().error, 'draft_version_conflict');

  updatedDoc.activity = { ...updatedDoc.activity, title: '合并编辑后的活动', theme: '合并后的主题' };
  // 5. Successful draft auto-save
  const saveDraftRes = await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: {
      expectedDraftVersion: 1,
      document: updatedDoc,
    },
  });
  assert.equal(saveDraftRes.statusCode, 200);
  assert.equal(saveDraftRes.json().draftVersion, 2);

  // 6. Commit draft to ContentRevision with CAS
  const commitConflictRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/commit`,
    headers: adminHeaders,
    payload: {
      expectedHeadVersion: 999, // Stale!
    },
  });
  assert.equal(commitConflictRes.statusCode, 409);

  const commitRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/commit`,
    headers: adminHeaders,
    payload: {
      expectedHeadVersion: 1,
    },
  });
  assert.equal(commitRes.statusCode, 200);
  const commitData = commitRes.json();
  assert.equal(commitData.activity.headVersion, 2);
  assert.equal(commitData.activity.title, updatedDoc.activity.title);
  assert.equal(commitData.activity.theme, updatedDoc.activity.theme);
  assert.notEqual(commitData.activity.currentContentRevisionId, created.activity.currentContentRevisionId);
  assert.equal(commitData.draft.draftVersion, 1); // Reset draft version for fresh edit cycle

  await app.close();
  database.close();
});

test('Activity Studio: text generation runner and candidate adoption with CAS', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-activities-gen-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });

  // Mock fetcher for LLM responses
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/chat/completions') || url.includes('/v1/chat')) {
      const mockLlmResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 1, stageId: 'stage_2', summary: '荧生起篝火烤鱼。',
                facts: [{ clientId: 'f1', text: '荧烤好了鱼', status: 'happened', sourceRecordClientIds: ['m1'], knownByActorIds: ['actor_lumine', 'actor_paimon'] }],
                messages: [{ clientId: 'm1', conversationId: 'conv_main', speakerActorId: 'actor_lumine', text: '烤鱼烤好了！', mediaClientIds: ['s1'], order: 10 }],
                posts: [{ clientId: 'p1', authorActorId: 'actor_paimon', text: '烤鱼真香！', order: 11, sourceFactClientIds: ['f1'] }],
                comments: [],
                mediaSlots: [{ clientId: 's1', kind: 'image', caption: '篝火与烤鱼', shotDescription: '篝火上的烤鱼', actorIds: ['actor_paimon'], sourceFactClientIds: ['f1'] }],
              }),
            },
          },
        ],
      };
      return Response.json(mockLlmResponse);
    }
    return new Response(null, { status: 404 });
  };

  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('llm', 'LLM', 'llm', 'http://llm.test/v1', 'gpt-4o', null, now, now);

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'llm', ?)").run(now);

  // Create initial activity
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createMinimalDocument() },
  });
  const activityId = createRes.json().activity.id;

  // Trigger text generation job for stage 2
  const jobRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/text-jobs`,
    headers: adminHeaders,
    payload: {
      mode: 'stage',
      stageId: 'stage_2',
    },
  });
  assert.equal(jobRes.statusCode, 202);
  const queuedJob = jobRes.json();
  assert.ok(queuedJob.id);

  // Poll for completion (the job executes asynchronously via setImmediate)
  let job = queuedJob;
  for (let i = 0; i < 20; i++) {
    if (job.status === 'succeeded' || job.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pollRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/activities/${activityId}/jobs/${queuedJob.id}`,
      headers: adminHeaders,
    });
    job = pollRes.json().job;
  }
  assert.equal(job.status, 'succeeded');
  assert.equal(job.resultCandidateIds.length, 1);

  const candidateId = job.resultCandidateIds[0];

  // Verify candidate exists
  const candidateRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/candidates/${candidateId}`,
    headers: adminHeaders,
  });
  assert.equal(candidateRes.statusCode, 200);
  const candidate = candidateRes.json();
  assert.equal(candidate.adopted, false);

  // Adopt candidate with CAS conflict
  const adoptConflictRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/candidates/${candidateId}/adopt`,
    headers: adminHeaders,
    payload: {
      expectedHeadVersion: 999, // Stale!
    },
  });
  assert.equal(adoptConflictRes.statusCode, 409);

  // Adopt candidate successfully
  const adoptRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/candidates/${candidateId}/adopt`,
    headers: adminHeaders,
    payload: {
      expectedHeadVersion: 1,
    },
  });
  assert.equal(adoptRes.statusCode, 200);
  const adoptData = adoptRes.json();
  assert.equal(adoptData.activity.headVersion, 2);
  assert.equal(adoptData.candidate.adopted, true);

  // Verify adopted content revision contains the new message and media slot
  const activeRevRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/revisions/${adoptData.activity.currentContentRevisionId}`,
    headers: adminHeaders,
  });
  assert.equal(activeRevRes.statusCode, 200);
  const activeDoc: ContentDocument = activeRevRes.json().document;
  assert.ok(activeDoc.messages.some((m) => m.text.includes('烤鱼')));
  assert.ok(activeDoc.mediaSlots.some((s) => s.caption.includes('篝火')));

  await app.close();
  database.close();
});

test('Activity Studio: media asset upload, range streaming, slot binding, and playback generation', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-activities-media-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // Create activity
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createMinimalDocument() },
  });
  const activityId = createRes.json().activity.id;

  // 1. Stream upload binary image asset
  const fakeImageData = Buffer.from('FAKE_PNG_IMAGE_BINARY_DATA_1234567890');
  const uploadRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/uploads`,
    headers: {
      ...adminHeaders,
      'content-type': 'image/png',
      'x-asset-key': 'camp_photo_1',
    },
    payload: fakeImageData,
  });
  assert.equal(uploadRes.statusCode, 201);
  const asset = uploadRes.json();
  assert.equal(asset.assetKey, 'camp_photo_1');
  assert.equal(asset.type, 'image');
  assert.equal(asset.byteSize, fakeImageData.length);

  // 2. Asset streaming query & Range request
  const fullGetRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/assets/camp_photo_1`,
    headers: adminHeaders,
  });
  assert.equal(fullGetRes.statusCode, 200);
  assert.equal(fullGetRes.headers['content-type'], 'image/png');
  assert.equal(fullGetRes.headers['accept-ranges'], 'bytes');
  assert.equal(fullGetRes.rawPayload.length, fakeImageData.length);

  // Partial range request (bytes=0-9)
  const rangeRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/assets/camp_photo_1`,
    headers: {
      ...adminHeaders,
      range: 'bytes=0-9',
    },
  });
  assert.equal(rangeRes.statusCode, 206);
  assert.equal(rangeRes.headers['content-range'], `bytes 0-9/${fakeImageData.length}`);
  assert.equal(rangeRes.rawPayload.length, 10);
  assert.equal(rangeRes.rawPayload.toString(), 'FAKE_PNG_I');

  // 3. Save slot binding to MediaRevision
  const contentRevisionId = createRes.json().activity.currentContentRevisionId;
  const mediaRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/media-revisions`,
    headers: adminHeaders,
    payload: {
      contentRevisionId,
      slotBindings: [
        {
          slotId: 'slot_1',
          slotFingerprint: 'fp_slot_1',
          assets: [{ assetKey: 'camp_photo_1', order: 1 }],
        },
      ],
    },
  });
  assert.equal(mediaRes.statusCode, 201);
  const mediaRev = mediaRes.json();
  assert.ok(mediaRev.id);
  assert.equal(mediaRev.slotBindings.length, 1);

  // 4. Generate auto playback
  const autoPlaybackRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/playback/generate`,
    headers: adminHeaders,
    payload: {
      contentRevisionId,
      mediaRevisionId: mediaRev.id,
      viewerActorId: 'actor_lumine',
    },
  });
  assert.equal(autoPlaybackRes.statusCode, 200);
  const playbackDoc = autoPlaybackRes.json().document;
  assert.ok(playbackDoc.actions.length > 0);
  assert.ok(playbackDoc.totalDurationMs > 0);

  // 5. Save PlaybackRevision
  const savePlaybackRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/playback-revisions`,
    headers: adminHeaders,
    payload: {
      contentRevisionId,
      mediaRevisionId: mediaRev.id,
      document: playbackDoc,
    },
  });
  assert.equal(savePlaybackRes.statusCode, 201);
  const playbackRev = savePlaybackRes.json();
  assert.ok(playbackRev.id);

  // Verify activity updated current revisions
  const actRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}`,
    headers: adminHeaders,
  });
  const updatedAct = actRes.json().activity;
  assert.equal(updatedAct.currentMediaRevisionId, mediaRev.id);
  assert.equal(updatedAct.currentPlaybackRevisionId, playbackRev.id);

  await app.close();
  database.close();
});

test('Activity Studio: checkpoints and restoration', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-activities-cp-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });



  // Create initial activity
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createMinimalDocument() },
  });
  const activityId = createRes.json().activity.id;
  const initialContentRevId = createRes.json().activity.currentContentRevisionId;

  // Create Checkpoint 1
  const cpRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/checkpoints`,
    headers: adminHeaders,
    payload: { name: '扎营完成检查点' },
  });
  assert.equal(cpRes.statusCode, 201);
  const checkpoint = cpRes.json();
  assert.equal(checkpoint.name, '扎营完成检查点');
  assert.equal(checkpoint.contentRevisionId, initialContentRevId);

  // Commit a new content revision to advance headVersion to 2
  const doc2 = createMinimalDocument('海边露营日 - 修改版');
  await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: { expectedDraftVersion: 1, document: doc2 },
  });
  const commitRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/commit`,
    headers: adminHeaders,
    payload: { expectedHeadVersion: 1 },
  });
  assert.equal(commitRes.json().activity.headVersion, 2);

  // Restore Checkpoint 1
  const restoreRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/checkpoints/${checkpoint.id}/restore`,
    headers: adminHeaders,
  });
  assert.equal(restoreRes.statusCode, 200);
  const restoredAct = restoreRes.json().activity;
  assert.equal(restoredAct.currentContentRevisionId, initialContentRevId);

  await app.close();
  database.close();
});

test('Activity Studio: self-contained ZIP export and import with ID remapping', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-activities-export-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // Create activity and upload an asset
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: createMinimalDocument('导出导入测试') },
  });
  const activityId = createRes.json().activity.id;

  const fakeImageData = Buffer.from('TEST_EXPORT_IMAGE_BYTES_123');
  await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/uploads`,
    headers: {
      ...adminHeaders,
      'content-type': 'image/png',
      'x-asset-key': 'export_test_photo',
    },
    payload: fakeImageData,
  });

  // Export full ZIP
  const exportRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/export`,
    headers: adminHeaders,
    payload: { mode: 'full' },
  });
  assert.equal(exportRes.statusCode, 200);
  assert.equal(exportRes.headers['content-type'], 'application/zip');
  const zipBuffer = exportRes.rawPayload;
  assert.ok(zipBuffer.length > 0);

  // Verify ZIP structure and files using our pure-TS zip parser
  const files = readZip(zipBuffer);
  assert.ok(files.has('activity.json'));
  assert.ok(files.has('manifest.json'));
  assert.ok(files.has('reader.html'));
  assert.ok(files.has('index.html')); // HyperFrames project entry
  assert.ok(files.has('project.json'));
  assert.ok(files.has('assets/gsap.min.js'));
  assert.ok(files.has('assets/default_avatar.png'));
  assert.ok(files.has('package.json'));
  const pkgData = JSON.parse(new TextDecoder().decode(files.get('package.json')!));
  assert.equal(pkgData.devDependencies?.hyperframes || pkgData.dependencies?.hyperframes, '0.8.30');
  assert.ok([...files.keys()].some((k) => k.startsWith('assets/')));

  // Read manifest.json from ZIP
  const manifestData = files.get('manifest.json')!;
  assert.ok(manifestData);
  const manifest = JSON.parse(new TextDecoder().decode(manifestData));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.files.length >= 4);

  // Now test Import: Stage ZIP
  const stageRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities/imports/stage',
    headers: {
      ...adminHeaders,
      'content-type': 'application/zip',
    },
    payload: zipBuffer,
  });
  assert.equal(stageRes.statusCode, 200);
  const stageData = stageRes.json();
  assert.ok(stageData.importId);
  assert.equal(stageData.preview.activity.title, '导出导入测试');
  assert.equal(stageData.preview.assetCount, 1);

  // Commit Import
  const commitImportRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/imports/${stageData.importId}/commit`,
    headers: adminHeaders,
  });
  assert.equal(commitImportRes.statusCode, 201);
  const importedAct = commitImportRes.json().activity;
  assert.ok(importedAct.id);
  assert.notEqual(importedAct.id, activityId); // Verified unique ID remapping!
  assert.equal(importedAct.title, '导出导入测试');

  // Verify imported assets
  const importedAssetsRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${importedAct.id}/assets`,
    headers: adminHeaders,
  });
  assert.equal(importedAssetsRes.statusCode, 200);
  const importedAssets = importedAssetsRes.json().items;
  assert.equal(importedAssets.length, 1);
  assert.equal(importedAssets[0].assetKey, 'export_test_photo');

  await app.close();
  database.close();
});

test('Activity Studio: strict revision consistency, CAS binding migration, baseline revision creation, and asset immutability', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-activities-rev-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });
  const store = new ActivityStore(database);

  // 1. Create activity: check that baseline MediaRevision and Checkpoint exist and are not null/'initial'
  const initialDoc = createMinimalDocument('版本一致性测试');
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: initialDoc },
  });
  assert.equal(createRes.statusCode, 201);
  const createdAct = createRes.json().activity;
  const activityId = createdAct.id;
  assert.ok(createdAct.currentMediaRevisionId);
  assert.notEqual(createdAct.currentMediaRevisionId, 'initial');

  // Verify GET /activities/:id returns draft, head, current revisions
  const getActRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}`,
    headers: adminHeaders,
  });
  assert.equal(getActRes.statusCode, 200);
  const actBody = getActRes.json();
  assert.equal(actBody.activity.id, activityId);
  assert.equal(actBody.draftVersion, 1);
  assert.ok(actBody.draft);
  assert.ok(actBody.currentContentRevision);
  assert.ok(actBody.currentMediaRevision);

  // Verify GET /activities/:id/draft returns { ...draft, draft }
  const getDraftRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
  });
  assert.equal(getDraftRes.statusCode, 200);
  const draftBody = getDraftRes.json();
  assert.ok(draftBody.draft);
  assert.ok(draftBody.document);

  // Verify GET /activities/:id/checkpoints and /history return items
  const getCpRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/checkpoints`,
    headers: adminHeaders,
  });
  assert.equal(getCpRes.statusCode, 200);
  assert.ok(Array.isArray(getCpRes.json().items));
  assert.ok(getCpRes.json().items.length >= 1);
  assert.equal(getCpRes.json().items[0].mediaRevisionId, createdAct.currentMediaRevisionId);

  const getHistRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/history`,
    headers: adminHeaders,
  });
  assert.equal(getHistRes.statusCode, 200);
  assert.ok(Array.isArray(getHistRes.json().items));

  // Verify GET /activities/:id/revisions returns items
  const getRevsRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/revisions`,
    headers: adminHeaders,
  });
  assert.equal(getRevsRes.statusCode, 200);
  assert.ok(Array.isArray(getRevsRes.json().items));
  assert.equal(getRevsRes.json().items.length, 1);

  // Verify GET media revision directly and through alias
  const mediaRevId = createdAct.currentMediaRevisionId;
  const getMediaRevRes1 = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/media-revisions/${mediaRevId}`,
    headers: adminHeaders,
  });
  assert.equal(getMediaRevRes1.statusCode, 200);
  assert.equal(getMediaRevRes1.json().id, mediaRevId);

  const getMediaRevRes2 = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/media-revisions/${mediaRevId}`,
    headers: adminHeaders,
  });
  assert.equal(getMediaRevRes2.statusCode, 200);
  assert.equal(getMediaRevRes2.json().id, mediaRevId);

  // 2. Asset Immutability:
  // Upload asset
  const fakeImageData = Buffer.from('IMMUTABLE_ASSET_BYTES_123');
  const uploadRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/uploads`,
    headers: {
      ...adminHeaders,
      'content-type': 'image/png',
      'x-asset-key': 'immutable_key_1',
    },
    payload: fakeImageData,
  });
  assert.equal(uploadRes.statusCode, 201);

  // Attempt to overwrite the same assetKey with a different artifactId must fail with 409 conflict
  assert.throws(
    () => {
      store.saveAsset({
        activityId,
        assetKey: 'immutable_key_1',
        artifactId: 'different-artifact-uuid-999',
        source: 'upload',
        type: 'image',
        createdAt: new Date().toISOString(),
      });
    },
    (err: any) => String(err).includes('asset_key_immutable_conflict')
  );

  // 3. Slot Binding Migration on Draft Commit:
  // Add a media slot to draft
  const docWithSlot: ContentDocument = {
    ...initialDoc,
    mediaSlots: [
      {
        id: 'slot_hero',
        stageId: 'stage_1',
        kind: 'image',
        caption: '营地合影',
        shotDescription: '全景',
        actorIds: ['actor_lumine'],
        sourceFactIds: [],
      },
    ],
  };
  await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: { expectedDraftVersion: 1, document: docWithSlot },
  });
  const commit1Res = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/commit`,
    headers: adminHeaders,
    payload: { expectedHeadVersion: 1 },
  });
  assert.equal(commit1Res.statusCode, 200);
  const head2 = commit1Res.json().activity;
  assert.equal(head2.headVersion, 2);

  // Select media for slot_hero
  const selectMediaRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/media/select`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: head2.currentContentRevisionId,
      selections: [
        {
          slotId: 'slot_hero',
          slotFingerprint: 'fp_hero_consistent',
          assetKeys: ['immutable_key_1'],
        },
      ],
    },
  });
  assert.ok(selectMediaRes.statusCode === 200 || selectMediaRes.statusCode === 201);

  // Generate & save Playback revision
  const autoPbRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/playback/generate`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: head2.currentContentRevisionId,
      mediaRevisionId: selectMediaRes.json().mediaRevisionId,
    },
  });
  assert.equal(autoPbRes.statusCode, 200);
  const pbDoc = autoPbRes.json().document;

  const savePbRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/playback-revisions`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: head2.currentContentRevisionId,
      mediaRevisionId: selectMediaRes.json().mediaRevisionId,
      document: pbDoc,
    },
  });
  assert.equal(savePbRes.statusCode, 201);
  const pbRevId = savePbRes.json().id;

  // Playback revision pointer is set
  const actWithPb = (await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}`,
    headers: adminHeaders,
  })).json().activity;
  assert.equal(actWithPb.currentPlaybackRevisionId, pbRevId);

  // Invalidation: Changing media selection MUST clear current_playback_revision_id
  await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/media/select`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: head2.currentContentRevisionId,
      selections: [
        {
          slotId: 'slot_hero',
          slotFingerprint: 'fp_hero_consistent',
          assetKeys: ['immutable_key_1'],
        },
      ],
    },
  });
  const actAfterMedia = (await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}`,
    headers: adminHeaders,
  })).json().activity;
  assert.equal(actAfterMedia.currentPlaybackRevisionId, null); // Invalidated!

  // Consistency check: Saving playback revision with mismatched contentRevisionId fails with 400
  const mismatchPbRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/playback-revisions`,
    headers: adminHeaders,
    payload: {
      contentRevisionId: 'non-existent-content-rev',
      mediaRevisionId: actAfterMedia.currentMediaRevisionId,
      document: pbDoc,
    },
  });
  assert.ok(mismatchPbRes.statusCode === 400 || mismatchPbRes.statusCode === 404);
  assert.equal(mismatchPbRes.json().error, 'content_revision_not_found');

  // Now test Slot Binding Migration:
  // Update draft (add message, keep slot_hero with same fp), then commit
  const doc3: ContentDocument = {
    ...docWithSlot,
    messages: [
      ...docWithSlot.messages,
      {
        id: 'msg_slot_preserved',
        conversationId: 'conv_main',
        stageId: 'stage_1',
        kind: 'message',
        speakerActorId: 'actor_paimon',
        text: '看，照片拍得多好！',
        mediaSlotIds: ['slot_hero'],
        storyOrder: 5,
      },
    ],
  };
  await app.inject({
    method: 'PUT',
    url: `/api/v1/admin/activities/${activityId}/draft`,
    headers: adminHeaders,
    payload: { expectedDraftVersion: 1, document: doc3 },
  });
  const commit2Res = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/commit`,
    headers: adminHeaders,
    payload: { expectedHeadVersion: actAfterMedia.headVersion },
  });
  assert.equal(commit2Res.statusCode, 200);
  const head3 = commit2Res.json().activity;
  assert.equal(head3.headVersion, actAfterMedia.headVersion + 1);

  // Fetch the new current media revision: slot_hero binding should be preserved!
  const newMediaRev = (await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/media-revisions/${head3.currentMediaRevisionId}`,
    headers: adminHeaders,
  })).json();
  const heroBinding = newMediaRev.slotBindings.find((b: any) => b.slotId === 'slot_hero');
  assert.ok(heroBinding, 'Slot binding for slot_hero should be preserved in new media revision');
  assert.equal(heroBinding.assets[0]?.assetKey, 'immutable_key_1');

  await app.close();
  database.close();
});

test('Activity Studio: plan locked stage preservation, downstream needs_review, job cancel/recovery, and video seek animation', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-activities-adv-'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });
  const store = new ActivityStore(database);

  // 1. Plan locked stage preservation & downstream needs_review
  const docWithLocked: ContentDocument = {
    ...createMinimalDocument('锁定阶段测试'),
    stages: [
      {
        id: 'stage_1',
        title: '原始锁定阶段1',
        order: 1,
        actorIds: ['actor_lumine'],
        location: '海滩',
        instruction: '整理装备',
        requiredBeats: [{ id: 'beat_1', text: '原节拍1', actorIds: ['actor_lumine'] }],
        locked: true,
        endCondition: '结束1',
      },
      {
        id: 'stage_2',
        title: '原始未锁定阶段2',
        order: 2,
        actorIds: ['actor_paimon'],
        location: '火堆',
        instruction: '生火',
        requiredBeats: [{ id: 'beat_2', text: '原节拍2', actorIds: ['actor_paimon'] }],
        locked: false,
        endCondition: '结束2',
      },
    ],
    stageResults: [
      {
        stageId: 'stage_1',
        sourceContextHash: 'ctx_hash_1',
        reviewState: 'ready',
        summary: '阶段1已完成',
        factIds: [],
      },
      {
        stageId: 'stage_2',
        sourceContextHash: 'ctx_hash_2',
        reviewState: 'ready',
        summary: '阶段2已完成',
        factIds: [],
      },
    ],
  };

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities',
    headers: adminHeaders,
    payload: { document: docWithLocked },
  });
  const activityId = createRes.json().activity.id;

  // Create a plan candidate that tries to overwrite both stage 1 and stage 2
  const planCandidate = store.createCandidate({
    activityId,
    baseRevisionId: createRes.json().activity.currentContentRevisionId,
    draftVersion: 1,
    scope: { mode: 'plan' },
    payload: {
      stages: [
        {
          stageId: 'stage_1',
          title: 'AI篡改的阶段1标题',
          description: 'AI篡改的指令1',
          requiredBeats: ['AI节拍1'],
        },
        {
          stageId: 'stage_2',
          title: 'AI生成的阶段2新标题',
          description: 'AI生成的指令2',
          requiredBeats: ['AI节拍2'],
        },
      ],
    },
    validation: { valid: true },
  });

  // Adopt this plan candidate
  const adoptRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/candidates/${planCandidate.id}/adopt`,
    headers: adminHeaders,
    payload: { expectedHeadVersion: 1 },
  });
  assert.equal(adoptRes.statusCode, 200);

  // Verify: stage_1 was preserved (locked: true), while stage_2 was updated
  const headRevId = adoptRes.json().activity.currentContentRevisionId;
  const headRevDoc = store.getContentRevision(activityId, headRevId)!.document;
  const s1 = headRevDoc.stages.find((s) => s.order === 1);
  const s2 = headRevDoc.stages.find((s) => s.order === 2);

  assert.equal(s1?.title, '原始锁定阶段1'); // Preserved!
  assert.equal(s1?.locked, true);
  assert.equal(s2?.title, 'AI生成的阶段2新标题'); // Adopted!

  // All stageResults marked as needs_review on plan adoption
  for (const sr of headRevDoc.stageResults || []) {
    assert.equal(sr.reviewState, 'needs_review');
  }

  // 2. Downstream stage reviewState marking on stage-level adopt
  const stageCandidate = store.createCandidate({
    activityId,
    baseRevisionId: headRevId,
    draftVersion: 1,
    scope: { mode: 'stage', stageId: 'stage_1' },
    payload: {
      stageId: 'stage_1',
      summary: '阶段1新记录',
      messages: [
        {
          clientId: 'msg_ai_1',
          speakerActorId: 'actor_lumine',
          text: '新的阶段1台词',
        },
      ],
    },
    validation: { valid: true },
  });

  const adoptStageRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/candidates/${stageCandidate.id}/adopt`,
    headers: adminHeaders,
    payload: { expectedHeadVersion: 2 },
  });
  assert.equal(adoptStageRes.statusCode, 200);
  const stageAdoptRevDoc = store.getContentRevision(activityId, adoptStageRes.json().activity.currentContentRevisionId)!.document;
  const sr2 = stageAdoptRevDoc.stageResults?.find((s) => s.stageId === 'stage_2');
  assert.equal(sr2?.reviewState, 'needs_review');

  // 3. Job Cancel and Dangling Job Recovery
  const { job: jobToCancel } = store.createJob({
    activityId,
    kind: 'text',
    mode: 'stage',
    requestHash: 'hash_to_cancel',
  });
  const cancelRes = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/jobs/${jobToCancel.id}/cancel`,
    headers: adminHeaders,
  });
  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.json().job.status, 'cancelled');

  // Insert a dangling running job
  const { job: danglingJob } = store.createJob({
    activityId,
    kind: 'text',
    mode: 'plan',
    requestHash: 'dangling_hash_1',
  });
  database.connection.prepare(
    `UPDATE activity_jobs SET status = 'running' WHERE id = ?`
  ).run(danglingJob.id);

  const recoveredCount = store.recoverDanglingJobs();
  assert.ok(recoveredCount >= 1);
  const recoveredJob = store.getJob(activityId, danglingJob.id);
  assert.equal(recoveredJob?.status, 'result_unknown');
  assert.equal(recoveredJob?.errorMessage, 'server_restarted_result_unknown');

  // 4. Download Export Security
  const unauthDownloadRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${activityId}/exports/fake_export_job/download`,
  });
  assert.equal(unauthDownloadRes.statusCode, 401);

  // 5. Video Seek Animation in HyperFrames compilation
  const playbackDocWithVideo: PlaybackDocument = {
    schemaVersion: 1,
    contentRevisionId: 'rev_v1',
    mediaRevisionId: 'mrev_v1',
    template: { id: 'phone-v1', version: '1.0.0' },
    viewerActorId: 'actor_lumine',
    layout: { width: 1080, height: 1920 },
    output: { width: 1080, height: 1920, fps: 30 },
    totalDurationMs: 8000,
    actions: [
      {
        id: 'act_video_clip',
        type: 'open_media',
        kind: 'video',
        atMs: 1000,
        durationMs: 4000,
        sourceInMs: 500,
        assetKey: 'video_ocean_view',
      },
    ],
  };

  const compiled = compileHyperFramesComposition(
    createMinimalDocument(),
    { schemaVersion: 1, slotBindings: [] },
    playbackDocWithVideo,
  );
  assert.match(compiled.html, /<video[^>]+data-start="1" data-duration="4" data-media-start="0.5"/);
  assert.match(compiled.html, /<audio[^>]+data-start="1" data-duration="4" data-media-start="0.5"/);
  assert.doesNotMatch(compiled.html, /currentTime|modalVideo.src/);

  await app.close();
  database.close();
});


test('Activity Studio: whole-text carries preceding generated facts without implicitly adopting them', async () => {
  const database = new ServiceDatabase();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken });
  const secrets = new SecretStore({});
  const { app } = await createService({ config, database, secrets });
  try {
    const now = new Date().toISOString();
    database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('batch-llm', 'LLM', 'llm', 'http://llm.test/v1', 'test-model', null, now, now);
    database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'batch-llm', ?)").run(now);
    const result = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { document: createMinimalDocument() } });
    const activity = result.json().activity;
    const store = new ActivityStore(database);
    const doc = store.getDraft(activity.id)!.document;
    const job = store.createJob({ activityId: activity.id, kind: 'text', mode: 'whole-text', requestHash: 'batch-proof' }).job;
    const prompts: string[] = [];
    let index = 0;
    await executeTextJob({ store, database, secrets, activityId: activity.id, jobId: job.id, mode: 'whole-text', scope: {}, inputSnapshot: doc,
      fetcher: async (_input, init) => {
        prompts.push(String(init?.body));
        const stage = doc.stages[index++];
        return Response.json({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, stageId: stage.id,
          summary: '本阶段完成', messages: [], posts: [], comments: [], mediaSlots: [],
          facts: [{ clientId: 'batch-fact', text: index === 1 ? '特殊蓝色蛋糕已经送到营地' : '大家分享了蓝色蛋糕', status: 'happened', knownByActorIds: stage.actorIds, sourceRecordClientIds: [] }] }) } }] });
      } });
    assert.equal(store.getJob(activity.id, job.id)?.status, 'succeeded');
    assert.equal(prompts.length, 2);
    assert.ok(prompts[1].includes('特殊蓝色蛋糕已经送到营地'));
    assert.deepEqual(store.getDraft(activity.id)!.document, doc);
    assert.equal(store.getActivity(activity.id)?.headVersion, activity.headVersion);
  } finally { await app.close(); database.close(); }
});
