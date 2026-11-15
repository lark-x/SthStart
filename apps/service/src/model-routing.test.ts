import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SERVICE_DATABASE_MIGRATIONS, ServiceDatabase, migrateDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { resolveAssignedLlmProfile, resolveEffectiveModelProfile, resolveProfile, resolveRoutedProfiles } from './providers.js';
import { SecretStore } from './security.js';
import { createService } from './server.js';
import { getModelRoute } from './model-routing.js';

const ADMIN_TOKEN = 'route-admin-test-token-0123456789abcdef';
const ADMIN = { 'x-sthstart-admin-token': ADMIN_TOKEN };

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

function testConfig() {
  return readConfig({
    STHSTART_ADMIN_TOKEN: ADMIN_TOKEN,
    STHSTART_IMAGE_SIGNING_SECRET: 'route-image-secret-0123456789abcdef',
  });
}

function ensureApp(database: ServiceDatabase, id: string, name = id) {
  const now = nowIso();
  database.connection.prepare(`
    INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,1,?,?)
  `).run(id, name, `hash-${id}`, JSON.stringify(['llm', 'vector', 'image', 'artifact', 'persona', 'logs']), now, now);
}

interface SeedModelOptions {
  capabilities?: string[];
  modelEnabled?: boolean;
  connectionEnabled?: boolean;
  connectionKind?: string;
  withProvider?: boolean;
  providerEnabled?: boolean;
  credentialAccount?: string | null;
  thinkingLevel?: 'auto' | 'off' | 'low' | 'medium' | 'high';
  timeoutMs?: number | null;
  connectionTimeoutMs?: number;
  modelId?: string;
  baseUrl?: string;
}

function seedCanonicalModel(database: ServiceDatabase, id: string, options: SeedModelOptions = {}) {
  const now = nowIso();
  const connectionId = `conn-${id}`;
  const capabilities = options.capabilities ?? ['text'];
  const modelEnabled = options.modelEnabled ?? true;
  const connectionEnabled = options.connectionEnabled ?? true;
  const baseUrl = options.baseUrl ?? `https://${id}.test/v1`;
  const modelId = options.modelId ?? `${id}-upstream`;
  database.connection.prepare(`
    INSERT INTO service_connections
      (id,name,kind,base_url,credential_account,timeout_ms,headers_json,options_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,base_url=excluded.base_url,credential_account=excluded.credential_account,
      timeout_ms=excluded.timeout_ms,enabled=excluded.enabled,updated_at=excluded.updated_at
  `).run(
    connectionId, `${id} 连接`, options.connectionKind ?? 'openai-compatible-text', baseUrl,
    options.credentialAccount ?? null, options.connectionTimeoutMs ?? 60000, '{}', '{}',
    connectionEnabled ? 1 : 0, now, now,
  );
  database.connection.prepare(`
    INSERT INTO model_profiles
      (id,connection_id,name,model_id,capabilities_json,context_length,max_output_tokens,
       default_params_json,advanced_json,thinking_level,timeout_ms,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,NULL,NULL,'{}','{}',?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      connection_id=excluded.connection_id,model_id=excluded.model_id,capabilities_json=excluded.capabilities_json,
      thinking_level=excluded.thinking_level,timeout_ms=excluded.timeout_ms,enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `).run(
    id, connectionId, `${id} 模型`, modelId, JSON.stringify(capabilities),
    options.thinkingLevel ?? 'auto', options.timeoutMs ?? null,
    modelEnabled ? 1 : 0, now, now,
  );
  if (options.withProvider !== false) {
    database.connection.prepare(`
      INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        kind=excluded.kind,base_url=excluded.base_url,model=excluded.model,
        credential_account=excluded.credential_account,enabled=excluded.enabled,updated_at=excluded.updated_at
    `).run(
      id, `${id} 模型`, 'llm', baseUrl, modelId, options.credentialAccount ?? null,
      (options.providerEnabled ?? (modelEnabled && connectionEnabled)) ? 1 : 0, now, now,
    );
    database.connection.prepare(`
      INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json)
      VALUES (?,'omit','{}','{}',?)
      ON CONFLICT(profile_id) DO UPDATE SET capabilities_json=excluded.capabilities_json
    `).run(id, JSON.stringify(capabilities));
  }
}

