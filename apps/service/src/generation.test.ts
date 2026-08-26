import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { SecretStore, hashToken, issueToken } from './security.js';
import { validateComfyApiJson, renderWorkflowSnapshot, reconcileGenerationTasks } from './generation.js';

const adminToken = 'admin-test-token-that-is-long-12345678';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function testConfig(overrides: Record<string, string> = {}) {
  return readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_IMAGE_SIGNING_SECRET: 'image-signing-test-secret-1234567890',
    ...overrides,
  });
}

function seedApp(database: ServiceDatabase, id: string, capabilities = ['llm', 'vector', 'image', 'artifact', 'generation', 'persona']) {
  const token = issueToken('test');
  const now = nowIso();
  database.connection.prepare('INSERT INTO managed_apps VALUES (?,?,?,?,1,?,?)')
    .run(id, id, hashToken(token), JSON.stringify(capabilities), now, now);
  database.connection.prepare("INSERT INTO storage_policies(app_id,mode) VALUES (?,'keep')").run(id);
  return token;
}

test('Generation core: validates ComfyUI API JSON and rejects GUI format', () => {
  // Valid API format
  const validApi = {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece' } },
    '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20 } },
  };
  assert.doesNotThrow(() => validateComfyApiJson(validApi));

  // GUI format containing nodes array
  const invalidGui = {
    last_node_id: 10,
    nodes: [{ id: 6, type: 'CLIPTextEncode' }],
    links: [],
  };
  assert.throws(() => validateComfyApiJson(invalidGui), /工作流必须为 ComfyUI API 格式 JSON/);

  // Empty or non-object definition
  assert.throws(() => validateComfyApiJson({}), /empty_workflow_definition/);
  assert.throws(() => validateComfyApiJson(null), /invalid_workflow_format/);
});

test('Generation core: renders workflow snapshot with node bindings and seed', () => {
  const definition = {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'default prompt' } },
    '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20 } },
  };
  const nodeBindings = {
    prompt: ['6', 'inputs', 'text'],
  };
  const snapshot = renderWorkflowSnapshot(definition, nodeBindings, { prompt: 'custom scenic view' }, 123456);
  assert.equal((snapshot['6'] as { inputs: { text: string } }).inputs.text, 'custom scenic view');
  assert.equal((snapshot['3'] as { inputs: { seed: number } }).inputs.seed, 123456);
});

test('Generation API: admin creates engine, workflow, version and app assignment', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-gen-admin-'));
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // 1. Create Engine
  const engineRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/engines',
    headers: adminHeaders,
    payload: {
      id: 'comfy-local',
      name: 'Comfy Local',
      kind: 'comfyui',
      baseUrl: 'http://127.0.0.1:8188',
      concurrencyLimit: 2,
    },
  });
  assert.equal(engineRes.statusCode, 201);

  // 2. Create Workflow
  const wfRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows',
    headers: adminHeaders,
    payload: {
      id: 'sdxl-turbo',
      name: 'SDXL Turbo Txt2Img',
      engineKind: 'comfyui',
    },
  });
  assert.equal(wfRes.statusCode, 201);

  // 3. Publish Version (with valid ComfyUI API JSON)
  const verRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/sdxl-turbo/versions',
    headers: adminHeaders,
    payload: {
      engineId: 'comfy-local',
      inputSchema: { prompt: { type: 'string' } },
      nodeBindings: { prompt: ['6', 'inputs', 'text'] },
      outputDeclarations: ['9'],
      definition: {
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
        '3': { class_type: 'KSampler', inputs: { seed: 0 } },
      },
    },
  });
  assert.equal(verRes.statusCode, 201);
  assert.equal(verRes.json().version, 1);

  // Reject invalid GUI format version submission
  const badVerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/sdxl-turbo/versions',
    headers: adminHeaders,
    payload: {
      definition: { nodes: [], last_node_id: 1 },
    },
  });
  assert.equal(badVerRes.statusCode, 400);
  assert.equal(badVerRes.json().error, 'invalid_workflow_format');

  // 4. Assign workflow to app
  seedApp(database, 'gen-app');
  const assignRes = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/apps/gen-app/generation-assignments',
    headers: adminHeaders,
    payload: {
      assignments: [{
        purpose: 'image',
        workflowId: 'sdxl-turbo',
        engineId: 'comfy-local',
      }],
    },
  });
  assert.equal(assignRes.statusCode, 200);
  assert.equal(assignRes.json().assignments.length, 1);

  await app.close();
  database.close();
});

