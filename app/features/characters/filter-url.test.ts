import test from 'node:test';
import assert from 'node:assert/strict';
import { characterFilterUrl, parseCharacterFilterParam } from './filter-url';

test('character URL filter restores valid paging and drops unsafe values', () => {
  const parsed = parseCharacterFilterParam(JSON.stringify({
    q: '芙宁娜', sort: 'name', page: 3, pageSize: 50,
    works: ['原神', '原神', 42], favorite: true,
  }));
  assert.deepEqual(parsed, {
    q: '芙宁娜', sort: 'name', page: 3, pageSize: 50,
    works: ['原神'], favorite: true,
  });
});

test('character URL filter corrects invalid page and capacity', () => {
  assert.deepEqual(parseCharacterFilterParam('{"page":0,"pageSize":999}'), {
    page: 1, pageSize: 20,
  });
  assert.equal(parseCharacterFilterParam('[]'), null);
  assert.equal(parseCharacterFilterParam('not-json'), null);
});

test('character filter URL keeps unrelated parameters for page history', () => {
  const next = characterFilterUrl('https://example.test/apps/characters?keep=1', {
    q: '芙宁娜', page: 2, pageSize: 50, sort: 'name',
  });
  assert.ok(next.startsWith('/apps/characters?keep=1&cf='));
  assert.equal(decodeURIComponent(next).includes('"page":2'), true);
});
