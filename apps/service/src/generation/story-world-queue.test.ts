import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SERVICE_DATABASE_MIGRATIONS, ServiceDatabase, migrateDatabase, nowIso } from '../database.js';
import { readConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { generationExecutionsFor } from './events.js';
import { waitForExecutions } from './execution-registry.js';
import {
  claimQueuedTaskForDispatch,
  generationQueueReconciled,
  generationQueueSlotHeldSupported,
  markGenerationQueueSchedulerStarted,
  releaseGenerationQueueSlot,
} from './public-image-queue.js';
import { storyWorldQueueStatements } from './story-world-queue-migration.js';
import {
  cancelGenerationTask,
  confirmGenerationTaskUncertainOutcome,
  createGenerationTask,
  executeQueuedTask,
  listUncertainGenerationTasks,
  reconcileGenerationTasks,
} from './execution.js';

class MemorySecrets extends SecretStore {
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get() { return { value: null, source: 'none' as const }; }
}

const TEST_ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
const testConfig = (directory: string) => readConfig({
  STHSTART_ADMIN_TOKEN: TEST_ADMIN_TOKEN,
  STHSTART_ARTIFACT_DIR: directory,
});

type Fixture = {
  directory: string;
  db1: ServiceDatabase;
  db2: ServiceDatabase;
  close: () => void;
};

function applyQueueMigration(database: ServiceDatabase) {
  if (generationQueueSlotHeldSupported(database)) return;
  for (const statement of storyWorldQueueStatements) {
    try {
      database.connection.exec(statement);
    } catch (error) {
      // The unified 55 migration may already own these statements in a
      // parallel branch; only a duplicate-column result is safe to ignore.
      if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition_not_met');
}

function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-public-queue-'));
  const path = join(directory, 'service.db');
  const db1 = new ServiceDatabase(path);
  applyQueueMigration(db1);
  const db2 = new ServiceDatabase(path);
  seedApps(db1);
  return {
    directory,
    db1,
    db2,
    close: () => {
      db2.close();
      db1.close();
      try { rmSync(directory, { recursive: true, force: true }); } catch { /* windows may hold WAL briefly */ }
    },
  };
}

function seedApps(database: ServiceDatabase) {
  const now = nowIso();
  for (const appId of ['story-world', 'free-generation']) {
    database.connection.prepare(
      "INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,?,1,?,?)",
    ).run(appId, appId, `token-${appId}`, JSON.stringify(['generation', 'image']), now, now);
  }
}

function addEngine(database: ServiceDatabase, id: string, kind: 'comfyui' | 'cloud' | 'worker', baseUrl: string) {
  const now = nowIso();
  database.connection.prepare(
    'INSERT INTO generation_engines(id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at) VALUES (?,?,?,?,NULL,1,?,?,?)',
  ).run(id, id, kind, baseUrl, kind === 'cloud' ? 2 : 1, now, now);
}

function addWorkflow(database: ServiceDatabase, id: string, engineKind: 'comfyui' | 'cloud' | 'worker', engineId: string, definition: Record<string, unknown> = { '1': { class_type: 'Test', inputs: {} } }, category = 'image') {
  const now = nowIso();
  database.connection.prepare(
    'INSERT INTO generation_workflows(id,name,description,engine_kind,category,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
  ).run(id, id, '', engineKind, category, now, now);
  database.connection.prepare(
    'INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at) VALUES (?,1,?,?,?,?,?,1,?)',
  ).run(id, engineId, '{}', '{}', '[]', JSON.stringify(definition), now);
}

function addTask(database: ServiceDatabase, options: {
  id: string;
  appId?: string;
  engineId: string;
  workflowId: string;
  createdAt: string;
  priority?: 'interactive' | 'normal' | 'background';
  status?: string;
  providerTaskId?: string | null;
  requestParams?: Record<string, unknown>;
  workflowSnapshot?: Record<string, unknown>;
}) {
  database.connection.prepare(`
    INSERT INTO generation_tasks(
      id,app_id,engine_id,workflow_id,workflow_version,purpose,request_hash,
      request_params_json,workflow_snapshot_json,status,provider_task_id,
      upstream_may_continue,cancellation_scope,created_at,updated_at,priority,progress_json
    ) VALUES (?,?,?,?,1,'test',?,?,?,?,?,0,'none',?,?,?,?)
  `).run(
    options.id,
    options.appId ?? 'story-world',
    options.engineId,
    options.workflowId,
    `hash-${options.id}`,
    JSON.stringify(options.requestParams ?? { inputs: {} }),
    JSON.stringify(options.workflowSnapshot ?? {}),
    options.status ?? 'queued',
    options.providerTaskId ?? null,
    options.createdAt,
    options.createdAt,
    options.priority ?? 'normal',
    '{}',
  );
}

function seedImageQueues(database: ServiceDatabase) {
  addEngine(database, 'comfy-a', 'comfyui', 'http://comfy-a.invalid:8188');
  addEngine(database, 'comfy-b', 'comfyui', 'http://comfy-b.invalid:8188');
  addEngine(database, 'gpt-a', 'cloud', 'https://gpt-a.invalid/v1');
  addWorkflow(database, 'wf-comfy-a', 'comfyui', 'comfy-a');
  addWorkflow(database, 'wf-comfy-b', 'comfyui', 'comfy-b');
  addWorkflow(database, 'wf-gpt-a', 'cloud', 'gpt-a', { type: 'cloud_recipe', model: 'gpt-image-1' });
}

test('public image queue shares ComfyUI and GPT Image slots across two connections and modules', () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    addTask(f.db1, { id: 'comfy-first', appId: 'story-world', engineId: 'comfy-a', workflowId: 'wf-comfy-a', createdAt: '2026-11-11T00:00:01.000Z' });
    addTask(f.db1, { id: 'comfy-second', appId: 'free-generation', engineId: 'comfy-b', workflowId: 'wf-comfy-b', createdAt: '2026-11-11T00:00:02.000Z' });
    addTask(f.db1, { id: 'gpt-first', appId: 'free-generation', engineId: 'gpt-a', workflowId: 'wf-gpt-a', createdAt: '2026-11-11T00:00:03.000Z' });
    addTask(f.db1, { id: 'comfy-late', appId: 'story-world', engineId: 'comfy-b', workflowId: 'wf-comfy-b', createdAt: '2026-11-11T00:00:04.000Z' });
    addTask(f.db1, { id: 'gpt-late', appId: 'story-world', engineId: 'gpt-a', workflowId: 'wf-gpt-a', createdAt: '2026-11-11T00:00:05.000Z' });

    assert.equal(claimQueuedTaskForDispatch(f.db1, 'comfy-first').reason, 'claimed');
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'comfy-second').reason, 'group_full', 'a second ComfyUI connection must not get a second slot');
    assert.equal(claimQueuedTaskForDispatch(f.db1, 'gpt-first').reason, 'claimed');
    assert.equal(claimQueuedTaskForDispatch(f.db1, 'comfy-late').reason, 'queue_order');
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'gpt-late').reason, 'total_full');

    f.db1.connection.prepare("UPDATE generation_tasks SET status='succeeded', upstream_may_continue=0, finished_at=? WHERE id='comfy-first'").run(nowIso());
    assert.equal(claimQueuedTaskForDispatch(f.db1, 'comfy-late').reason, 'queue_order', 'the older queued ComfyUI task must be picked first');
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'comfy-second').reason, 'claimed');
    assert.equal(claimQueuedTaskForDispatch(f.db1, 'comfy-late').reason, 'total_full');
  } finally {
    f.close();
  }
});

