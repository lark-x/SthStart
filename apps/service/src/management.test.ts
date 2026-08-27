import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';

const adminToken = 'admin-management-test-token-123456789012345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

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

test('model management discovers, clones independently, assigns, and protects active profiles', async () => {
  const seenHeaders: Headers[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    seenHeaders.push(new Headers(init?.headers));
    return Response.json({ data: [{ id: 'model-b' }, { id: 'models/model-a' }, { id: 'model-b' }] });
  };
  const database = new ServiceDatabase(); const secrets = new MemorySecrets();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets, fetcher });
  const createdApp = await app.inject({ method: 'POST', url: '/api/v1/admin/apps', headers: adminHeaders, payload: { id: 'writer-app', name: 'Writer' } });
  assert.equal(createdApp.statusCode, 201);
  const profile = await app.inject({ method: 'POST', url: '/api/v1/admin/profiles', headers: adminHeaders, payload: {
    id: 'primary-model', name: 'Primary', kind: 'llm', baseUrl: 'https://llm.test/v1', model: 'model-a', secret: 'source-secret', capabilities: ['text', 'multimodal'], headers: { 'X-Custom': 'ok', Authorization: 'must-not-pass' }, extraBody: { temperature: 0.7 },
  } });
  assert.equal(profile.statusCode, 201);
  const discovered = await app.inject({ method: 'POST', url: '/api/v1/admin/llm/models/discover', headers: adminHeaders, payload: { profileId: 'primary-model' } });
  assert.equal(discovered.statusCode, 200); assert.deepEqual(discovered.json().models, ['model-a', 'model-b']);
  assert.equal(seenHeaders[0].get('authorization'), 'Bearer source-secret'); assert.equal(seenHeaders[0].get('x-custom'), 'ok');
  const cloned = await app.inject({ method: 'POST', url: '/api/v1/admin/profiles/primary-model/clone', headers: adminHeaders, payload: { id: 'secondary-model', name: 'Secondary', model: 'model-b', capabilities: ['text'] } });
  assert.equal(cloned.statusCode, 201); assert.equal(secrets.values.get('profile:secondary-model'), 'source-secret');
  await secrets.set('profile:primary-model', 'changed-source-secret');
  assert.equal(secrets.values.get('profile:secondary-model'), 'source-secret');
  const assigned = await app.inject({ method: 'PUT', url: '/api/v1/admin/apps/writer-app/llm-assignments', headers: adminHeaders, payload: { textProfileId: 'secondary-model', multimodalProfileId: 'primary-model' } });
  assert.equal(assigned.statusCode, 200);
  const disabled = await app.inject({ method: 'POST', url: '/api/v1/admin/profiles', headers: adminHeaders, payload: { id: 'secondary-model', name: 'Secondary', kind: 'llm', baseUrl: 'https://llm.test/v1', model: 'model-b', capabilities: ['text'], enabled: false } });
  assert.equal(disabled.statusCode, 409); assert.equal(disabled.json().error, 'profile_in_use');
  const removedWhileUsed = await app.inject({ method: 'DELETE', url: '/api/v1/admin/profiles/secondary-model', headers: adminHeaders });
  assert.equal(removedWhileUsed.statusCode, 409);
  await app.inject({ method: 'PUT', url: '/api/v1/admin/apps/writer-app/llm-assignments', headers: adminHeaders, payload: { textProfileId: null, multimodalProfileId: 'primary-model' } });
  const removed = await app.inject({ method: 'DELETE', url: '/api/v1/admin/profiles/secondary-model', headers: adminHeaders });
  assert.equal(removed.statusCode, 200); assert.equal(secrets.values.has('profile:secondary-model'), false);
  await app.close(); database.close();
});

