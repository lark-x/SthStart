import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanseHtmlText, cleanseCharacterDraft } from './cleanse.js';

test('cleanseHtmlText removes span tags and converts br to newline', () => {
  const dirty = '普通攻击：<span style="color:#FFD780FF">地心·磐礴</span>。<br/>造成<span style="color:#FFFFFFFF">岩元素伤害</span>。';
  const clean = cleanseHtmlText(dirty);
  assert.equal(clean, '普通攻击：地心·磐礴。\n造成岩元素伤害。');
});

test('cleanseCharacterDraft cleans recursively across nested objects and arrays', () => {
  const dirtyDraft = {
    displayName: '钟离',
    identity: '你是岩王帝君。<br/><span style="color:#123456">技能</span>',
    personality: ['冷静<br/>沉稳', '<span style="foo">博古通今</span>'],
    details: {
      world: '提瓦特<br/>璃月',
    },
  };
  const cleaned = cleanseCharacterDraft(dirtyDraft);
  assert.deepEqual(cleaned, {
    displayName: '钟离',
    identity: '你是岩王帝君。\n技能',
    personality: ['冷静\n沉稳', '博古通今'],
    details: {
      world: '提瓦特\n璃月',
    },
  });
});