test('uncertain upstream work keeps its slot until cancellation is confirmed', async () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    addTask(f.db1, {
      id: 'comfy-running', engineId: 'comfy-a', workflowId: 'wf-comfy-a',
      createdAt: '2026-11-11T00:01:00.000Z', status: 'accepted', providerTaskId: 'prompt-running',
    });
    f.db1.connection.prepare("UPDATE generation_tasks SET queue_slot_held=1 WHERE id='comfy-running'").run();
    addTask(f.db1, { id: 'comfy-waiting', engineId: 'comfy-b', workflowId: 'wf-comfy-b', createdAt: '2026-11-11T00:01:01.000Z' });
    markGenerationQueueSchedulerStarted(f.db1);
    assert.equal(generationQueueReconciled(f.db1), false);

    const runningFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/queue')) return Response.json({ queue_running: [[0, 'prompt-running']], queue_pending: [] });
      return Response.json({});
    };
    await cancelGenerationTask(testConfig(f.directory), f.db1, new MemorySecrets(), 'comfy-running', 'story-world', runningFetcher);

    const cancelled = f.db1.connection.prepare("SELECT status,upstream_may_continue,queue_slot_held FROM generation_tasks WHERE id='comfy-running'").get() as { status: string; upstream_may_continue: number; queue_slot_held: number };
    assert.equal(cancelled.status, 'abandoned');
    assert.equal(cancelled.upstream_may_continue, 1);
    assert.equal(cancelled.queue_slot_held, 1);
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'comfy-waiting').reason, 'group_full', 'a running upstream task must not free its slot on timeout/cancel');

    const pendingFetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/queue') && (!init?.method || init.method === 'GET')) return Response.json({ queue_running: [], queue_pending: [[0, 'prompt-pending']] });
      if (url.endsWith('/queue') && init?.method === 'POST') return Response.json({});
      return Response.json({});
    };
    addTask(f.db1, {
      id: 'comfy-pending', engineId: 'comfy-b', workflowId: 'wf-comfy-b',
      createdAt: '2026-11-11T00:02:00.000Z', status: 'accepted', providerTaskId: 'prompt-pending',
    });
    f.db1.connection.prepare("UPDATE generation_tasks SET queue_slot_held=1 WHERE id='comfy-pending'").run();
    await cancelGenerationTask(testConfig(f.directory), f.db1, new MemorySecrets(), 'comfy-pending', 'story-world', pendingFetcher);
    const confirmed = f.db1.connection.prepare("SELECT status,upstream_may_continue,queue_slot_held FROM generation_tasks WHERE id='comfy-pending'").get() as { status: string; upstream_may_continue: number; queue_slot_held: number };
    assert.equal(confirmed.status, 'cancelled');
    assert.equal(confirmed.upstream_may_continue, 0);
    assert.equal(confirmed.queue_slot_held, 0);
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'comfy-waiting').reason, 'group_full', 'the other uncertain task still holds the ComfyUI group');

    releaseGenerationQueueSlot(f.db1, 'comfy-running');
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'comfy-waiting').reason, 'claimed', 'confirmed release frees the slot');
  } finally {
    f.close();
  }
});

