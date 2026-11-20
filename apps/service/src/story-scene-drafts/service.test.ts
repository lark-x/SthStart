import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import { StorySceneDraftSchema, type StorySceneActionResponse, type StorySceneDraft } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import { migrateDatabase, SERVICE_DATABASE_MIGRATIONS, ServiceDatabase } from '../database.js';
import { registerStorySceneDraftRoutes } from './routes.js';
import { StorySceneService } from './service.js';
import { StorySceneTextError, type StorySceneTextExecutor } from './text.js';

const character = { name: '林舟', origin: 'original' as const, setting: '风暴过后，守塔人必须点亮信号灯。' };
const start = { time: '风暴后', location: '旧灯塔' };
const brief = { viewpoint: '林舟', action: '把信号灯点亮', change: '走失的小船调头', constraints: ['单一视角'] };
const rootPath = '/api/v1/admin/story-scene-drafts';
const adminToken = 'scene-tests-admin-token';
const noMedia: ConstructorParameters<typeof StorySceneService>[2] = {
  readImageTask: image => image,
  generateImage: async () => { throw new Error('Unexpected image call'); },
  adopt: () => { throw new Error('Unexpected adoption call'); },
};

test('strict authenticated draft routes paginate summary only, preserve conflict data, and fork without overwriting', async () => {
  const db = new ServiceDatabase();
  const service = new StorySceneService(db, async () => { throw new Error('Unexpected text call'); }, noMedia);
  const app = Fastify();
  registerStorySceneDraftRoutes(app, { adminToken } as ServiceConfig, service);
  const headers = { 'x-sthstart-admin-token': adminToken };
  try {
    assert.equal((await app.inject({ method: 'GET', url: rootPath })).statusCode, 401);
    const input = { character, idempotencyKey: 'create-1', notes: '不会出现在摘要', start };
    const create = () => app.inject({ method: 'POST', url: rootPath, headers, payload: input });
    const firstResponse = await create();
    assert.equal(firstResponse.statusCode, 201, firstResponse.body);
    const draft = firstResponse.json<StorySceneDraft>();
    assert.ok(Value.Check(StorySceneDraftSchema, draft));
    assert.equal((await create()).json().id, draft.id);
    const url = `${rootPath}/${draft.id}`;
    const update = await app.inject({ method: 'PATCH', url, headers, payload: { expectedRevision: draft.revision, body: '灯亮了。' } });
    assert.equal(update.statusCode, 200, update.body);
    const duplicateTab = await app.inject({ method: 'PATCH', url, headers, payload: { expectedRevision: draft.revision, body: '另一个版本' } });
    assert.equal(duplicateTab.statusCode, 409);
    assert.equal((await app.inject({ method: 'GET', url, headers })).json().body, '灯亮了。');
    assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { expectedRevision: 2, start: null } })).json().error, 'fork_required');
    assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { expectedRevision: 2, images: [] } })).statusCode, 400);
    const fork = await app.inject({ method: 'POST', url: rootPath, headers, payload: { idempotencyKey: 'fork', forkFrom: draft.id } });
    assert.equal(fork.statusCode, 201, fork.body);
    assert.equal(fork.json().forkedFrom, draft.id);
    assert.equal(fork.json().body, '');
    assert.equal(fork.json().start.location, start.location);
    const page1 = (await app.inject({ method: 'GET', url: `${rootPath}?limit=1`, headers })).json();
    assert.equal(page1.items.length, 1);
    assert.equal('notes' in page1.items[0], false);
    const page2 = (await app.inject({ method: 'GET', url: `${rootPath}?limit=1&cursor=${page1.nextCursor}`, headers })).json();
    assert.equal(page2.items.length, 1);
    assert.notEqual(page2.items[0].id, page1.items[0].id);
    assert.equal(page2.nextCursor, null);
  } finally {
    await app.close();
    db.close();
  }
});

