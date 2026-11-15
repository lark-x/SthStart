import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCharacterFilterChips, hasCharacterFilters } from './filter-chips';

test('character filter chips expose one removable condition per value', () => {
  const filter = {
    q: '芙宁娜',
    works: ['原神', '枫丹'],
    tags: ['水神'],
    tagMode: 'all' as const,
    favorite: true,
    birthdayMonth: 6,
    page: 2,
    pageSize: 50,
  };
  const chips = activeCharacterFilterChips(filter);
  assert.equal(hasCharacterFilters(filter), true);
  assert.deepEqual(chips.map((chip) => chip.key), [
    'works:原神', 'works:枫丹', 'tags:水神', 'tagMode', 'q', 'favorite', 'birthdayMonth',
  ]);
  assert.deepEqual(chips[0].clear(), { works: ['枫丹'] });
  assert.deepEqual(chips.find((chip) => chip.key === 'favorite')?.clear(), { favorite: undefined });
  assert.deepEqual(chips.find((chip) => chip.key === 'birthdayMonth')?.clear(), { birthdayMonth: undefined });
});

test('plain paging has no chips and an empty filter is not considered filtered', () => {
  assert.equal(hasCharacterFilters({ page: 1, pageSize: 20 }), false);
  assert.equal(hasCharacterFilters({}), false);
  assert.deepEqual(activeCharacterFilterChips({}), []);
});
