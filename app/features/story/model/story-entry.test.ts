import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoryCharacter, StoryDocument } from '@sthstart/contracts';
import {
  bibleEntryCount, bibleGroupsOf, buildEntryRows, chapterIndexOf, chapterWordLabel,
  defaultEntryOf, entryBody, entryMatchesSearch, filteredChaptersOf, neighborChapters,
  resolveActiveEntry, totalWordCount,
} from './story-entry';

const document = (overrides: Partial<StoryDocument> & Pick<StoryDocument, 'id' | 'kind' | 'title'>): StoryDocument => ({
  projectId: 'p1', body: '', position: 0, revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
});
const character = (id: string, name: string): StoryCharacter => ({
  id, projectId: 'p1', name, notes: `${name} 的设定`, sourceCharacterId: null, sourceVersion: null,
  revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

test('default entry prefers first chapter for fiction and outline for reflection', () => {
  const chapters = [document({ id: 'c2', kind: 'chapter', title: '第二章', position: 1 }), document({ id: 'c1', kind: 'chapter', title: '第一章', position: 0 })];
  const outline = document({ id: 'o1', kind: 'outline', title: '主线' });
  const entries = buildEntryRows([...chapters, outline], [character('ch1', '阿澜')]);

  assert.equal(defaultEntryOf(entries, [...chapters, outline], false)?.id, 'c1');
  assert.equal(defaultEntryOf(entries, [...chapters, outline], true)?.id, 'o1');
  assert.equal(defaultEntryOf(entries, [], false)?.id, 'c2');
});

test('active entry follows explicit selection, then URL entry, then default', () => {
  const docs = [document({ id: 'o1', kind: 'outline', title: '主线' }), document({ id: 'c1', kind: 'chapter', title: '第一章' })];
  const entries = buildEntryRows(docs, [character('ch1', '阿澜')]);
  const fallback = defaultEntryOf(entries, docs, false);

  assert.equal(resolveActiveEntry(entries, { kind: 'character', id: 'ch1' }, 'c1', fallback)?.id, 'ch1');
  assert.equal(resolveActiveEntry(entries, null, 'o1', fallback)?.id, 'o1');
  assert.equal(resolveActiveEntry(entries, { kind: 'document', id: 'missing' }, null, fallback)?.id, 'c1');
});

test('chapter neighbors and indexes ignore character entries', () => {
  const docs = [document({ id: 'c1', kind: 'chapter', title: '一', position: 0 }), document({ id: 'c2', kind: 'chapter', title: '二', position: 1 }), document({ id: 'c3', kind: 'chapter', title: '三', position: 2 })];
  const middle = docs[1]!;
  const neighbors = neighborChapters(docs, middle);

  assert.equal(chapterIndexOf(docs, middle), 1);
  assert.equal(neighbors.previous?.id, 'c1');
  assert.equal(neighbors.next?.id, 'c3');
  assert.equal(chapterIndexOf(docs, character('ch1', '阿澜')), -1);
  assert.deepEqual(neighborChapters(docs, docs[0]!), { index: 0, previous: null, next: docs[1] });
});

test('search, chapter filtering and bible grouping keep existing semantics', () => {
  const docs = [
    document({ id: 'c1', kind: 'chapter', title: '雨夜', body: '码头' }),
    document({ id: 'o1', kind: 'outline', title: '主线' }),
    document({ id: 'w1', kind: 'world', title: '世界' }),
    document({ id: 's1', kind: 'scene', title: '场景' }),
  ];
  const entries = buildEntryRows(docs, [character('ch1', '阿澜')]);

  assert.equal(filteredChaptersOf(docs.filter((item) => item.kind === 'chapter'), '码头').length, 1);
  assert.equal(filteredChaptersOf(docs.filter((item) => item.kind === 'chapter'), '不存在').length, 0);
  assert.equal(entryMatchesSearch(entries[0]!, '码头'), true);
  assert.equal(entryMatchesSearch(entries[4]!, '设定'), true);
  assert.equal(entryMatchesSearch(entries[0]!, '  '), true);

  const groups = bibleGroupsOf(entries);
  assert.deepEqual(groups.map((group) => group.kind), ['outline', 'character', 'world', 'scene']);
  assert.equal(groups[1]!.rows[0]?.item.id, 'ch1');
  assert.equal(bibleEntryCount(entries), 4);
  assert.equal(totalWordCount(docs.filter((item): item is StoryDocument => item.kind === 'chapter')), 2);
});

test('entry body/title helpers and word labels match the editor lists', () => {
  const chapter = document({ id: 'c1', kind: 'chapter', title: '第一章', body: '正文' });
  assert.equal(entryBody(character('ch1', '阿澜')), '阿澜 的设定');
  assert.equal(chapterWordLabel(999), '999字');
  assert.equal(chapterWordLabel(1500), '1.5k字');
  assert.equal(entryMatchesSearch({ kind: 'document', item: chapter }, '第一'), true);
});
