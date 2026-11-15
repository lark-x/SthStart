import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { SERVICE_DATABASE_MIGRATIONS, ServiceDatabase, migrateDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { SecretStore, hashToken } from './security.js';
import { registerConnectionRoutes } from './connections-routes.js';
import { registerModelRoutes } from './models-routes.js';
import { registerModelRouteRoutes } from './model-routes.js';
import { registerPublicRoutes } from './public-routes.js';
import { resolveProfile, resolveRoutedProfiles } from './providers.js';
import { resolveAppLlmBindingStatus, resolveCharacterLlmBindingStatus } from './llm-status.js';
import { embedWithModel } from './unified-models.js';
import { registerManagementRoutes } from './management.js';

class MemorySecrets extends SecretStore {
  values = new Map<string, string>();
  reads: Array<{ account: string; env?: string }> = [];
  override async get(account: string, env?: string) {
    this.reads.push({ account, env });
    const value = this.values.get(account);
    return value ? { value, source: 'keyring' as const } : { value: null, source: 'none' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

function fixture(fetcher: typeof fetch = async () => { throw new Error('unexpected_network_call'); }) {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'unified-models-test-admin-credential', STHSTART_VECTOR_URL: 'http://vector.invalid' });
  const app = Fastify();
  registerConnectionRoutes(app, config, database, secrets, fetcher);
  registerModelRoutes(app, config, database, secrets, fetcher);
  registerModelRouteRoutes(app, database);
  registerPublicRoutes(app, config, database, secrets, fetcher);
  const headers = { 'x-sthstart-admin-token': config.adminToken! };
  const post = (path: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1/admin/${path}`, headers, payload });
  const connection = { id: 'shared', name: '同一个供应商', kind: 'openai-compatible-image', baseUrl: 'https://shared.invalid/v1', headers: { 'X-Tenant': 'tenant' }, options: { vendor: true }, secret: 'shared-test-key', timeoutMs: 4321 };
  const model = (id: string, modelType = 'chat', extra: object = {}) => post('models', { id, connectionId: connection.id, name: id, modelId: 'one-vendor-model', modelType, capabilities: modelType === 'chat' ? ['text', 'multimodal'] : [], ...extra });
  const seedApp = (id = 'test-app') => {
    const now = nowIso();
    const token = `test-token-${id}`;
    database.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
      VALUES (?,?,?,'["llm","vector","image"]',1,?,?)`).run(id, id, hashToken(token), now, now);
    return token;
  };
  return { database, secrets, config, app, headers, post, connection, model, seedApp };
}

test('one supplier supports independent chat, embedding and image models, with strict routing and reusable credentials', async () => {
  const f = fixture(async (url, init) => {
    assert.equal(String(url), 'https://shared.invalid/v1/chat/completions');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer shared-test-key');
    assert.equal(headers.get('X-Tenant'), 'tenant');
    assert.equal(JSON.parse(String(init?.body)).vendor, true);
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  });
  try {
    assert.equal((await f.post('connections', f.connection)).statusCode, 201);
    for (const [id, type, kind] of [['chat-a', 'chat', 'llm'], ['embed-a', 'embedding', 'vector'], ['image-a', 'image', 'image']]) {
      const saved = await f.model(id, type);
      assert.equal(saved.statusCode, 201, saved.body);
      assert.equal(saved.json().modelType, type);
      const legacy = f.database.connection.prepare('SELECT * FROM provider_profiles WHERE id=?').get(id)!;
      assert.equal(legacy.kind, kind);
      assert.equal(legacy.credential_account, 'conn:shared');
      assert.deepEqual(saved.json().capabilities, type === 'chat' ? ['text', 'multimodal'] : []);
    }
    assert.equal(f.secrets.values.size, 1);
    assert.equal((await f.model('chat-duplicate')).statusCode, 409);
    assert.equal((await f.model('chat-a', 'chat', { name: '改名' })).statusCode, 201);
    assert.equal((await f.model('chat-b', 'chat', { modelId: 'another-vendor-model' })).statusCode, 201);
    assert.ok(await resolveProfile(f.database, f.secrets, 'llm', 'chat-a'));
    assert.equal(await resolveProfile(f.database, f.secrets, 'llm', 'embed-a'), null);
    assert.equal(await resolveProfile(f.database, f.secrets, 'image', 'chat-a'), null);
    assert.equal(await resolveProfile(f.database, f.secrets, 'vector'), null, 'an embedding-only API cannot become the default vector index service');
    assert.ok(await resolveProfile(f.database, f.secrets, 'vector', 'embed-a'));
    const token = f.seedApp();
    const route = await f.app.inject({ method: 'PUT', url: '/api/v1/admin/model-routes', headers: f.headers,
      payload: { scope: 'public', capability: 'text', primaryModelId: 'chat-a', fallbackModelIds: [], inheritPublicFallbacks: false } });
    assert.equal(route.statusCode, 201, route.body);
    assert.equal((await resolveAppLlmBindingStatus(f.database, f.secrets, 'test-app', 'text')).status, 'ready');
    assert.equal((await resolveRoutedProfiles(f.database, f.secrets, 'test-app', 'text'))[0].id, 'chat-a');
    const wrongRoute = await f.app.inject({ method: 'PUT', url: '/api/v1/admin/model-routes', headers: f.headers,
      payload: { scope: 'public', capability: 'text', primaryModelId: 'embed-a', fallbackModelIds: [], inheritPublicFallbacks: false } });
    assert.equal(wrongRoute.statusCode, 400);
    const inference = await f.post('models/chat-a/test', {});
    assert.equal(inference.json().success, true, inference.body);
    const multimodalRoute = await f.app.inject({ method: 'PUT', url: '/api/v1/admin/model-routes', headers: f.headers,
      payload: { scope: 'public', capability: 'multimodal', primaryModelId: 'chat-a', fallbackModelIds: [], inheritPublicFallbacks: false } });
    assert.equal(multimodalRoute.statusCode, 201);
    for (const content of ['public text call', [{ type: 'text', text: 'public vision call' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]]) {
      const gateway = await f.app.inject({ method: 'POST', url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${token}` }, payload: { messages: [{ role: 'user', content }] } });
      assert.equal(gateway.statusCode, 200, gateway.body);
      assert.equal(gateway.json().choices[0].message.content, 'ok');
    }
  } finally { await f.app.close(); f.database.close(); }
});

test('model save checks the shared runtime contract after normalizing legacy vision; updates preserve omitted options', async () => {
  const f = fixture();
  try {
    await f.post('connections', f.connection);
    assert.equal((await f.model('schema-model', 'chat', { capabilities: ['text', 'vision'], contextLength: 10000, timeoutMs: 8765 })).statusCode, 201);
    const updated = await f.post('models', { id: 'schema-model', connectionId: 'shared', name: '新名称', modelId: 'one-vendor-model' });
    assert.equal(updated.statusCode, 201, updated.body);
    assert.deepEqual(updated.json().capabilities, ['text', 'multimodal']);
    assert.equal(updated.json().timeoutMs, 8765);
    assert.equal(updated.json().contextLength, 10000);
    for (const invalid of [{ capabilities: ['audio'] }, { capabilities: [] }, { modelType: 'audio' }, { modelType: 123 },
      { enabled: 'true' }, { contextLength: '123' }, { timeoutMs: 2 }, { defaultParams: [] }, { advancedJson: null },
      { name: 'x'.repeat(161) }, { modelId: 'x'.repeat(501) }]) {
      const result = await f.model('schema-model', 'chat', invalid);
      assert.equal(result.statusCode, 400, JSON.stringify(invalid));
    }
    for (const missing of ['id', 'connectionId', 'name', 'modelId']) {
      const input: Record<string, unknown> = { id: 'schema-model', connectionId: 'shared', name: 'model', modelId: 'one-vendor-model', capabilities: ['text'] };
      delete input[missing];
      assert.equal((await f.post('models', input)).statusCode, 400, missing);
    }
    assert.equal((await f.model('schema-model', 'embedding', { capabilities: [] })).statusCode, 201);
    assert.equal((await f.post('models/schema-model/test', {})).json().success, false, 'a failed embedding test must not try chat');
    assert.equal((await f.model('schema-model', 'embedding', { enabled: false })).statusCode, 201);
    assert.equal((await f.post('models/schema-model/test', {})).statusCode, 409);
  } finally { await f.app.close(); f.database.close(); }
});

test('references guard primary/fallback, purpose and character models, while supplier edits preserve projections', async () => {
  const f = fixture();
  try {
    await f.post('connections', f.connection);
    f.seedApp();
    for (const id of ['primary', 'fallback', 'purpose', 'character']) await f.model(id, 'chat', { modelId: id });
    const route = await f.app.inject({ method: 'PUT', url: '/api/v1/admin/model-routes', headers: f.headers,
      payload: { scope: 'public', capability: 'multimodal', primaryModelId: 'primary', fallbackModelIds: ['fallback'], inheritPublicFallbacks: false } });
    assert.equal(route.statusCode, 201, route.body);
    f.database.connection.prepare(`INSERT INTO purpose_bindings VALUES ('purpose-ref','test-app','planning','model','purpose',0,?)`).run(nowIso());
    f.database.connection.prepare(`INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,created_at,updated_at)
      VALUES ('char','char','角色','{}','[]',?,?)`).run(nowIso(), nowIso());
    f.database.connection.prepare(`INSERT INTO character_model_assignments VALUES ('char','multimodal','character',?)`).run(nowIso());
    for (const id of ['primary', 'fallback', 'purpose', 'character']) {
      for (const changes of [{ enabled: false }, { modelType: 'embedding' }, { modelId: 'different-model' }, { capabilities: ['text'] }]) {
        assert.equal((await f.model(id, 'chat', { modelId: id, ...changes })).statusCode, 409, `${id} ${JSON.stringify(changes)}`);
      }
      const deletion = await f.app.inject({ method: 'DELETE', url: `/api/v1/admin/models/${id}`, headers: f.headers });
      assert.equal(deletion.statusCode, 409);
      assert.ok(deletion.json().references.length > 0);
    }
    await f.post('connections', { ...f.connection, id: 'other' });
    assert.equal((await f.model('primary', 'chat', { connectionId: 'other', modelId: 'primary' })).statusCode, 409);
    const oldKey = f.secrets.values.get('conn:shared');
    assert.equal((await f.post('connections', { ...f.connection, enabled: false, secret: 'must-not-replace-key' })).statusCode, 409);
    assert.equal(f.secrets.values.get('conn:shared'), oldKey, 'rejected edits must not mutate shared credentials');
    assert.equal((await f.post('connections', { ...f.connection, kind: 'vector' })).statusCode, 409);
    assert.equal((await f.post('connections', { ...f.connection, kind: 'openai-compatible-text' })).statusCode, 409);
    assert.equal((await f.post('connections', { ...f.connection, baseUrl: 'https://changed.invalid/v1', headers: { 'X-Tenant': 'new' }, options: { vendor: 'new' } })).statusCode, 201);
    const projection = f.database.connection.prepare('SELECT base_url,credential_account FROM provider_profiles WHERE id=?').get('primary')!;
    assert.equal(projection.base_url, 'https://changed.invalid/v1');
    const options = f.database.connection.prepare('SELECT * FROM provider_profile_options WHERE profile_id=?').get('primary')!;
    assert.deepEqual(JSON.parse(String(options.headers_json)), { 'X-Tenant': 'new' });
    assert.equal(JSON.parse(String(options.extra_body_json)).vendor, 'new');
    assert.equal((await resolveCharacterLlmBindingStatus(f.database, f.secrets, 'char', 'multimodal')).status, 'ready');
    // Status and runtime reject stale legacy projections after an external state change.
    f.database.connection.prepare("UPDATE service_connections SET enabled=0 WHERE id='shared'").run();
    assert.equal(await resolveProfile(f.database, f.secrets, 'llm', 'character'), null);
    assert.equal((await resolveCharacterLlmBindingStatus(f.database, f.secrets, 'char', 'multimodal')).status, 'profile_disabled');
    f.database.connection.prepare("UPDATE service_connections SET enabled=1 WHERE id='shared'").run();
    f.database.connection.prepare("UPDATE model_profiles SET model_type='embedding' WHERE id IN ('primary','character')").run();
    assert.equal((await resolveAppLlmBindingStatus(f.database, f.secrets, 'test-app', 'multimodal')).status, 'capability_mismatch');
    assert.equal((await resolveCharacterLlmBindingStatus(f.database, f.secrets, 'char', 'multimodal')).status, 'capability_mismatch');
  } finally { await f.app.close(); f.database.close(); }
});

test('embedding validates batches, ordering and upstream payloads, and cannot leak into the default vector service', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  let result: unknown = { data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }] };
  const f = fixture(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    assert.ok(init?.signal);
    return Response.json(result);
  });
  try {
    await f.post('connections', f.connection);
    await f.model('embed-a', 'embedding');
    await f.model('chat-a');
    const embeddings = await embedWithModel(f.database, f.secrets, 'embed-a', ['a', 'b'], async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return Response.json(result);
    });
    assert.deepEqual(embeddings.embeddings, [[1, 2], [3, 4]]);
    assert.equal(calls[0].url, 'https://shared.invalid/v1/embeddings');
    assert.deepEqual(calls[0].body, { model: 'one-vendor-model', input: ['a', 'b'] });
    assert.equal(calls[0].headers.get('authorization'), 'Bearer shared-test-key');
    assert.equal(calls[0].headers.get('X-Tenant'), 'tenant');
    assert.ok(f.secrets.reads.some(read => read.env === 'STHSTART_SECRET_SHARED'));
    const count = calls.length;
    await assert.rejects(embedWithModel(f.database, f.secrets, 'chat-a', 'a', fetch), /embedding_model_unavailable/);
    await assert.rejects(embedWithModel(f.database, f.secrets, 'embed-a', [''], fetch), /invalid_embedding_input/);
    assert.equal(calls.length, count);
    for (const invalid of [{ data: [] }, { data: [{ index: 0, embedding: [] }] }, { data: [{ index: 2, embedding: [1] }] },
      { data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }] },
      { data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [2, 3] }] }]) {
      await assert.rejects(embedWithModel(f.database, f.secrets, 'embed-a', ['a', 'b'], async () => Response.json(invalid)), /invalid_embedding_response/);
    }
    const token = f.seedApp();
    const embed = (profile?: string, path = 'embed') => f.app.inject({ method: 'POST', url: `/api/v1/vector/${path}`,
      headers: { authorization: `Bearer ${token}`, ...(profile ? { 'x-sthstart-profile': profile } : {}) }, payload: { text: 'a', namespace: 'notes' } });
    result = { data: [{ index: 0, embedding: [1, 2] }] };
    assert.deepEqual((await embed('embed-a')).json(), { embeddings: [[1, 2]] });
    const beforeRejections = calls.length;
    assert.equal((await embed('chat-a')).statusCode, 400);
    assert.equal((await embed('unknown')).statusCode, 409);
    assert.equal((await embed('embed-a', 'search')).statusCode, 400);
    await f.model('embed-a', 'embedding', { enabled: false });
    assert.equal((await embed('embed-a')).statusCode, 503);
    assert.equal(calls.length, beforeRejections, 'invalid explicit selections must never call the default service');
    result = { embeddings: [[7, 8]] };
    await embed();
    assert.equal(calls.at(-1)?.url, 'http://vector.invalid/embed');
    await f.post('connections', { ...f.connection, id: 'vector', kind: 'vector', baseUrl: 'https://legacy-vector.invalid' });
    await f.model('legacy-embed', 'embedding', { connectionId: 'vector' });
    assert.equal((await f.post('models/legacy-embed/test', {})).json().success, true);
    assert.equal(calls.at(-1)?.url, 'https://legacy-vector.invalid/embed');
    assert.deepEqual(calls.at(-1)?.body, { text: '连接测试' });
    assert.equal((await f.model('invalid-vector-chat', 'chat', { connectionId: 'vector' })).statusCode, 400);
  } finally { await f.app.close(); f.database.close(); }
});

test('migration 61 preserves v60 models, connections, assignments, workflows and business data', () => {
  const connection = new DatabaseSync(':memory:');
  try {
    connection.exec('PRAGMA foreign_keys=ON');
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS.filter(m => m.version <= 60), 'service');
    const now = nowIso();
    for (const [id, kind] of [['text', 'openai-compatible-text'], ['image', 'openai-compatible-image'], ['vector', 'vector'], ['comfy', 'comfyui'], ['worker', 'worker']]) {
      connection.prepare(`INSERT INTO service_connections(id,name,kind,base_url,credential_account,headers_json,options_json,enabled,created_at,updated_at)
        VALUES (?,?,?,?,?,'{"X-Tenant":"keep"}','{"custom":"keep"}',1,?,?)`).run(id, id, kind, `https://${id}.invalid`, `account-${id}`, now, now);
      connection.prepare(`INSERT INTO model_profiles(id,connection_id,name,model_id,capabilities_json,context_length,max_output_tokens,default_params_json,advanced_json,thinking_level,timeout_ms,enabled,created_at,updated_at)
        VALUES (?,?,?,?,'["text","multimodal"]',9999,888,'{"temperature":0.1}','{"keep":true}','high',6543,1,?,?)`).run(id, id, id, `${id}-vendor`, now, now);
      connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
        VALUES (?,?,?, ?,?,?,1,?,?)`).run(id, id, id === 'text' ? 'llm' : id === 'vector' ? 'vector' : 'image', `https://${id}.invalid`, `${id}-vendor`, `account-${id}`, now, now);
    }
    connection.prepare(`INSERT INTO managed_apps VALUES ('mig-app','应用','hash','["llm"]',1,?,?)`).run(now, now);
    connection.prepare(`INSERT INTO app_llm_assignments VALUES ('mig-app','text','text',?)`).run(now);
    connection.prepare(`INSERT INTO model_routes VALUES ('route','public','','text','text','[]',0,?,?)`).run(now, now);
    connection.prepare(`INSERT INTO purpose_bindings VALUES ('binding','mig-app','planning','model','text',0,?)`).run(now);
    connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,created_at,updated_at)
      VALUES ('old-engine','旧绘图','cloud','https://old.invalid',1,?,?)`).run(now, now);
    connection.prepare(`INSERT INTO generation_workflows(id,name,engine_kind,latest_version,created_at,updated_at)
      VALUES ('old-workflow','旧方案','cloud',1,?,?)`).run(now, now);
    connection.prepare(`INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,definition_json,is_published,created_at)
      VALUES ('old-workflow',1,'old-engine','{"type":"cloud_recipe","modelId":"old-vendor"}',1,?)`).run(now);
    connection.prepare(`INSERT INTO runtime_settings VALUES ('theme','{"mode":"warm"}',?)`).run(now);
    connection.prepare(`INSERT INTO creative_notes(id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at)
      VALUES ('note','旧笔记','idea','摘要','{"body":"保留原文"}','["标签"]','draft',1,?,?)`).run(now, now);
    const tables = ['model_profiles', 'service_connections', 'provider_profiles', 'managed_apps', 'app_llm_assignments', 'model_routes', 'purpose_bindings', 'generation_engines', 'generation_workflows', 'generation_workflow_versions', 'runtime_settings', 'creative_notes'];
    const before = tables.map(table => connection.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row })));
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'service');
    const types = { text: 'chat', image: 'image', vector: 'embedding', comfy: 'image', worker: 'image' };
    for (const [index, table] of tables.entries()) {
      const after = connection.prepare(`SELECT * FROM ${table}`).all().map(row => {
        const copy = { ...row };
        if (table === 'model_profiles') {
          assert.equal(copy.model_type, types[String(copy.id) as keyof typeof types]);
          delete copy.model_type;
        }
        if (table === 'generation_engines') { assert.equal(copy.connection_id, null); delete copy.connection_id; }
        return copy;
      });
      assert.deepEqual(after, before[index], `${table} must preserve all preexisting columns`);
    }
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(connection.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'service');
    assert.equal(connection.prepare('SELECT count(*) AS count FROM model_profiles').get()!.count, 5);
  } finally { connection.close(); }
});

test('legacy profile saves preserve each model type and remain resolvable through the strict runtime', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'legacy-models-test-admin-credential' });
  const app = Fastify();
  registerManagementRoutes(app, config, database, secrets, async () => { throw new Error('must_not_dispatch'); });
  const headers = { 'x-sthstart-admin-token': config.adminToken! };
  try {
    for (const [kind, modelType] of [['llm', 'chat'], ['vector', 'embedding'], ['image', 'image']] as const) {
      const payload = { id: `legacy-${kind}`, name: `旧配置 ${kind}`, kind, baseUrl: `https://${kind}.invalid/v1`, model: `vendor-${kind}`, secret: 'legacy-key' };
      const saved = await app.inject({ method: 'POST', url: '/api/v1/admin/profiles', headers, payload });
      assert.equal(saved.statusCode, 201, saved.body);
      const model = database.connection.prepare('SELECT * FROM model_profiles WHERE id=?').get(payload.id)!;
      assert.equal(model.model_type, modelType, `legacy ${kind} must retain its type`);
      const runtime = await resolveProfile(database, secrets, kind, payload.id);
      assert.ok(runtime, `legacy ${kind} must resolve`);
      assert.equal(runtime.model, payload.model);
      assert.equal(runtime.secret, 'legacy-key');
      assert.equal(await resolveProfile(database, secrets, kind === 'llm' ? 'image' : 'llm', payload.id), null);
    }
  } finally { await app.close(); database.close(); }
});
