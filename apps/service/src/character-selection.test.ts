import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCharacterVersionSelection, EMPTY_CHARACTER_DRAFT_V2 } from '@sthstart/contracts';
import { ServiceDatabase } from './database.js';
import { publishCharacterSnapshot } from './characters/snapshots.js';
import { createActorSnapshotFromCharacter } from './activities/characters.js';
import { StoryStore } from './story/store.js';

test('story and activity consume the same frozen form and text-only costume, not edited live data', () => {
  const db = new ServiceDatabase();
  try {
    const draft = { ...EMPTY_CHARACTER_DRAFT_V2, displayName: '测试角色', summary: '身份', personaText: '主档案故事', appearance: { baseText: '白发', defaultOutfitText: '常服' } };
    db.connection.prepare(`INSERT INTO character_profiles(id,slug,display_name,draft_json,tags_json,variants_json,created_at,updated_at)
      VALUES ('selection','selection','测试角色',?,'[]',?,'now','now')`).run(JSON.stringify(draft), JSON.stringify([
        { id: 'armor', name: '装甲形态', variantKind: 'armor', personaText: '装甲经历', appearance: { baseText: '白发', defaultOutfitText: '战甲' } },
      ]));
    db.connection.prepare(`INSERT INTO character_assets(id,character_id,kind,category,title,metadata_json,created_at)
      VALUES ('costume','selection','reference','costume','夜宴',?,'now')`).run(JSON.stringify({outfitDescription:'蓝色礼服',loreStory:'夜宴服饰故事'}));
    const version = publishCharacterSnapshot(db, 'selection', { expectedDraftRevision: 1, versionLabel: '初始阶段' })!;
    assert.ok(version);
    db.connection.prepare("UPDATE character_profiles SET variants_json='[]',draft_json=? WHERE id='selection'").run(JSON.stringify({...draft,personaText:'后改正文'}));
    db.connection.prepare("DELETE FROM character_assets WHERE id='costume'").run();
    const selected = resolveCharacterVersionSelection(version, {variantId:'armor',costumeAssetId:'costume'});
    assert.match(selected.prompt, /装甲经历/); assert.match(selected.prompt, /夜宴服饰故事/);
    assert.equal(selected.appearance.defaultOutfitText, '蓝色礼服');
    assert.doesNotMatch(selected.prompt, /后改正文/);
    assert.equal(resolveCharacterVersionSelection(version).draft.personaText, '主档案故事');
    const actor = createActorSnapshotFromCharacter(db,'selection',{sourceVersion:1,sourceVariantId:'armor',sourceCostumeAssetId:'costume'})!;
    assert.match(String(actor.persona.personaText), /夜宴服饰故事/);
    assert.equal(actor.outfitDescription,'蓝色礼服'); assert.equal(actor.sourceVariantId,'armor');
    assert.equal(createActorSnapshotFromCharacter(db,'selection',{sourceVersion:1,sourceVariantId:'missing'}),null);
    const store = new StoryStore(db); const project = store.createProject({title:'作品'});
    const storyActor = store.createCharacter(project.id,{name:'角色',sourceCharacterId:'selection',sourceVersion:1,sourceVariantId:'armor',sourceCostumeAssetId:'costume'});
    assert.equal(storyActor.sourceCostumeAssetId,'costume');
    const source = store.getCharacterSourceSnapshot(storyActor) as {personaText:string;appearance:{defaultOutfitText:string}};
    assert.match(source.personaText,/装甲经历/); assert.match(source.personaText,/夜宴服饰故事/);
    assert.equal(source.appearance.defaultOutfitText,'蓝色礼服');
    assert.throws(()=>store.createCharacter(project.id,{name:'坏选择',sourceCharacterId:'selection',sourceVersion:1,sourceVariantId:'missing'}), /所选阶段/);
  } finally { db.close(); }
});
