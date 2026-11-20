import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityDocument, normalizeCharacterDraftV2, type ActivityPlanningFormExtended, type CharacterVariant } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { publishCharacterSnapshot } from '../characters/snapshots.js';
import { ActivityStore } from './store.js';
import { ActivityPlanningStore, createPlanningSession, resolvePlanningActor, type PlanningServiceOptions } from './planning.js';

const form = (): ActivityPlanningFormExtended => ({ templateId: 'blank', title: '企划', type: '', theme: '', location: '', rules: '', scheduledDate: null, characters: [], birthdayCharacterIds: [] });
function fixture() {
  const database = new ServiceDatabase(':memory:');
  const options: PlanningServiceOptions = { database, config: readConfig({}), secrets: new SecretStore({}), store: new ActivityStore(database) };
  return { database, options };
}
function insertOriginal(database: ServiceDatabase, id: string) {
  const draft = normalizeCharacterDraftV2({ displayName: id, originType: 'original', personaText: '最初的人设', appearance: { baseText: '最初外貌' } });
  database.connection.prepare(`INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,archived,created_at,updated_at,draft_revision)
    VALUES (?,?,?,?,'[]',0,'now','now',1)`).run(id, id, id, JSON.stringify(draft));
  return draft;
}
function pendingSession(database: ServiceDatabase) {
  const document = buildActivityDocument({ templateId: 'blank', title: '待补企划', type: '', theme: '', location: '', rules: '', actors: [], birthdayActorIds: [], scheduledDate: null });
  document.actors.push({ id: 'pending', displayName: '待补人物', personaStatus: 'pending', candidateRefId: 'missing', persona: {}, activityRole: '', outfitDescription: '', appearanceReferenceAssetKeys: [] });
  return new ActivityPlanningStore(database).createSession({ form: form(), document, characters: [] });
}

test('planning refuses live original drafts and freezes the chosen stage, variant and costume', () => {
  const { database, options } = fixture();
  try {
    const draft = insertOriginal(database, 'original');
    assert.throws(() => createPlanningSession(options, { form: { ...form(), characters: [{ characterId: 'original' }] } }), { code: 'character_stage_required' });
    const variant: CharacterVariant = { id: 'awake', name: '觉醒', summary: '觉醒摘要', personaText: '觉醒后的想法', appearance: { baseText: '红色长发', defaultOutfitText: '' } };
    database.connection.prepare('UPDATE character_profiles SET variants_json=? WHERE id=?').run(JSON.stringify([variant]), 'original');
    database.connection.prepare(`INSERT INTO character_assets(id,character_id,kind,category,title,tags_json,metadata_json,created_at)
      VALUES ('skin','original','reference','costume','礼服','[]',?,'now')`).run(JSON.stringify({ outfitDescription: '黑色礼服', loreStory: '庆典记忆' }));
    publishCharacterSnapshot(database, 'original', { versionLabel: '初醒', expectedDraftRevision: 1 });
    database.connection.prepare('UPDATE character_profiles SET draft_json=?,variants_json=? WHERE id=?')
      .run(JSON.stringify({ ...draft, personaText: '未保存的修改' }), '[]', 'original');
    const response = createPlanningSession(options, { form: { ...form(), characters: [{ characterId: 'original', version: 1, variantId: 'awake', costumeAssetId: 'skin' }] } });
    const actor = response.session.document.actors[0];
    assert.equal(actor.sourceVersion, 1);
    assert.equal(actor.sourceVariantId, 'awake');
    assert.equal(actor.sourceCostumeAssetId, 'skin');
    assert.match(JSON.stringify(actor.persona), /觉醒后的想法/);
    assert.doesNotMatch(JSON.stringify(actor.persona), /未保存的修改/);
    assert.equal(actor.outfitDescription, '黑色礼服');
    assert.equal(response.session.form.characters[0].variantId, 'awake');
    assert.equal(response.session.characters[0].sourceCostumeAssetId, 'skin');
    assert.throws(() => createPlanningSession(options, { form: { ...form(), characters: [{ characterId: 'original', version: null }] } }), { code: 'character_stage_required' });
  } finally { database.close(); }
});

test('persona resolution explicitly saves a named original stage and rolls back incomplete new cards', () => {
  const { database, options } = fixture();
  try {
    const session = pendingSession(database);
    const input = { mode: 'persona' as const, displayName: '新原创', persona: { originType: 'original', summary: '旅行者', personaText: '谨慎而热心。' } };
    assert.throws(() => resolvePlanningActor(options, session.id, 'pending', input), { code: 'character_stage_required' });
    assert.equal(database.connection.prepare('SELECT count(*) n FROM character_profiles').get()!.n, 0);
    const saved = resolvePlanningActor(options, session.id, 'pending', { ...input, versionLabel: '初到港口' });
    assert.ok(saved.createdCharacterId);
    const actor = saved.session.document.actors[0];
    assert.equal(actor.sourceVersion, 1);
    assert.equal(actor.sourceVersionStatus, 'published');
    assert.equal(database.connection.prepare('SELECT version_label FROM character_versions WHERE character_id=?').get(saved.createdCharacterId!)!.version_label, '初到港口');
    const second = pendingSession(database);
    assert.throws(() => resolvePlanningActor(options, second.id, 'pending', { ...input, persona: { originType: 'original' }, versionLabel: '空阶段' }), { code: 'character_incomplete' });
    assert.equal(database.connection.prepare('SELECT count(*) n FROM character_profiles').get()!.n, 1);
    assert.equal(new ActivityPlanningStore(database).getSession(second.id)!.document.actors[0].personaStatus, 'pending');
  } finally { database.close(); }
});

test('matching pending actors preserves a selected saved stage and refuses an original with none', () => {
  const { database, options } = fixture();
  try {
    insertOriginal(database, 'original');
    const session = pendingSession(database);
    assert.throws(() => resolvePlanningActor(options, session.id, 'pending', { mode: 'match', characterId: 'original' }), { code: 'character_stage_required' });
    publishCharacterSnapshot(database, 'original', { versionLabel: '第一阶段' });
    const saved = resolvePlanningActor(options, session.id, 'pending', { mode: 'match', characterId: 'original', version: 1 });
    assert.equal(saved.session.document.actors[0].sourceVersion, 1);
  } finally { database.close(); }
});