function seedLegacyProvider(
  database: ServiceDatabase,
  id: string,
  options: { capabilities?: string[]; enabled?: boolean; model?: string } = {},
) {
  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,NULL,?,?,?)
    ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at
  `).run(id, `${id} 旧模型`, 'llm', `https://${id}.test/v1`, options.model ?? `${id}-upstream`,
    options.enabled === false ? 0 : 1, now, now);
  database.connection.prepare(`
    INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json)
    VALUES (?,'omit','{}','{}',?)
    ON CONFLICT(profile_id) DO UPDATE SET capabilities_json=excluded.capabilities_json
  `).run(id, JSON.stringify(options.capabilities ?? ['text']));
}

function saveRoute(
  database: ServiceDatabase,
  scope: 'public' | 'app',
  appId: string | null,
  capability: 'text' | 'multimodal',
  primaryModelId: string,
  fallbackModelIds: string[] = [],
  inheritPublicFallbacks = false,
  updatedAt = nowIso(),
) {
  const id = `route:${scope}:${appId ?? ''}:${capability}`;
  database.connection.prepare(`
    INSERT INTO model_routes
      (id,scope,app_id,capability,primary_model_id,fallback_model_ids_json,inherit_public_fallbacks,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(scope,app_id,capability) DO UPDATE SET
      primary_model_id=excluded.primary_model_id,fallback_model_ids_json=excluded.fallback_model_ids_json,
      inherit_public_fallbacks=excluded.inherit_public_fallbacks,updated_at=excluded.updated_at
  `).run(id, scope, appId ?? '', capability, primaryModelId, JSON.stringify(fallbackModelIds),
    scope === 'app' && inheritPublicFallbacks ? 1 : 0, updatedAt, updatedAt);
}

