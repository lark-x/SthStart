import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fastify from 'fastify';
import {
  ServiceDatabase,
  SERVICE_DATABASE_MIGRATIONS,
  migrateDatabase,
  nowIso,
} from './database.js';
import { ProjectStore, registerProjectRoutes } from './projects.js';
import { PublicationStore } from './publication/store.js';
import { StoryError } from './story/store.js';
import type { ServiceConfig } from './config.js';

function seedNote(database: ServiceDatabase, id: string, title: string, text: string) {
  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO creative_notes (id, title, kind, summary, content_json, tags_json, stage, favorite, created_at, updated_at)
    VALUES (?, ?, 'note', '摘要', ?, '[]', 'reference', 0, ?, ?)
  `).run(id, title, JSON.stringify([{ type: 'text', text }]), now, now);
}

test('project pages use full-search totals, stable ties and clamp pages after deletion', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    assert.deepEqual(store.page({ page: 99 }), { items: [], page: 1, pageSize: 20, total: 0 });
    const ids = Array.from({ length: 81 }, (_, i) => store.story.createProject({
      title: '项目 ' + String(i).padStart(3, '0'), summary: i === 80 ? '唯一星海 100%_ABC ÉTOILE' : '普通项目',
    }).id);
    store.story.createProject({ title: '不应出现在创作项目', projectType: 'reflection' });
    db.connection.prepare('UPDATE story_projects SET updated_at=?,created_at=?').run('2026-01-01', '2026-01-01');
    for (const sort of ['updated', 'created'] as const) {
      const pages = Array.from({ length: 5 }, (_, i) => store.page({ page: i + 1, pageSize: 20, sort }));
      assert.ok(pages.every(p => p.total === 81));
      const actual = pages.flatMap(p => p.items.map(i => i.project.id));
      assert.deepEqual(actual, [...ids].sort());
      assert.equal(new Set(actual).size, 81);
    }
    assert.equal(store.list().items.length, 81, 'legacy callers still receive all projects');
    const match = store.page({ q: '星海', page: 5 });
    assert.equal(match.total, 1);
    assert.equal(match.page, 1);
    assert.equal(match.items[0].project.id, ids[80]);
    assert.equal(store.page({ q: '%_abc' }).total, 1, 'wildcards are literal and ASCII case insensitive');
    assert.equal(store.page({ q: 'étoile' }).total, 1, 'Unicode case folding matches the previous client search');
    assert.equal(store.page({ q: "' OR 1=1 --" }).total, 0);
    const last = store.page({ page: 5, sort: 'title' });
    assert.equal(last.items[0].project.id, ids[80]);
    db.connection.prepare('DELETE FROM story_projects WHERE id=?').run(ids[80]);
    assert.equal(store.page({ page: 5 }).page, 4);
    assert.equal(store.page({ page: 5 }).items.length, 20);
  } finally { db.close(); }
});

test('project page HTTP contract validates query and preserves metadata and authorization', async () => {
  const db = new ServiceDatabase(':memory:');
  const app = fastify();
  registerProjectRoutes(app, { adminToken: 'page-test' } as ServiceConfig, db, null);
  const headers = { 'x-sthstart-admin-token': 'page-test' };
  try {
    assert.equal((await app.inject({ url: '/api/v1/admin/projects/page' })).statusCode, 401);
    for (const query of ['page=0', 'page=abc', 'page=1.5', 'pageSize=101', 'sort=bad', 'q=' + 'x'.repeat(201)]) {
      const result = await app.inject({ url: '/api/v1/admin/projects/page?' + query, headers });
      assert.equal(result.statusCode, 400, query);
    }
    const valid = await app.inject({ url: '/api/v1/admin/projects/page?page=99&pageSize=50', headers });
    assert.equal(valid.statusCode, 200);
    assert.deepEqual(valid.json(), { items: [], total: 0, page: 1, pageSize: 50 });
    const legacy = await app.inject({ url: '/api/v1/admin/projects', headers });
    assert.deepEqual(legacy.json(), { items: [] });
  } finally { await app.close(); db.close(); }
});

function seedArtifact(database: ServiceDatabase, id: string, appId = 'creative-center') {
  const now = nowIso();
  database.connection.prepare(`
    INSERT OR IGNORE INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at)
    VALUES (?, ?, 'hash_' || ?, '["artifact"]', 1, ?, ?)
  `).run(appId, '测试应用', appId, now, now);

  database.connection.prepare(`
    INSERT INTO artifacts (id, app_id, content_type, byte_size, sha256, file_status, original_name, media_type, created_at)
    VALUES (?, ?, 'image/png', 100, 'sha_' || ?, 'ready', 'test.png', 'image', ?)
  `).run(id, appId, id, now);
}

function seedActivity(database: ServiceDatabase, id: string, title = '活动制作') {
  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO activities (id, title, type, archived, created_at, updated_at)
    VALUES (?, ?, 'general', 0, ?, ?)
  `).run(id, title, now, now);
}

