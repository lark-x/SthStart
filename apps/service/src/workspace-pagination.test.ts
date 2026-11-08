import assert from 'node:assert/strict';
import test from 'node:test';
import fastify from 'fastify';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { registerActivityRoutes } from './activities/routes.js';
import { registerCreativeRoutes } from './creative.js';
import { listImageAttemptsPage } from './activities/image-attempts.js';
import { decodeListCursor, encodeListCursor } from './list-cursor.js';

test('activity pages search beyond 100, preserve ties and clamp after deletion', async () => {
  const db = new ServiceDatabase();
  const app = fastify();
  try {
    const store = new ActivityStore(db);
    assert.equal(store.pageActivities().total, 0);
    const ids = Array.from({length: 121}, (_, i) => store.createActivity({title: `项目 ${i}`, type: 'story', location: i === 120 ? '独特地点%_ ÉTOILE' : ''}).activity.id);
    db.connection.prepare('UPDATE activities SET updated_at=?').run('2026-01-01');
    const pages = Array.from({length: 7}, (_, i) => store.pageActivities({page: i + 1}));
    assert.deepEqual(pages.flatMap(p => p.items.map(i => i.id)), [...ids].sort().reverse());
    assert.equal(store.pageActivities({q: '独特地点%_', page: 99}).items[0].id, ids[120]);
    assert.equal(store.pageActivities({q: '独特地点%_', page: 99}).page, 1);
    assert.equal(store.pageActivities({q: 'étoile'}).items[0].id, ids[120]);
    assert.equal(store.listActivities({cursor: '2025-01-01T00:00:00.000Z'}).items.length, 0);
    const last = store.pageActivities({page: 7}).items[0];
    db.connection.prepare('DELETE FROM activities WHERE id=?').run(last.id);
    assert.equal(store.pageActivities({page: 7}).page, 6);
    const first = store.listActivities({limit: 100});
    const next = store.listActivities({limit: 100, cursor: first.nextCursor!});
    assert.equal(new Set([...first.items, ...next.items].map(i => i.id)).size, 120);
    assert.equal(next.nextCursor, null);
    registerActivityRoutes(app, readConfig({}), db, new SecretStore({}));
    const response = await app.inject('/api/v1/admin/activities/page?page=2&pageSize=100');
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().items.length, 20);
    assert.equal(response.json().total, 120);
    assert.equal((await app.inject('/api/v1/admin/activities/page?pageSize=101')).statusCode, 400);
    assert.equal((await app.inject('/api/v1/admin/activities')).json().items.length, 100, 'old endpoint shape retained');
  } finally { await app.close(); db.close(); }
});

test('creative history traverses 121 equal-time tasks and rejects invalid cursors', async () => {
  const db = new ServiceDatabase();
  const app = fastify();
  try {
    // Isolated fixture only: unrelated engine/workflow records are not needed for read-only history.
    db.connection.exec('PRAGMA foreign_keys = OFF');
    const insert = db.connection.prepare(`INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES (?, ?, 'engine', 'workflow', 1, 'hash', '{}', '{}', 'failed', '2026-01-01', '2026-01-01')`);
    for (let i = 0; i < 121; i++) insert.run(`task-${String(i).padStart(3, '0')}`, 'creative-center');
    insert.run('foreign-task', 'other-app');
    registerCreativeRoutes(app, readConfig({}), db, new SecretStore({}));
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response: {statusCode: number; body: string; json(): {items: {id: string}[]; nextCursor: string | null}} = await app.inject('/api/v1/admin/creative/tasks?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      assert.equal(response.statusCode, 200, response.body);
      const body: {items: {id: string}[]; nextCursor: string | null} = response.json();
      ids.push(...body.items.map((item: {id: string}) => item.id));
      cursor = body.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 121);
    assert.equal(new Set(ids).size, 121);
    assert.equal(ids.at(-1), 'task-000');
    assert.equal((await app.inject('/api/v1/admin/creative/tasks?cursor=bad')).statusCode, 400);
    assert.equal((await app.inject('/api/v1/admin/creative/tasks?limit=101')).statusCode, 400);
    assert.equal((await app.inject('/api/v1/admin/creative/tasks')).json().items.length, 30);
  } finally {await app.close(); db.close();}
});

test('image history crosses 50 with ties, slot isolation and deleted cursor row', () => {
  const db = new ServiceDatabase();
  try {
    db.connection.exec('PRAGMA foreign_keys = OFF');
    const insert = db.connection.prepare(`INSERT INTO activity_image_attempts(id, activity_id, base_content_revision_id, image_config_revision_id, slot_id, slot_fingerprint, recipe_id, compilation_id, recipe_hash, execution_plan_hash, task_id, status, actual_seed, business_request_hash, created_at, updated_at) VALUES (?, 'activity', '', '', ?, '', '', '', '', '', '', 'failed', 1, '', '2026-01-01', '2026-01-01')`);
    for (let i = 0; i < 121; i++) insert.run(`image-${String(i).padStart(3, '0')}`, 'slot');
    insert.run('other', 'another-slot');
    const first = listImageAttemptsPage(db, 'activity', 'slot');
    assert.equal(first.items.length, 50);
    db.connection.prepare('DELETE FROM activity_image_attempts WHERE id=?').run(first.items.at(-1)!.id);
    const second = listImageAttemptsPage(db, 'activity', 'slot', 50, first.nextCursor!);
    const third = listImageAttemptsPage(db, 'activity', 'slot', 50, second.nextCursor!);
    assert.equal(third.nextCursor, null);
    const ids = [...first.items, ...second.items, ...third.items].map(i => i.id);
    assert.equal(ids.length, 121);
    assert.equal(new Set(ids).size, 121);
    assert.equal(listImageAttemptsPage(db, 'other-activity').items.length, 0);
    assert.deepEqual(decodeListCursor(encodeListCursor('time', 'id')), ['time', 'id']);
    assert.throws(() => decodeListCursor('bad'));
  } finally {db.close();}
});