test('two connections racing the same ComfyUI group submit only once', async () => {
  const f = fixture();
  try {
    addEngine(f.db1, 'comfy-a', 'comfyui', 'http://comfy-a.invalid:8188');
    addEngine(f.db1, 'comfy-b', 'comfyui', 'http://comfy-b.invalid:8188');
    addWorkflow(f.db1, 'wf-comfy-a', 'comfyui', 'comfy-a', { '1': { class_type: 'SaveImage', inputs: {} } });
    addWorkflow(f.db1, 'wf-comfy-b', 'comfyui', 'comfy-b', { '1': { class_type: 'SaveImage', inputs: {} } });
    addTask(f.db1, { id: 'race-a', engineId: 'comfy-a', workflowId: 'wf-comfy-a', createdAt: '2026-11-11T00:05:00.000Z' });
    addTask(f.db1, { id: 'race-b', engineId: 'comfy-b', workflowId: 'wf-comfy-b', createdAt: '2026-11-11T00:05:01.000Z' });
    const config = testConfig(f.directory);
    let promptA = 0;
    let promptB = 0;
    const fetcherA: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/prompt')) { promptA++; return Response.json({ prompt_id: 'race-prompt-a' }); }
      if (url.includes('/history/race-prompt-a')) return Response.json({ 'race-prompt-a': { status: { status_str: 'success' }, outputs: { '1': { images: [{ filename: 'race.png', type: 'output' }] } } } });
      if (url.includes('/view')) return new Response(Buffer.from('race-png'), { status: 200, headers: { 'content-type': 'image/png' } });
      if (url.includes('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
      return new Response(null, { status: 404 });
    };
    const fetcherB: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/prompt')) promptB++;
      return new Response(null, { status: 404 });
    };

    await Promise.all([
      executeQueuedTask(config, f.db1, new MemorySecrets(), 'race-a', fetcherA),
      executeQueuedTask(config, f.db2, new MemorySecrets(), 'race-b', fetcherB),
    ]);

    const a = f.db1.connection.prepare("SELECT status FROM generation_tasks WHERE id='race-a'").get() as { status: string };
    const b = f.db1.connection.prepare("SELECT status FROM generation_tasks WHERE id='race-b'").get() as { status: string };
    assert.equal(a.status, 'succeeded');
    assert.equal(b.status, 'queued');
    assert.equal(promptA, 1);
    assert.equal(promptB, 0, 'the second connection must not reach ComfyUI while the shared group is occupied');
  } finally {
    f.close();
  }
});