test('1. 资料冻结：加入项目后保存快照，原资料后续修改不改变已冻结的标题与摘录', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-资料冻结' });
    seedNote(db, 'note-freeze', '原始笔记标题', '这是原始的笔记正文内容。');

    const link = store.add(project.id, { kind: 'note', id: 'note-freeze' });
    assert.equal(link.title, '原始笔记标题');
    assert.ok(link.excerpt.includes('这是原始的笔记正文内容'));
    assert.equal(link.state, 'unchanged');

    // 修改源资料的内容与标题
    db.connection.prepare(`
      UPDATE creative_notes
      SET title = '修改后的新标题',
          content_json = ?,
          updated_at = ?
      WHERE id = 'note-freeze'
    `).run(JSON.stringify([{ type: 'text', text: '正文已被大幅度篡改！' }]), nowIso());

    // 重新获取概览与链接，检查标题与摘录是否依然保持冻结快照
    const overview = store.overview(project.id);
    const currentLink = overview.links.find((l) => l.id === link.id);
    assert.ok(currentLink);
    assert.equal(currentLink.title, '原始笔记标题', '链接标题应保持加入时的冻结快照');
    assert.ok(currentLink.excerpt.includes('这是原始的笔记正文内容'), '链接摘录应保持加入时的冻结快照');
    assert.equal(currentLink.excerpt.includes('正文已被大幅度篡改'), false, '快照绝不能被静默篡改');
  } finally {
    db.close();
  }
});

test('2. 源修改 updated 与源删除 missing 动态状态检测', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-状态检测' });

    // Note 源修改与删除
    seedNote(db, 'note-state', '资料标题', '初始正文内容');
    const noteLink = store.add(project.id, { kind: 'note', id: 'note-state' });
    assert.equal(store.overview(project.id).links.find((l) => l.id === noteLink.id)?.state, 'unchanged');

    // 修改 Note -> updated
    db.connection.prepare(`
      UPDATE creative_notes
      SET content_json = ?, updated_at = ?
      WHERE id = 'note-state'
    `).run(JSON.stringify([{ type: 'text', text: '改变后的内容' }]), nowIso());
    assert.equal(store.overview(project.id).links.find((l) => l.id === noteLink.id)?.state, 'updated');

    // 删除 Note -> missing
    db.connection.prepare("DELETE FROM creative_notes WHERE id = 'note-state'").run();
    assert.equal(store.overview(project.id).links.find((l) => l.id === noteLink.id)?.state, 'missing');

    // Artifact 缺失状态
    seedArtifact(db, 'art-state');
    const artLink = store.add(project.id, { kind: 'artifact', id: 'art-state' });
    assert.equal(store.overview(project.id).links.find((l) => l.id === artLink.id)?.state, 'unchanged');

    db.connection.prepare("UPDATE artifacts SET file_status = 'missing' WHERE id = 'art-state'").run();
    assert.equal(store.overview(project.id).links.find((l) => l.id === artLink.id)?.state, 'missing');

    // Activity 归档状态视为 missing
    seedActivity(db, 'act-state', '活动1');
    const actLink = store.add(project.id, { kind: 'activity', id: 'act-state' });
    assert.equal(store.overview(project.id).links.find((l) => l.id === actLink.id)?.state, 'unchanged');

    db.connection.prepare("UPDATE activities SET archived = 1 WHERE id = 'act-state'").run();
    assert.equal(store.overview(project.id).links.find((l) => l.id === actLink.id)?.state, 'missing');
  } finally {
    db.close();
  }
});

