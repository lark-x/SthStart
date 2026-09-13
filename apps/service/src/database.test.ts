import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ServiceDatabase, SERVICE_DATABASE_MIGRATIONS, migrateDatabase } from './database.js';

test('fresh databases record an explicit migration baseline', () => {
  const database = new ServiceDatabase();
  const migrations = database.connection.prepare('SELECT version,name FROM schema_migrations').all() as Array<{ version: number; name: string }>;
  assert.equal(migrations.length, 22);
  assert.equal(migrations[0].version, 1);
  assert.equal(migrations[0].name, 'initial');
  assert.equal(migrations[1].version, 2);
  assert.equal(migrations[1].name, 'llm-model-assignments');
  assert.equal(migrations[2].name, 'shared-character-library');
  assert.equal(migrations[3].name, 'version-character-relationships');
  assert.equal(migrations[4].name, 'artifact-2.0-central-media');
  assert.equal(migrations[5].name, 'generation-core-and-scheduler');
  assert.equal(migrations[6].name, 'windows-worker-bridge');
  assert.equal(migrations[7].name, 'generation-engine-request-options');
  assert.equal(migrations[8].version, 9);
  assert.equal(migrations[8].name, 'generation-media-capabilities-and-progress');
  assert.equal(migrations[9].version, 10);
  assert.equal(migrations[9].name, 'artifact-video-metadata');
  assert.equal(migrations[10].version, 11);
  assert.equal(migrations[10].name, 'generation-consumer-links');
  assert.equal(migrations[11].version, 12);
  assert.equal(migrations[11].name, 'notebook-local-first-sync');
  assert.equal(migrations[12].version, 13);
  assert.equal(migrations[12].name, 'activity-studio');
  assert.equal(migrations[13].version, 14);
  assert.equal(migrations[13].name, 'activity-image-provenance');
  assert.equal(migrations[14].version, 15);
  assert.equal(migrations[14].name, 'activity-frozen-image-plans');
  assert.equal(migrations[15].version, 16);
  assert.equal(migrations[15].name, 'character-library-remediation');
  assert.equal(migrations[16].version, 17);
  assert.equal(migrations[16].name, 'character-source-snapshot-links');
  assert.equal(migrations[17].name, 'character-library-organization');
  assert.equal(migrations[18].name, 'birthday-calendar-and-planning');
  assert.equal(migrations[19].name, 'character-media-column-convergence');
  assert.equal(migrations[20].name, 'character-asset-file-mirror-cleanup');
  const columns = database.connection.prepare('PRAGMA table_info(provider_profile_options)').all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === 'capabilities_json'), true);
  const taskColumns = database.connection.prepare('PRAGMA table_info(generation_tasks)').all() as Array<{ name: string }>;
  assert.equal(taskColumns.some((column) => column.name === 'progress_json'), true);
  const workflowColumns = database.connection.prepare('PRAGMA table_info(generation_workflows)').all() as Array<{ name: string }>;
  assert.equal(workflowColumns.some((column) => column.name === 'category'), true);
  const workflowVersionColumns = database.connection.prepare('PRAGMA table_info(generation_workflow_versions)').all() as Array<{ name: string }>;
  assert.equal(workflowVersionColumns.some((column) => column.name === 'input_capabilities_json'), true);
  assert.equal(workflowVersionColumns.some((column) => column.name === 'output_media_types_json'), true);
  assert.equal(workflowVersionColumns.some((column) => column.name === 'output_schema_json'), true);
  const artifactColumns = database.connection.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>;
  assert.equal(artifactColumns.some((column) => column.name === 'thumbnail_artifact_id'), true);
  const characterAssetColumns = database.connection.prepare('PRAGMA table_info(character_assets)').all() as Array<{ name: string }>;
  assert.equal(characterAssetColumns.some((column) => column.name === 'artifact_id'), true);
  // 迁移 20 起，文件元数据的权威位置是 artifacts；资产表不再镜像哈希与尺寸。
  assert.equal(characterAssetColumns.some((column) => column.name === 'sha256'), false);
  // 文件信息只存在 artifacts；资产表也不再镜像路径与尺寸。
  assert.equal(characterAssetColumns.some((column) => column.name === 'local_path'), false);
  const referenceColumns = database.connection.prepare('PRAGMA table_info(character_visual_references)').all() as Array<{ name: string }>;
  assert.equal(referenceColumns.some((column) => column.name === 'artifact_id'), false);
  assert.equal(referenceColumns.some((column) => column.name === 'purposes_json'), true);
  // 本项目没有命名服装库业务，迁移 20 移除了空壳服装表。
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='character_outfits'").get() === undefined, true);
  const noteColumns = database.connection.prepare('PRAGMA table_info(creative_notes)').all() as Array<{ name: string }>;
  assert.equal(noteColumns.some((column) => column.name === 'revision'), true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='generation_context_links'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='activities'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='activity_drafts'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='activity_content_revisions'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='activity_image_config_drafts'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='activity_prompt_recipes'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='activity_image_attempts'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='character_import_sessions'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='character_field_provenance'").get() !== undefined, true);
  assert.equal(database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='character_visual_references'").get() !== undefined, true);
  database.close();
});