test('restart reconciliation holds unknown submissions before queued dispatch', async () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    addTask(f.db1, { id: 'unknown-submit', engineId: 'comfy-a', workflowId: 'wf-comfy-a', createdAt: '2026-11-11T00:03:00.000Z', status: 'submitting' });
    addTask(f.db1, { id: 'queued-behind', engineId: 'comfy-b', workflowId: 'wf-comfy-b', createdAt: '2026-11-11T00:03:01.000Z' });
    markGenerationQueueSchedulerStarted(f.db1);

    const result = await reconcileGenerationTasks(testConfig(f.directory), f.db1, new MemorySecrets());
    assert.equal(result.recoveredCount, 2);
    await waitForExecutions([...generationExecutionsFor(f.db1)], 2000);

    const unknown = f.db1.connection.prepare("SELECT status,error_code,upstream_may_continue,queue_slot_held FROM generation_tasks WHERE id='unknown-submit'").get() as { status: string; error_code: string; upstream_may_continue: number; queue_slot_held: number };
    assert.equal(unknown.status, 'abandoned');
    assert.equal(unknown.error_code, 'submission_outcome_unknown');
    assert.equal(unknown.upstream_may_continue, 1);
    assert.equal(unknown.queue_slot_held, 1);
    const queued = f.db1.connection.prepare("SELECT status FROM generation_tasks WHERE id='queued-behind'").get() as { status: string };
    assert.equal(queued.status, 'queued', 'restart must not dispatch a new task past an uncertain slot holder');

    releaseGenerationQueueSlot(f.db1, 'unknown-submit');
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'queued-behind').reason, 'claimed');
  } finally {
    f.close();
  }
});

test('a database created at migration 54 upgrades to 55 and keeps open tasks recoverable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-queue-upgrade-'));
  const path = join(directory, 'service.db');
  let upgraded: ServiceDatabase | null = null;
  try {
    const legacy = new DatabaseSync(path);
    migrateDatabase(legacy, SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= 54), 'legacy');
    const now = nowIso();
    legacy.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('story-world','story-world','legacy-token','[\"generation\",\"image\"]',1,?,?)").run(now, now);
    legacy.prepare("INSERT INTO generation_engines(id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at) VALUES ('legacy-comfy','legacy','comfyui','http://legacy.invalid:8188',NULL,1,1,?,?)").run(now, now);
    legacy.prepare("INSERT INTO generation_workflows(id,name,description,engine_kind,category,latest_version,created_at,updated_at) VALUES ('legacy-wf','legacy','','comfyui','image',1,?,?)").run(now, now);
    legacy.prepare("INSERT INTO generation_tasks(id,app_id,engine_id,workflow_id,workflow_version,purpose,request_hash,request_params_json,workflow_snapshot_json,status,provider_task_id,upstream_may_continue,cancellation_scope,created_at,updated_at,priority,progress_json) VALUES ('legacy-open','story-world','legacy-comfy','legacy-wf',1,'default','h','{}','{}','submitting',NULL,0,'none',?,?,'normal','{}')").run(now, now);
    legacy.close();

    upgraded = new ServiceDatabase(path);
    const columns = upgraded.connection.prepare('PRAGMA table_info(generation_tasks)').all() as Array<{ name?: string }>;
    assert.ok(columns.some((column) => column.name === 'queue_slot_held'), 'migration 55 should add queue_slot_held');
    const before = upgraded.connection.prepare("SELECT status,queue_slot_held FROM generation_tasks WHERE id='legacy-open'").get() as { status: string; queue_slot_held: number };
    assert.equal(before.status, 'submitting');
    assert.equal(before.queue_slot_held, 1, 'migration backfills open tasks as holding a slot');

    const result = await reconcileGenerationTasks(testConfig(directory), upgraded, new MemorySecrets());
    assert.equal(result.recoveredCount, 1);
    const after = upgraded.connection.prepare("SELECT status,error_code,upstream_may_continue FROM generation_tasks WHERE id='legacy-open'").get() as { status: string; error_code: string; upstream_may_continue: number };
    assert.equal(after.status, 'abandoned');
    assert.equal(after.error_code, 'submission_outcome_unknown');
    assert.equal(after.upstream_may_continue, 1);
  } finally {
    upgraded?.close();
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* windows may hold WAL briefly */ }
  }
});