test('model discovery supports alternate arrays and gives an actionable empty-list error', async () => {
  let call = 0;
  const fetcher: typeof fetch = async () => call++ === 0 ? Response.json({ models: ['zeta', { name: 'alpha' }] }) : Response.json({ items: [] });
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets: new MemorySecrets(), fetcher });
  const first = await app.inject({ method: 'POST', url: '/api/v1/admin/llm/models/discover', headers: adminHeaders, payload: { baseUrl: 'https://provider.test/v1' } });
  assert.deepEqual(first.json().models, ['alpha', 'zeta']);
  const empty = await app.inject({ method: 'POST', url: '/api/v1/admin/llm/models/discover', headers: adminHeaders, payload: { baseUrl: 'https://provider.test/v1' } });
  assert.equal(empty.statusCode, 502); assert.equal(empty.json().error, 'empty_model_list');
  await app.close(); database.close();
});

test('model clone validation reports the exact invalid field', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets: new MemorySecrets() });
  const invalidId = await app.inject({ method: 'POST', url: '/api/v1/admin/profiles/source/clone', headers: adminHeaders, payload: { id: 'Bad_ID', name: '副本', model: 'model-a', capabilities: ['text'] } });
  assert.equal(invalidId.statusCode, 400);
  assert.equal(invalidId.json().error, 'invalid_clone_id');
  assert.match(invalidId.json().message, /小写字母/);
  const missingModel = await app.inject({ method: 'POST', url: '/api/v1/admin/profiles/source/clone', headers: adminHeaders, payload: { id: 'valid-copy', name: '副本', capabilities: ['text'] } });
  assert.equal(missingModel.statusCode, 400);
  assert.equal(missingModel.json().error, 'clone_model_required');
  await app.close(); database.close();
});

test('Windows Worker management stores token separately, exposes safe settings, and probes health', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const seenAuth: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    seenAuth.push(new Headers(init?.headers).get('authorization') || '');
    return Response.json({ ok: true, ready: true, workerId: 'worker-a', model: 'sdxl', temperature: 0.5, queueDepth: 0, runningTaskId: null, disk: { freeBytes: 12345 } });
  };
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets, fetcher });
  const token = 'worker-management-secret-that-is-long-enough-123456';
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/workers',
    headers: adminHeaders,
    payload: {
      id: 'worker-a', name: 'Windows Worker A', baseUrl: 'http://192.168.1.20:9200/', token,
      model: 'sdxl', temperature: 0.5, ipAllowlist: ['192.168.1.0/24'], diskWarningBytes: 10_000, diskStopBytes: 2_000,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().token, token);
  assert.equal(secrets.values.get('engine:worker-a'), token);

  const list = await app.inject({ method: 'GET', url: '/api/v1/admin/workers', headers: adminHeaders });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items[0].baseUrl, 'http://192.168.1.20:9200');
  assert.equal('token' in list.json().items[0], false);
  assert.equal('secret' in list.json().items[0], false);
  assert.equal(list.json().items[0].concurrencyLimit, 1);

  const health = await app.inject({ method: 'GET', url: '/api/v1/admin/workers/worker-a/health', headers: adminHeaders });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ready, true);
  assert.equal(health.json().disk.warningBytes, 10_000);
  assert.deepEqual(seenAuth, [`Bearer ${token}`]);

  const rotated = await app.inject({ method: 'POST', url: '/api/v1/admin/workers/worker-a/rotate-token', headers: adminHeaders });
  assert.equal(rotated.statusCode, 200);
  assert.notEqual(rotated.json().token, token);
  assert.equal(secrets.values.get('engine:worker-a'), rotated.json().token);

  const invalid = await app.inject({ method: 'POST', url: '/api/v1/admin/workers', headers: adminHeaders, payload: { id: 'worker-b', name: 'Bad', baseUrl: 'http://worker.test:9200', token: 'short', ipAllowlist: ['not-an-ip'] } });
  assert.equal(invalid.statusCode, 400);

  await app.close(); database.close();
});

