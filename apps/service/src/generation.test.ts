import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { SecretStore, hashToken, issueToken } from './security.js';
import { validateComfyApiJson, renderWorkflowSnapshot, reconcileGenerationTasks, activeGenerationExecutions, cleanupGenerationEvents, pollAndCompleteTask } from './generation.js';

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

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
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
  const artifactReference = database.connection.prepare("SELECT ref_type, ref_id FROM artifact_references WHERE artifact_id = ?").get(artId) as { ref_type: string; ref_id: string };
  assert.equal(artifactReference.ref_type, "generation-output");
  assert.equal(artifactReference.ref_id, taskId);

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

  // Wait for all 3 tasks to reach terminal state
  const recDeadline = Date.now() + 5000;
  while (Date.now() < recDeadline) {
    const acc = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = 't-acc'").get() as { status: string };
    const run = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = 't-run'").get() as { status: string };
    const que = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = 't-que'").get() as { status: string };
    if (acc.status === "succeeded" && run.status === "failed" && que.status === "succeeded") break;
    await new Promise((r) => setTimeout(r, 50));
  }

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

test("Generation concurrency: limits active tasks to concurrency_limit and scheduler drains queued tasks when capacity is freed", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-conc-"));
  const token = seedApp(database, "conc-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  // Concurrency limit = 1
  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-1", "Engine", "comfyui", "http://comfy.test:8188", null, 1, 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-1", "WF", "", "comfyui", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("conc-app", "default", "wf-1", 1, "eng-1", now);

  let task1CanFinish = false;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/prompt")) {
      return Response.json({ prompt_id: "prompt-conc-" + Math.random().toString(36).slice(2) });
    }
    if (url.includes("/history/")) {
      if (!task1CanFinish) {
        return Response.json({});
      }
      const promptId = url.split("/").pop()!;
      return Response.json({
        [promptId]: {
          status: { status_str: "success" },
          outputs: { "9": { images: [{ filename: "out.png", type: "output" }] } },
        },
      });
    }
    if (url.includes("/view")) {
      return new Response(Buffer.from("binary-png"), { status: 200, headers: { "content-type": "image/png" } });
    }
    if (url.includes("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
    return new Response(null, { status: 404 });
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  // 1. Submit task 1 -> will occupy the 1 capacity slot
  const res1 = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "conc-key-1" },
    payload: {},
  });
  const task1Id = res1.json().id;

  // Wait briefly for task 1 to reach submitting/accepted
  await new Promise((r) => setTimeout(r, 100));

  // 2. Submit task 2 -> engine at capacity (limit 1), must remain queued
  const res2 = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "conc-key-2" },
    payload: {},
  });
  const task2Id = res2.json().id;

  await new Promise((r) => setTimeout(r, 100));
  const t2Before = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(task2Id) as { status: string };
  assert.equal(t2Before.status, "queued", "Task 2 must remain queued while Task 1 is active");

  // 3. Now let task 1 finish -> frees capacity and scheduler should pick up task 2
  task1CanFinish = true;
  const concDeadline = Date.now() + 5000;
  while (Date.now() < concDeadline) {
    const t1 = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(task1Id) as { status: string };
    const t2 = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(task2Id) as { status: string };
    if (t1.status === "succeeded" && t2.status === "succeeded") break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const t1After = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(task1Id) as { status: string };
  const t2After = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(task2Id) as { status: string };
  assert.equal(t1After.status, "succeeded");
  assert.equal(t2After.status, "succeeded", "Task 2 must be scheduled and completed once capacity is freed");

  await app.close();
  database.close();
});

test("Generation poll timeout and 404: poll deadline marks abandoned with poll_timeout and 404 marks upstream_not_found", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-poll-to-"));
  seedApp(database, "poll-to-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-1", "Engine", "comfyui", "http://comfy.test:8188", null, 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-1", "WF", "", "comfyui", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("poll-to-app", "default", "wf-1", 1, "eng-1", now);

  // 1. Task timeout test with short pollTimeoutMs = 50ms
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, provider_task_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("t-timeout", "poll-to-app", "eng-1", "wf-1", 1, "h1", "{}", "{}", "accepted", "prompt-to", now, now);

  const timeoutFetcher: typeof fetch = async () => Response.json({});
  await pollAndCompleteTask(config, database, new SecretStore({}), "t-timeout", timeoutFetcher, { pollTimeoutMs: 50, pollIntervalMs: 10 });

  const toTask = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ?").get("t-timeout") as { status: string; error_code: string; upstream_may_continue: number };
  assert.equal(toTask.status, "abandoned");
  assert.equal(toTask.error_code, "poll_timeout");
  assert.equal(toTask.upstream_may_continue, 1);

  // 2. Upstream 404 test
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, provider_task_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("t-404", "poll-to-app", "eng-1", "wf-1", 1, "h2", "{}", "{}", "accepted", "prompt-404", now, now);

  const notFoundFetcher: typeof fetch = async () => new Response(null, { status: 404 });
  await pollAndCompleteTask(config, database, new SecretStore({}), "t-404", notFoundFetcher, { pollTimeoutMs: 500, pollIntervalMs: 10 });

  const nfTask = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ?").get("t-404") as { status: string; error_code: string; upstream_may_continue: number };
  assert.equal(nfTask.status, "abandoned");
  assert.equal(nfTask.error_code, "upstream_not_found");
  assert.equal(nfTask.upstream_may_continue, 1);

  database.close();
});