test('execution layer blocks two live engines and a third group while upstream fetches are pending', async () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    addEngine(f.db1, 'worker-img', 'worker', 'http://worker-img.invalid:9000');
    addWorkflow(f.db1, 'wf-worker-img', 'worker', 'worker-img');
    addTask(f.db1, { id: 'exec-comfy', engineId: 'comfy-a', workflowId: 'wf-comfy-a', createdAt: '2026-11-11T00:06:00.000Z' });
    addTask(f.db1, {
      id: 'exec-gpt-a', engineId: 'gpt-a', workflowId: 'wf-gpt-a', createdAt: '2026-11-11T00:06:01.000Z',
      requestParams: { inputs: { prompt: 'a', model: 'gpt-image-1' } },
      workflowSnapshot: { type: 'cloud_recipe', model: 'gpt-image-1' },
    });
    addTask(f.db1, {
      id: 'exec-gpt-b', engineId: 'gpt-a', workflowId: 'wf-gpt-a', createdAt: '2026-11-11T00:06:02.000Z',
      requestParams: { inputs: { prompt: 'b', model: 'gpt-image-1' } },
      workflowSnapshot: { type: 'cloud_recipe', model: 'gpt-image-1' },
    });
    addTask(f.db1, { id: 'exec-worker', engineId: 'worker-img', workflowId: 'wf-worker-img', createdAt: '2026-11-11T00:06:03.000Z' });
    markGenerationQueueSchedulerStarted(f.db1);
    assert.equal(generationQueueReconciled(f.db2), false, 'the gate must cover both connections to the same database file');
    const config = testConfig(f.directory);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    let releaseComfy!: (response: Response) => void;
    const comfyPrompt = new Promise<Response>((resolve) => { releaseComfy = resolve; });
    const comfyFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/prompt')) return comfyPrompt;
      if (url.includes('/history/exec-comfy-prompt')) return Response.json({ 'exec-comfy-prompt': { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'exec-comfy.png', type: 'output' }] } } } });
      if (url.includes('/view')) return new Response(Buffer.from('exec-comfy-png'), { status: 200, headers: { 'content-type': 'image/png' } });
      if (url.includes('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
      return new Response(null, { status: 404 });
    };

    let releaseCloud!: (response: Response) => void;
    const cloudResponse = new Promise<Response>((resolve) => { releaseCloud = resolve; });
    const cloudFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/images/generations')) return cloudResponse;
      return new Response(null, { status: 404 });
    };

    const statusOf = (id: string) => String((f.db1.connection.prepare('SELECT status FROM generation_tasks WHERE id=?').get(id) as { status: string }).status);
    const comfyRun = executeQueuedTask(config, f.db1, new MemorySecrets(), 'exec-comfy', comfyFetcher);
    const cloudRun = executeQueuedTask(config, f.db2, new MemorySecrets(), 'exec-gpt-a', cloudFetcher);
    await waitFor(() => statusOf('exec-comfy') === 'submitting' && statusOf('exec-gpt-a') === 'running');

    let cloudBCalls = 0;
    let workerCalls = 0;
    const cloudBFetcher: typeof fetch = async () => { cloudBCalls++; return Response.json({ data: [{ b64_json: png }] }); };
    const workerFetcher: typeof fetch = async () => { workerCalls++; return Response.json({}); };
    await executeQueuedTask(config, f.db1, new MemorySecrets(), 'exec-gpt-b', cloudBFetcher);
    await executeQueuedTask(config, f.db1, new MemorySecrets(), 'exec-worker', workerFetcher);
    assert.equal(cloudBCalls, 0, 'GPT Image group must not submit a second request');
    assert.equal(workerCalls, 0, 'the third image group must not submit while total image capacity is 2');
    assert.equal(statusOf('exec-gpt-b'), 'queued');
    assert.equal(statusOf('exec-worker'), 'queued');

    releaseComfy(Response.json({ prompt_id: 'exec-comfy-prompt' }));
    await comfyRun;
    releaseCloud(Response.json({ data: [{ b64_json: png }] }));
    await cloudRun;
    assert.equal(statusOf('exec-comfy'), 'succeeded');
    assert.equal(statusOf('exec-gpt-a'), 'succeeded');

    await executeQueuedTask(config, f.db1, new MemorySecrets(), 'exec-gpt-b', cloudBFetcher);
    assert.equal(cloudBCalls, 1);
    assert.equal(statusOf('exec-gpt-b'), 'succeeded');
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'exec-worker').reason, 'claimed', `worker status=${statusOf('exec-worker')}`);
  } finally {
    f.close();
  }
});