test('3. adopt 原子且重复采用幂等，重复 add 幂等返回已有 link', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-采用幂等' });
    seedNote(db, 'note-adopt', '设定资料', '世界观背景：空岛之门已开启。');

    // 重复 add 不报错，幂等返回同一条记录
    const link1 = store.add(project.id, { kind: 'note', id: 'note-adopt' });
    const link2 = store.add(project.id, { kind: 'note', id: 'note-adopt' });
    assert.equal(link1.id, link2.id);
    assert.equal(store.overview(project.id).links.length, 1);

    // 首次 adopt
    const res1 = store.adopt(project.id, link1.id);
    assert.ok(res1.document);
    assert.equal(res1.document.kind, 'world');
    assert.equal(res1.document.title, '设定资料');

    // 检查 project_links.adopted_entry_id 已持久化
    const overview = store.overview(project.id);
    const adoptedLink = overview.links.find((l) => l.id === link1.id);
    assert.equal(adoptedLink?.adoptedEntryId, res1.document.id);

    // 再次 adopt 必须幂等，直接返回同一文档，不产生第二篇文档
    const res2 = store.adopt(project.id, link1.id);
    assert.equal(res2.document.id, res1.document.id);
    const worldDocs = store.story.listDocuments(project.id).filter((d) => d.kind === 'world');
    assert.equal(worldDocs.length, 1, '重复采用不能重复创建 world 文档');
  } finally {
    db.close();
  }
});

test('4. 移除引用不删来源，已采用为设定的引用禁止直接 unlink', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-移除引用' });
    seedNote(db, 'note-unlink', '独立资料', '重要资料正文');

    const link = store.add(project.id, { kind: 'note', id: 'note-unlink' });
    assert.equal(store.overview(project.id).links.length, 1);

    // 正常 unlink 未采用的引用
    store.unlink(project.id, link.id);
    assert.equal(store.overview(project.id).links.length, 0);

    // 确认原始 creative_notes 依然完整存在
    const noteExists = db.connection.prepare('SELECT id FROM creative_notes WHERE id = ?').get('note-unlink');
    assert.ok(noteExists, '移除引用绝不能删除来源数据');

    // 重新加入并采用为设定后，禁止删除引用（保留采用出处）
    const newLink = store.add(project.id, { kind: 'note', id: 'note-unlink' });
    store.adopt(project.id, newLink.id);

    assert.throws(
      () => store.unlink(project.id, newLink.id),
      (err: unknown) => err instanceof StoryError && err.code === 'project_reference_adopted' && err.statusCode === 409,
    );
  } finally {
    db.close();
  }
});

test('5. 保留采用出处：采纳为文档的正文包含完整的来源与版本出处元数据', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-出处保留' });
    seedNote(db, 'note-provenance', '旧时代编年史', '远古时代的神明大战。');

    const link = store.add(project.id, { kind: 'note', id: 'note-provenance' });
    const { document } = store.adopt(project.id, link.id);

    assert.ok(document.body.includes('远古时代的神明大战。'));
    assert.ok(document.body.includes('采用来源：旧时代编年史'));
    assert.ok(document.body.includes('来源标识：note/note-provenance'));
    assert.ok(document.body.includes('采纳时间：'));
    assert.ok(document.body.includes('此内容已成为本项目设定；来源更新不会自动覆盖作者的修改。'));
  } finally {
    db.close();
  }
});

test('6. 采用回调抛错时事务原子回滚，不残留半提交条目', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-回滚测试' });

    // onCreated 回调如果抛错，story.createDocument 整个事务必须回滚
    assert.throws(
      () => {
        store.story.createDocument(
          project.id,
          { kind: 'world', title: '事务回滚测试文档', body: '测试正文' },
          () => {
            throw new Error('callback_simulated_failure');
          },
        );
      },
      /callback_simulated_failure/,
    );

    const docCount = Number(
      (db.connection.prepare("SELECT COUNT(*) AS n FROM story_documents WHERE title = '事务回滚测试文档'").get() as { n: number }).n,
    );
    assert.equal(docCount, 0, '回调抛错后文档绝不能残留在数据库中');
  } finally {
    db.close();
  }
});

