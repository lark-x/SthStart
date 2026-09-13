import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createService } from './server.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, nowIso, SERVICE_DATABASE_MIGRATIONS, ServiceDatabase } from './database.js';
import { hashToken, issueToken, SecretStore } from './security.js';
import { buildAuditionPrompt } from './characters/persona-compiler.js';
import { readConfig } from './config.js';
import { CHARACTER_PERSONA_COMPILER_VERSION, toCharacterRuntime } from '@sthstart/contracts';

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
  assert.equal(published.json().compilerVersion, CHARACTER_PERSONA_COMPILER_VERSION, '发布版本必须记录生成提示词的编译器版本');
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
  assert.equal(imported.statusCode, 201, imported.body);
  assert.equal(imported.json().draft.displayName, '莉莉');
  // 卡片导入后草稿已是 V2：卡片文本进入人设正文，不再有独立的 personality 细分字段。
  assert.match(toCharacterRuntime(imported.json().draft).personaText, /好奇/);
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

test('结构迁移后的原文归档可在来源里下载，迁移不丢旧文字', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sthstart-migration-archive-'));
  const databasePath = resolve(directory, 'sthstart.db');
  const originalV1 = {
    displayName: '归档角色',
    summary: '归档摘要',
    identity: '原始身份文字',
    personality: ['原始性格'],
    appearance: { description: '原始外观', hair: '银白长发', outfits: ['旧礼服', '旧常服'] },
    extraRules: '原始额外规则',
  };

  // 先造一个仍是 V1 结构的角色，模拟迁移前的真实库。
  const before = new ServiceDatabase(databasePath);
  const now = nowIso();
  before.connection.prepare(`INSERT INTO character_profiles
    (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision)
    VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1)`)
    .run('archive-character', 'archive-character', '归档角色', JSON.stringify(originalV1), '[]', now, now);
  before.close();

  // 跑真实的迁移脚本（apply 会写库，所以先对临时副本执行）。
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  execFileSync(process.execPath, [resolve(repositoryRoot, 'scripts/character-model-migration.mjs'), 'apply', '--db', databasePath], { cwd: repositoryRoot, stdio: 'pipe' });

  const database = new ServiceDatabase(databasePath);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  try {
    const detail = await app.inject({ method: 'GET', url: '/api/v1/admin/characters/archive-character', headers: adminHeaders });
    assert.equal(detail.statusCode, 200, detail.body);
    const migrated = detail.json().draft;
    assert.equal(migrated.schemaVersion, 2, '迁移后草稿应升级为 V2');
    const runtime = toCharacterRuntime(migrated);
    for (const original of ['原始身份文字', '原始性格', '原始外观', '银白长发', '原始额外规则', '归档摘要']) {
      assert.ok(JSON.stringify(migrated).includes(original), `迁移后应保留原文：${original}`);
    }
    assert.equal(runtime.appearance.defaultOutfitText, '旧礼服', '默认穿着取旧的第一套');

    const archive = (detail.json().sources as Array<Record<string, unknown>>)
      .find((source) => source.sourceType === 'migration_archive');
    assert.ok(archive, '迁移归档必须出现在角色来源里');
    assert.ok(archive.sourceSnapshotId, '归档来源必须能定位到快照');

    const raw = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/characters/archive-character/source-snapshots/${archive.sourceSnapshotId}/raw`,
      headers: adminHeaders,
    });
    assert.equal(raw.statusCode, 200, raw.body);
    assert.match(String(raw.headers['content-type']), /application\/json/);
    const recovered = JSON.parse(raw.body);
    assert.equal(recovered.identity, '原始身份文字', '归档必须能还原旧字段原文');
    assert.deepEqual(recovered.appearance.outfits, ['旧礼服', '旧常服'], '未生效的旧服装必须可恢复');
    assert.deepEqual(recovered.personality, ['原始性格']);
  } finally {
    await app.close();
    database.close();
  }
});

test('非空服装表不会被静默删除：先中止并给出归档入口，归档后才允许升级', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sthstart-outfit-guard-'));
  const databasePath = resolve(directory, 'sthstart.db');

  // 造一个「迁移 19」状态的库：已有 character_outfits，但还没跑 20/21。
  const seeded = new DatabaseSync(databasePath);
  seeded.exec('PRAGMA foreign_keys = ON');
  migrateDatabase(seeded, SERVICE_DATABASE_MIGRATIONS.filter((migration) => migration.version <= 19), 'service');
  const now = nowIso();
  seeded.prepare(`INSERT INTO character_profiles
    (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision)
    VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1)`)
    .run('outfit-character', 'outfit-character', '换装角色', JSON.stringify({ displayName: '换装角色', identity: '换装角色的身份' }), '[]', now, now);
  seeded.prepare('INSERT INTO character_outfits VALUES (?,?,?,?,?,?,?,?)')
    .run('outfit-1', 'outfit-character', '常服', '深蓝礼服与礼帽', '{}', 0, '2026-01-01T00:00:00.000Z', now);
  seeded.prepare('INSERT INTO character_outfits VALUES (?,?,?,?,?,?,?,?)')
    .run('outfit-2', 'outfit-character', '披风', '银白披风', '{}', 1, '2026-01-02T00:00:00.000Z', now);
  seeded.close();

  // 未归档就升级：必须在删表前中止，且表与数据都还在。
  assert.throws(() => new ServiceDatabase(databasePath), /character_outfits/);

  const inspect = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal((inspect.prepare('SELECT COUNT(*) AS count FROM character_outfits').get() as { count: number }).count, 2, '中止后服装行必须原样保留');
  inspect.close();

  // 走归档入口：脚本先归档服装行，之后迁移才可以删除该表。
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const output = execFileSync(process.execPath, [resolve(repositoryRoot, 'scripts/character-model-migration.mjs'), 'apply', '--db', databasePath, '--json'], { cwd: repositoryRoot, encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.outfitRows, 2);
  assert.equal(report.outfitDefaultsApplied, 1, '启用中的服装应成为默认穿着');

  const database = new ServiceDatabase(databasePath);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  try {
    const detail = await app.inject({ method: 'GET', url: '/api/v1/admin/characters/outfit-character', headers: adminHeaders });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(
      toCharacterRuntime(detail.json().draft).appearance.defaultOutfitText,
      '银白披风',
      '启用中的旧服装应转为默认穿着',
    );

    const archive = (detail.json().sources as Array<Record<string, unknown>>)
      .find((source) => source.sourceType === 'migration_archive' && source.title === '迁移前服装原文');
    assert.ok(archive, '服装归档必须出现在角色来源里');
    const raw = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/characters/outfit-character/source-snapshots/${archive.sourceSnapshotId}/raw`,
      headers: adminHeaders,
    });
    assert.equal(raw.statusCode, 200, raw.body);
    const outfits = JSON.parse(raw.body) as Array<Record<string, unknown>>;
    assert.equal(outfits.length, 2, '两条旧服装都要可恢复');
    assert.deepEqual(outfits.map((outfit) => outfit.label), ['常服', '披风']);
  } finally {
    await app.close();
    database.close();
  }
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