test('migration 60 upgrades a v59 database without losing app, model, or business data', () => {
  const path = resolve(mkdtempSync(resolve(tmpdir(), 'sthstart-model-routing-')), 'v59.db');
  const connection = new DatabaseSync(path);
  try {
    connection.exec('PRAGMA foreign_keys = ON');
    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= 59), 'service');
    const now = '2026-01-01T00:00:00.000Z';
    ensureAppConnection(connection, 'mig-app-a', now);
    ensureAppConnection(connection, 'mig-app-b', now);
    ensureAppConnection(connection, 'mig-app-c', now);
    connection.prepare('INSERT INTO runtime_settings VALUES (?,?,?)').run('theme', '{"mode":"warm"}', now);
    connection.prepare(`
      INSERT INTO creative_notes(id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at)
      VALUES ('mig-note','旧业务笔记','idea','保留摘要','{"body":"原内容"}','["旧标签"]','draft',1,?,?)
    `).run(now, now);

    for (const [connectionId, kind, enabled] of [
      ['mig-conn-a', 'openai-compatible-text', 1],
      ['mig-conn-b', 'openai-compatible-text', 1],
      ['mig-conn-vector', 'vector', 1],
    ] as const) {
      connection.prepare(`
        INSERT INTO service_connections
          (id,name,kind,base_url,credential_account,timeout_ms,headers_json,options_json,enabled,created_at,updated_at)
        VALUES (?,?,?,?,NULL,60000,'{}','{}',?,?,?)
      `).run(connectionId, connectionId, kind, `https://${connectionId}.test/v1`, enabled, now, now);
    }

    for (const [profileId, connectionId, modelId, capabilities, enabled] of [
      ['mig-model-a', 'mig-conn-a', 'upstream-a', '["text"]', 1],
      ['mig-model-b', 'mig-conn-b', 'upstream-b', '["multimodal"]', 0],
      ['mig-model-vector', 'mig-conn-vector', 'upstream-vector', '["text"]', 1],
    ] as const) {
      connection.prepare(`
        INSERT INTO model_profiles
          (id,connection_id,name,model_id,capabilities_json,context_length,max_output_tokens,
           default_params_json,advanced_json,test_status,last_tested_at,enabled,created_at,updated_at)
        VALUES (?,?,?,?,?,NULL,NULL,'{}','{"thinkingMode":"enabled","note":"keep"}','untested',NULL,?,?,?)
      `).run(profileId, connectionId, profileId, modelId, capabilities, enabled, now, now);
    }

    for (const id of ['mig-model-a', 'mig-model-b', 'mig-model-vector', 'legacy-provider-only']) {
      connection.prepare(`
        INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
        VALUES (?,?,'llm',?,?,NULL,1,?,?)
      `).run(id, id, `https://${id}.test/v1`, `${id}-upstream`, now, now);
      connection.prepare(`
        INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json)
        VALUES (?, 'omit', '{}', '{}', '["text","multimodal"]')
      `).run(id);
    }

    connection.prepare('INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,?,?,?)')
      .run('mig-app-a', 'text', 'mig-model-a', now);
    connection.prepare('INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,?,?,?)')
      .run('mig-app-a', 'multimodal', 'mig-model-b', now);
    connection.prepare('INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,?,?,?)')
      .run('mig-app-b', 'text', 'legacy-provider-only', now);
    connection.prepare('INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,?,?,?)')
      .run('mig-app-c', 'text', 'mig-model-vector', now);

    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'service');

    const migration = connection.prepare('SELECT version,name FROM schema_migrations WHERE version=60').get() as { version: number; name: string };
    assert.deepEqual({ ...migration }, { version: 60, name: 'model-routing-and-thinking' });
    const modelColumns = connection.prepare('PRAGMA table_info(model_profiles)').all() as Array<{ name: string }>;
    assert.ok(modelColumns.some((column) => column.name === 'thinking_level'));
    assert.ok(modelColumns.some((column) => column.name === 'timeout_ms'));

    const model = connection.prepare("SELECT * FROM model_profiles WHERE id='mig-model-a'").get() as Record<string, unknown>;
    assert.equal(model.model_id, 'upstream-a');
    assert.equal(model.thinking_level, 'auto');
    assert.equal(model.timeout_ms, null);
    assert.deepEqual(JSON.parse(String(model.advanced_json)), { thinkingMode: 'enabled', note: 'keep' });
    assert.deepEqual(JSON.parse(String((connection.prepare("SELECT value_json FROM runtime_settings WHERE key='theme'").get() as { value_json: string }).value_json)), { mode: 'warm' });
    const note = connection.prepare("SELECT * FROM creative_notes WHERE id='mig-note'").get() as Record<string, unknown>;
    assert.equal(note.title, '旧业务笔记');
    assert.equal(note.summary, '保留摘要');
    assert.equal(note.content_json, '{"body":"原内容"}');

    const assignments = connection.prepare('SELECT app_id,role,profile_id FROM app_llm_assignments ORDER BY app_id,role').all() as Array<Record<string, unknown>>;
    assert.deepEqual(assignments.map((row) => ({ ...row })), [
      { app_id: 'mig-app-a', role: 'multimodal', profile_id: 'mig-model-b' },
      { app_id: 'mig-app-a', role: 'text', profile_id: 'mig-model-a' },
      { app_id: 'mig-app-b', role: 'text', profile_id: 'legacy-provider-only' },
      { app_id: 'mig-app-c', role: 'text', profile_id: 'mig-model-vector' },
    ]);

    const routes = connection.prepare(`
      SELECT app_id,capability,primary_model_id,inherit_public_fallbacks,fallback_model_ids_json
      FROM model_routes ORDER BY app_id,capability
    `).all() as Array<{ app_id: string; capability: string; primary_model_id: string; inherit_public_fallbacks: number; fallback_model_ids_json: string }>;
    assert.deepEqual(routes.map((row) => ({ ...row })), [
      { app_id: 'mig-app-a', capability: 'multimodal', primary_model_id: 'mig-model-b', inherit_public_fallbacks: 0, fallback_model_ids_json: '[]' },
      { app_id: 'mig-app-a', capability: 'text', primary_model_id: 'mig-model-a', inherit_public_fallbacks: 0, fallback_model_ids_json: '[]' },
    ]);
    assert.equal(routes.some((route) => route.app_id === 'mig-app-b'), false, 'provider-only legacy rows do not fabricate model routes');
    assert.equal(routes.some((route) => route.app_id === 'mig-app-c'), false, 'non-text connections do not become LLM routes');
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(), []);

    migrateDatabase(connection, SERVICE_DATABASE_MIGRATIONS, 'service');
    assert.equal((connection.prepare('SELECT COUNT(*) AS count FROM model_routes').get() as { count: number }).count, 2);
  } finally {
    connection.close();
  }
});