test('definite submission failure releases while timeout holds and recovery does not send a second prompt', async () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    markGenerationQueueSchedulerStarted(f.db1);
    const config = testConfig(f.directory);

    addTask(f.db1, { id: 'fail-a', engineId: 'comfy-a', workflowId: 'wf-comfy-a', createdAt: '2026-11-11T00:07:00.000Z' });
    const refusedFetcher: typeof fetch = async () => {
      const error = new Error('connect ECONNREFUSED') as Error & { cause?: { code: string } };
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    };
    await executeQueuedTask(config, f.db1, new MemorySecrets(), 'fail-a', refusedFetcher);
    const failed = f.db1.connection.prepare("SELECT status,upstream_may_continue,queue_slot_held FROM generation_tasks WHERE id='fail-a'").get() as { status: string; upstream_may_continue: number; queue_slot_held: number };
    assert.equal(failed.status, 'failed');
    assert.equal(failed.upstream_may_continue, 0);

    addTask(f.db1, { id: 'fail-b', engineId: 'comfy-a', workflowId: 'wf-comfy-a', createdAt: '2026-11-11T00:07:01.000Z' });
    const successFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'fail-b-prompt' });
      if (url.includes('/history/fail-b-prompt')) return Response.json({ 'fail-b-prompt': { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'fail-b.png', type: 'output' }] } } } });
      if (url.includes('/view')) return new Response(Buffer.from('fail-b-png'), { status: 200, headers: { 'content-type': 'image/png' } });
      if (url.includes('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
      return new Response(null, { status: 404 });
    };
    await executeQueuedTask(config, f.db2, new MemorySecrets(), 'fail-b', successFetcher);
    assert.equal(String((f.db1.connection.prepare("SELECT status FROM generation_tasks WHERE id='fail-b'").get() as { status: string }).status), 'succeeded');

    addTask(f.db1, { id: 'timeout-a', engineId: 'comfy-a', workflowId: 'wf-comfy-a', createdAt: '2026-11-11T00:07:02.000Z' });
    const timeoutFetcher: typeof fetch = async () => {
      const error = new Error('request timed out');
      error.name = 'AbortError';
      throw error;
    };
    await executeQueuedTask(config, f.db1, new MemorySecrets(), 'timeout-a', timeoutFetcher);
    const uncertain = f.db1.connection.prepare("SELECT status,upstream_may_continue,queue_slot_held,error_code FROM generation_tasks WHERE id='timeout-a'").get() as { status: string; upstream_may_continue: number; queue_slot_held: number; error_code: string };
    assert.equal(uncertain.status, 'abandoned');
    assert.equal(uncertain.error_code, 'submission_outcome_unknown');
    assert.equal(uncertain.upstream_may_continue, 1);
    assert.equal(uncertain.queue_slot_held, 1);
    assert.deepEqual(listUncertainGenerationTasks(f.db1, 'story-world').map((task) => task.id), ['timeout-a']);

    addTask(f.db1, { id: 'timeout-b', engineId: 'comfy-b', workflowId: 'wf-comfy-b', createdAt: '2026-11-11T00:07:03.000Z' });
    let recoveryPrompts = 0;
    const recoveryFetcher: typeof fetch = async (input) => {
      if (String(input).endsWith('/prompt')) recoveryPrompts++;
      return Response.json({ prompt_id: 'unexpected' });
    };
    const recovered = await reconcileGenerationTasks(config, f.db1, new MemorySecrets(), recoveryFetcher);
    assert.equal(recovered.recoveredCount, 1);
    await waitFor(() => generationExecutionsFor(f.db1).size === 0);
    assert.equal(recoveryPrompts, 0, 'restart reconciliation must not submit behind an uncertain slot');
    assert.equal(String((f.db1.connection.prepare("SELECT status FROM generation_tasks WHERE id='timeout-b'").get() as { status: string }).status), 'queued');

    const confirmed = confirmGenerationTaskUncertainOutcome(f.db1, 'timeout-a', 'story-world', 'cancelled', '已核对上游队列，任务不存在');
    assert.equal(confirmed.status, 'cancelled');
    const afterConfirm = f.db1.connection.prepare("SELECT upstream_may_continue,queue_slot_held FROM generation_tasks WHERE id='timeout-a'").get() as { upstream_may_continue: number; queue_slot_held: number };
    assert.equal(afterConfirm.upstream_may_continue, 0);
    assert.equal(afterConfirm.queue_slot_held, 0);
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'timeout-b').reason, 'claimed');
  } finally {
    f.close();
  }
});