test('unversioned databases fail closed with an actionable reset command', () => {
  const path = resolve(mkdtempSync(resolve(tmpdir(), 'sthstart-db-')), 'legacy.db');
  const legacy = new DatabaseSync(path); legacy.exec('CREATE TABLE legacy_data(id TEXT)'); legacy.close();
  assert.throws(() => new ServiceDatabase(path), /npm run db:reset -- --confirm/);
});

test('version one databases migrate existing LLM profiles to text capability', () => {
  const path = resolve(mkdtempSync(resolve(tmpdir(), 'sthstart-db-v1-')), 'v1.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1,'initial','now');
    CREATE TABLE managed_apps(id TEXT PRIMARY KEY,name TEXT,token_hash TEXT,capabilities_json TEXT,enabled INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE provider_profiles(id TEXT PRIMARY KEY,name TEXT,kind TEXT,base_url TEXT,model TEXT,credential_account TEXT,enabled INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE provider_profile_options(profile_id TEXT PRIMARY KEY,thinking_mode TEXT,headers_json TEXT,extra_body_json TEXT);
    CREATE TABLE creative_notes(id TEXT PRIMARY KEY,title TEXT,kind TEXT,summary TEXT,content_json TEXT,tags_json TEXT,stage TEXT,favorite INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE artifacts(id TEXT PRIMARY KEY, app_id TEXT, task_id TEXT, provider_url TEXT, local_path TEXT, content_type TEXT, byte_size INTEGER, pinned INTEGER, created_at TEXT);
    INSERT INTO provider_profiles VALUES ('old','Old','llm','https://example.test/v1','old-model',NULL,1,'now','now');
    INSERT INTO provider_profile_options VALUES ('old','omit','{}','{}');`);
  old.close();
  const migrated = new ServiceDatabase(path);
  const row = migrated.connection.prepare("SELECT capabilities_json FROM provider_profile_options WHERE profile_id='old'").get() as { capabilities_json: string };
  assert.deepEqual(JSON.parse(row.capabilities_json), ['text']);
  assert.equal(migrated.connection.prepare('SELECT MAX(version) version FROM schema_migrations').get()!.version, 22);
  migrated.close();
});

test('transaction helper rolls back all writes on failure', () => {
  const database = new ServiceDatabase();
  assert.throws(() => database.transaction(() => {
    database.connection.prepare("INSERT INTO runtime_settings VALUES ('one','{}','now')").run();
    throw new Error('stop');
  }));
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM runtime_settings').get()!.count, 0);
  database.close();
});


test('version 17 character data survives the organization migration', () => {
  const connection = new DatabaseSync(':memory:');
  try {
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS.filter(m => m.version <= 17), 'service');
    connection.prepare("INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision) VALUES ('old','old','已有角色',?, ?,0,'then','then',4)").run('{"work":"星铁","identity":"原有设定"}', '["原有标签"]');
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'service');
    const row = connection.prepare("SELECT * FROM character_profiles WHERE id='old'").get()!;
    assert.equal(row.draft_json, '{"work":"星铁","identity":"原有设定"}');
    assert.equal(row.tags_json, '["原有标签"]');
    assert.equal(row.draft_revision, 4);
    assert.equal(row.organization_json, '{}');
    assert.equal(connection.prepare('SELECT count(*) count FROM character_works').get()!.count, 2);
  } finally { connection.close(); }
});

test('migration 20 收敛角色媒体重复列时保留参考配置与来源备注', () => {
  const connection = new DatabaseSync(':memory:');
  try {
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= 19), 'service');
    connection.prepare("INSERT INTO managed_apps VALUES ('characters','角色库','token-hash','[\"persona\"]',1,'then','then')").run();
    connection.prepare("INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision) VALUES ('c1','c1','媒体角色','{}','[]',0,'then','then',1)").run();
    connection.prepare("INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,sha256,file_status,created_at,updated_at) VALUES ('art-1','characters','C:/media/a.png','image/png',1024,'sha-asset','ready','then','then')").run();
    // 资产侧与参考图侧的重复列刻意不同：迁移必须按「资产为空才回填」的规则合并，而不是覆盖。
    connection.prepare("INSERT INTO character_assets(id,character_id,artifact_id,kind,local_path,content_type,byte_size,original_name,sha256,width,height,purposes_json,enabled,crop_json,outfit_id,source_page,source_url,author_note,user_note,created_at) VALUES ('asset-1','c1','art-1','reference','C:/media/a.png','image/png',1024,'a.png','sha-asset',512,768,'[\"reference\"]',1,NULL,NULL,'','','资产作者','','then')").run();
    connection.prepare("INSERT INTO character_visual_references(id,character_id,asset_id,artifact_id,sha256,purposes_json,outfit_id,source_page,original_url,author_note,user_note,enabled,crop_json,created_at,updated_at) VALUES ('ref-1','c1','asset-1','art-1','sha-asset','[\"reference\",\"avatar\"]',NULL,'参考页','https://example.test/a','参考作者','参考备注',0,'{\"x\":1}', 'then','then')").run();

    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'service');

    const reference = connection.prepare("SELECT * FROM character_visual_references WHERE id='ref-1'").get()!;
    assert.equal(reference.asset_id, 'asset-1');
    assert.equal(reference.purposes_json, '[\"reference\",\"avatar\"]', '参考用途属于参考配置，必须原样保留');
    assert.equal(reference.enabled, 0, '禁用状态不能被「非空优先」回滚成启用');
    assert.equal(reference.crop_json, '{\"x\":1}');
    for (const dropped of ['artifact_id', 'sha256', 'source_page', 'original_url', 'author_note', 'user_note', 'outfit_id']) {
      assert.equal(Object.hasOwn(reference, dropped), false, `参考表不应再保留重复列 ${dropped}`);
    }

    const asset = connection.prepare("SELECT * FROM character_assets WHERE id='asset-1'").get()!;
    assert.equal(asset.artifact_id, 'art-1');
    assert.equal(asset.source_page, '参考页', '资产侧为空时用参考图侧补齐来源');
    assert.equal(asset.source_url, 'https://example.test/a');
    assert.equal(asset.author_note, '资产作者', '资产侧已有备注时不得被参考图侧覆盖');
    assert.equal(asset.user_note, '参考备注', '资产侧为空时回填参考图备注');
    for (const dropped of ['purposes_json', 'enabled', 'crop_json', 'sha256', 'width', 'height', 'outfit_id', 'local_path', 'content_type', 'byte_size', 'original_name']) {
      assert.equal(Object.hasOwn(asset, dropped), false, `资产表不应再保留重复列 ${dropped}`);
    }

    assert.equal(connection.prepare("SELECT count(*) count FROM sqlite_schema WHERE type='table' AND name='character_outfits'").get()!.count, 0, '未接入业务的服装表应被删除');
    assert.equal(connection.prepare('SELECT count(*) count FROM character_visual_references').get()!.count, 1, '重建参考表时不得丢行');
  } finally { connection.close(); }
});

test('migration 20 保留同一资产的多条参考，且不要求头像必须有参考行', () => {
  const connection = new DatabaseSync(':memory:');
  try {
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= 19), 'service');
    connection.prepare("INSERT INTO managed_apps VALUES ('characters','角色库','token-hash','[\"persona\"]',1,'then','then')").run();
    connection.prepare("INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,avatar_asset_id,archived,created_at,updated_at,draft_revision) VALUES ('c1','c1','媒体角色','{}','[]','asset-avatar',0,'then','then',1)").run();

    // 同一份实际文件被两个角色资产关联（不强制合并同哈希记录）：一份作头像、一份作参考来源。
    for (const assetId of ['asset-avatar', 'asset-shared']) {
      connection.prepare("INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,sha256,file_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(`art-${assetId}`, 'characters', `C:/media/${assetId}.png`, 'image/png', 2048, `sha-${assetId}`, 'ready', 'then', 'then');
      connection.prepare("INSERT INTO character_assets(id,character_id,artifact_id,kind,local_path,content_type,byte_size,original_name,sha256,width,height,purposes_json,outfit_id,enabled,crop_json,source_page,source_url,author_note,user_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)")
        .run(assetId, 'c1', `art-${assetId}`, assetId === 'asset-avatar' ? 'avatar' : 'reference', `C:/media/${assetId}.png`, 'image/png', 2048, `${assetId}.png`, `sha-${assetId}`, 512, 768, '[]', 1, null, '', '', '', '', 'then');
    }

    // 同一个资产挂两条参考，各自用途与启用状态不同：迁移必须按参考自身 id 重建，不能合并成一条。
    connection.prepare("INSERT INTO character_visual_references(id,character_id,asset_id,artifact_id,sha256,purposes_json,outfit_id,source_page,original_url,author_note,user_note,enabled,crop_json,created_at,updated_at) VALUES ('ref-identity','c1','asset-shared','art-asset-shared','sha-asset-shared','[\"reference\"]',NULL,'来源甲','https://example.test/1','','',1,NULL,'2026-01-01T00:00:00.000Z','then')").run();
    connection.prepare("INSERT INTO character_visual_references(id,character_id,asset_id,artifact_id,sha256,purposes_json,outfit_id,source_page,original_url,author_note,user_note,enabled,crop_json,created_at,updated_at) VALUES ('ref-outfit','c1','asset-shared','art-asset-shared','sha-asset-shared','[\"reference\",\"outfit\"]',NULL,'来源乙','https://example.test/2','','',0,'{\"y\":2}','2026-01-02T00:00:00.000Z','then')").run();

    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'service');

    const references = connection.prepare('SELECT id,asset_id,purposes_json,enabled,crop_json FROM character_visual_references ORDER BY id').all() as Array<{ id: string; asset_id: string; purposes_json: string; enabled: number; crop_json: string | null }>;
    assert.equal(references.length, 2, '同一资产的两条参考都要保留');
    assert.deepEqual(references.map((row) => row.id), ['ref-identity', 'ref-outfit'], '参考 ID 必须稳定，不能重建');
    assert.deepEqual([...new Set(references.map((row) => row.asset_id))], ['asset-shared'], '两条参考仍指向同一资产');
    assert.equal(references[0].purposes_json, '[\"reference\"]');
    assert.equal(references[1].purposes_json, '[\"reference\",\"outfit\"]', '各条参考保留自己的用途');
    assert.equal(references[0].enabled, 1);
    assert.equal(references[1].enabled, 0, '禁用状态按各自的值保留');
    assert.equal(references[1].crop_json, '{\"y\":2}', '裁剪配置按各自的值保留');

    // 头像资产没有参考行，迁移不能因此丢掉它或给它编造参考。
    const avatar = connection.prepare("SELECT id,artifact_id,kind FROM character_assets WHERE id='asset-avatar'").get() as { id: string; artifact_id: string; kind: string } | undefined;
    assert.equal(avatar?.artifact_id, 'art-asset-avatar', '无参考的头像仍要保留 artifact 关联');
    assert.equal(connection.prepare("SELECT count(*) count FROM character_visual_references WHERE asset_id='asset-avatar'").get()!.count, 0, '不应为头像编造参考行');
    assert.equal(connection.prepare("SELECT avatar_asset_id FROM character_profiles WHERE id='c1'").get()!.avatar_asset_id, 'asset-avatar', '头像归属不受影响');
  } finally { connection.close(); }
});