function ensureAppConnection(connection: DatabaseSync, id: string, now: string) {
  connection.prepare(`
    INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,1,?,?)
  `).run(id, id, `hash-${id}`, JSON.stringify(['llm']), now, now);
}

test('route precedence keeps app choices and legacy assignments above the public route', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  try {
    ensureApp(database, 'precedence-app');
    ensureApp(database, 'public-only-app');
    ensureApp(database, 'legacy-public-app');
    for (const id of ['app-primary', 'app-fallback', 'public-primary', 'public-fallback', 'legacy-model']) {
      seedCanonicalModel(database, id);
    }
    saveRoute(database, 'public', null, 'text', 'public-primary', ['app-fallback', 'public-fallback']);
    saveRoute(database, 'app', 'precedence-app', 'text', 'app-primary', ['app-fallback'], true);

    let resolved = await resolveAssignedLlmProfile(database, secrets, 'precedence-app', 'text');
    assert.equal(resolved?.id, 'app-primary');
    assert.deepEqual((resolved?.fallbacks ?? []).map((profile) => profile.id), ['app-fallback', 'public-fallback']);

    // Public fallbacks that would duplicate the app primary are ignored.
    saveRoute(database, 'public', null, 'text', 'public-primary', ['app-primary', 'public-fallback']);
    saveRoute(database, 'app', 'precedence-app', 'text', 'app-primary', [], true);
    resolved = await resolveAssignedLlmProfile(database, secrets, 'precedence-app', 'text');
    assert.deepEqual((resolved?.fallbacks ?? []).map((profile) => profile.id), ['public-fallback']);

    saveRoute(database, 'app', 'precedence-app', 'text', 'app-primary', ['app-fallback'], false);
    resolved = await resolveAssignedLlmProfile(database, secrets, 'precedence-app', 'text');
    assert.deepEqual((resolved?.fallbacks ?? []).map((profile) => profile.id), ['app-fallback']);

    // A legacy screen write after migration remains authoritative without being
    // mistaken for the public default.
    database.connection.prepare(`
      INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('precedence-app','text','legacy-model','2099-01-01T00:00:00.000Z')
      ON CONFLICT(app_id,role) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at
    `).run();
    resolved = await resolveAssignedLlmProfile(database, secrets, 'precedence-app', 'text');
    assert.equal(resolved?.id, 'legacy-model');
    assert.equal(resolved?.fallbacks, undefined);

    const publicOnly = await resolveAssignedLlmProfile(database, secrets, 'public-only-app', 'text');
    assert.equal(publicOnly?.id, 'public-primary');
    assert.deepEqual((publicOnly?.fallbacks ?? []).map((profile) => profile.id), ['app-primary', 'public-fallback']);

    database.connection.prepare(`
      INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('legacy-public-app','text','legacy-model',?)
    `).run(nowIso());
    const legacyPublic = await resolveAssignedLlmProfile(database, secrets, 'legacy-public-app', 'text');
    assert.equal(legacyPublic?.id, 'legacy-model', 'legacy assignment must beat the public route');
  } finally {
    database.close();
  }
});

