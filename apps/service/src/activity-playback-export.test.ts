import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { generateAutoPlayback } from './activities/playback.js';
import type { ContentDocument } from '@sthstart/contracts';
import { createPortableBackup, restorePortableBackup, verifyPortableBackup } from './portable-backup.js';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { buildActivityExportPackage } from './activities/exports.js';
import { stageActivityImport, commitActivityImport } from './activities/imports.js';

const adminToken = 'activity-m6-token-123456789012345';

test('M6-A: Auto playback multi-conversation and playback modes', async () => {
  const content: ContentDocument = {
    schemaVersion: 1,
    activity: {
      title: '多会话测试活动',
      type: '聚会',
      theme: '会话测试',
      location: '活动现场',
      rules: '',
      generationMode: 'fill_details',
      scheduledDate: null,
    },
    actors: [
      {
        id: 'actor_alice',
        displayName: '爱丽丝',
        activityRole: '组织者',
        outfitDescription: '日常服',
        appearanceReferenceAssetKeys: [],
        persona: { displayName: '爱丽丝', identity: '组织者' },
      },
      {
        id: 'actor_bob',
        displayName: '鲍勃',
        activityRole: '嘉宾',
        outfitDescription: '日常服',
        appearanceReferenceAssetKeys: [],
        persona: { displayName: '鲍勃', identity: '嘉宾' },
      },
    ],
    relationships: [],
    stages: [
      {
        id: 'stage_1',
        title: '阶段一',
        order: 1,
        actorIds: ['actor_alice', 'actor_bob'],
        location: '大厅',
        instruction: '',
        requiredBeats: [],
        locked: false,
        endCondition: '',
      },
    ],
    conversations: [
      { id: 'conv_group', kind: 'group', title: '群聊讨论', memberActorIds: ['actor_alice', 'actor_bob'] },
      { id: 'conv_private', kind: 'direct', title: '私聊', memberActorIds: ['actor_alice', 'actor_bob'] },
    ],
    messages: [
      {
        id: 'msg_1',
        conversationId: 'conv_group',
        stageId: 'stage_1',
        kind: 'message',
        speakerActorId: 'actor_alice',
        text: '群里的第一句话',
        mediaSlotIds: [],
        storyOrder: 10,
      },
      {
        id: 'msg_2',
        conversationId: 'conv_private',
        stageId: 'stage_1',
        kind: 'message',
        speakerActorId: 'actor_bob',
        text: '私聊里悄悄说',
        mediaSlotIds: [],
        storyOrder: 20,
      },
      {
        id: 'msg_3',
        conversationId: 'conv_group',
        stageId: 'stage_1',
        kind: 'message',
        speakerActorId: 'actor_alice',
        text: '回到群聊继续说',
        mediaSlotIds: [],
        storyOrder: 30,
      },
    ],
    posts: [
      {
        id: 'post_1',
        stageId: 'stage_1',
        authorActorId: 'actor_alice',
        text: '今天真开心！',
        mediaSlotIds: [],
        storyOrder: 15,
        sourceFactIds: [],
      },
    ],
    comments: [],
    likes: [],
    mediaSlots: [],
    facts: [],
    stageResults: [],
  };

  // 1. Verify multi-conversation switching within the same stage
  const byStageDoc = generateAutoPlayback('rev_1', content, 'none', null, { mode: 'by_stage' });
  const openViews = byStageDoc.actions.filter((a) => a.type === 'open_view');
  assert.ok(openViews.length >= 3);
  assert.equal(openViews[0].conversationId, 'conv_group');
  assert.equal(openViews[1].conversationId, 'conv_private');
  assert.equal(openViews[2].conversationId, 'conv_group');

  // 2. Verify story_order interleaves messages and posts
  const storyOrderDoc = generateAutoPlayback('rev_1', content, 'none', null, { mode: 'story_order' });
  const actionSequence = storyOrderDoc.actions.map((a) => {
    if (a.type === 'reveal_message') return `msg:${a.targetId}`;
    if (a.type === 'scroll_to') return `post:${a.targetId}`;
    if (a.type === 'open_view') return `view:${a.view}${a.conversationId ? `:${a.conversationId}` : ''}`;
    return a.type;
  });

  // Story orders are: msg_1 (10) -> post_1 (15) -> msg_2 (20) -> msg_3 (30)
  const contentEvents = actionSequence.filter((s) => s.startsWith('msg:') || s.startsWith('post:'));
  assert.deepEqual(contentEvents, ['msg:msg_1', 'post:post_1', 'msg:msg_2', 'msg:msg_3']);

  // 3. Verify chat_only
  const chatOnlyDoc = generateAutoPlayback('rev_1', content, 'none', null, { mode: 'chat_only' });
  assert.ok(chatOnlyDoc.actions.some((a) => a.type === 'reveal_message'));
  assert.ok(!chatOnlyDoc.actions.some((a) => a.type === 'scroll_to'));

  // 4. Verify moments_only
  const momentsOnlyDoc = generateAutoPlayback('rev_1', content, 'none', null, { mode: 'moments_only' });
  assert.ok(!momentsOnlyDoc.actions.some((a) => a.type === 'reveal_message'));
  assert.ok(momentsOnlyDoc.actions.some((a) => a.type === 'scroll_to'));
});