test('cloud definite rejection releases and HTTP 5xx keeps the GPT Image slot until manual confirmation', async () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    markGenerationQueueSchedulerStarted(f.db1);
    const config = testConfig(f.directory);
    addTask(f.db1, {
      id: 'cloud-400', engineId: 'gpt-a', workflowId: 'wf-gpt-a', createdAt: '2026-11-11T00:08:00.000Z',
      requestParams: { inputs: { prompt: 'x', model: 'gpt-image-1' } },
      workflowSnapshot: { type: 'cloud_recipe', model: 'gpt-image-1' },
    });
    const badRequestFetcher: typeof fetch = async () => new Response('bad request', { status: 400 });
    await executeQueuedTask(config, f.db1, new MemorySecrets(), 'cloud-400', badRequestFetcher);
    const rejected = f.db1.connection.prepare("SELECT status,upstream_may_continue,error_code FROM generation_tasks WHERE id='cloud-400'").get() as { status: string; upstream_may_continue: number; error_code: string };
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.upstream_may_continue, 0);

    addTask(f.db1, {
      id: 'cloud-500', engineId: 'gpt-a', workflowId: 'wf-gpt-a', createdAt: '2026-11-11T00:08:01.000Z',
      requestParams: { inputs: { prompt: 'x', model: 'gpt-image-1' } },
      workflowSnapshot: { type: 'cloud_recipe', model: 'gpt-image-1' },
    });
    const serverErrorFetcher: typeof fetch = async () => new Response('server error', { status: 500 });
    await executeQueuedTask(config, f.db1, new MemorySecrets(), 'cloud-500', serverErrorFetcher);
    const uncertain = f.db1.connection.prepare("SELECT status,upstream_may_continue,error_code,queue_slot_held FROM generation_tasks WHERE id='cloud-500'").get() as { status: string; upstream_may_continue: number; error_code: string; queue_slot_held: number };
    assert.equal(uncertain.status, 'abandoned');
    assert.equal(uncertain.error_code, 'cloud_submission_uncertain');
    assert.equal(uncertain.upstream_may_continue, 1);
    assert.equal(uncertain.queue_slot_held, 1);
    assert.deepEqual(listUncertainGenerationTasks(f.db1, 'story-world').map((task) => task.id), ['cloud-500']);

    addTask(f.db1, {
      id: 'cloud-next', engineId: 'gpt-a', workflowId: 'wf-gpt-a', createdAt: '2026-11-11T00:08:02.000Z',
      requestParams: { inputs: { prompt: 'x', model: 'gpt-image-1' } },
      workflowSnapshot: { type: 'cloud_recipe', model: 'gpt-image-1' },
    });
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'cloud-next').reason, 'group_full');
    const confirmed = confirmGenerationTaskUncertainOutcome(f.db1, 'cloud-500', 'story-world', 'failed', '已核对上游无进行中请求');
    assert.equal(confirmed.status, 'failed');
    assert.equal(claimQueuedTaskForDispatch(f.db2, 'cloud-next').reason, 'claimed');
  } finally {
    f.close();
  }
});

test('cancelling an active cloud request keeps its slot until the outcome is confirmed', async () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    markGenerationQueueSchedulerStarted(f.db1);
    addTask(f.db1,{id:'cloud-cancel',engineId:'gpt-a',workflowId:'wf-gpt-a',createdAt:'2026-11-11T00:08:30.000Z',requestParams:{inputs:{prompt:'x',model:'gpt-image-2'}},workflowSnapshot:{type:'cloud_recipe',model:'gpt-image-2'}});
    const fetcher:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});});
    const execution=executeQueuedTask(testConfig(f.directory),f.db1,new MemorySecrets(),'cloud-cancel',fetcher);
    while(f.db1.connection.prepare('SELECT status FROM generation_tasks WHERE id=?').get('cloud-cancel')?.status!=='running') await new Promise(r=>setTimeout(r,5));
    const cancelled=await cancelGenerationTask(testConfig(f.directory),f.db1,new MemorySecrets(),'cloud-cancel','story-world',fetcher);
    await execution;
    assert.equal(cancelled.upstreamMayContinue,true);
    addTask(f.db1,{id:'cloud-after-cancel',engineId:'gpt-a',workflowId:'wf-gpt-a',createdAt:'2026-11-11T00:08:31.000Z'});
    assert.equal(claimQueuedTaskForDispatch(f.db2,'cloud-after-cancel').reason,'group_full');
    confirmGenerationTaskUncertainOutcome(f.db1,'cloud-cancel','story-world','cancelled','Provider confirmed the request was cancelled.');
    assert.equal(claimQueuedTaskForDispatch(f.db2,'cloud-after-cancel').reason,'claimed');
  } finally { f.close(); }
});