test('7. 项目隔离：项目之间的引用和采用互不干扰，禁止跨项目操作', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const p1 = store.story.createProject({ title: '项目A' });
    const p2 = store.story.createProject({ title: '项目B' });
    seedNote(db, 'note-iso', '共享资料', '内容');

    const linkA = store.add(p1.id, { kind: 'note', id: 'note-iso' });

    // p2 不应有任何链接
    assert.equal(store.overview(p2.id).links.length, 0);

    // p2 尝试 adopt 或 unlink p1 的链接应抛 404
    assert.throws(
      () => store.adopt(p2.id, linkA.id),
      (err: unknown) => err instanceof StoryError && err.code === 'project_link_not_found' && err.statusCode === 404,
    );

    assert.throws(
      () => store.unlink(p2.id, linkA.id),
      (err: unknown) => err instanceof StoryError && err.code === 'project_link_not_found' && err.statusCode === 404,
    );
  } finally {
    db.close();
  }
});

test('8. artifact 保护引用与移除：登记 artifact_references 并在 unlink 时精确解绑', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-媒体保护' });
    seedArtifact(db, 'art-protect', 'creative-center');

    const link = store.add(project.id, { kind: 'artifact', id: 'art-protect' });

    // 检查 artifact_references 已写入引用
    const ref = db.connection.prepare(`
      SELECT * FROM artifact_references
      WHERE artifact_id = ? AND ref_type = 'project' AND ref_id = ?
    `).get('art-protect', link.id) as { app_id: string } | undefined;
    assert.ok(ref);
    assert.equal(ref.app_id, 'creative-center');

    // 移除项目引用
    store.unlink(project.id, link.id);

    // 检查 artifact_references 已删除
    const refAfter = db.connection.prepare(`
      SELECT 1 FROM artifact_references
      WHERE artifact_id = ? AND ref_type = 'project' AND ref_id = ?
    `).get('art-protect', link.id);
    assert.equal(refAfter, undefined, '移除项目引用必须精确清理 artifact_references');

    // 原始 artifact 不得被删除
    const artStillExists = db.connection.prepare('SELECT id FROM artifacts WHERE id = ?').get('art-protect');
    assert.ok(artStillExists, '媒体本体不能被删除');
  } finally {
    db.close();
  }
});

test('9. 真实制作流程测试：PublicationStore 创建制作、汇集于 overview、禁止跨项目改变来源', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const p1 = store.story.createProject({ title: '制作流程项目1' });
    const p2 = store.story.createProject({ title: '制作流程项目2' });

    // 建立正文章节并获取其冻结修订版本
    const chapter = store.story.createDocument(p1.id, { kind: 'chapter', title: '第一章 启程', body: '飞船缓缓升空。' });
    const revisions = store.story.listEntryRevisions(p1.id, 'chapter', chapter.id);
    assert.ok(revisions.length > 0);
    const revisionId = revisions[0].id;

    // 通过真实的 PublicationStore.create 创建制作草稿活动
    const pubStore = new PublicationStore(db, '/tmp');
    const draft = pubStore.create(p1.id, [revisionId]);
    assert.ok(draft.activityId);

    // 验证 p1 项目概览汇集该制作
    const overview1 = store.overview(p1.id);
    assert.ok(overview1.productions.some((prod) => prod.id === draft.activityId));
    assert.equal(store.list().items.find((i) => i.project.id === p1.id)?.productions, 1);

    // 验证 p2 尝试跨项目关联该制作时被拒绝 (409 project_source_conflict)
    assert.throws(
      () => store.add(p2.id, { kind: 'activity', id: draft.activityId }),
      (err: unknown) => err instanceof StoryError && err.code === 'project_source_conflict' && err.statusCode === 409,
    );

    // p1 本身关联该制作成功
    const linkP1 = store.add(p1.id, { kind: 'activity', id: draft.activityId });
    assert.equal(linkP1.kind, 'activity');
    assert.equal(linkP1.sourceId, draft.activityId);
  } finally {
    db.close();
  }
});

