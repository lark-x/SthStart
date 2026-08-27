import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
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

test('character avatar generation uses the common task and applies a central artifact', async () => {
  const database = new ServiceDatabase();
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-character-avatar-'));
  const config = readConfig({ STHSTART_ADMIN_TOKEN: ADMIN_TOKEN, STHSTART_ARTIFACT_DIR: artifactDirectory });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: { displayName: '头像角色', draft: draft('头像角色') } });
  assert.equal(created.statusCode, 201);
  const characterId = created.json().id as string;
  const unassigned = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${characterId}/generate-avatar`, headers: adminHeaders });
  assert.equal(unassigned.statusCode, 409);
  assert.equal(unassigned.json().error, 'generation_assignment_not_found');

  const now = nowIso(); const engineId = 'character-avatar-engine'; const workflowId = 'character-avatar-workflow'; const taskId = 'character-avatar-task'; const artifactId = 'character-avatar-artifact';
  database.connection.prepare('INSERT INTO generation_engines VALUES (?,?,?,?,?,?,?,?,?)').run(engineId, 'Avatar Engine', 'comfyui', 'http://comfy.test', null, 1, 1, now, now);
  database.connection.prepare('INSERT INTO generation_workflows (id,name,description,engine_kind,category,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(workflowId, 'Avatar Workflow', '', 'comfyui', 'image', 1, now, now);
  database.connection.prepare('INSERT INTO generation_workflow_versions (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(workflowId, 1, engineId, '{}', '{}', '[]', JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }), 1, now);
  database.connection.prepare('INSERT INTO app_generation_assignments VALUES (?,?,?,?,?,?)').run('characters', 'character-avatar', workflowId, 1, engineId, now);
  const assetDir = resolve(artifactDirectory, 'characters'); await mkdir(assetDir, { recursive: true }); const filePath = resolve(assetDir, `${artifactId}.png`); await writeFile(filePath, Buffer.from('avatar-bytes'));
  database.connection.prepare(`INSERT INTO generation_tasks
    (id,app_id,engine_id,workflow_id,workflow_version,purpose,idempotency_key,request_hash,request_params_json,workflow_snapshot_json,actual_seed,status,provider_task_id,error_code,error_message,upstream_may_continue,cancellation_scope,retry_of,created_at,updated_at,priority,progress_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'succeeded',NULL,NULL,NULL,0,'none',NULL,?,?,?,?)`).run(taskId, 'characters', engineId, workflowId, 1, 'character-avatar', null, 'hash', JSON.stringify({ inputs: { characterId } }), '{}', 123, now, now, 'interactive', JSON.stringify({ value: 1, stage: 'completed' }));
  database.connection.prepare(`INSERT INTO artifacts
    (id,app_id,task_id,provider_url,local_path,content_type,byte_size,sha256,file_status,original_name,media_type,width,height,duration_ms,fps,codec,has_audio,thumbnail_artifact_id,metadata_json,pinned,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'ready',?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(artifactId, 'characters', taskId, null, filePath, 'image/png', 12, 'hash', 'avatar.png', 'image', 1, 1, null, null, null, 0, null, '{}', now, now);
  database.connection.prepare('INSERT INTO generation_task_artifacts VALUES (?,?,?,?,?)').run(taskId, artifactId, 'default', 0, now);

  const task = await app.inject({ method: 'GET', url: `/api/v1/admin/characters/${characterId}/generation-tasks/${taskId}`, headers: adminHeaders });
  assert.equal(task.statusCode, 200); assert.equal(task.json().artifacts[0].artifactId, artifactId);
  const applied = await app.inject({ method: 'POST', url: `/api/v1/admin/characters/${characterId}/generation-tasks/${taskId}/apply-avatar`, headers: adminHeaders });
  assert.equal(applied.statusCode, 201);
  const stored = database.connection.prepare('SELECT avatar_asset_id FROM character_profiles WHERE id=?').get(characterId) as { avatar_asset_id: string };
  const asset = database.connection.prepare('SELECT artifact_id FROM character_assets WHERE id=?').get(stored.avatar_asset_id) as { artifact_id: string };
  assert.equal(asset.artifact_id, artifactId);
  const served = await app.inject({ method: 'GET', url: `/api/v1/admin/characters/assets/${stored.avatar_asset_id}`, headers: adminHeaders });
  assert.equal(served.statusCode, 200); assert.equal(served.body, 'avatar-bytes');
  assert.equal(database.connection.prepare("SELECT COUNT(*) count FROM artifact_references WHERE artifact_id=? AND app_id='characters' AND ref_type='character-avatar'").get(artifactId)!.count, 1);
  await app.close(); database.close();
});