test('explicit model and purpose bindings stay above app and public routes', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  try {
    ensureApp(database, 'purpose-app');
    for (const id of ['route-model', 'explicit-model', 'purpose-model', 'mm-only']) {
      seedCanonicalModel(database, id, id === 'mm-only' ? { capabilities: ['multimodal'] } : {});
    }
    saveRoute(database, 'public', null, 'text', 'route-model');
    database.connection.prepare(`
      INSERT INTO purpose_bindings(id,app_id,purpose_key,target_type,target_id,inherit_app_default,updated_at)
      VALUES ('pb-purpose','purpose-app','planning','model','purpose-model',0,?)
    `).run(nowIso());

    const explicit = await resolveEffectiveModelProfile(database, secrets, 'purpose-app', 'planning', 'explicit-model');
    assert.equal(explicit?.id, 'explicit-model');
    const purpose = await resolveEffectiveModelProfile(database, secrets, 'purpose-app', 'planning');
    assert.equal(purpose?.id, 'purpose-model');
    const routed = await resolveEffectiveModelProfile(database, secrets, 'purpose-app', 'other-purpose');
    assert.equal(routed?.id, 'route-model');

    await assert.rejects(
      resolveEffectiveModelProfile(database, secrets, 'purpose-app', 'planning', 'mm-only'),
      /explicit_model_capability_mismatch/,
    );
    database.connection.prepare("UPDATE purpose_bindings SET target_id='mm-only' WHERE id='pb-purpose'").run();
    await assert.rejects(
      resolveEffectiveModelProfile(database, secrets, 'purpose-app', 'planning'),
      /purpose_model_capability_mismatch/,
    );
  } finally {
    database.close();
  }
});

test('invalid route profiles fail explicitly while invalid fallbacks are skipped', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  try {
    ensureApp(database, 'disabled-app');
    ensureApp(database, 'mismatch-app');
    ensureApp(database, 'fallback-app');
    ensureApp(database, 'empty-app');
    ensureApp(database, 'public-invalid-app');
    ensureApp(database, 'legacy-invalid-app');
    seedCanonicalModel(database, 'healthy-model');
    seedCanonicalModel(database, 'disabled-model', { modelEnabled: false });
    seedCanonicalModel(database, 'mm-model', { capabilities: ['multimodal'] });
    seedLegacyProvider(database, 'legacy-disabled', { enabled: false });

    saveRoute(database, 'app', 'disabled-app', 'text', 'disabled-model');
    await assert.rejects(
      resolveRoutedProfiles(database, secrets, 'disabled-app', 'text'),
      (error: unknown) => (error as { code?: string; reason?: string }).code === 'model_route_unavailable'
        && (error as { reason?: string }).reason === 'model_disabled',
    );

    saveRoute(database, 'app', 'mismatch-app', 'text', 'mm-model');
    await assert.rejects(
      resolveRoutedProfiles(database, secrets, 'mismatch-app', 'text'),
      (error: unknown) => (error as { reason?: string }).reason === 'capability_mismatch',
    );

    saveRoute(database, 'app', 'fallback-app', 'text', 'healthy-model', ['disabled-model', 'missing-model']);
    const fallback = await resolveRoutedProfiles(database, secrets, 'fallback-app', 'text');
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0].id, 'healthy-model');

    assert.deepEqual(await resolveRoutedProfiles(database, secrets, 'empty-app', 'text'), []);

    saveRoute(database, 'public', null, 'text', 'disabled-model');
    await assert.rejects(
      resolveRoutedProfiles(database, secrets, 'public-invalid-app', 'text'),
      (error: unknown) => (error as { reason?: string }).reason === 'model_disabled',
    );

    database.connection.prepare(`
      INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('legacy-invalid-app','text','legacy-disabled',?)
    `).run(nowIso());
    await assert.rejects(
      resolveRoutedProfiles(database, secrets, 'legacy-invalid-app', 'text'),
      (error: unknown) => (error as { code?: string; reason?: string }).code === 'model_route_unavailable'
        && (error as { reason?: string }).reason === 'legacy_assignment_unavailable',
    );
  } finally {
    database.close();
  }
});