test('workflow import accepts valid ComfyUI API JSON and rejects GUI formats or secrets', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets: new MemorySecrets() });

  const validDefinition = {
    '106': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '122': { class_type: 'PrimitiveInt', inputs: { value: 768 } },
    '8': { class_type: 'VAEDecode', inputs: {} },
  };

  // 1. Happy path: import a workflow bundle
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/import',
    headers: adminHeaders,
    payload: {
      id: 'turbo-anime',
      name: '极速二次元生图',
      description: 'Anima Turbo 极速管线',
      category: 'image',
      engineKind: 'comfyui',
      inputSchema: { prompt: { type: 'string' } },
      nodeBindings: { prompt: ['106', 'inputs', 'text'] },
      outputDeclarations: ['8'],
      outputMediaTypes: ['image/png'],
      definition: validDefinition,
    },
  });
  assert.equal(imported.statusCode, 201);
  assert.equal(imported.json().id, 'turbo-anime');
  assert.equal(imported.json().version, 1);

  // Second import increments version to v2
  const secondImport = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/import',
    headers: adminHeaders,
    payload: {
      id: 'turbo-anime',
      name: '极速二次元生图 v2',
      category: 'image',
      engineKind: 'comfyui',
      inputSchema: { prompt: { type: 'string' } },
      nodeBindings: { prompt: ['106', 'inputs', 'text'] },
      outputDeclarations: ['8'],
      definition: validDefinition,
    },
  });
  assert.equal(secondImport.statusCode, 201);
  assert.equal(secondImport.json().version, 2);

  // 2. Reject GUI format (containing nodes/links array)
  const guiPayload = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/import',
    headers: adminHeaders,
    payload: {
      id: 'gui-workflow',
      name: '画布导出',
      definition: {
        nodes: [{ id: 1, type: 'CLIPTextEncode' }],
        links: [[1, 1, 0, 2, 0, 'CLIP']],
      },
      inputSchema: {},
      nodeBindings: {},
      outputDeclarations: ['1'],
    },
  });
  assert.equal(guiPayload.statusCode, 400);
  assert.equal(guiPayload.json().error, 'invalid_workflow_format_gui_rejected');
  assert.match(guiPayload.json().message, /ComfyUI API 格式/);

  // 3. Reject plaintext secrets in workflow payload
  const secretPayload = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/import',
    headers: adminHeaders,
    payload: {
      id: 'secret-workflow',
      name: '包含密钥的工作流',
      apiKey: 'sk-plaintext-secret-12345',
      definition: validDefinition,
      inputSchema: {},
      nodeBindings: { prompt: ['106', 'inputs', 'text'] },
      outputDeclarations: ['8'],
    },
  });
  assert.equal(secretPayload.statusCode, 400);
  assert.equal(secretPayload.json().error, 'secrets_not_permitted');
  assert.match(secretPayload.json().message, /不得包含明文密钥/);

  const nestedSecretPayload = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/import',
    headers: adminHeaders,
    payload: {
      id: 'nested-secret-workflow',
      name: '嵌套密钥工作流',
      definition: {
        '106': { class_type: 'CLIPTextEncode', inputs: { text: 'https://user:password@example.com/model' } },
      },
      inputSchema: { headers: { 'x-api-key': 'secret' } },
      nodeBindings: {},
      outputDeclarations: ['106'],
    },
  });
  assert.equal(nestedSecretPayload.statusCode, 400);
  assert.equal(nestedSecretPayload.json().error, 'secrets_not_permitted');

  // 4. Reject invalid workflow ID
  const invalidId = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/import',
    headers: adminHeaders,
    payload: {
      id: 'Bad_ID!',
      name: '非法 ID',
      definition: validDefinition,
      inputSchema: {},
      nodeBindings: {},
      outputDeclarations: ['8'],
    },
  });
  assert.equal(invalidId.statusCode, 400);
  assert.equal(invalidId.json().error, 'invalid_workflow_id');

  // 5. Reject missing output declarations
  const missingOutputs = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/generation/workflows/import',
    headers: adminHeaders,
    payload: {
      id: 'no-output-wf',
      name: '无输出声明',
      definition: validDefinition,
      inputSchema: {},
      nodeBindings: { prompt: ['106', 'inputs', 'text'] },
      outputDeclarations: [],
    },
  });
  assert.equal(missingOutputs.statusCode, 400);
  assert.equal(missingOutputs.json().error, 'output_declarations_required');

  await app.close(); database.close();
});