test('10. 角色版本追溯：检测项目内角色所绑定的已发布版本与主资料库最新版本差异 (latestSourceVersion)', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '角色版本项目' });
    const now = nowIso();

    // 建立公共角色资料与初始发布版本 1
    db.connection.prepare(`
      INSERT INTO character_profiles (id, slug, display_name, draft_json, created_at, updated_at)
      VALUES ('char-source-1', 'traveler', '旅行者', '{}', ?, ?)
    `).run(now, now);

    db.connection.prepare(`
      INSERT INTO character_versions (character_id, version, data_json, compiled_linshe_prompt, created_at)
      VALUES ('char-source-1', 1, '{}', 'prompt v1', ?),
             ('char-source-1', 2, '{}', 'prompt v2', ?)
    `).run(now, now);

    // 项目内引入角色，绑定至版本 1
    const character = store.story.createCharacter(project.id, {
      name: '旅行者',
      sourceCharacterId: 'char-source-1',
      sourceVersion: 1,
    });
    assert.equal(character.sourceVersion, 1);

    // 概览中检测到当前绑定的版本是 1，但主库最新版本为 2
    let overview = store.overview(project.id);
    let charInOverview = overview.characters.find((c) => c.id === character.id);
    assert.ok(charInOverview);
    assert.equal(charInOverview.sourceVersion, 1);
    assert.equal(charInOverview.latestSourceVersion, 2, '应能感知到主库存在更新的发布版本 2');

    // 主库再发布版本 3
    db.connection.prepare(`
      INSERT INTO character_versions (character_id, version, data_json, compiled_linshe_prompt, created_at)
      VALUES ('char-source-1', 3, '{}', 'prompt v3', ?)
    `).run(now);

    overview = store.overview(project.id);
    charInOverview = overview.characters.find((c) => c.id === character.id);
    assert.equal(charInOverview?.latestSourceVersion, 3, '主库发布版本 3 后能即时感知');
  } finally {
    db.close();
  }
});

test('11. auth 和非法输入：未配置管理凭据返回 503，凭据错误返回 401，非法入参返回 400', async () => {
  const db = new ServiceDatabase(':memory:');
  const adminToken = 'secret-admin-token-test';

  // 1. 当 adminToken 为 null 时，访问管理路由应响应 503 admin_not_configured
  const unconfiguredApp = fastify();
  registerProjectRoutes(unconfiguredApp, { adminToken: null } as unknown as ServiceConfig, db, null);
  await unconfiguredApp.ready();

  try {
    const res503 = await unconfiguredApp.inject({
      method: 'GET',
      url: '/api/v1/admin/projects',
    });
    assert.equal(res503.statusCode, 503);
    assert.equal(res503.json().error, 'admin_not_configured');
  } finally {
    await unconfiguredApp.close();
  }

  // 2. 正常配置 adminToken 的场景
  const configuredApp = fastify();
  registerProjectRoutes(configuredApp, { adminToken } as unknown as ServiceConfig, db, null);
  await configuredApp.ready();

  try {
    const store = new ProjectStore(db);
    const project = store.story.createProject({ title: '项目-HTTP测试' });

    // 未带凭据 -> 401
    const unauthed = await configuredApp.inject({
      method: 'GET',
      url: '/api/v1/admin/projects',
    });
    assert.equal(unauthed.statusCode, 401);

    const headers = { 'x-sthstart-admin-token': adminToken };

    // 正常获取列表 -> 200
    const listRes = await configuredApp.inject({
      method: 'GET',
      url: '/api/v1/admin/projects',
      headers,
    });
    assert.equal(listRes.statusCode, 200);

    // 非法 body 输入（未知 kind） -> 400
    const invalidKind = await configuredApp.inject({
      method: 'POST',
      url: `/api/v1/admin/projects/${project.id}/links`,
      headers,
      payload: { kind: 'unsupported_kind', id: '123' },
    });
    assert.equal(invalidKind.statusCode, 400);

    // 不存在的来源 -> 404 project_source_missing
    const missingSource = await configuredApp.inject({
      method: 'POST',
      url: `/api/v1/admin/projects/${project.id}/links`,
      headers,
      payload: { kind: 'note', id: 'non-existent-note-id' },
    });
    assert.equal(missingSource.statusCode, 404);
    assert.equal(missingSource.json().error, 'project_source_missing');

    // 不存在的项目 -> 404 story_project_not_found
    const missingProject = await configuredApp.inject({
      method: 'GET',
      url: '/api/v1/admin/projects/non-existent-project/overview',
      headers,
    });
    assert.equal(missingProject.statusCode, 404);
    assert.equal(missingProject.json().error, 'story_project_not_found');

    // 对 artifact 执行 adopt -> 400 project_reference_required
    seedArtifact(db, 'art-cannot-adopt');
    const artLink = store.add(project.id, { kind: 'artifact', id: 'art-cannot-adopt' });

    const adoptArt = await configuredApp.inject({
      method: 'POST',
      url: `/api/v1/admin/projects/${project.id}/links/${artLink.id}/adopt`,
      headers,
      payload: {},
    });
    assert.equal(adoptArt.statusCode, 400);
    assert.equal(adoptArt.json().error, 'project_reference_required');
  } finally {
    await configuredApp.close();
    db.close();
  }
});

