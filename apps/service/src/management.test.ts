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
