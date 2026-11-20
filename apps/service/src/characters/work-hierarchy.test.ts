import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorldDefinition } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { normalizeCharacterDraft } from './draft.js';
import { publishCharacterSnapshot } from './snapshots.js';
import { browseCharacters, characterWorks, editCharacterOrganization, repairCharacterWorkHierarchy, upsertCharacterWorkHierarchy } from './organization.js';

function definition(title: string): WorldDefinition {
  return {
    title, workNature: 'original', parentWork: null, summary: '', timeLabel: '',
    locations: [{ id: 'port', name: '港口', description: '' }],
    actors: [{ id: 'a', name: '甲', role: 'main', characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'port', referenceArtifactIds: [] }],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  };
}
function insertCharacter(database: ServiceDatabase, id: string, work: string, originType = 'original', appearance: unknown = {}) {
  const draft = { ...normalizeCharacterDraft({ displayName: id, work, originType, summary: '角色摘要' }), appearance };
  database.connection.prepare(`INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision)
    VALUES (?,?,?,?, '[]',0,'now','now',1)`).run(id, id, id, JSON.stringify(draft));
  return draft;
}

test('world rename keeps one work identity and migrates current references while old snapshots stay frozen', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new StoryWorldStore(database);
    const mother = store.create({ ...definition('旧母作'), workNature: 'canon' });
    insertCharacter(database, 'ip-card', '旧母作', 'ip');
    publishCharacterSnapshot(database, 'ip-card', { allowIncomplete: true });
    const child = store.create({ ...definition('同人港口'), workNature: 'derivative', parentWork: '旧母作' });
    const pending = store.createSetup({ title: '未完成同人', workNature: 'derivative', parentWork: '旧母作', idempotencyKey: 'pending' });
    const updated = store.updateWorld(mother.id, { expectedRevision: mother.revision, definition: { ...definition('新母作'), workNature: 'canon' } });
    const works = characterWorks(database);
    assert.equal(works.filter(work => work.worldId === mother.id).length, 1);
    assert.equal(works.some(work => work.name === '旧母作'), false);
    assert.ok(works.find(work => work.name === '新母作')?.aliases.includes('旧母作'));
    assert.equal(works.find(work => work.name === child.title)?.parentWork, '新母作');
    assert.equal(store.getWorld(child.id).parentWork, '新母作');
    assert.equal(store.getWorld(child.id).revision, child.revision + 1);
    assert.equal(store.getSetup(pending.id).draft.definition.parentWork, '新母作');
    const profile = database.connection.prepare('SELECT draft_json,latest_version FROM character_profiles WHERE id=?').get('ip-card')!;
    assert.equal(JSON.parse(String(profile.draft_json)).work, '新母作');
    assert.equal(Number(profile.latest_version), 2);
    assert.equal(JSON.parse(String(database.connection.prepare('SELECT data_json FROM character_versions WHERE character_id=? AND version=1').get('ip-card')!.data_json)).work, '旧母作');
    assert.equal(browseCharacters(database, { works: ['旧母作'] }).total, 1);
    assert.equal(updated.title, '新母作');
  } finally { database.close(); }
});

test('repair merges proven same-world remnants idempotently and rejects names owned by another world', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new StoryWorldStore(database);
    const world = store.create(definition('当前名'));
    database.connection.prepare(`INSERT INTO character_works(name,aliases_json,media_type,work_nature,parent_work,world_id,summary)
      VALUES ('残留旧名','["旧别名"]','','original',NULL,?,'')`).run(world.id);
    insertCharacter(database, 'old-card', '残留旧名');
    assert.equal(repairCharacterWorkHierarchy(database, world.id)?.name, '当前名');
    assert.equal(database.connection.prepare('SELECT count(*) n FROM character_works WHERE world_id=?').get(world.id)!.n, 1);
    assert.equal(JSON.parse(String(database.connection.prepare('SELECT draft_json FROM character_profiles WHERE id=?').get('old-card')!.draft_json)).work, '当前名');
    assert.ok(repairCharacterWorkHierarchy(database, world.id)?.aliases.includes('旧别名'));
    assert.equal(database.connection.prepare('SELECT draft_revision FROM character_profiles WHERE id=?').get('old-card')!.draft_revision, 2);
    const other = store.create(definition('别人的作品'));
    assert.throws(() => store.updateWorld(world.id, { expectedRevision: world.revision, definition: definition(other.title) }), { code: 'character_work_conflict' });
    assert.equal(store.getWorld(world.id).title, world.title);
    assert.equal(characterWorks(database).filter(work => work.worldId === world.id).length, 1);
  } finally { database.close(); }
});