test('迁移复核入口能列出待确认角色，并显示旧多套服装与当前穿着', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sthstart-migration-review-'));
  const databasePath = resolve(directory, 'sthstart.db');
  const originalV1 = {
    displayName: '待复核角色',
    summary: '摘要',
    identity: '身份文字',
    personality: ['性格甲'],
    // 外观描述里夹带服装词 + 单独的发型字段 → ambiguous_appearance；配饰 → accessory_placement。
    appearance: { description: '她穿着黑色礼服', hair: '银白长发', eyes: '蓝瞳', outfits: ['旧礼服', '旧常服'], accessories: ['胸针'] },
    extraRules: '旧额外规则',
  };

  // 造一个迁移前的 V1 角色，再跑真实迁移脚本，最后用服务接口查复核项。
  const before = new ServiceDatabase(databasePath);
  const now = nowIso();
  before.connection.prepare(`INSERT INTO character_profiles
    (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision)
    VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1)`)
    .run('review-character', 'review-character', '待复核角色', JSON.stringify(originalV1), '[]', now, now);
  // 另一个已升级、但没有迁移冲突的角色，用来验证列表只列真正有待确认项的角色。
  before.connection.prepare(`INSERT INTO character_profiles
    (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision)
    VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1)`)
    .run('clean-character', 'clean-character', '无冲突角色', JSON.stringify({ schemaVersion: 2, displayName: '无冲突角色', englishName: '', aliases: [], originType: 'original', work: '', summary: '', personaText: '正文', speechText: '', dialogueExamples: [], behaviorRules: '', appearance: { baseText: '', defaultOutfitText: '' } }), '[]', now, now);
  before.close();

  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  execFileSync(process.execPath, [resolve(repositoryRoot, 'scripts/character-model-migration.mjs'), 'apply', '--db', databasePath], { cwd: repositoryRoot, stdio: 'pipe' });

  const database = new ServiceDatabase(databasePath);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  try {
    const detail = await app.inject({ method: 'GET', url: '/api/v1/admin/characters/review-character/migration-review', headers: adminHeaders });
    assert.equal(detail.statusCode, 200, detail.body);
    const review = detail.json();
    assert.equal(review.hasArchive, true);
    assert.ok(review.archivedAt, '应记录归档时间');

    const kinds = (review.conflicts as Array<{ kind: string }>).map((conflict) => conflict.kind);
    assert.ok(kinds.includes('ambiguous_appearance'), '整体描述夹带服装应被标记复核');
    assert.ok(kinds.includes('accessory_placement'), '配饰归属应被标记复核');
    assert.ok(kinds.includes('mixed_extra_rules'), '旧额外规则应被标记复核');
    for (const conflict of review.conflicts as Array<{ detail: string }>) {
      assert.ok(conflict.detail.length > 0, '每条复核项都要有人能看懂的解释');
    }

    // 旧多套服装要可恢复：未生效的那套也要看得到。
    assert.deepEqual(review.archivedOutfits, ['旧礼服', '旧常服']);
    assert.equal(review.current.defaultOutfitText, '旧礼服', '第一套作为当前默认穿着');
    assert.ok(String(review.current.baseText).includes('银白长发'));

    // 复核项是只读推导，不因查看而改变草稿。
    const after = await app.inject({ method: 'GET', url: '/api/v1/admin/characters/review-character', headers: adminHeaders });
    assert.equal(after.json().draftRevision, review.draftRevision);

    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/character-migration-reviews', headers: adminHeaders });
    assert.equal(list.statusCode, 200, list.body);
    const ids = (list.json().items as Array<{ characterId: string }>).map((item) => item.characterId);
    assert.deepEqual(ids, ['review-character'], '列表只包含仍有复核项的角色');
    assert.equal(list.json().total, 1);

    // 没有迁移归档的角色也能查，明确返回「无归档」而不是报错。
    const clean = await app.inject({ method: 'GET', url: '/api/v1/admin/characters/clean-character/migration-review', headers: adminHeaders });
    assert.equal(clean.statusCode, 200, clean.body);
    assert.equal(clean.json().hasArchive, false);
    assert.deepEqual(clean.json().conflicts, []);
  } finally {
    await app.close();
    database.close();
  }
});