test('M6-A: Working project export and import restores editing policy and remapped references', async (t) => {
  const artifactDirectory = resolve(tmpdir(), `activity-export-${randomUUID()}`);
  t.after(() => rmSync(artifactDirectory, { recursive: true, force: true }));
  const database = new ServiceDatabase();
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const secrets = new SecretStore({});
  const { app } = await createService({ config, database, secrets });

  t.after(async () => {
    await app.close();
    database.close();
  });

  const store = new ActivityStore(database);

  // Create an activity with locked records in editingPolicy
  const doc: ContentDocument = {
    schemaVersion: 1,
    activity: {
      title: '导出导入锁定测试',
      type: '派对',
      theme: '测试主题',
      location: '露台',
      rules: '',
      generationMode: 'fill_details',
      scheduledDate: null,
    },
    actors: [
      {
        id: 'actor_host',
        displayName: '派对主人',
        activityRole: '主持',
        outfitDescription: '礼服',
        appearanceReferenceAssetKeys: [],
        persona: { displayName: '派对主人', identity: '主持' },
      },
    ],
    relationships: [],
    stages: [
      {
        id: 'stage_1',
        title: '入场',
        order: 1,
        actorIds: ['actor_host'],
        location: '露台',
        instruction: '',
        requiredBeats: [],
        locked: true,
        endCondition: '',
      },
    ],
    conversations: [
      { id: 'conv_1', kind: 'group', title: '主群聊', memberActorIds: ['actor_host'] },
    ],
    messages: [
      {
        id: 'msg_locked_x',
        conversationId: 'conv_1',
        stageId: 'stage_1',
        kind: 'message',
        speakerActorId: 'actor_host',
        text: '这是一条已锁定的重要发言',
        mediaSlotIds: ['slot_locked_pic'],
        storyOrder: 10,
      },
    ],
    posts: [
      {
        id: 'post_locked_y',
        stageId: 'stage_1',
        authorActorId: 'actor_host',
        text: '已锁定的朋友圈动态',
        mediaSlotIds: [],
        storyOrder: 20,
        sourceFactIds: [],
      },
    ],
    comments: [],
    likes: [],
    mediaSlots: [
      {
        id: 'slot_locked_pic',
        stageId: 'stage_1',
        kind: 'image',
        caption: '锁定配图',
        shotDescription: '特写',
        actorIds: ['actor_host'],
        sourceFactIds: [],
      },
    ],
    facts: [],
    stageResults: [],
    editingPolicy: {
      lockedRecords: [
        { kind: 'message', id: 'msg_locked_x' },
        { kind: 'post', id: 'post_locked_y' },
      ],
      lockedMediaSlotIds: ['slot_locked_pic'],
    },
  };

  const { activity } = store.createActivity({
    title: doc.activity.title,
    type: doc.activity.type,
    theme: doc.activity.theme,
    location: doc.activity.location,
    initialDocument: doc,
  });

  const activityId = activity.id;

  // 1. Export as project format
  const zipBuffer = await buildActivityExportPackage(config, database, store, activityId, {
    format: 'project',
  });
  assert.ok(zipBuffer.length > 0);

  // 2. Stage the export zip
  const staged = await stageActivityImport(config, database, zipBuffer);
  assert.equal(staged.preview.title, '导出导入锁定测试');
  assert.equal(staged.preview.messageCount, 1);
  assert.equal(staged.preview.postCount, 1);

  // 3. Commit import
  const committed = await commitActivityImport(config, database, store, staged.jobId);

  assert.ok(committed.activity.id);
  assert.notEqual(committed.activity.id, activityId);

  // 4. Verify editingPolicy in the imported activity
  const importedContentRev = store.getContentRevision(committed.activity.id, committed.activity.currentContentRevisionId!);
  assert.ok(importedContentRev);
  const importedDoc = importedContentRev.document;
  assert.ok(importedDoc.editingPolicy);
  assert.equal(importedDoc.editingPolicy.lockedRecords.length, 2);
  assert.equal(importedDoc.editingPolicy.lockedMediaSlotIds.length, 1);

  // Ensure IDs were remapped to the new record and slot IDs!
  const newMsgId = importedDoc.messages[0].id;
  const newPostId = importedDoc.posts[0].id;
  const newSlotId = importedDoc.mediaSlots[0].id;

  assert.notEqual(newMsgId, 'msg_locked_x');
  assert.notEqual(newPostId, 'post_locked_y');
  assert.notEqual(newSlotId, 'slot_locked_pic');

  assert.deepEqual(importedDoc.editingPolicy.lockedRecords, [
    { kind: 'message', id: newMsgId },
    { kind: 'post', id: newPostId },
  ]);
  assert.deepEqual(importedDoc.editingPolicy.lockedMediaSlotIds, [newSlotId]);
});

