import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase, nowIso } from './database.js';
import { hashToken, issueToken, SecretStore } from './security.js';
import { readConfig } from './config.js';

const ADMIN_TOKEN = 'character-admin-test-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': ADMIN_TOKEN };
const testConfig = () => readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN });

function seedPersonaApp(database: ServiceDatabase) {
  const token = issueToken('character_test'); const now = nowIso();
  database.connection.prepare('INSERT INTO managed_apps VALUES (?,?,?,?,1,?,?)').run('character-test', 'Character test', hashToken(token), '["persona"]', now, now);
  database.connection.prepare("INSERT INTO storage_policies(app_id,mode) VALUES ('character-test','keep')").run();
  return token;
}

const draft = (name: string) => ({ displayName: name, identity: `${name}的身份`, summary: `${name}的摘要`, appearance: { description: `${name}的外观` }, personality: ['冷静'] });

test('character drafts publish immutable snapshots and route them to an authorized app', async () => {
  const database = new ServiceDatabase(); const token = seedPersonaApp(database);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  const first = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: { displayName: '阿澄', draft: draft('阿澄') } });
  const second = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: { displayName: '小满', draft: draft('小满') } });
  assert.equal(first.statusCode, 201); assert.equal(second.statusCode, 201);
  const firstId = first.json().id as string; const secondId = second.json().id as string;
  await app.inject({ method: 'PUT', url: `/api/v1/admin/characters/${firstId}/relationship`, headers: adminHeaders, payload: { toCharacterId: secondId, relationType: '朋友', description: '互相信赖' } });
  const published = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${firstId}/publish`, headers: adminHeaders });
  assert.equal(published.statusCode, 201); assert.equal(published.json().version, 1); assert.equal(published.json().relationships[0].relationType, '朋友');
  await app.inject({ method: 'PUT', url: `/api/v1/admin/characters/${firstId}`, headers: adminHeaders, payload: { draft: { ...draft('阿澄'), summary: '后来修改的草稿' } } });
  const remote = await app.inject({ method: 'GET', url: `/api/v1/characters/${firstId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(remote.statusCode, 200); assert.equal(remote.json().version.data.summary, '阿澄的摘要');
  const linked = await app.inject({ method: 'POST', url: '/api/v1/app-characters', headers: { authorization: `Bearer ${token}` }, payload: { characterId: firstId, localId: 'local-1' } });
  assert.equal(linked.statusCode, 201); assert.equal(linked.json().sourceVersion, 1);
  await app.close(); database.close();
});

test('Tavern Card V2 JSON imports into a structured editable draft and exports again', async () => {
  const database = new ServiceDatabase(); const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  const imported = await app.inject({ method: 'POST', url: '/api/v1/admin/characters/import-tavern', headers: adminHeaders, payload: { card: { spec: 'chara_card_v2', data: { name: '莉莉', description: '旅行中的炼金术师', personality: '好奇\n谨慎', scenario: '住在港口' } } } });
  assert.equal(imported.statusCode, 201); assert.equal(imported.json().draft.displayName, '莉莉'); assert.deepEqual(imported.json().draft.personality, ['好奇', '谨慎']);
  const exported = await app.inject({ method: 'GET', url: `/api/v1/admin/characters/${imported.json().id}/export-tavern`, headers: adminHeaders });
  assert.equal(exported.statusCode, 200); assert.equal(exported.json().spec, 'chara_card_v2'); assert.equal(exported.json().data.name, '莉莉');
  await app.close(); database.close();
});

test('legacy personas are migrated without losing their original prompt', async () => {
  const database = new ServiceDatabase(); const now = nowIso();
  database.connection.prepare('INSERT INTO personas VALUES (?,?,?,?,?,?,?)').run('legacy-role', '旧角色', '[]', 'legacy', 1, now, now);
  database.connection.prepare('INSERT INTO persona_versions VALUES (?,?,?,?,?,?,?,?)').run('legacy-role', 1, '旧角色', '原始完整人格', '黑发', null, '{}', now);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  const detail = await app.inject({ method: 'GET', url: '/api/v1/admin/characters/legacy-role', headers: adminHeaders });
  assert.equal(detail.statusCode, 200); assert.equal(detail.json().versions[0].compiledLinshePrompt, '原始完整人格');
  await app.close(); database.close();
});
