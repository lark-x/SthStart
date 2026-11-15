import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ServiceDatabase, nowIso } from '../database.js';
import { readConfig } from '../config.js';
import { registerGenerationRecoveryRoutes } from './recovery-routes.js';

const ADMIN_TOKEN = 'recovery-admin-token-0123456789abcdef';

function seed(database: ServiceDatabase) {
  const now = nowIso();
  for (const appId of ['app-a', 'app-b']) {
    database.connection.prepare(
      "INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,?,1,?,?)",
    ).run(appId, appId, `token-${appId}`, JSON.stringify(['generation', 'image']), now, now);
  }
  database.connection.prepare(
    "INSERT INTO generation_engines(id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at) VALUES ('eng-a','eng','comfyui','http://eng.invalid:8188',NULL,1,1,?,?)",
  ).run(now, now);
  database.connection.prepare(
    "INSERT INTO generation_workflows(id,name,description,engine_kind,category,latest_version,created_at,updated_at) VALUES ('wf-a','wf','','comfyui','image',1,?,?)",
  ).run(now, now);

  const addTask = (id: string, appId: string, status: string, upstream: number, updatedAt: string, errorCode: string | null = null) => {
    database.connection.prepare(`
      INSERT INTO generation_tasks(
        id,app_id,engine_id,workflow_id,workflow_version,purpose,request_hash,
        request_params_json,workflow_snapshot_json,status,provider_task_id,error_code,error_message,
        upstream_may_continue,cancellation_scope,created_at,updated_at,priority,progress_json,queue_slot_held,finished_at
      ) VALUES (?,?,'eng-a','wf-a',1,'default',?,'{}','{}',?,NULL,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, appId, `hash-${id}`, status, errorCode, errorCode ? `problem ${errorCode}` : null,
      upstream, upstream ? 'local-tracking' : 'none', '2026-11-11T00:00:00.000Z', updatedAt, 'normal', '{}', upstream, '2026-11-11T00:00:10.000Z',
    );
  };
  addTask('uncertain-a', 'app-a', 'abandoned', 1, '2026-11-11T00:00:03.000Z', 'submission_outcome_unknown');
  addTask('active-a', 'app-a', 'running', 1, '2026-11-11T00:00:04.000Z');
  addTask('reviewed-a', 'app-a', 'abandoned', 0, '2026-11-11T00:00:02.000Z');
  addTask('uncertain-b', 'app-b', 'failed', 1, '2026-11-11T00:00:05.000Z', 'cloud_submission_uncertain');
}

async function fixture() {
  const database = new ServiceDatabase();
  seed(database);
  const config = readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN, STHSTART_ARTIFACT_DIR: ':memory:' });
  const app = Fastify({ logger: false });
  registerGenerationRecoveryRoutes(app, config, database);
  await app.ready();
  return {
    database,
    app,
    close: async () => { await app.close(); database.close(); },
  };
}

const auth = { 'x-sthstart-admin-token': ADMIN_TOKEN };

test('recovery routes reject missing admin auth', async () => {
  const f = await fixture();
  try {
    const list = await f.app.inject({ method: 'GET', url: '/api/v1/admin/generation/uncertain-tasks' });
    assert.equal(list.statusCode, 401);
    const resolve = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/uncertain-a/resolve-uncertain',
      payload: { confirmed: true, outcome: 'cancelled', note: 'checked' },
    });
    assert.equal(resolve.statusCode, 401);
    const wrong = await f.app.inject({
      method: 'GET', url: '/api/v1/admin/generation/uncertain-tasks',
      headers: { 'x-sthstart-admin-token': 'wrong-token' },
    });
    assert.equal(wrong.statusCode, 401);
  } finally {
    await f.close();
  }
});

test('uncertain task list is filtered by app and exposes only public recovery fields', async () => {
  const f = await fixture();
  try {
    const list = await f.app.inject({ method: 'GET', url: '/api/v1/admin/generation/uncertain-tasks?limit=10', headers: auth });
    assert.equal(list.statusCode, 200);
    const body = list.json() as { items: Array<Record<string, unknown>>; total: number };
    assert.equal(body.total, 3);
    assert.deepEqual(body.items.map((item) => item.id), ['uncertain-a', 'active-a', 'uncertain-b']);
    assert.equal(body.items[0].appId, 'app-a');
    assert.equal(body.items[0].upstreamMayContinue, true);
    assert.equal('artifacts' in body.items[0], false);

    const scoped = await f.app.inject({ method: 'GET', url: '/api/v1/admin/generation/uncertain-tasks?appId=app-b', headers: auth });
    assert.equal(scoped.statusCode, 200);
    assert.deepEqual((scoped.json() as { items: Array<{ id: string }> }).items.map((item) => item.id), ['uncertain-b']);
  } finally {
    await f.close();
  }
});

test('confirmed resolution releases an abandoned uncertain task and removes it from the list', async () => {
  const f = await fixture();
  try {
    const resolved = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/uncertain-a/resolve-uncertain', headers: auth,
      payload: { confirmed: true, outcome: 'cancelled', note: '已在 ComfyUI 队列与历史中核对，任务不存在', appId: 'app-a' },
    });
    assert.equal(resolved.statusCode, 200);
    const task = (resolved.json() as { task: { status: string; upstreamMayContinue: boolean; errorCode: string | null } }).task;
    assert.equal(task.status, 'cancelled');
    assert.equal(task.upstreamMayContinue, false);
    assert.equal(task.errorCode, null);
    const row = f.database.connection.prepare("SELECT status,upstream_may_continue,queue_slot_held,cancellation_scope FROM generation_tasks WHERE id='uncertain-a'").get() as { status: string; upstream_may_continue: number; queue_slot_held: number; cancellation_scope: string };
    assert.equal(row.status, 'cancelled');
    assert.equal(row.upstream_may_continue, 0);
    assert.equal(row.queue_slot_held, 0);
    assert.equal(row.cancellation_scope, 'none');

    const list = await f.app.inject({ method: 'GET', url: '/api/v1/admin/generation/uncertain-tasks', headers: auth });
    assert.deepEqual((list.json() as { items: Array<{ id: string }> }).items.map((item) => item.id), ['active-a', 'uncertain-b']);
  } finally {
    await f.close();
  }
});

test('unconfirmed, active, already-resolved and cross-app requests keep the task untouched', async () => {
  const f = await fixture();
  try {
    const notConfirmed = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/uncertain-b/resolve-uncertain', headers: auth,
      payload: { confirmed: false, outcome: 'cancelled', note: 'not checked' },
    });
    assert.equal(notConfirmed.statusCode, 400);

    const blankNote = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/uncertain-b/resolve-uncertain', headers: auth,
      payload: { confirmed: true, outcome: 'cancelled', note: '   ' },
    });
    assert.equal(blankNote.statusCode, 400);

    const active = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/active-a/resolve-uncertain', headers: auth,
      payload: { confirmed: true, outcome: 'cancelled', note: 'checked' },
    });
    assert.equal(active.statusCode, 409);
    assert.equal(active.json().error, 'task_still_active');

    const reviewed = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/reviewed-a/resolve-uncertain', headers: auth,
      payload: { confirmed: true, outcome: 'cancelled', note: 'checked' },
    });
    assert.equal(reviewed.statusCode, 409);
    assert.equal(reviewed.json().error, 'task_not_awaiting_review');

    const crossApp = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/uncertain-b/resolve-uncertain', headers: auth,
      payload: { confirmed: true, outcome: 'failed', note: 'checked', appId: 'app-a' },
    });
    assert.equal(crossApp.statusCode, 404);

    const missing = await f.app.inject({
      method: 'POST', url: '/api/v1/admin/generation/tasks/missing/resolve-uncertain', headers: auth,
      payload: { confirmed: true, outcome: 'failed', note: 'checked' },
    });
    assert.equal(missing.statusCode, 404);

    const untouched = (f.database.connection.prepare("SELECT status,upstream_may_continue,queue_slot_held FROM generation_tasks WHERE id IN ('uncertain-b','active-a','reviewed-a') ORDER BY id").all() as Array<{ status: string; upstream_may_continue: number; queue_slot_held: number }>)
      .map((row) => ({ ...row }));
    assert.deepEqual(untouched, [
      { status: 'running', upstream_may_continue: 1, queue_slot_held: 1 },
      { status: 'abandoned', upstream_may_continue: 0, queue_slot_held: 0 },
      { status: 'failed', upstream_may_continue: 1, queue_slot_held: 1 },
    ]);
  } finally {
    await f.close();
  }
});
