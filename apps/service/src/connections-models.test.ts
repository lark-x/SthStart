import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { resolveEffectiveModelProfile } from './providers.js';

const ADMIN_TOKEN = 'test-admin-secret-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': ADMIN_TOKEN };

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

test('connections, model profiles, and purpose bindings full lifecycle', async () => {
  const db = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN });

  const mockFetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/models')) {
      return Response.json({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] });
    }
    if (url.endsWith('/chat/completions')) {
      return Response.json({
        id: 'chatcmpl-mock',
        choices: [{ message: { role: 'assistant', content: '连接成功喵。' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }
    return new Response('ok', { status: 200 });
  };

  const { app } = await createService({ config, database: db, secrets, fetcher: mockFetcher });

  try {
    // 1. Create a service connection
    const createConnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/connections',
      headers: adminHeaders,
      payload: {
        id: 'conn-openai-test',
        name: 'OpenAI 测试连接',
        kind: 'openai-compatible-text',
        baseUrl: 'https://api.openai.com/v1',
        secret: 'sk-test-123456',
        timeoutMs: 30000,
        enabled: true,
      },
    });
    assert.equal(createConnRes.statusCode, 201);
    const connJson = createConnRes.json();
    assert.equal(connJson.id, 'conn-openai-test');

    // 2. Discover models from connection
    const discoverRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/connections/discover-models',
      headers: adminHeaders,
      payload: {
        connectionId: 'conn-openai-test',
      },
    });
    assert.equal(discoverRes.statusCode, 200);
    const discoverJson = discoverRes.json();
    assert.deepEqual(discoverJson.models, ['gpt-4o', 'gpt-4o-mini']);

    // 3. Test connection probe
    const testConnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/connections/test',
      headers: adminHeaders,
      payload: {
        connectionId: 'conn-openai-test',
      },
    });
    assert.equal(testConnRes.statusCode, 200);
    assert.equal(testConnRes.json().success, true);

    // 4. Create a model profile referencing connection
    const createModelRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/models',
      headers: adminHeaders,
      payload: {
        id: 'model-gpt4o',
        connectionId: 'conn-openai-test',
        name: 'GPT-4o 旗舰',
        modelId: 'gpt-4o',
        capabilities: ['text', 'vision'],
        contextLength: 128000,
        enabled: true,
      },
    });
    assert.equal(createModelRes.statusCode, 201);
    assert.equal(createModelRes.json().id, 'model-gpt4o');

    // 5. Test model inference
    const testModelRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/models/model-gpt4o/test',
      headers: adminHeaders,
      payload: {
        prompt: '测试连通性',
      },
    });
    assert.equal(testModelRes.statusCode, 200);
    const testModelJson = testModelRes.json();
    assert.equal(testModelJson.success, true);
    assert.match(testModelJson.output, /连接成功喵/);

    // 6. Purpose binding: bind activities -> planning -> model-gpt4o
    const putBindingRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/purpose-bindings',
      headers: adminHeaders,
      payload: {
        bindings: [
          {
            appId: 'activities',
            purposeKey: 'planning',
            targetType: 'model',
            targetId: 'model-gpt4o',
            inheritAppDefault: false,
          },
        ],
      },
    });
    assert.equal(putBindingRes.statusCode, 200);

    // 7. Verify resolveEffectiveModelProfile resolves the purpose binding
    const resolved = await resolveEffectiveModelProfile(db, secrets, 'activities', 'planning');
    assert.ok(resolved);
    assert.equal(resolved.id, 'model-gpt4o');
    assert.equal(resolved.model, 'gpt-4o');
    assert.equal(resolved.baseUrl, 'https://api.openai.com/v1');

    // 8. Overview includes connections, modelProfiles, purposeBindings
    const overviewRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: adminHeaders,
    });
    assert.equal(overviewRes.statusCode, 200);
    const overview = overviewRes.json();
    assert.ok(Array.isArray(overview.connections));
    assert.ok(overview.connections.some((c: { id: string }) => c.id === 'conn-openai-test'));
    assert.ok(Array.isArray(overview.modelProfiles));
    assert.ok(overview.modelProfiles.some((m: { id: string }) => m.id === 'model-gpt4o'));
    assert.ok(Array.isArray(overview.purposeBindings));
    assert.ok(overview.purposeBindings.some((b: { purposeKey: string }) => b.purposeKey === 'planning'));

    // 9. Deleting connection while in use is blocked
    const delConnBlocked = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/connections/conn-openai-test',
      headers: adminHeaders,
    });
    assert.equal(delConnBlocked.statusCode, 409);

    // 10. Deleting model while bound to purpose is blocked
    const delModelBlocked = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/models/model-gpt4o',
      headers: adminHeaders,
    });
    assert.equal(delModelBlocked.statusCode, 409);

    // 11. GET /api/v1/admin/purposes returns the purpose bindings
    const getPurposesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/purposes',
      headers: adminHeaders,
    });
    assert.equal(getPurposesRes.statusCode, 200);
    const purposesList = getPurposesRes.json();
    assert.ok(Array.isArray(purposesList.items));
    assert.ok(purposesList.items.some((b: { purposeKey: string }) => b.purposeKey === 'planning'));

    // 12. PUT /api/v1/admin/purposes/:appId/:purpose updates single purpose binding
    const putSinglePurpose = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/purposes/activities/planning',
      headers: adminHeaders,
      payload: {
        targetType: 'model',
        targetId: 'model-gpt4o',
        inheritAppDefault: false,
      },
    });
    assert.equal(putSinglePurpose.statusCode, 200);

    // 13. DELETE /api/v1/admin/purposes/:appId/:purpose deletes single purpose binding
    const delSinglePurpose = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/purposes/activities/planning',
      headers: adminHeaders,
    });
    assert.equal(delSinglePurpose.statusCode, 200);

    // 14. Legacy /api/v1/admin/profiles dual-writes to service_connections & model_profiles
    const legacyPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/profiles',
      headers: adminHeaders,
      payload: {
        id: 'legacy-p1',
        name: 'Legacy Profile 1',
        kind: 'llm',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        secret: 'sk-leg-1',
        enabled: true,
      },
    });
    assert.equal(legacyPostRes.statusCode, 201);
    // Check that service_connections and model_profiles were populated
    const checkConn = db.connection.prepare('SELECT * FROM service_connections WHERE id = ?').get('conn_legacy-p1') as Record<string, unknown> | undefined;
    assert.ok(checkConn);
    assert.equal(checkConn.base_url, 'https://api.openai.com/v1');
    const checkModel = db.connection.prepare('SELECT * FROM model_profiles WHERE id = ?').get('legacy-p1') as Record<string, unknown> | undefined;
    assert.ok(checkModel);
    assert.equal(checkModel.model_id, 'gpt-4o-mini');

    // Test clone dual-write
    const legacyCloneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/profiles/legacy-p1/clone',
      headers: adminHeaders,
      payload: {
        id: 'legacy-p1-copy',
        name: 'Legacy Profile 1 Copy',
        model: 'gpt-4o-mini',
        capabilities: ['text'],
      },
    });
    assert.equal(legacyCloneRes.statusCode, 201);
    const checkCloneModel = db.connection.prepare('SELECT * FROM model_profiles WHERE id = ?').get('legacy-p1-copy') as Record<string, unknown> | undefined;
    assert.ok(checkCloneModel);

    // Test delete dual-delete
    const legacyDelRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/profiles/legacy-p1-copy',
      headers: adminHeaders,
    });
    assert.equal(legacyDelRes.statusCode, 200);
    const checkDeleted = db.connection.prepare('SELECT * FROM model_profiles WHERE id = ?').get('legacy-p1-copy');
    assert.equal(checkDeleted, undefined);
  } finally {
    await app.close();
    db.close();
  }
});