test('model routes API validates and synchronizes app routes with legacy assignments', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const { app } = await createService({ config: testConfig(), database, secrets });
  try {
    ensureApp(database, 'route-api-app');
    ensureApp(database, 'route-api-other');
    for (const id of ['api-primary', 'api-fallback', 'api-fallback-2', 'api-fallback-3', 'api-public', 'api-public-mm', 'api-mm']) {
      seedCanonicalModel(database, id, id === 'api-mm' || id === 'api-public-mm' ? { capabilities: ['multimodal'] } : {});
    }
    seedCanonicalModel(database, 'api-sync-only', { withProvider: false });
    seedCanonicalModel(database, 'api-disabled', { modelEnabled: false });

    for (const request of [
      { method: 'GET' as const, url: '/api/v1/admin/model-routes' },
      { method: 'PUT' as const, url: '/api/v1/admin/model-routes', payload: { scope: 'public', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: [], inheritPublicFallbacks: false } },
      { method: 'DELETE' as const, url: '/api/v1/admin/model-routes/apps/route-api-app/text' },
      { method: 'POST' as const, url: '/api/v1/admin/model-routes/apply-public', payload: { capability: 'text' } },
      { method: 'GET' as const, url: '/api/v1/admin/models' },
      { method: 'DELETE' as const, url: '/api/v1/admin/models/api-public' },
    ]) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 401, `${request.method} ${request.url} requires admin auth`);
    }

    let response = await app.inject({
      method: 'PUT', url: '/api/v1/admin/model-routes', headers: ADMIN,
      payload: { scope: 'public', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: ['api-fallback'], inheritPublicFallbacks: false },
    });
    assert.equal(response.statusCode, 201);
    response = await app.inject({
      method: 'PUT', url: '/api/v1/admin/model-routes', headers: ADMIN,
      payload: { scope: 'public', capability: 'multimodal', primaryModelId: 'api-public-mm', fallbackModelIds: [], inheritPublicFallbacks: false },
    });
    assert.equal(response.statusCode, 201);
    response = await app.inject({
      method: 'PUT', url: '/api/v1/admin/model-routes', headers: ADMIN,
      payload: { scope: 'app', appId: 'route-api-app', capability: 'text', primaryModelId: 'api-sync-only', fallbackModelIds: ['api-fallback'], inheritPublicFallbacks: true },
    });
    assert.equal(response.statusCode, 201);
    response = await app.inject({
      method: 'PUT', url: '/api/v1/admin/model-routes', headers: ADMIN,
      payload: { scope: 'app', appId: 'route-api-app', capability: 'multimodal', primaryModelId: 'api-mm', fallbackModelIds: [], inheritPublicFallbacks: true },
    });
    assert.equal(response.statusCode, 201);

    const appRoute = getModelRoute(database, 'app', 'route-api-app', 'text');
    assert.equal(appRoute?.primaryModelId, 'api-sync-only');
    assert.equal((database.connection.prepare("SELECT model FROM provider_profiles WHERE id='api-sync-only'").get() as { model: string }).model, 'api-sync-only-upstream');
    assert.equal((database.connection.prepare("SELECT profile_id FROM app_llm_assignments WHERE app_id='route-api-app' AND role='text'").get() as { profile_id: string }).profile_id, 'api-sync-only');
    assert.equal((database.connection.prepare("SELECT profile_id FROM app_llm_assignments WHERE app_id='route-api-app' AND role='multimodal'").get() as { profile_id: string }).profile_id, 'api-mm');

    const listed = (await app.inject({ method: 'GET', url: '/api/v1/admin/model-routes', headers: ADMIN })).json() as { items: Array<{ scope: string; appId: string | null; capability: string }> };
    assert.equal(listed.items.length, 4);
    assert.ok(listed.items.some((route) => route.scope === 'public' && route.appId === null && route.capability === 'text'));
    assert.ok(listed.items.some((route) => route.scope === 'app' && route.appId === 'route-api-app' && route.capability === 'multimodal'));

    for (const payload of [
      { scope: 'app', appId: 'missing-app', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: [], inheritPublicFallbacks: false },
      { scope: 'public', appId: 'route-api-app', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: [], inheritPublicFallbacks: false },
      { scope: 'public', capability: 'text', primaryModelId: 'api-disabled', fallbackModelIds: [], inheritPublicFallbacks: false },
      { scope: 'public', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: ['api-disabled'], inheritPublicFallbacks: false },
      { scope: 'public', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: ['api-fallback', 'api-fallback-2', 'api-fallback-3'], inheritPublicFallbacks: false },
      { scope: 'public', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: ['api-public'], inheritPublicFallbacks: false },
      { scope: 'public', capability: 'text', primaryModelId: 'api-public', fallbackModelIds: [], inheritPublicFallbacks: 'yes' },
    ]) {
      const invalid = await app.inject({ method: 'PUT', url: '/api/v1/admin/model-routes', headers: ADMIN, payload });
      assert.equal(invalid.statusCode, 400, JSON.stringify(payload));
    }

    const appliedText = await app.inject({
      method: 'POST', url: '/api/v1/admin/model-routes/apply-public', headers: ADMIN, payload: { capability: 'text' },
    });
    assert.equal(appliedText.statusCode, 200);
    assert.ok(appliedText.json().removed >= 2);
    assert.equal(getModelRoute(database, 'app', 'route-api-app', 'text'), null);
    assert.equal(database.connection.prepare("SELECT 1 FROM app_llm_assignments WHERE app_id='route-api-app' AND role='text'").get(), undefined);
    assert.ok(getModelRoute(database, 'app', 'route-api-app', 'multimodal'), 'apply-public must not remove the other capability');
    assert.ok(database.connection.prepare("SELECT 1 FROM app_llm_assignments WHERE app_id='route-api-app' AND role='multimodal'").get());

    response = await app.inject({
      method: 'PUT', url: '/api/v1/admin/model-routes', headers: ADMIN,
      payload: { scope: 'app', appId: 'route-api-app', capability: 'text', primaryModelId: 'api-sync-only', fallbackModelIds: [], inheritPublicFallbacks: false },
    });
    assert.equal(response.statusCode, 201);
    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/admin/model-routes/apps/route-api-app/text', headers: ADMIN });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().inherited, true);
    assert.equal(getModelRoute(database, 'app', 'route-api-app', 'text'), null);
    assert.equal(database.connection.prepare("SELECT 1 FROM app_llm_assignments WHERE app_id='route-api-app' AND role='text'").get(), undefined);
    assert.ok(getModelRoute(database, 'app', 'route-api-app', 'multimodal'));

    const appliedMultimodal = await app.inject({
      method: 'POST', url: '/api/v1/admin/model-routes/apply-public', headers: ADMIN, payload: { capability: 'multimodal' },
    });
    assert.equal(appliedMultimodal.statusCode, 200);
    assert.equal(getModelRoute(database, 'app', 'route-api-app', 'multimodal'), null);
    assert.equal(database.connection.prepare("SELECT 1 FROM app_llm_assignments WHERE app_id='route-api-app' AND role='multimodal'").get(), undefined);
  } finally {
    await app.close();
    database.close();
  }
});

