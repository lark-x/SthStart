import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { registerConnectionRoutes } from './connections-routes.js';
import { registerModelRoutes } from './models-routes.js';
import { resolveProfile } from './providers.js';
import { executeCloudGeneration } from './generation/cloud-adapter.js';
import { validateCloudRecipeStructure } from './generation/workflows.js';
import { ExecutionRegistry, executionRegistryFor, waitForExecutions } from './generation/execution-registry.js';
import { executeTextLlm } from './llm/common-llm.js';

class MemorySecrets extends SecretStore {
  values = new Map<string, string>();
  fail = false;
  override async get(account: string) { const value = this.values.get(account); return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const }; }
  override async set(account: string, value: string) { if (this.fail) throw new Error('storage_unavailable'); this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

test('connection edits preserve omitted settings, failed credential replacement and disabled model state; deletion works', async () => {
  const db = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const app = Fastify();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'review-admin-token-with-enough-length' });
  registerConnectionRoutes(app, config, db, secrets);
  registerModelRoutes(app, config, db, secrets, async () => Response.json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }));
  const headers = { 'x-sthstart-admin-token': config.adminToken! };
  const connection = { id: 'conn_test', name: 'test', kind: 'openai-compatible-text', baseUrl: 'https://example.invalid/v1' };
  const model = { id: 'model_test', name: 'model', modelId: 'actual-model', connectionId: connection.id };
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1/admin/${url}`, headers, payload });
  try {
    assert.equal((await post('connections', { ...connection, enabled: false, timeoutMs: 43210, headers: { 'X-Test': 'retained' }, options: { temperature: 0.12 } })).statusCode, 201);
    db.connection.prepare("UPDATE service_connections SET credential_account='old_account' WHERE id=?").run(connection.id);
    secrets.values.set('old_account', 'old-secret');
    secrets.fail = true;
    const update = await post('connections', { ...connection, secret: 'new-secret' });
    assert.equal(update.statusCode, 201);
    assert.equal(update.json().secretStored, false);
    const row = db.connection.prepare('SELECT * FROM service_connections WHERE id=?').get(connection.id) as Record<string, unknown>;
    assert.equal(row.enabled, 0);
    assert.equal(row.timeout_ms, 43210);
    assert.equal(row.credential_account, 'old_account');
    assert.equal(JSON.parse(String(row.headers_json))['X-Test'], 'retained');
    assert.equal(JSON.parse(String(row.options_json)).temperature, 0.12);
    assert.equal((await post('models', model)).statusCode, 201);
    // Deliberately stale legacy projection must never bypass the disabled connection.
    db.connection.prepare('UPDATE provider_profiles SET enabled=1 WHERE id=?').run(model.id);
    assert.equal(await resolveProfile(db, secrets, 'llm', model.id), null);
    assert.equal((await post('models', { ...model, enabled: false })).statusCode, 201);
    assert.equal((await post('connections', { ...connection, enabled: true })).statusCode, 201);
    const legacy = db.connection.prepare('SELECT enabled FROM provider_profiles WHERE id=?').get(model.id) as { enabled: number };
    assert.equal(legacy.enabled, 0);
    assert.equal((await post('models', { ...model, enabled: true })).statusCode, 201);
    assert.equal(await resolveProfile(db, secrets, 'image', model.id), null);
    const inference = (await post(`models/${model.id}/test`, { type: 'text' })).json();
    assert.equal(inference.success, true);
    assert.equal(inference.tokenUsage.total_tokens, 4);
    assert.ok(inference.aiCallId);
    assert.ok(db.connection.prepare('SELECT id FROM ai_call_records WHERE id=?').get(inference.aiCallId));
    assert.equal((await post('models', { ...model, id: 42 })).statusCode, 400);
    assert.equal((await post('connections', { ...connection, timeoutMs: 'bad' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/admin/models/${model.id}`, headers })).statusCode, 200);
    assert.equal(db.connection.prepare('SELECT id FROM model_profiles WHERE id=?').get(model.id), undefined);
  } finally { await app.close(); db.close(); }
});