test('试演提示词使用统一上下文，并只建议 V2 草稿里真实存在的字段', () => {
  const prompt = buildAuditionPrompt({
    schemaVersion: 2,
    displayName: '试演角色',
    englishName: 'Audition',
    aliases: [],
    originType: 'ip',
    work: '试演作品',
    summary: '摘要',
    personaText: '### 身份\n港口城市的仲裁者',
    speechText: '语气：冷静克制',
    dialogueExamples: ['示例：先看完证据再说结论。'],
    behaviorRules: '不代替其他参与者做决定',
    appearance: { baseText: '银白长发', defaultOutfitText: '深色风衣' },
  }, '有人迟到了十分钟，角色会怎么说？');

  // 与活动、邻舍导出共享同一份角色语义。
  assert.ok(prompt.includes('港口城市的仲裁者'), '人设正文应进入试演提示词');
  assert.ok(prompt.includes('冷静克制'), '说话方式应进入试演提示词');
  assert.ok(prompt.includes('不代替其他参与者做决定'), '行为约束应进入试演提示词');
  assert.ok(prompt.includes('银白长发'), '外观应进入试演提示词');

  // 建议路径必须是 V2 字段，不能让用户拿到 V2 编辑器里不存在的 V1 路径。
  assert.equal(prompt.includes('/speech/tone'), false, '不得再建议 V1 路径');
  assert.equal(prompt.includes('/personality'), false, '不得再建议 V1 路径');
  assert.ok(prompt.includes('/speechText'));
  assert.ok(prompt.includes('/personaText'));
  assert.ok(prompt.includes('/appearance/baseText'));
  assert.ok(prompt.includes('/appearance/defaultOutfitText'));
});
