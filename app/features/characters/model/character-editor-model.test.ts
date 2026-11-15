import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DRAFT_V2 } from '../schemas';
import { buildCharacterAvatarPrompt, characterDraftSnapshot, createCharacterVariant } from './character-editor-model';
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
    summary: '一句话概述',
    personaText: '人设正文',
    appearance: { baseText: '蓝白长发', defaultOutfitText: '' },
  });
});

test('snapshot changes when tags or variants change', () => {
  const base = characterDraftSnapshot({ displayName: '芙宁娜' }, [], []);
  assert.notEqual(base, characterDraftSnapshot({ displayName: '芙宁娜' }, ['水神'], []));
  assert.notEqual(base, characterDraftSnapshot({ displayName: '芙宁娜' }, [], [{ id: 'v1', name: '形态' }]));
});
