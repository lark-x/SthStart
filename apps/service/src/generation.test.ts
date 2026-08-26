import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { SecretStore, hashToken, issueToken } from './security.js';
import { validateComfyApiJson, renderWorkflowSnapshot, reconcileGenerationTasks, activeGenerationExecutions } from './generation.js';

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
        '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['3', 0] } },
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
  assert.equal(badVerRes.json().error, 'invalid_workflow_format_gui_rejected');

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

test("Generation deduplication: duplicate output persistArtifact calls reuse existing artifact and task_id", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-dedup-"));
  const token = seedApp(database, "dedup-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-1", "Engine", "comfyui", "http://comfy.test:8188", null, 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-1", "WF", "", "comfyui", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("dedup-app", "default", "wf-1", 1, "eng-1", now);

  let viewFetchCount = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/prompt")) return Response.json({ prompt_id: "prompt-dedup-1" });
    if (url.includes("/history/prompt-dedup-1")) {
      return Response.json({
        "prompt-dedup-1": {
          status: { status_str: "success" },
          outputs: { "9": { images: [{ filename: "dedup.png", type: "output" }] } },
        },
      });
    }
    if (url.includes("/view")) {
      viewFetchCount++;
      return new Response(Buffer.from("binary-png-data"), { status: 200, headers: { "content-type": "image/png" } });
    }
    if (url.includes("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
    return new Response(null, { status: 404 });
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "dedup-key-1" },
    payload: {},
  });
  const taskId = createRes.json().id;
  await Promise.allSettled(Array.from(activeGenerationExecutions));

  const lookup1 = await app.inject({
    method: "GET",
    url: `/api/v1/generation/tasks/${taskId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(lookup1.json().status, "succeeded");
  assert.equal(lookup1.json().artifacts.length, 1);
  const artId = lookup1.json().artifacts[0].artifactId;
  assert.equal(viewFetchCount, 1);

  // Check that artifacts table has task_id recorded
  const artRow = database.connection.prepare("SELECT * FROM artifacts WHERE id = ?").get(artId) as { task_id: string };
  assert.equal(artRow.task_id, taskId);

  await app.close();
  database.close();
});

test("Generation security: error messages and event payloads sanitize sensitive credentials and local paths", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-sec-"));
  const token = seedApp(database, "sec-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-1", "Engine", "comfyui", "http://comfy.test:8188", null, 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-1", "WF", "", "comfyui", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("sec-app", "default", "wf-1", 1, "eng-1", now);

  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/prompt")) {
      return new Response(JSON.stringify({ error: "Failed token Bearer sk-secret-123456789012 at /Users/dev/project/file.ts" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, { status: 404 });
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "sec-key-1" },
    payload: {},
  });
  const taskId = createRes.json().id;
  await Promise.allSettled(Array.from(activeGenerationExecutions));

  const lookup = await app.inject({
    method: "GET",
    url: `/api/v1/generation/tasks/${taskId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(lookup.json().status, "failed");
  assert.equal(lookup.json().errorCode, "upstream_rejected");
  assert.doesNotMatch(lookup.json().errorMessage, /sk-secret/);
  assert.doesNotMatch(lookup.json().errorMessage, /\/Users\/dev/);

  // Check event payload in database is also sanitized
  const events = database.connection.prepare("SELECT * FROM generation_events WHERE task_id = ? AND event_type = ?").all(taskId, "failed") as Array<{ payload_json: string }>;
  assert.equal(events.length, 1);
  assert.doesNotMatch(events[0].payload_json, /sk-secret/);
  assert.doesNotMatch(events[0].payload_json, /\/Users\/dev/);

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

test('Generation recovery: reconcileGenerationTasks recovers accepted and running tasks via history/queue with 0 prompt calls, and reschedules queued tasks', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-gen-reconcile-full-'));
  seedApp(database, 'rec-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json, definition_json, is_published, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES ('rec-app','default','wf-1',1,'eng-1',?)").run(now);

  // Seed 3 open tasks:
  // 1. accepted with provider_task_id -> should poll history and succeed (0 prompt calls)
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, provider_task_id, created_at, updated_at) VALUES ('t-acc','rec-app','eng-1','wf-1',1,'h1','{}','{}','accepted','prompt-acc-1',?,?)").run(now, now);
  // 2. running with provider_task_id -> should poll history and fail on execution_error (0 prompt calls)
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, provider_task_id, created_at, updated_at) VALUES ('t-run','rec-app','eng-1','wf-1',1,'h2','{}','{}','running','prompt-run-1',?,?)").run(now, now);
  // 3. queued -> should be rescheduled and call prompt
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES ('t-que','rec-app','eng-1','wf-1',1,'h3','{}','{}','queued',?,?)").run(now, now);

  let promptCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/prompt")) {
      promptCalls++;
      return Response.json({ prompt_id: "prompt-que-1" });
    }
    if (url.includes("/history/prompt-acc-1")) {
      return Response.json({
        "prompt-acc-1": {
          status: { status_str: "success" },
          outputs: { "9": { images: [{ filename: "acc.png", type: "output" }] } },
        },
      });
    }
    if (url.includes("/history/prompt-run-1")) {
      return Response.json({
        "prompt-run-1": {
          status: {
            status_str: "error",
            messages: [["execution_error", { exception_message: "CUDA out of memory in /Users/dev/internal.py" }]],
          },
        },
      });
    }
    if (url.includes("/history/prompt-que-1")) {
      return Response.json({
        "prompt-que-1": {
          status: { status_str: "success" },
          outputs: { "9": { images: [{ filename: "que.png", type: "output" }] } },
        },
      });
    }
    if (url.includes("/view")) {
      return new Response(Buffer.from("binary-png"), { status: 200, headers: { "content-type": "image/png" } });
    }
    if (url.includes("/queue")) {
      return Response.json({ queue_running: [], queue_pending: [] });
    }
    return new Response(null, { status: 404 });
  };

  const res = await reconcileGenerationTasks(config, database, new SecretStore({}), fetcher);
  assert.equal(res.recoveredCount, 3);

  // Wait for all async tasks to finish
  await Promise.allSettled(Array.from(activeGenerationExecutions));

  const accTaskFinal = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get("t-acc") as { status: string };
  const runTaskFinal = database.connection.prepare("SELECT status, error_code, error_message FROM generation_tasks WHERE id = ?").get("t-run") as { status: string; error_code: string; error_message: string };
  const queTaskFinal = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get("t-que") as { status: string };

  assert.equal(accTaskFinal.status, "succeeded");
  assert.equal(runTaskFinal.status, "failed");
  assert.equal(runTaskFinal.error_code, "execution_error");
  assert.doesNotMatch(runTaskFinal.error_message, /\/Users\/dev/);
  assert.equal(queTaskFinal.status, "succeeded");

  // Verify prompt was only called for the queued task (1 call total, 0 for accepted/running)
  assert.equal(promptCalls, 1, "Only queued tasks should call /prompt on restart recovery");

  // Verify artifacts have taskId set
  const accArtifacts = database.connection.prepare("SELECT task_id, original_name FROM artifacts WHERE task_id = ?").all("t-acc") as Array<{ task_id: string }>;
  assert.equal(accArtifacts.length, 1);
  assert.equal(accArtifacts[0].task_id, "t-acc");

  database.close();
});