test('in-flight idempotency, busy exclusion and stale completion survive an intervening edit', async () => {
  const db = new ServiceDatabase();
  let complete!: (body: string) => void;
  const text: StorySceneTextExecutor = () => new Promise(resolve => {
    complete = body => resolve({ action: 'write', body });
  });
  const service = new StorySceneService(db, text, noMedia);
  try {
    const created = service.store.create({ idempotencyKey: 'first', character, start });
    const confirmed = service.store.patch(created.id, { expectedRevision: 1, brief, briefConfirmed: true });
    const input = { action: 'write' as const, expectedRevision: confirmed.revision, idempotencyKey: 'write-1' };
    const pending = service.run(created.id, input);
    const replay = await service.run(created.id, input);
    assert.equal(replay.action.status, 'running');
    await assert.rejects(service.run(created.id, { ...input, idempotencyKey: 'write-2' }), { code: 'action_busy' });
    const edited = service.store.patch(created.id, { expectedRevision: confirmed.revision, body: '作者输入' });
    complete('迟到的 AI 正文');
    const result = await pending;
    assert.equal(result.action.id, replay.action.id);
    assert.equal(result.action.status, 'stale');
    assert.equal(result.draft.body, edited.body);
    assert.equal(result.draft.bodyVersion, edited.bodyVersion);
  } finally { db.close(); }
});

test('retry relinks the original author message and recovers expired text actions', async () => {
  const db = new ServiceDatabase();
  let attempts = 0;
  const service = new StorySceneService(db, async (_draft, input, ctx) => {
    assert.equal(input.action, 'discuss');
    assert.equal(input.message, '换成林舟视角');
    assert.equal(ctx.message?.text, input.message);
    attempts++;
    if (attempts === 1) throw new StorySceneTextError('provider_unavailable', 502, '暂时不可用');
    return { action: 'discuss', message: { id: ctx.actionId, role: 'assistant', text: '从林舟看见灯起笔。', createdAt: new Date().toISOString() } };
  }, noMedia);
  try {
    const draft = service.store.create({ idempotencyKey: 'create', character, start });
    const input = { action: 'discuss' as const, expectedRevision: 1, idempotencyKey: 'first-attempt', message: '换成林舟视角' };
    const first = await service.run(draft.id, input);
    assert.equal(first.action.status, 'failed');
    assert.equal(first.draft.messages.length, 1);
    db.connection.prepare("UPDATE story_scene_actions SET status = 'running', updated_at = '2000-01-01' WHERE id = ?").run(first.action.id);
    assert.equal(service.get(draft.id).currentAction?.error?.code, 'action_expired');
    const retry = await service.run(draft.id, { action: 'discuss', expectedRevision: first.draft.revision, idempotencyKey: 'next', retryOf: first.action.id });
    assert.equal(retry.action.status, 'succeeded');
    assert.equal(retry.action.messageId, first.action.messageId);
    assert.deepEqual(retry.draft.messages.map(item => item.role), ['author', 'assistant']);
    assert.equal(attempts, 2);
  } finally { db.close(); }
});

test('v65 disk database preserves work, chapter and character rows when adding scene drafts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-scene-upgrade-'));
  const path = join(directory, 'upgrade.db');
  try {
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec('PRAGMA foreign_keys = ON');
      migrateDatabase(legacy, SERVICE_DATABASE_MIGRATIONS.filter(item => item.version <= 65), 'service');
      legacy.exec(`INSERT INTO story_projects(id,title,summary,revision,context_settings_json,created_at,updated_at,work_id,project_type)
        VALUES ('existing-work','旧作品','',1,'{}','then','then','work-external','fiction');
        INSERT INTO story_documents(id,project_id,kind,title,body,position,revision,created_at,updated_at)
        VALUES ('existing-chapter','existing-work','chapter','旧章节','旧正文',1,2,'then','then');
        INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,created_at,updated_at)
        VALUES ('existing-character','old-character','旧角色','{}','[]','then','then');`);
    } finally { legacy.close(); }
    const upgraded = new ServiceDatabase(path);
    try {
      assert.equal(upgraded.connection.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version, SERVICE_DATABASE_MIGRATIONS.at(-1)?.version);
      assert.equal(upgraded.connection.prepare("SELECT title FROM story_projects WHERE id = 'existing-work'").get()?.title, '旧作品');
      assert.equal(upgraded.connection.prepare("SELECT body FROM story_documents WHERE id = 'existing-chapter'").get()?.body, '旧正文');
      assert.equal(upgraded.connection.prepare("SELECT display_name FROM character_profiles WHERE id = 'existing-character'").get()?.display_name, '旧角色');
      const service = new StorySceneService(upgraded, async () => { throw new Error('Unexpected text call'); }, noMedia);
      const draft = service.store.create({ idempotencyKey: 'migrated', character });
      assert.equal(service.get(draft.id).title, '林舟的一幕');
      assert.equal(upgraded.connection.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      assert.deepEqual(upgraded.connection.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true }); }
});