test('mother work validation resolves aliases and rejects missing, self, derivative and circular ancestry', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const child = upsertCharacterWorkHierarchy(database, { name: '甲同人', workNature: 'derivative', parentWork: '星铁' });
    assert.equal(child.parentWork, '崩坏：星穹铁道');
    assert.throws(() => upsertCharacterWorkHierarchy(database, { name: '空母作', workNature: 'derivative' }), { code: 'character_parent_work_required' });
    assert.throws(() => upsertCharacterWorkHierarchy(database, { name: '无母作', workNature: 'derivative', parentWork: '不存在' }), { code: 'character_parent_work_missing' });
    assert.throws(() => upsertCharacterWorkHierarchy(database, { name: '自己', workNature: 'derivative', parentWork: '自己' }), { code: 'character_work_cycle' });
    assert.throws(() => upsertCharacterWorkHierarchy(database, { name: '乙同人', workNature: 'derivative', parentWork: '甲同人' }), { code: 'character_parent_work_invalid' });
    assert.throws(() => upsertCharacterWorkHierarchy(database, { name: '崩坏：星穹铁道', workNature: 'derivative', parentWork: '原神' }), { code: 'character_work_cycle' });
    assert.equal(characterWorks(database).find(work => work.name === '崩坏：星穹铁道')?.workNature, 'canon');
    const store = new StoryWorldStore(database);
    assert.throws(() => store.create({ ...definition('原神'), workNature: 'original' }), { code: 'character_work_conflict' });
    assert.equal(characterWorks(database).find(work => work.name === '原神')?.workNature, 'canon');
  } finally { database.close(); }
});

test('browse reads V2 appearance with legacy fallback and work nature never falls back across classified works', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    insertCharacter(database, 'v2', '原神', 'ip', { baseText: '银色短发' });
    insertCharacter(database, 'v1', '原神', 'ip', { description: '蓝色外套' });
    insertCharacter(database, 'empty-v2', '原神', 'ip', { baseText: '', description: '陈旧重复字段' });
    insertCharacter(database, 'unclassified', '', 'derivative');
    assert.equal(browseCharacters(database, { appearance: 'yes' }).total, 2);
    assert.equal(browseCharacters(database, { appearance: 'no' }).total, 2);
    assert.deepEqual(browseCharacters(database, { workNature: 'derivative' }).rows.map(row => row.id), ['unclassified']);
    assert.equal(browseCharacters(database, { workNature: 'original' }).total, 0);
  } finally { database.close(); }
});

test('batch classification publishes new IP and derivative snapshots atomically while originals stay staged', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    for (const origin of ['ip', 'derivative', 'original']) insertCharacter(database, origin, '原神', origin);
    editCharacterOrganization(database, { ids: ['ip', 'derivative', 'original'], work: '星铁' });
    for (const id of ['ip', 'derivative']) {
      const version = database.connection.prepare('SELECT data_json FROM character_versions WHERE character_id=?').get(id)!;
      assert.equal(JSON.parse(String(version.data_json)).work, '崩坏：星穹铁道');
    }
    assert.equal(database.connection.prepare('SELECT count(*) n FROM character_versions WHERE character_id=?').get('original')!.n, 0);
    assert.throws(() => editCharacterOrganization(database, { ids: ['ip', 'missing'], work: '原神' }));
    assert.equal(database.connection.prepare('SELECT count(*) n FROM character_versions WHERE character_id=?').get('ip')!.n, 1);
  } finally { database.close(); }
});

test('editing a linked directory updates current world classification with revision conflicts preserved', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const store = new StoryWorldStore(database);
    const world = store.create(definition('目录编辑作品'));
    const branch = store.createBranch(world.id, { title: '历史主线', mode: 'alternate', direction: '', expectedRevision: 1 });
    upsertCharacterWorkHierarchy(database, { name: world.title, worldId: world.id, workNature: 'derivative', parentWork: '星铁' });
    const current = store.getWorld(world.id);
    assert.equal(current.workNature, 'derivative');
    assert.equal(current.parentWork, '崩坏：星穹铁道');
    assert.equal(current.revision, world.revision + 1);
    assert.equal(store.definitionAtTick(world.id, branch.id, 0).workNature, 'original');
    assert.throws(() => store.updateWorld(world.id, { expectedRevision: 1, definition: definition('过时更新') }), { code: 'story_world_revision_conflict' });
    assert.equal(characterWorks(database).find(work => work.worldId === world.id)?.name, world.title);
  } finally { database.close(); }
});

test('reclassifying a derivative as a main card clears both family links and publishes its current state', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    insertCharacter(database, 'root', '原神', 'ip');
    const draft = insertCharacter(database, 'child', '原神', 'derivative');
    database.connection.prepare('UPDATE character_profiles SET parent_character_id=?,draft_json=? WHERE id=?')
      .run('root', JSON.stringify({ ...draft, parentCharacterId: 'root' }), 'child');
    editCharacterOrganization(database, { ids: ['child'], originType: 'ip' });
    const row = database.connection.prepare('SELECT draft_json,parent_character_id,latest_version FROM character_profiles WHERE id=?').get('child')!;
    assert.equal(row.parent_character_id, null);
    assert.equal(JSON.parse(String(row.draft_json)).parentCharacterId, undefined);
    assert.equal(row.latest_version, 1);
    assert.equal(browseCharacters(database, { collapseDerivatives: true }).total, 2);
  } finally { database.close(); }
});