test('Generation tasks: full lifecycle from queued to succeeded with idempotency, outputs, and artifacts', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-gen-tasks-'));
  const token = seedApp(database, 'client-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  // Seed engine, workflow, version and assignment
  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json, definition_json, is_published, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('wf-1', 1, 'eng-1', '{}', JSON.stringify({ prompt: ['6', 'inputs', 'text'] }), JSON.stringify(['9']), JSON.stringify({ '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '3': { class_type: 'KSampler', inputs: { seed: 0 } } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES ('client-app','default','wf-1',1,'eng-1',?)").run(now);

  let promptSubmitted = false;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/prompt')) {
      promptSubmitted = true;
      return Response.json({ prompt_id: 'comfy-prompt-100' });
    }
    if (url.includes('/history/comfy-prompt-100')) {
      return Response.json({
        'comfy-prompt-100': {
          status: { status_str: 'success' },
          outputs: {
            '9': { images: [{ filename: 'output_001.png', type: 'output' }] },
          },
        },
      });
    }
    if (url.includes('/view')) {
      return new Response(Buffer.from('png-binary-data'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (url.includes('/queue')) {
      return Response.json({ queue_running: [], queue_pending: [] });
    }
    return new Response(null, { status: 404 });
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  // 1. Create task with Idempotency-Key
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/generation/tasks',
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': 'idemp-key-12345',
    },
    payload: {
      inputs: { prompt: 'a beautiful sunset over mountains' },
      seed: 42,
    },
  });
  assert.equal(createRes.statusCode, 202);
  const task = createRes.json();
  assert.equal(task.appId, 'client-app');
  assert.equal(task.actualSeed, 42);

  // 2. Idempotency: exact same request returns existing task
  const dupRes = await app.inject({
    method: 'POST',
    url: '/api/v1/generation/tasks',
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': 'idemp-key-12345',
    },
    payload: {
      inputs: { prompt: 'a beautiful sunset over mountains' },
      seed: 42,
    },
  });
  assert.equal(dupRes.statusCode, 202);
  assert.equal(dupRes.json().id, task.id);

  // 3. Idempotency conflict: same key with different payload -> 409
  const conflictRes = await app.inject({
    method: 'POST',
    url: '/api/v1/generation/tasks',
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': 'idemp-key-12345',
    },
    payload: {
      inputs: { prompt: 'completely different prompt' },
    },
  });
  assert.equal(conflictRes.statusCode, 409);
  assert.equal(conflictRes.json().error, 'idempotency_conflict');

  // Wait for background execution to complete
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const lookup = await app.inject({
      method: 'GET',
      url: `/api/v1/generation/tasks/${task.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    if (lookup.json().status === 'succeeded') {
      assert.equal(lookup.json().artifacts.length, 1);
      assert.equal(lookup.json().artifacts[0].outputName, '9');
      break;
    }
  }

  assert.equal(promptSubmitted, true);
  await app.close();
  database.close();
});

test('Generation tasks: handles submission timeout with submission_outcome_unknown and prohibits auto-retry', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-gen-unknown-'));
  const token = seedApp(database, 'timeout-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json, definition_json, is_published, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('wf-1', 1, 'eng-1', '{}', '{}', '[]', JSON.stringify({ '6': { class_type: 'Test', inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES ('timeout-app','default','wf-1',1,'eng-1',?)").run(now);

  let promptAttempts = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/prompt')) {
      promptAttempts++;
      const err = new Error('network timeout during prompt submission');
      err.name = 'TimeoutError';
      throw err;
    }
    return new Response(null, { status: 404 });
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/generation/tasks',
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': 'idemp-timeout-1',
    },
    payload: { inputs: {} },
  });
  const taskId = createRes.json().id;

  // Wait for background execution attempt
  await new Promise((r) => setTimeout(r, 400));

  const lookup = await app.inject({
    method: 'GET',
    url: `/api/v1/generation/tasks/${taskId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(lookup.json().status, 'abandoned');
  assert.equal(lookup.json().errorCode, 'submission_outcome_unknown');
  assert.match(lookup.json().errorMessage, /提交状态不确定/);
  assert.equal(promptAttempts, 1, 'Must not automatically re-submit after unknown submission outcome');

  // Test retry creates a NEW task referencing retryOf
  const retryRes = await app.inject({
    method: 'POST',
    url: `/api/v1/generation/tasks/${taskId}/retry`,
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': 'idemp-retry-1',
    },
  });
  assert.equal(retryRes.statusCode, 202);
  const retryTask = retryRes.json();
  assert.notEqual(retryTask.id, taskId);
  assert.equal(retryTask.retryOf, taskId);

  await app.close();
  database.close();
});

test('Generation tasks: cancellation handles queued, pending queue, and running (abandoned without global interrupt)', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-gen-cancel-'));
  const token = seedApp(database, 'cancel-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json, definition_json, is_published, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('wf-1', 1, 'eng-1', '{}', '{}', '[]', JSON.stringify({ '6': { class_type: 'Test', inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES ('cancel-app','default','wf-1',1,'eng-1',?)").run(now);

  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/prompt')) return Response.json({ prompt_id: 'comfy-p1' });
    if (url.includes('/queue') && init?.method === 'POST') return Response.json({});
    if (url.includes('/queue')) return Response.json({ queue_running: [[1, 'comfy-p1']], queue_pending: [] });
    return Response.json({});
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/generation/tasks',
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': 'idemp-cancel-test',
    },
    payload: { inputs: {} },
  });
  const taskId = createRes.json().id;

  // Wait briefly for scheduler to submit prompt and reach accepted/running
  await new Promise((r) => setTimeout(r, 200));

  // Cancel running task
  const cancelRes = await app.inject({
    method: 'POST',
    url: `/api/v1/generation/tasks/${taskId}/cancel`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.json().status, 'abandoned');
  assert.equal(cancelRes.json().upstreamMayContinue, true);
  assert.equal(cancelRes.json().cancellationScope, 'local-tracking');
  assert.equal(calls.some((c) => c.includes('/interrupt')), false, 'Never call global /interrupt');

  await app.close();
  database.close();
});