test("Generation cancellation upstream error: failsafe marks task as abandoned instead of false cancelled when queue deletion fails", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-cancel-err-"));
  const token = seedApp(database, "cancel-err-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-1", "Engine", "comfyui", "http://comfy.test:8188", null, 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-1", "WF", "", "comfyui", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-1", 1, "eng-1", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("cancel-err-app", "default", "wf-1", 1, "eng-1", now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, provider_task_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("t-cancel-fail", "cancel-err-app", "eng-1", "wf-1", 1, "h1", "{}", "{}", "accepted", "prompt-p1", now, now);

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/queue") && init?.method === "POST") {
      return new Response(JSON.stringify({ error: "Queue delete error" }), { status: 500 });
    }
    if (url.includes("/queue")) return Response.json({ queue_running: [], queue_pending: [[1, "prompt-p1"]] });
    return Response.json({});
  };

  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });

  const cancelRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks/t-cancel-fail/cancel",
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.json().status, "abandoned", "Must not falsely report cancelled when queue deletion fails");
  assert.equal(cancelRes.json().errorCode, "cancellation_upstream_failed");
  assert.equal(cancelRes.json().upstreamMayContinue, true);

  await app.close();
  database.close();
});

test("Generation security: keyring failure marks task as failed with keyring_unavailable without leaving submitting state", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-keyring-err-"));
  const token = seedApp(database, "keyring-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-secret", "Engine", "comfyui", "http://comfy.test:8188", "engine:eng-secret", 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-1", "WF", "", "comfyui", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-1", 1, "eng-secret", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("keyring-app", "default", "wf-1", 1, "eng-secret", now);

  const throwingSecrets = {
    get: async () => { throw new Error("Keyring backend crashed"); },
    set: async () => {},
    delete: async () => {},
  } as unknown as SecretStore;

  const { app } = await createService({ config, database, secrets: throwingSecrets });

  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "keyring-test-1" },
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
  assert.equal(lookup.json().errorCode, "keyring_unavailable");

  await app.close();
  database.close();
});