test("Generation managed workflow: client cannot supply workflowId/workflowVersion, unassigned purpose rejected without fallback", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-managed-"));
  const token = seedApp(database, "managed-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json, definition_json, is_published, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES ('managed-app','default','wf-1',1,'eng-1',?)").run(now);

  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // 1. Client supplies workflowId -> 400 workflow_assignment_managed
  const wfRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "key-managed-1" },
    payload: { workflowId: "wf-1" },
  });
  assert.equal(wfRes.statusCode, 400);
  assert.equal(wfRes.json().error, "workflow_assignment_managed");

  // 2. Client supplies workflowVersion -> 400 workflow_assignment_managed
  const verRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "key-managed-2" },
    payload: { workflowVersion: 1 },
  });
  assert.equal(verRes.statusCode, 400);
  assert.equal(verRes.json().error, "workflow_assignment_managed");

  // 3. Client supplies unassigned purpose -> 404 generation_assignment_not_found (NO fallback to default)
  const unassignedRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "key-managed-3" },
    payload: { purpose: "unassigned-art" },
  });
  assert.equal(unassignedRes.statusCode, 404);
  assert.equal(unassignedRes.json().error, "generation_assignment_not_found");

  await app.close();
  database.close();
});

test("Generation admin validations: engine URL and concurrency, workflow version structure and kind matching, atomic assignment validation", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-admin-val-"));
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // 1. Engine with invalid URL protocol
  const badUrlRes = await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/engines",
    headers: adminHeaders,
    payload: { id: "eng-bad-proto", name: "Bad", kind: "comfyui", baseUrl: "ftp://127.0.0.1:8188", concurrencyLimit: 1 },
  });
  assert.equal(badUrlRes.statusCode, 400);
  assert.equal(badUrlRes.json().error, "invalid_url");

  // 2. Engine with invalid concurrency limit
  const badConcRes = await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/engines",
    headers: adminHeaders,
    payload: { id: "eng-bad-conc", name: "Bad", kind: "comfyui", baseUrl: "http://127.0.0.1:8188", concurrencyLimit: 0 },
  });
  assert.equal(badConcRes.statusCode, 400);
  assert.equal(badConcRes.json().error, "invalid_concurrency_limit");

  // Create valid engine
  await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/engines",
    headers: adminHeaders,
    payload: { id: "comfy-ok", name: "Comfy OK", kind: "comfyui", baseUrl: "http://127.0.0.1:8188", concurrencyLimit: 2 },
  });
  // Create worker engine
  await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/engines",
    headers: adminHeaders,
    payload: { id: "worker-ok", name: "Worker OK", kind: "worker", baseUrl: "http://127.0.0.1:9000", concurrencyLimit: 1 },
  });

  // Create comfyui workflow
  await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/workflows",
    headers: adminHeaders,
    payload: { id: "wf-comfy", name: "Comfy WF", engineKind: "comfyui" },
  });

  // 3. Workflow version referencing non-existent engine
  const badEngineVer = await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/workflows/wf-comfy/versions",
    headers: adminHeaders,
    payload: {
      engineId: "non-existent-engine",
      definition: { "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } },
      inputSchema: {},
      nodeBindings: {},
      outputDeclarations: ["6"],
    },
  });
  assert.equal(badEngineVer.statusCode, 404);
  assert.equal(badEngineVer.json().error, "engine_not_found");

  // 4. Workflow version with engine kind mismatch (worker engine for comfyui workflow)
  const mismatchEngineVer = await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/workflows/wf-comfy/versions",
    headers: adminHeaders,
    payload: {
      engineId: "worker-ok",
      definition: { "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } },
      inputSchema: {},
      nodeBindings: {},
      outputDeclarations: ["6"],
    },
  });
  assert.equal(mismatchEngineVer.statusCode, 400);
  assert.equal(mismatchEngineVer.json().error, "engine_kind_mismatch");

  // 5. Workflow version with invalid nodeBindings (referencing missing node)
  const badBindingVer = await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/workflows/wf-comfy/versions",
    headers: adminHeaders,
    payload: {
      engineId: "comfy-ok",
      definition: { "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } },
      inputSchema: {},
      nodeBindings: { prompt: ["999", "inputs", "text"] },
      outputDeclarations: ["6"],
    },
  });
  assert.equal(badBindingVer.statusCode, 400);
  assert.equal(badBindingVer.json().error, "binding_node_not_found");

  // 6. Workflow version with invalid outputDeclarations (empty or missing node)
  const badOutputVer = await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/workflows/wf-comfy/versions",
    headers: adminHeaders,
    payload: {
      engineId: "comfy-ok",
      definition: { "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } },
      inputSchema: {},
      nodeBindings: {},
      outputDeclarations: ["999"],
    },
  });
  assert.equal(badOutputVer.statusCode, 400);
  assert.equal(badOutputVer.json().error, "output_node_not_found");

  // Publish valid version 1
  const goodVer = await app.inject({
    method: "POST",
    url: "/api/v1/admin/generation/workflows/wf-comfy/versions",
    headers: adminHeaders,
    payload: {
      engineId: "comfy-ok",
      definition: { "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } },
      inputSchema: { prompt: { type: "string" } },
      nodeBindings: { prompt: ["6", "inputs", "text"] },
      outputDeclarations: ["6"],
    },
  });
  assert.equal(goodVer.statusCode, 201);

  // 7. Atomic assignment validation: fails atomically without touching DB if any entry is invalid
  seedApp(database, "app-val-test");
  const badAssign = await app.inject({
    method: "PUT",
    url: "/api/v1/admin/apps/app-val-test/generation-assignments",
    headers: adminHeaders,
    payload: {
      assignments: [
        { purpose: "default", workflowId: "wf-comfy", engineId: "comfy-ok" },
        { purpose: "invalid-item", workflowId: "non-existent-wf", engineId: "comfy-ok" },
      ],
    },
  });
  assert.equal(badAssign.statusCode, 404);
  assert.equal(badAssign.json().error, "workflow_not_found");

  // Verify that zero assignments were created
  const checkZero = database.connection.prepare("SELECT COUNT(*) as c FROM app_generation_assignments WHERE app_id = ?").get("app-val-test") as { c: number };
  assert.equal(checkZero.c, 0);

  await app.close();
  database.close();
});