test('cloud execution honors recipe defaults, explicit inputs, and the configured bounded timeout', async (t) => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    markGenerationQueueSchedulerStarted(f.db1);
    const now = nowIso();
    f.db1.connection.prepare('INSERT INTO service_connections(id,name,kind,base_url,timeout_ms,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('gpt-a', 'image connection', 'openai-compatible-image', 'https://image.invalid/v1', 600000, now, now);
    const timeouts: number[] = [];
    const original = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', (value: number) => { timeouts.push(value); return original(value); });
    const requests: Record<string, unknown>[] = [];
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const fetcher: typeof fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ data: [{ b64_json: png }] }); };
    for (const [index, inputs] of [{prompt:'scene'}, {prompt:'scene',quality:'low',size:'1536x1024',format:'webp'}].entries()) {
      const taskId = 'cloud-defaults-' + index;
      addTask(f.db1, { id:taskId, engineId:'gpt-a', workflowId:'wf-gpt-a', createdAt:'2026-11-11T00:09:0'+index+'.000Z',
        requestParams:{inputs}, workflowSnapshot:{type:'cloud_recipe',modelId:'gpt-image-2',size:'1024x1024',quality:'medium',format:'png'} });
      await executeQueuedTask(testConfig(f.directory),f.db1,new MemorySecrets(),taskId,fetcher);
      assert.equal(f.db1.connection.prepare('SELECT status FROM generation_tasks WHERE id=?').get(taskId)?.status,'succeeded');
      assert.equal(f.db1.connection.prepare('SELECT queue_slot_held FROM generation_tasks WHERE id=?').get(taskId)?.queue_slot_held,0);
    }
    assert.deepEqual(requests.map(r=>[r.model,r.size,r.quality,r.output_format,r.n]),[
      ['gpt-image-2','1024x1024','medium','png',1],['gpt-image-2','1536x1024','low','webp',1],
    ]);
    assert.ok(timeouts.includes(600000));
  } finally { f.close(); }
});

test('single image tasks reject request and workflow batch switches and multi-image responses', async () => {
  const f = fixture();
  try {
    seedImageQueues(f.db1);
    const config = testConfig(f.directory);
    const secrets = new MemorySecrets();
    f.db1.connection.prepare("INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES ('free-generation','default','wf-gpt-a',1,'gpt-a',?)").run(nowIso());

    await assert.rejects(
      createGenerationTask(config, f.db1, secrets, { appId: 'free-generation', inputs: { prompt: 'two images', n: 2 } }, async () => Response.json({ data: [] })),
      (error: Error & { code?: string }) => error.code === 'generation_batch_not_allowed',
    );

    addEngine(f.db1, 'comfy-batch', 'comfyui', 'http://comfy-batch.invalid:8188');
    addWorkflow(f.db1, 'wf-comfy-batch', 'comfyui', 'comfy-batch', {
      '1': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 2 } },
      '2': { class_type: 'SaveImage', inputs: {} },
    });
    f.db1.connection.prepare("INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES ('story-world','batch','wf-comfy-batch',1,'comfy-batch',?)").run(nowIso());
    await assert.rejects(
      createGenerationTask(config, f.db1, secrets, { appId: 'story-world', purpose: 'batch', inputs: {} }, async () => Response.json({})),
      (error: Error & { code?: string }) => error.code === 'generation_batch_not_allowed',
    );

    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const twoImageFetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/images/generations')) return Response.json({ data: [{ b64_json: png }, { b64_json: png }] });
      return new Response(null, { status: 404 });
    };
    const created = await createGenerationTask(config, f.db1, secrets, { appId: 'free-generation', purpose: 'default', inputs: { prompt: 'one task', model: 'gpt-image-1' } }, twoImageFetcher);
    const deadline = Date.now() + 3000;
    let status = '';
    while (Date.now() < deadline) {
      status = String((f.db1.connection.prepare('SELECT status FROM generation_tasks WHERE id=?').get(created.id) as { status: string }).status);
      if (['succeeded', 'failed', 'cancelled', 'abandoned'].includes(status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const failed = f.db1.connection.prepare("SELECT status,error_code FROM generation_tasks WHERE id=?").get(created.id) as { status: string; error_code: string };
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'generation_batch_not_allowed');
    const artifacts = f.db1.connection.prepare('SELECT COUNT(*) AS count FROM generation_task_artifacts WHERE task_id=?').get(created.id) as { count: number };
    assert.equal(Number(artifacts.count), 0, 'a multi-image upstream response must not persist partial batch artifacts');
  } finally {
    f.close();
  }
});