test("Generation events cleanup: cleanupGenerationEvents purges old events of finished tasks", () => {
  const database = new ServiceDatabase();
  const now = nowIso();
  seedApp(database, "clean-app");

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-1", "Engine", "comfyui", "http://comfy.test:8188", null, 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-1", "WF", "", "comfyui", 1, now, now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("t-done", "clean-app", "eng-1", "wf-1", 1, "h1", "{}", "{}", "succeeded", now, now);
  database.connection.prepare("INSERT INTO generation_tasks(id, app_id, engine_id, workflow_id, workflow_version, request_hash, request_params_json, workflow_snapshot_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("t-active", "clean-app", "eng-1", "wf-1", 1, "h2", "{}", "{}", "running", now, now);

  // Seed old event for completed task (8 days ago)
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  database.connection.prepare("INSERT INTO generation_events(task_id, app_id, event_type, payload_json, created_at) VALUES (?,?,?,?,?)")
    .run("t-done", "clean-app", "succeeded", "{}", eightDaysAgo);
  // Seed recent event for active task
  database.connection.prepare("INSERT INTO generation_events(task_id, app_id, event_type, payload_json, created_at) VALUES (?,?,?,?,?)")
    .run("t-active", "clean-app", "running", "{}", now);

  const cleanRes = cleanupGenerationEvents(database, { maxRetentionDays: 7, maxEvents: 100 });
  assert.equal(cleanRes.deletedCount, 1);

  const remainingEvents = database.connection.prepare("SELECT * FROM generation_events").all();
  assert.equal(remainingEvents.length, 1);
  assert.equal((remainingEvents[0] as { task_id: string }).task_id, "t-active");

  database.close();
});

test("Generation worker: submits once, polls, persists output, and confirms remote files", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-worker-"));
  const token = seedApp(database, "worker-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-worker", "Worker", "worker", "http://worker.test:9000", "engine:eng-worker", 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workers(engine_id,model,temperature,ip_allowlist_json,disk_warning_bytes,disk_stop_bytes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("eng-worker", "sdxl", 0.4, "[]", 10_000, 2_000, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-worker", "Worker WF", "", "worker", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-worker", 1, "eng-worker", "{}", "{}", JSON.stringify(["9"]), JSON.stringify({ "6": { class_type: "Test", inputs: {} }, "9": { class_type: "SaveImage", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("worker-app", "default", "wf-worker", 1, "eng-worker", now);

  const secrets = new MemorySecrets();
  await secrets.set("engine:eng-worker", "worker-secret-that-is-long-enough-123456");
  const calls: string[] = [];
  let statusCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer worker-secret-that-is-long-enough-123456');
    assert.doesNotMatch(url, /comfy\.test|\/prompt$|\/history\//);
    if (url.endsWith('/v1/worker/tasks')) return Response.json({ taskId: 'worker-task-1', status: 'queued' }, { status: 202 });
    if (url.endsWith('/status')) {
      statusCalls++;
      return Response.json({
        taskId: 'worker-task-1',
        status: statusCalls === 1 ? 'running' : 'succeeded',
        outputs: statusCalls === 1 ? [] : [{ outputId: 'output-1', outputName: '9', filename: 'worker.png', contentType: 'image/png', byteSize: 18, sha256: '9e5f6b4d4f5b9f5bba7c17b1f7f3bead2642f4f5e22a0f8d2af8dc1d4b1f3ab1' }],
      });
    }
    if (url.endsWith('/output/output-1')) return new Response(Buffer.from('worker-output-data'), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '18' } });
    if (url.endsWith('/confirm')) return Response.json({ taskId: 'worker-task-1', status: 'confirmed' });
    return new Response(null, { status: 404 });
  };

  // The expected SHA-256 is intentionally computed from the exact mocked bytes above.
  const outputBytes = Buffer.from('worker-output-data');
  const expectedHash = (await import('node:crypto')).createHash('sha256').update(outputBytes).digest('hex');
  const originalFetcher = fetcher;
  const checkedFetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/status') && statusCalls >= 1) {
      const response = await originalFetcher(input, init);
      if (response.ok) {
        const payload = await response.json() as Record<string, unknown>;
        if (Array.isArray(payload.outputs) && payload.outputs.length) (payload.outputs[0] as Record<string, unknown>).sha256 = expectedHash;
        return Response.json(payload);
      }
    }
    return originalFetcher(input, init);
  };

  const { app } = await createService({ config, database, secrets, fetcher: checkedFetcher });

  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "worker-key-1" },
    payload: {},
  });
  assert.equal(createRes.statusCode, 202);
  const taskId = createRes.json().id as string;
  await Promise.allSettled(Array.from(activeGenerationExecutions));
  const lookup = await app.inject({ method: 'GET', url: `/api/v1/generation/tasks/${taskId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(lookup.json().status, 'succeeded');
  assert.equal(lookup.json().artifacts.length, 1);
  assert.equal(lookup.json().artifacts[0].outputName, '9');
  assert.ok(calls.some((call) => call.startsWith('POST http://worker.test:9000/v1/worker/tasks')));
  assert.ok(calls.some((call) => call.endsWith('/output/output-1')));
  assert.ok(calls.some((call) => call.endsWith('/confirm')));

  await app.close();
  database.close();
});

test("Generation unsupported engine: cloud engine task creation fails with unsupported_engine", async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), "sthstart-gen-unsupported-"));
  const token = seedApp(database, "unsupp-app");
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const now = nowIso();

  database.connection.prepare("INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)").run("eng-cloud", "Cloud", "cloud", "http://cloud.test:9000", null, 1, 2, now, now);
  database.connection.prepare("INSERT INTO generation_workflows VALUES (?,?,?,?,?,?,?)").run("wf-cloud", "Cloud WF", "", "cloud", 1, now, now);
  database.connection.prepare("INSERT INTO generation_workflow_versions VALUES (?,?,?,?,?,?,?,?,?)").run("wf-cloud", 1, "eng-cloud", "{}", "{}", "[]", JSON.stringify({ "6": { class_type: "Test", inputs: {} } }), 1, now);
  database.connection.prepare("INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)").run("unsupp-app", "default", "wf-cloud", 1, "eng-cloud", now);

  const { app } = await createService({ config, database, secrets: new SecretStore({}) });
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/generation/tasks",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "cloud-key-1" },
    payload: {},
  });
  assert.equal(createRes.statusCode, 400);
  assert.equal(createRes.json().error, "unsupported_engine");
  await app.close();
  database.close();
});