test('12. 从 53 迁移到 54 真实资产保留与外键检查：媒体行、角色资产行及项目数据完整保留且无外键违规', () => {
  const conn = new DatabaseSync(':memory:');
  conn.exec('PRAGMA foreign_keys = ON');

  try {
    // 迁移至 53 阶段
    const migrationsUpTo53 = SERVICE_DATABASE_MIGRATIONS.slice(0, 53);
    migrateDatabase(conn, migrationsUpTo53, 'test');

    const applied53 = conn.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number };
    assert.equal(applied53.v, 53);

    // 植入 53 阶段全量核心实体：managed_apps, artifacts, character_profiles, character_assets, story_projects, story_documents
    const now = nowIso();
    conn.prepare(`
      INSERT INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at)
      VALUES ('test-app', '测试应用', 'hash_test', '["artifact"]', 1, ?, ?)
    `).run(now, now);

    conn.prepare(`
      INSERT INTO artifacts (id, app_id, content_type, byte_size, sha256, file_status, media_type, created_at)
      VALUES ('art-m53', 'test-app', 'image/png', 2048, 'sha_m53_hash', 'ready', 'image', ?)
    `).run(now);

    conn.prepare(`
      INSERT INTO character_profiles (id, slug, display_name, draft_json, created_at, updated_at)
      VALUES ('char-m53', 'char-53', '角色53', '{}', ?, ?)
    `).run(now, now);

    conn.prepare(`
      INSERT INTO character_assets (id, character_id, artifact_id, kind, category, title, created_at)
      VALUES ('asset-m53', 'char-m53', 'art-m53', 'portrait', 'portrait', '立绘资产', ?)
    `).run(now);

    conn.prepare(`
      INSERT INTO story_projects (id, title, summary, revision, context_settings_json, created_at, updated_at, work_id, project_type)
      VALUES ('proj-m53', '53前项目', '摘要', 1, '{}', ?, ?, NULL, 'fiction')
    `).run(now, now);

    conn.prepare(`
      INSERT INTO story_documents (id, project_id, kind, title, body, position, revision, created_at, updated_at)
      VALUES ('doc-m53', 'proj-m53', 'chapter', '第一章', '故事从五十三版本开始。', 0, 1, ?, ?)
    `).run(now, now);

    // 执行迁移至 54（包含 creative-project-links）
    migrateDatabase(conn, SERVICE_DATABASE_MIGRATIONS, 'test');

    const applied54 = conn.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number };
    assert.equal(applied54.v, 54);

    // 严格运行 PRAGMA foreign_key_check 确保无任何外键冲突
    const fkViolations = conn.prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(fkViolations, [], '54 迁移后必须无任何外键违规');

    // 验证新表 project_links 已建立
    const hasTable = conn.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='project_links'").get();
    assert.ok(hasTable, '54 迁移必须创建 project_links 表');

    // 验证既有真实资产与媒体数据完整保留
    const artifact = conn.prepare('SELECT * FROM artifacts WHERE id = ?').get('art-m53') as Record<string, unknown>;
    assert.ok(artifact);
    assert.equal(artifact.content_type, 'image/png');
    assert.equal(artifact.sha256, 'sha_m53_hash');

    const charAsset = conn.prepare('SELECT * FROM character_assets WHERE id = ?').get('asset-m53') as Record<string, unknown>;
    assert.ok(charAsset);
    assert.equal(charAsset.character_id, 'char-m53');
    assert.equal(charAsset.artifact_id, 'art-m53');
    assert.equal(charAsset.category, 'portrait');

    // 验证既有项目与章节文档完好无损
    const project = conn.prepare('SELECT * FROM story_projects WHERE id = ?').get('proj-m53') as Record<string, unknown>;
    assert.ok(project);
    assert.equal(project.title, '53前项目');

    const document = conn.prepare('SELECT * FROM story_documents WHERE id = ?').get('doc-m53') as Record<string, unknown>;
    assert.ok(document);
    assert.equal(document.title, '第一章');
    assert.equal(document.body, '故事从五十三版本开始。');
  } finally {
    conn.close();
  }
});