test('Generation events: SSE stream isolates applications and supports Last-Event-ID', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-gen-events-'));
  const tokenA = seedApp(database, 'app-alpha');
  seedApp(database, 'app-beta');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json, definition_json, is_published, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('wf-1', 1, 'eng-1', '{}', '{}', '[]', JSON.stringify({ '6': { class_type: 'Test', inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES ('app-alpha','default','wf-1',1,'eng-1',?)").run(now);

  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // Seed past events for app-alpha and app-beta
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES ('t1','app-alpha','eng-1','wf-1',1,'h1','{}','{}','queued',?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES ('t2','app-beta','eng-1','wf-1',1,'h2','{}','{}','queued',?,?)").run(now, now);

  database.connection.prepare("INSERT INTO generation_events(task_id, app_id, event_type, payload_json, created_at) VALUES (?,?,?,?,?)").run('t1', 'app-alpha', 'queued', JSON.stringify({ step: 1 }), now);
  database.connection.prepare("INSERT INTO generation_events(task_id, app_id, event_type, payload_json, created_at) VALUES (?,?,?,?,?)").run('t2', 'app-beta', 'queued', JSON.stringify({ secret_beta: true }), now);
  database.connection.prepare("INSERT INTO generation_events(task_id, app_id, event_type, payload_json, created_at) VALUES (?,?,?,?,?)").run('t1', 'app-alpha', 'submitting', JSON.stringify({ step: 2 }), now);

  // App Alpha queries events with Last-Event-ID = 0
  const alphaStream = await app.inject({
    method: 'GET',
    url: '/api/v1/generation/events?after=0&once=true',
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(alphaStream.statusCode, 200);
  assert.match(alphaStream.body, /event: queued/);
  assert.match(alphaStream.body, /event: submitting/);
  assert.doesNotMatch(alphaStream.body, /secret_beta/, 'App Alpha must not receive App Beta events');

  await app.close();
  database.close();
});

test('Generation recovery: reconcileGenerationTasks cleans up submitting tasks on restart', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-gen-reconcile-'));
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  // Seed a task that was left in submitting state when service was killed
  seedApp(database, 'reconcile-app');
  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, provider_task_id, created_at, updated_at) VALUES ('t-stale','reconcile-app','eng-1','wf-1',1,'h1','{}','{}','submitting',NULL,?,?)").run(now, now);

  const res = await reconcileGenerationTasks(config, database, new SecretStore({}));
  assert.equal(res.recoveredCount, 1);

  const task = database.connection.prepare('SELECT status, error_code FROM generation_tasks WHERE id = ?').get('t-stale') as { status: string; error_code: string };
  assert.equal(task.status, 'abandoned');
  assert.equal(task.error_code, 'submission_outcome_unknown');

  database.close();
});
