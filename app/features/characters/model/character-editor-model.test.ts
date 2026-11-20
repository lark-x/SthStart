import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DRAFT_V2 } from '../schemas';
import { buildCharacterAvatarPrompt, characterDraftSnapshot, createCharacterVariant, effectiveCharacterDraft, saveCharacterStage } from './character-editor-model';
import type { CharacterDraftV2 } from '@sthstart/contracts';

const draft: CharacterDraftV2 = {
  ...EMPTY_DRAFT_V2,
  displayName: '芙宁娜',
  work: '原神',
  summary: '一句话概述',
  personaText: '人设正文',
  appearance: { baseText: '蓝白长发', defaultOutfitText: '' },
};

test('avatar prompt keeps draft order and skips empty fields', () => {
  assert.equal(
    buildCharacterAvatarPrompt(draft),
    '芙宁娜, 原神, 蓝白长发, 角色头像，突出面部特征，保持角色身份和服装一致',
  );
});

test('new variant copies editable text from the current draft and trims its name', () => {
  assert.deepEqual(createCharacterVariant('variant-1', '  雪山特训  ', draft), {
    id: 'variant-1',
    name: '雪山特训',
    variantKind: 'form',
    summary: '一句话概述',
    personaText: '人设正文',
    appearance: { baseText: '蓝白长发', defaultOutfitText: '' },
  });
});

test('selected variant overrides its own persona and outfit while inheriting identity and speech', () => {
  const result = effectiveCharacterDraft(draft, { id: 'sp', name: 'SP', variantKind: 'sp', summary: 'SP概要', personaText: 'SP完整故事', appearance: { baseText: '短发', defaultOutfitText: 'SP装甲' } });
  assert.equal(result.displayName, draft.displayName);
  assert.equal(result.speechText, draft.speechText);
  assert.equal(result.personaText, 'SP完整故事');
  assert.match(buildCharacterAvatarPrompt(result), /短发, SP装甲/);
  assert.equal(draft.personaText, '人设正文');
});

test('new variant preserves the selected kind', () => {
  assert.equal(createCharacterVariant('sp', 'SP形态', draft, 'sp').variantKind, 'sp');
});

test('failed or incomplete save never publishes an old stage', async () => {
  let published = false;
  for (const saved of [null, { id: 'c1', draftRevision: 0 }, { id: 'c1', draftRevision: NaN }]) {
    assert.equal(await saveCharacterStage({ prepare: async () => saved, publish: async () => { published = true; return 'old'; } }), null);
  }
  assert.equal(published, false);
});

test('stage publication receives exactly the revision from a successful complete session save', async () => {
  const calls: string[] = [];
  const result = await saveCharacterStage({
    prepare: async () => { calls.push('save'); return { id: 'current-source', draftRevision: 17 }; },
    publish: async saved => { calls.push('publish'); assert.deepEqual(saved, { id: 'current-source', draftRevision: 17 }); return 4; },
  });
  assert.deepEqual(calls, ['save', 'publish']);
  assert.equal(result, 4);
});

test('publication rejects revision conflicts instead of reporting stale success', async () => {
  await assert.rejects(saveCharacterStage({ prepare: async () => ({ id: 'c1', draftRevision: 2 }), publish: async () => { throw new Error('draft_revision_conflict'); } }), /draft_revision_conflict/);
});

test('snapshot changes when tags or variants change', () => {
  const base = characterDraftSnapshot({ displayName: '芙宁娜' }, [], []);
  assert.notEqual(base, characterDraftSnapshot({ displayName: '芙宁娜' }, ['水神'], []));
  assert.notEqual(base, characterDraftSnapshot({ displayName: '芙宁娜' }, [], [{ id: 'v1', name: '形态' }]));
});
