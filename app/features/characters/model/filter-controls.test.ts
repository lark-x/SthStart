import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterFilterControls, characterFilterSelectPatch } from './filter-controls';

const facets = {
  works: [{ name: '原神', aliases: ['Genshin'], mediaType: '游戏' }],
  tags: ['水神', '枫丹'],
  groups: ['生日会'],
  interpretations: ['原作向'],
  sources: ['local'],
  birthdayMonths: [6],
};

test('one filter model keeps common controls and every existing select in a stable order', () => {
  const model = buildCharacterFilterControls({ page: 1, pageSize: 20 }, facets);
  assert.deepEqual(model.multi.map((control) => control.key), ['works', 'tags', 'groups']);
  assert.deepEqual(model.multi.map((control) => control.options.map((option) => option.value)), [
    ['原神'], ['水神', '枫丹'], ['生日会'],
  ]);
  assert.deepEqual(model.sections.map((section) => section.id), ['classification', 'birthday-sort']);
  assert.deepEqual(model.sections.flatMap((section) => section.selects.map((control) => control.key)), [
    'mediaType', 'originType', 'reference', 'appearance', 'interpretation', 'source',
    'unclassified', 'tagMode', 'birthdayStatus', 'birthdayMonth', 'sort',
  ]);
  assert.equal(model.favorite, false);
});

test('selected values remain visible when a facet page has not returned them yet', () => {
  const model = buildCharacterFilterControls({
    works: ['未返回的作品'],
    tags: ['临时标签'],
    groups: ['临时分组'],
    interpretation: '自定义演绎',
    source: 'manual',
    birthdayMonth: 12,
    favorite: true,
    page: 1,
    pageSize: 20,
  }, facets);
  const byKey = Object.fromEntries(model.multi.map((control) => [control.key, control]));
  assert.deepEqual(byKey.works.options.map((option) => option.value), ['原神', '未返回的作品']);
  assert.deepEqual(byKey.tags.options.map((option) => option.value), ['水神', '枫丹', '临时标签']);
  assert.deepEqual(byKey.groups.options.map((option) => option.value), ['生日会', '临时分组']);
  const selects = Object.fromEntries(model.sections.flatMap((section) => section.selects).map((control) => [control.key, control]));
  assert.equal(selects.interpretation.value, '自定义演绎');
  assert.equal(selects.source.value, 'manual');
  assert.equal(selects.source.options.find((option) => option.value === 'manual')?.label, '手动创建');
  assert.equal(selects.birthdayMonth.value, '12');
  assert.equal(model.favorite, true);
});

test('select patches clear on an empty choice and validate birthday month values', () => {
  assert.deepEqual(characterFilterSelectPatch('mediaType', '游戏'), { mediaType: '游戏' });
  assert.deepEqual(characterFilterSelectPatch('tagMode', ''), { tagMode: undefined });
  assert.deepEqual(characterFilterSelectPatch('birthdayMonth', '6'), { birthdayMonth: 6 });
  assert.deepEqual(characterFilterSelectPatch('birthdayMonth', '13'), { birthdayMonth: undefined });
  assert.deepEqual(characterFilterSelectPatch('birthdayMonth', 'not-a-month'), { birthdayMonth: undefined });
});