test('cloud recipes require a vendor model, normalize legacy recipes and preserve canonical parameters', async () => {
  assert.throws(() => validateCloudRecipeStructure({}, {}, {}, []), /modelId/);
  const recipe = validateCloudRecipeStructure({ model: 'legacy-model' }, {}, {}, []).validatedDefinition;
  assert.equal(recipe.modelId, 'legacy-model');
  let requests = 0;
  const fetchFn: typeof fetch = async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'real-model');
    assert.equal(body.prompt, 'real-prompt');
    assert.equal(body.n, 2);
    assert.equal(body.output_format, 'jpeg');
    assert.equal(body.extra, true);
    return Response.json({ data: [{ b64_json: Buffer.from([0xff, 0xd8, 0xff, 0x01]).toString('base64') }] });
  };
  const options = { engine: { id: 'engine', baseUrl: 'https://example.invalid/v1', secret: null }, model: 'real-model', prompt: 'real-prompt', fetchFn };
  await assert.rejects(executeCloudGeneration({ ...options, operation: 'image-to-image' }), /reference_image_required/);
  assert.equal(requests, 0);
  const result = await executeCloudGeneration({ ...options, n: 2, format: 'jpeg', customParams: { model: 'wrong', prompt: 'wrong', n: 99, extra: true } });
  assert.equal(result.images[0].contentType, 'image/jpeg');
  await assert.rejects(executeCloudGeneration({ ...options, fetchFn: async () => Response.json({ data: [{}] }) }), /有效图像/);
});

test('cloud result download shares cancellation with the original task', async () => {
  const controller = new AbortController();
  await assert.rejects(executeCloudGeneration({ engine: { id: 'e', baseUrl: 'https://example.invalid', secret: null }, model: 'm', prompt: 'p', signal: controller.signal,
    fetchFn: async (url, init) => {
      if (String(url).endsWith('/images/generations')) return Response.json({ data: [{ url: 'https://example.invalid/image' }] });
      controller.abort(new Error('cancelled_download'));
      init?.signal?.throwIfAborted();
      return new Response('image');
    },
  }), /cancelled_download/);
});

test('registry reserves before dispatch and separates service instances', async () => {
  const registry = new ExecutionRegistry();
  let calls = 0;
  const first = registry.start({ taskId: 'one', appId: 'app' }, async () => { calls++; });
  await assert.rejects(registry.start({ taskId: 'one', appId: 'app' }, async () => { calls++; }), /already_executing/);
  await first;
  await registry.drain(5000);
  await assert.rejects(registry.start({ taskId: 'two', appId: 'app' }, async () => { calls++; }), /server_draining/);
  assert.equal(calls, 1);
  const one = {}, two = {};
  assert.equal(executionRegistryFor(one), executionRegistryFor(one));
  assert.notEqual(executionRegistryFor(one), executionRegistryFor(two));
});

test('common LLM uses connection timeout and removes internal thinking option', async () => {
  await executeTextLlm({ profile: { baseUrl: 'https://example.invalid', model: 'real-model', timeoutMs: 4321, thinkingMode: 'disabled', extraBody: { thinkingMode: 'disabled', temperature: 0.1 } }, prompt: 'p', fetchFn: async (_url, init) => {
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.temperature, 0.1);
    assert.equal(body.thinkingMode, undefined);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  } });
});


test('shutdown wait is bounded and retains pending work for eventual cleanup', async () => {
  let finish!: () => void;
  const work = new Promise<void>((resolve) => { finish = resolve; });
  assert.equal(await waitForExecutions([work], 10), false);
  finish();
  assert.equal(await waitForExecutions([work], 1000), true);
});

test('DSH never adopts an occupied port as a project instance', async () => {
  const { DshProcessManager } = await import('./story/dsh-process-manager.js');
  const manager = new DshProcessManager(readConfig(), { requireProject() {} } as unknown as import('./story/store.js').StoryStore);
  (manager as unknown as { isPortAvailable(port: number): Promise<boolean> }).isPortAvailable = async () => false;
  await assert.rejects(manager.start('project-test'), /已被占用/);
  assert.equal(manager.status('project-test').running, false);
});


test('missing actual model is a configuration error and cannot dispatch a default model', async () => {
  let calls = 0;
  await assert.rejects(executeTextLlm({ profile: { baseUrl: 'https://example.invalid' }, prompt: 'p', fetchFn: async () => {
    calls++;
    return Response.json({});
  } }), /model_id_required/);
  assert.equal(calls, 0);
});