test("Generation retry: only allowed on terminal failed/abandoned/cancelled states", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-retry-val-"));
  const token = seedApp(database, "retry-val-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines(id, name, kind, base_url, enabled, concurrency_limit, created_at, updated_at) VALUES ('eng-1','Engine','comfyui','http://comfy.test:8188',1,2,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflows(id, name, engine_kind, latest_version, created_at, updated_at) VALUES ('wf-1','WF','comfyui',1,?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions(workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json, definition_json, is_published, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments(app_id, purpose, workflow_id, workflow_version, engine_id, updated_at) VALUES ('retry-val-app','default','wf-1',1,'eng-1',?)").run(now);

  // Seed tasks in various states
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES ('t-queued','retry-val-app','eng-1','wf-1',1,'h1','{}','{}','queued',?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES ('t-running','retry-val-app','eng-1','wf-1',1,'h2','{}','{}','running',?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES ('t-succeeded','retry-val-app','eng-1','wf-1',1,'h3','{}','{}','succeeded',?,?)").run(now, now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES ('t-failed','retry-val-app','eng-1','wf-1',1,'h4','{}','{}','failed',?,?)").run(now, now);

  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // 1. Retry queued task -> 409 not_retryable
  const retryQueued = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks/t-queued/retry",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(retryQueued.statusCode, 409);
  assert.equal(retryQueued.json().error, "not_retryable");

  // 2. Retry running task -> 409 not_retryable
  const retryRunning = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks/t-running/retry",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(retryRunning.statusCode, 409);
  assert.equal(retryRunning.json().error, "not_retryable");

  // 3. Retry succeeded task -> 409 not_retryable
  const retrySucceeded = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks/t-succeeded/retry",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(retrySucceeded.statusCode, 409);
  assert.equal(retrySucceeded.json().error, "not_retryable");

  // 4. Retry failed task -> 202 accepted
  const retryFailed = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks/t-failed/retry",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "retry-failed-key-1" },
  });
  assert.equal(retryFailed.statusCode, 202);
  assert.equal(retryFailed.json().retryOf, "t-failed");

  await app.close();
  database.close();
});