test('M6-B: Portable backup, verify, and restore whole-site data', async () => {
  const tempBase = resolve(tmpdir(), `sthstart-backup-test-${randomUUID()}`);
  mkdirSync(tempBase, { recursive: true });

  const testDbDir = resolve(tempBase, 'source-dbs');
  const testArtifactsDir = resolve(tempBase, 'source-artifacts');
  const backupOutDir = resolve(tempBase, 'backup-out');
  const restoreDir = resolve(tempBase, 'restore-out');

  mkdirSync(testDbDir, { recursive: true });
  mkdirSync(testArtifactsDir, { recursive: true });

  const serviceDbPath = resolve(testDbDir, 'service.sqlite');
  const narrativeDbPath = resolve(testDbDir, 'narrative.sqlite');

  // Initialize service db and insert a test artifact
  const db = new DatabaseSync(serviceDbPath);
  db.exec(`
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      app_id TEXT,
      local_path TEXT,
      byte_size INTEGER,
      sha256 TEXT,
      content_type TEXT,
      file_status TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE artifact_references (
      artifact_id TEXT,
      app_id TEXT,
      ref_type TEXT
    );
  `);

  db.exec('CREATE TABLE note_assets(id TEXT PRIMARY KEY, local_path TEXT, content_type TEXT)');
  const noteFile = resolve(testArtifactsDir, 'note-attachment.jpg');
  writeFileSync(noteFile, 'notebook attachment');
  db.prepare('INSERT INTO note_assets VALUES (?,?,?)').run('note_ref_1', noteFile, 'image/jpeg');

  // Create real test artifact file
  const testArtifactFile = resolve(testArtifactsDir, 'sample_image.png');
  writeFileSync(testArtifactFile, Buffer.from('fake-png-binary-content-12345'));
  const testSha = 'd1715e451b6814036f45a0b77b47db95cb1c7df4c940b1274ab3e67c82e6648e';

  db.prepare(`
    INSERT INTO artifacts VALUES ('art_001', 'activities', ?, 30, ?, 'image/png', 'ready', '2026-09-15T00:00:00Z', NULL)
  `).run(testArtifactFile, testSha);

  db.prepare(`
    INSERT INTO artifact_references VALUES ('art_001', 'activities', 'activity_asset')
  `).run();
  db.close();

  // Create narrative db
  const ndb = new DatabaseSync(narrativeDbPath);
  ndb.exec('CREATE TABLE test_narrative (id TEXT);');
  ndb.close();

  const mockConfig = readConfig({
    STHSTART_DATABASE_PATH: serviceDbPath,
    STHSTART_NARRATIVE_DATABASE_PATH: narrativeDbPath,
    STHSTART_ARTIFACT_DIR: testArtifactsDir,
  });

  try {
    // 1. Create portable backup
    const backupResult = await createPortableBackup({
      destination: backupOutDir,
      config: mockConfig,
    });

    assert.equal(backupResult.destination, backupOutDir);
    assert.equal(backupResult.manifest.totalArtifacts, 2);
    assert.ok(backupResult.manifest.items.some(item => item.storage === 'note'));
    assert.equal(backupResult.manifest.missingFiles.length, 0);
    assert.ok(existsSync(resolve(backupOutDir, 'backup-manifest.json')));
    assert.ok(existsSync(resolve(backupOutDir, 'service.sqlite')));
    assert.ok(existsSync(resolve(backupOutDir, 'narrative.sqlite')));
    assert.ok(existsSync(resolve(backupOutDir, 'artifacts/art_001.png')));

    // 2. Verify portable backup
    const verifyResult = await verifyPortableBackup(backupOutDir);
    assert.equal(verifyResult.valid, true);
    assert.equal(verifyResult.errors.length, 0);

    // 3. Restore to a new target directory
    const restoredServiceDb = resolve(restoreDir, 'dbs/new-service-name.sqlite');
    const restoredNarrativeDb = resolve(restoreDir, 'dbs/new-narrative-name.sqlite');
    const restoredArtifactsDir = resolve(restoreDir, 'restored-artifacts');

    const restoreConfig = readConfig({
      STHSTART_DATABASE_PATH: restoredServiceDb,
      STHSTART_NARRATIVE_DATABASE_PATH: restoredNarrativeDb,
      STHSTART_ARTIFACT_DIR: restoredArtifactsDir,
    });

    const restoreResult = await restorePortableBackup(backupOutDir, {
      confirm: true,
      config: restoreConfig,
    });

    assert.equal(restoreResult.restoredArtifacts, 2);
    assert.equal(restoreResult.restoredDatabases.length, 2);
    assert.ok(existsSync(restoredServiceDb));
    assert.ok(existsSync(resolve(restoredArtifactsDir, 'art_001.png')));

    // 4. Verify that artifacts.local_path in restored db now points to the new restored directory!
    const restoredDb = new DatabaseSync(restoredServiceDb, { readOnly: true });
    const row = restoredDb.prepare('SELECT local_path FROM artifacts WHERE id = ?').get('art_001') as { local_path: string };
    restoredDb.close();

    assert.equal(row.local_path, resolve(restoredArtifactsDir, 'art_001.png'));
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
