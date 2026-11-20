import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { migrateDatabase, SERVICE_DATABASE_MIGRATIONS } from '../database.js';

test('version 54 database with projects, chapter text, character snapshots, and links upgrades to the latest version and preserves exact data across physical disk reopen', () => {
  const tempDbPath = join(
    tmpdir(),
    `sthstart-upgrade-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  const testProject = {
    id: 'project-alpha-v54',
    title: '风暴群岛编年史',
    summary: '跨世代海权与风暴编年史项目',
    revision: 2,
    context_settings_json: JSON.stringify({ defaultPerspective: 'third-limited', worldBuildingNotes: '深海航线' }),
    created_at: '2026-11-01T08:00:00.000Z',
    updated_at: '2026-11-05T14:30:00.000Z',
    work_id: 'work-storm-archipelago',
    project_type: 'fiction',
  };

  const testChapter = {
    id: 'doc-chapter-1',
    project_id: 'project-alpha-v54',
    kind: 'chapter',
    title: '第一卷：起航之潮',
    body: '长风掠过白鸥港的灯塔，林舟整理好航海手记，推开通向观星甲板的铜门。长卷上的星象正在发生不可逆转的重叠。',
    position: 1,
    revision: 3,
    created_at: '2026-11-01T08:30:00.000Z',
    updated_at: '2026-11-05T15:00:00.000Z',
  };

  const testScene = {
    id: 'doc-scene-1',
    project_id: 'project-alpha-v54',
    kind: 'scene',
    title: '甲板偶遇',
    body: '配角乙在缆绳堆旁核对补给单据，低声提醒林舟注意风暴前夕的异常气压。',
    position: 2,
    revision: 1,
    created_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-05T15:10:00.000Z',
  };

  const testCharacterProfile = {
    id: 'char-lin-zhou',
    slug: 'lin-zhou-protagonist',
    display_name: '林舟',
    draft_json: JSON.stringify({ personality: '沉着内敛，善于观察天象变化', role: '领航学者' }),
    tags_json: JSON.stringify(['核心主角', '学者', '航海师']),
    avatar_asset_id: 'asset-avatar-linzhou-v1',
    latest_version: 1,
    archived: 0,
    created_at: '2026-11-01T07:00:00.000Z',
    updated_at: '2026-11-05T12:00:00.000Z',
    draft_revision: 2,
    organization_json: JSON.stringify({ guild: '星枢领航会' }),
    variants_json: '[]',
    portrait_asset_id: 'asset-portrait-linzhou-v1',
  };

  const testCharacterVersion = {
    character_id: 'char-lin-zhou',
    version: 1,
    data_json: JSON.stringify({ traits: ['理性', '决断力强'], goal: '绘制暴风海域全图' }),
    compiled_linshe_prompt: '林舟，星枢领航会首席学者，身着青灰防风长袍。',
    created_at: '2026-11-01T07:30:00.000Z',
    relationships_json: JSON.stringify([{ targetId: 'actor-b', relation: '航行助手' }]),
    draft_revision: 1,
    appearance_snapshot_json: JSON.stringify({ clothing: '青灰长袍与防风斗篷', items: ['黄铜星盘', '航海日志'] }),
    provenance_json: JSON.stringify({ source: 'studio-genesis', author: 'tester' }),
    compiler_version: 'v2.4.0',
  };

  const testProjectLink = {
    id: 'link-project-char-1',
    project_id: 'project-alpha-v54',
    kind: 'narrative',
    source_id: 'char-lin-zhou',
    snapshot_json: JSON.stringify({ snapshotName: '林舟第一卷出场快照', version: 1 }),
    captured_at: '2026-11-01T08:45:00.000Z',
    adopted_entry_id: 'doc-chapter-1',
  };

  let db: DatabaseSync | null = null;
  let reopened: DatabaseSync | null = null;

  try {
    // 1. Initialize physical temporary database and migrate to v54
    db = new DatabaseSync(tempDbPath);
    db.exec('PRAGMA foreign_keys=ON');
    migrateDatabase(db, SERVICE_DATABASE_MIGRATIONS.filter(m => m.version <= 54), 'service');

    // Verify v54 schema version
    assert.equal(
      db.prepare('SELECT max(version) as version FROM schema_migrations').get()?.version,
      54,
    );

    // 2. Insert real v54 projects, chapter text, character profiles, versions and links
    db.prepare(`
      INSERT INTO story_projects (id, title, summary, revision, context_settings_json, created_at, updated_at, work_id, project_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testProject.id, testProject.title, testProject.summary, testProject.revision,
      testProject.context_settings_json, testProject.created_at, testProject.updated_at,
      testProject.work_id, testProject.project_type,
    );

    db.prepare(`
      INSERT INTO story_documents (id, project_id, kind, title, body, position, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testChapter.id, testChapter.project_id, testChapter.kind, testChapter.title,
      testChapter.body, testChapter.position, testChapter.revision,
      testChapter.created_at, testChapter.updated_at,
    );

    db.prepare(`
      INSERT INTO story_documents (id, project_id, kind, title, body, position, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testScene.id, testScene.project_id, testScene.kind, testScene.title,
      testScene.body, testScene.position, testScene.revision,
      testScene.created_at, testScene.updated_at,
    );

    db.prepare(`
      INSERT INTO character_profiles (id, slug, display_name, draft_json, tags_json, avatar_asset_id, latest_version, archived, created_at, updated_at, draft_revision, organization_json, variants_json, portrait_asset_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testCharacterProfile.id, testCharacterProfile.slug, testCharacterProfile.display_name,
      testCharacterProfile.draft_json, testCharacterProfile.tags_json, testCharacterProfile.avatar_asset_id,
      testCharacterProfile.latest_version, testCharacterProfile.archived, testCharacterProfile.created_at,
      testCharacterProfile.updated_at, testCharacterProfile.draft_revision,
      testCharacterProfile.organization_json, testCharacterProfile.variants_json, testCharacterProfile.portrait_asset_id,
    );

    db.prepare(`
      INSERT INTO character_versions (character_id, version, data_json, compiled_linshe_prompt, created_at, relationships_json, draft_revision, appearance_snapshot_json, provenance_json, compiler_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testCharacterVersion.character_id, testCharacterVersion.version, testCharacterVersion.data_json,
      testCharacterVersion.compiled_linshe_prompt, testCharacterVersion.created_at,
      testCharacterVersion.relationships_json, testCharacterVersion.draft_revision,
      testCharacterVersion.appearance_snapshot_json, testCharacterVersion.provenance_json,
      testCharacterVersion.compiler_version,
    );

    db.prepare(`
      INSERT INTO project_links (id, project_id, kind, source_id, snapshot_json, captured_at, adopted_entry_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      testProjectLink.id, testProjectLink.project_id, testProjectLink.kind,
      testProjectLink.source_id, testProjectLink.snapshot_json, testProjectLink.captured_at,
      testProjectLink.adopted_entry_id,
    );

    db.prepare('INSERT INTO runtime_settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'world-upgrade-sentinel',
      '{"preserve":true}',
      'now',
    );

    // Record existing tables in v54
    const preV55Tables = (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(t => t.name);

    // 3. Apply every pending migration transactionally.
    migrateDatabase(db, SERVICE_DATABASE_MIGRATIONS, 'service');

    // 4. Verify migration idempotency (running again doesn't crash or alter)
    migrateDatabase(db, SERVICE_DATABASE_MIGRATIONS, 'service');

    // 5. Close physical temporary database
    db.close();
    db = null;

    // 6. Reopen physical temporary database from disk
    reopened = new DatabaseSync(tempDbPath);
    reopened.exec('PRAGMA foreign_keys=ON');

    // Verify all pending migrations and the bounded notification index.
    assert.equal(
      reopened.prepare('SELECT max(version) as version FROM schema_migrations').get()?.version,
      SERVICE_DATABASE_MIGRATIONS.at(-1)!.version,
    );
    assert.ok(reopened.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='idx_sw_steps_notification_pending'").get());

    // Verify all pre-v55 tables remain present
    for (const tableName of preV55Tables) {
      assert.ok(
        reopened.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(tableName),
        `Table ${tableName} must be preserved across migration and reopen`,
      );
    }

    // Verify exact content of project
    const preservedProject = reopened.prepare('SELECT * FROM story_projects WHERE id = ?').get(testProject.id) as Record<string, unknown>;
    assert.deepEqual({ ...preservedProject }, testProject);

    // Verify exact content of chapter (including full body text)
    const preservedChapter = reopened.prepare('SELECT * FROM story_documents WHERE id = ?').get(testChapter.id) as Record<string, unknown>;
    assert.deepEqual({ ...preservedChapter }, testChapter);

    // Verify exact content of scene
    const preservedScene = reopened.prepare('SELECT * FROM story_documents WHERE id = ?').get(testScene.id) as Record<string, unknown>;
    assert.deepEqual({ ...preservedScene }, testScene);

    // Verify exact content of character profile
    const preservedProfile = reopened.prepare('SELECT * FROM character_profiles WHERE id = ?').get(testCharacterProfile.id) as Record<string, unknown>;
    assert.deepEqual({ ...preservedProfile }, { ...testCharacterProfile, parent_character_id: null });

    // Verify exact content of character version snapshot
    const preservedVersion = reopened.prepare('SELECT * FROM character_versions WHERE character_id = ? AND version = ?').get(testCharacterVersion.character_id, testCharacterVersion.version) as Record<string, unknown>;
    assert.deepEqual({ ...preservedVersion }, { ...testCharacterVersion, version_label: '' });

    // Verify exact content of project links
    const preservedLink = reopened.prepare('SELECT * FROM project_links WHERE id = ?').get(testProjectLink.id) as Record<string, unknown>;
    assert.deepEqual({ ...preservedLink }, testProjectLink);

    // Verify runtime sentinel
    assert.equal(
      reopened.prepare('SELECT value_json FROM runtime_settings WHERE key=?').get('world-upgrade-sentinel')?.value_json,
      '{"preserve":true}',
    );

    // Verify new v55 story world tables exist
    assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE name='sw_worlds'").get());
    assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE name='sw_branches'").get());
    assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE name='sw_branch_definitions'").get());
    assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE name='sw_events'").get());
    assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE name='sw_memories'").get());
    assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE name='sw_run_calls'").get());
    for (const table of ['sw_actor_plans', 'sw_step_intents', 'sw_memory_summaries']) {
      assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table));
    }
    assert.ok(reopened.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name='idx_sw_actor_plan_active'").get());

    // Verify generation_tasks queue column
    const genTaskColumns = reopened.prepare('PRAGMA table_info(generation_tasks)').all() as { name: string }[];
    assert.ok(genTaskColumns.some(c => c.name === 'queue_slot_held'));

    // Verify SQLite foreign keys check passes cleanly
    assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);

    // Verify SQLite integrity check passes cleanly
    const integrity = reopened.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    assert.equal(integrity?.integrity_check, 'ok');
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
    if (reopened) {
      try { reopened.close(); } catch {}
    }
    if (existsSync(tempDbPath)) {
      try { unlinkSync(tempDbPath); } catch {}
    }
    if (existsSync(`${tempDbPath}-wal`)) {
      try { unlinkSync(`${tempDbPath}-wal`); } catch {}
    }
    if (existsSync(`${tempDbPath}-shm`)) {
      try { unlinkSync(`${tempDbPath}-shm`); } catch {}
    }
  }
});