test('model deletion checks route JSON exactly and model tests never use route fallbacks', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.includes('test-target.test')) return new Response('boom', { status: 500 });
    return Response.json({
      choices: [{ message: { role: 'assistant', content: '连接成功' } }],
      usage: { total_tokens: 3 },
    });
  };
  const { app } = await createService({ config: testConfig(), database, secrets, fetcher });
  try {
    ensureApp(database, 'model-test-app');
    for (const id of ['m1', 'm2', 'm10', 'test-target', 'test-fallback', 'thinking-target', 'character-bound']) {
      seedCanonicalModel(database, id);
    }
    saveRoute(database, 'app', 'model-test-app', 'text', 'test-target', ['test-fallback']);
    saveRoute(database, 'public', null, 'text', 'm2', ['m10']);

    const deleteUnused = await app.inject({ method: 'DELETE', url: '/api/v1/admin/models/m1', headers: ADMIN });
    assert.equal(deleteUnused.statusCode, 200, '"m1" must not match the fallback "m10" by substring');

    const now = nowIso();
    database.connection.prepare(`
      INSERT INTO character_profiles
        (id,slug,display_name,draft_json,tags_json,latest_version,archived,created_at,updated_at)
      VALUES ('character-with-model','character-with-model','角色模型绑定','{}','[]',NULL,0,?,?)
    `).run(now, now);
    database.connection.prepare(`
      INSERT INTO character_model_assignments(character_id,role,profile_id,updated_at)
      VALUES ('character-with-model','text','character-bound',?)
    `).run(now);
    const deleteCharacterBound = await app.inject({
      method: 'DELETE', url: '/api/v1/admin/models/character-bound', headers: ADMIN,
    });
    assert.equal(deleteCharacterBound.statusCode, 409);
    assert.equal(deleteCharacterBound.json().error, 'model_in_use');
    assert.equal(deleteCharacterBound.json().characterAssignments[0].character_id, 'character-with-model');
    database.connection.prepare(
      "DELETE FROM character_model_assignments WHERE character_id='character-with-model'",
    ).run();
    const deleteReleasedModel = await app.inject({
      method: 'DELETE', url: '/api/v1/admin/models/character-bound', headers: ADMIN,
    });
    assert.equal(deleteReleasedModel.statusCode, 200);

    const deleteFallback = await app.inject({ method: 'DELETE', url: '/api/v1/admin/models/m10', headers: ADMIN });
    assert.equal(deleteFallback.statusCode, 409);
    assert.equal(deleteFallback.json().error, 'model_in_use');
    assert.ok(deleteFallback.json().routes.some((route: { capability: string }) => route.capability === 'text'));
    const deletePrimary = await app.inject({ method: 'DELETE', url: '/api/v1/admin/models/m2', headers: ADMIN });
    assert.equal(deletePrimary.statusCode, 409);

    const before = calls.length;
    const failedTest = await app.inject({
      method: 'POST', url: '/api/v1/admin/models/test-target/test', headers: ADMIN,
      payload: { prompt: 'test', type: 'text' },
    });
    assert.equal(failedTest.statusCode, 200);
    assert.equal(failedTest.json().success, false);
    assert.equal(calls.length - before, 1, 'the model test must not try the route fallback');
    assert.match(calls.at(-1)?.url ?? '', /test-target\.test/);

    const thinkingModel = database.connection.prepare("SELECT * FROM model_profiles WHERE id='thinking-target'").get() as Record<string, unknown>;
    assert.ok(thinkingModel);
    database.connection.prepare(`
      UPDATE model_profiles SET thinking_level='low', timeout_ms=1234 WHERE id='thinking-target'
    `).run();
    database.connection.prepare("UPDATE service_connections SET timeout_ms=4321 WHERE id='conn-thinking-target'").run();
    const success = await app.inject({
      method: 'POST', url: '/api/v1/admin/models/thinking-target/test', headers: ADMIN,
      payload: { prompt: 'test', type: 'text' },
    });
    assert.equal(success.statusCode, 200);
    assert.equal(success.json().success, true);
    const thinkingCall = calls.at(-1)!;
    assert.equal(thinkingCall.body.model, 'thinking-target-upstream');
    assert.equal(thinkingCall.body.reasoning_effort, 'low');
    assert.equal(thinkingCall.body.thinking, undefined);
    const resolvedThinking = await resolveProfile(database, secrets, 'llm', 'thinking-target');
    assert.equal(resolvedThinking?.timeoutMs, 1234, 'model timeout wins');

    seedCanonicalModel(database, 'connection-timeout-model', { timeoutMs: null, connectionTimeoutMs: 4321 });
    const resolvedConnectionTimeout = await resolveProfile(database, secrets, 'llm', 'connection-timeout-model');
    assert.equal(resolvedConnectionTimeout?.timeoutMs, 4321, 'connection timeout is the fallback');
  } finally {
    await app.close();
    database.close();
  }
});
