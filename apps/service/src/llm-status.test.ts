import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';

/**
 * 模型绑定状态统一规则回归：
 * 能力声明、llm-status 接口、capabilities llmStatus 与任务创建预检共享同一套判定。
 */

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
    STHSTART_ADMIN_TOKEN: 'admin-test-token-that-is-long-12345678',
    STHSTART_IMAGE_SIGNING_SECRET: 'image-signing-test-secret-1234567890',
  });
}

const ADMIN = { 'x-sthstart-admin-token': 'admin-test-token-that-is-long-12345678' };

function seedProfile(database: ServiceDatabase, id: string, overrides: { model?: string | null; enabled?: number; capabilities?: string[] } = {}) {
  const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, `模型 ${id}`, 'llm', 'https://llm.example.test/v1', overrides.model === undefined ? 'test-model' : overrides.model, null, overrides.enabled === undefined ? 1 : overrides.enabled, now, now);
  database.connection.prepare('INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,?,?,?,?)')
    .run(id, 'omit', '{}', '{}', JSON.stringify(overrides.capabilities ?? ['text', 'multimodal']));
}

function assign(database: ServiceDatabase, appId: string, role: 'text' | 'multimodal', profileId: string | null) {
  if (!profileId) {
    database.connection.prepare('DELETE FROM app_llm_assignments WHERE app_id=? AND role=?').run(appId, role);
    return;
  }
  database.connection.prepare(`INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(app_id,role) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at`)
    .run(appId, role, profileId, nowIso());
}

test('activities 与 characters 启动后具备 llm 能力，已有绑定不受影响', async () => {
  const database = new ServiceDatabase();
  try {
    // 预置旧能力（缺失 llm）与既有绑定，模拟升级前的存量数据库。
    database.connection.prepare('INSERT INTO managed_apps VALUES (?,?,?,?,1,?,?)')
      .run('activities', '活动工作室', 'hash-activities', JSON.stringify(['generation', 'artifact', 'activities']), nowIso(), nowIso());
    assign(database, 'activities', 'text', null);
    const { app } = await createService({ config: testConfig(), database, secrets: new MemorySecrets() });
    await app.close();
    const row = database.connection.prepare('SELECT capabilities_json FROM managed_apps WHERE id=?').get('activities') as { capabilities_json: string };
    const capabilities = JSON.parse(row.capabilities_json) as string[];
    assert.ok(capabilities.includes('llm'), 'activities 必须声明 llm 能力');
    assert.ok(capabilities.includes('activities'), '原有能力必须保留');
    const charactersRow = database.connection.prepare('SELECT capabilities_json FROM managed_apps WHERE id=?').get('characters') as { capabilities_json: string };
    assert.ok((JSON.parse(charactersRow.capabilities_json) as string[]).includes('llm'));
  } finally {
    database.close();
  }
});

test('llm-status 对未绑定、停用、能力不匹配、缺模型 ID 返回细分状态', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: testConfig(), database, secrets: new MemorySecrets() });
  try {
    const statusOf = async (appId: string) => (await app.inject({ method: 'GET', url: `/api/v1/admin/apps/${appId}/llm-status`, headers: ADMIN })).json() as {
      appId: string; text: { status: string; ready: boolean; configurationPath: string; message: string | null };
    };

    // 未绑定
    const unassigned = await statusOf('activities');
    assert.equal(unassigned.text.status, 'unassigned');
    assert.equal(unassigned.text.ready, false);
    assert.equal(unassigned.text.configurationPath, '/settings/public-services?section=routing&app=activities');
    assert.ok(unassigned.text.message?.includes('尚未选择文本模型'));

    // 就绪
    seedProfile(database, 'prof-ok');
    assign(database, 'activities', 'text', 'prof-ok');
    const ready = await statusOf('activities');
    assert.equal(ready.text.status, 'ready');
    assert.equal(ready.text.ready, true);

    // 模板停用
    seedProfile(database, 'prof-off', { enabled: 0 });
    assign(database, 'activities', 'text', 'prof-off');
    const disabled = await statusOf('activities');
    assert.equal(disabled.text.status, 'profile_disabled');

    // 能力不匹配
    seedProfile(database, 'prof-mm', { capabilities: ['multimodal'] });
    assign(database, 'activities', 'text', 'prof-mm');
    const mismatch = await statusOf('activities');
    assert.equal(mismatch.text.status, 'capability_mismatch');

    // 缺模型 ID
    seedProfile(database, 'prof-nomodel', { model: null });
    assign(database, 'activities', 'text', 'prof-nomodel');
    const missingModel = await statusOf('activities');
    assert.equal(missingModel.text.status, 'model_missing');

    // 多模态角色单独判定：仅文本就绪时多模态仍未就绪，两者互不影响。
    assign(database, 'activities', 'text', 'prof-ok');
    assign(database, 'activities', 'multimodal', null);
    const roles = (await app.inject({ method: 'GET', url: '/api/v1/admin/apps/activities/llm-status', headers: ADMIN })).json() as Record<string, { ready: boolean }>;
    assert.equal(roles.text.ready, true);
    assert.equal(roles.multimodal.ready, false);

    // 不存在的应用返回 404
    const missing = await app.inject({ method: 'GET', url: '/api/v1/admin/apps/no-such-app/llm-status', headers: ADMIN });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
    database.close();
  }
});

test('capabilities 的 llm 与 llmStatus.ready 一致并返回真实模板名称', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: testConfig(), database, secrets: new MemorySecrets() });
  try {
    const before = (await app.inject({ method: 'GET', url: '/api/v1/admin/activities/capabilities', headers: ADMIN })).json() as { llm: boolean; llmProfile: unknown; llmStatus?: { ready: boolean; status: string } };
    assert.equal(before.llm, false);
    assert.equal(before.llmStatus?.status, 'unassigned');

    seedProfile(database, 'prof-cap', { capabilities: ['text'] });
    assign(database, 'activities', 'text', 'prof-cap');
    const after = (await app.inject({ method: 'GET', url: '/api/v1/admin/activities/capabilities', headers: ADMIN })).json() as {
      llm: boolean; llmProfile: { id: string; name: string } | null; llmStatus?: { ready: boolean };
    };
    assert.equal(after.llm, true);
    assert.equal(after.llmStatus?.ready, true);
    assert.equal(after.llmProfile?.id, 'prof-cap');
    assert.equal(after.llmProfile?.name, '模型 prof-cap');
  } finally {
    await app.close();
    database.close();
  }
});

test('企划任务在未绑定时返回 409 llm_not_ready 且不产生排队任务', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: testConfig(), database, secrets: new MemorySecrets() });
  try {
    // 先选一个角色以通过角色校验；这里直接插入一个最小角色。
    database.connection.prepare(`INSERT INTO character_profiles(id,slug,display_name,draft_json,draft_revision,archived,tags_json,created_at,updated_at)
      VALUES (?,?,?,?,0,0,'[]',?,?)`).run('char-1', 'char-1', '测试角色', JSON.stringify({ displayName: '测试角色' }), nowIso(), nowIso());
    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: ADMIN,
      payload: { form: { characters: [{ characterId: 'char-1' }] } },
    });
    assert.equal(created.statusCode, 201);
    const sessionId = (created.json() as { session: { id: string } }).session.id;

    const response = await app.inject({ method: 'POST', url: `/api/v1/admin/activity-planning-sessions/${sessionId}/jobs`, headers: ADMIN, payload: {} });
    assert.equal(response.statusCode, 409);
    const body = response.json() as { error: string; configurationPath?: string; message?: string };
    assert.equal(body.error, 'llm_not_ready');
    assert.ok(body.configurationPath?.includes('app=activities'));
    const jobs = database.connection.prepare('SELECT COUNT(*) AS count FROM activity_planning_jobs').get() as { count: number };
    assert.equal(jobs.count, 0);
  } finally {
    await app.close();
    database.close();
  }
});
