import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreativeNote, NoteBlock } from '@sthstart/contracts';
import {
  insertContentBlock,
  moveContentBlock,
  noteSavePayload,
  removeContentBlock,
  updateContentBlock,
} from './note-content';

function textBlock(id: string, text = ''): NoteBlock {
  return { id, type: 'text', text };
}

test('content blocks insert after an anchor and append when the anchor is gone', () => {
  const content = [textBlock('a', 'first'), textBlock('b', 'second')];
  const inserted = insertContentBlock(content, textBlock('c'), 'a');
  assert.deepEqual(inserted.map((block) => block.id), ['a', 'c', 'b']);
  assert.deepEqual(content.map((block) => block.id), ['a', 'b'], 'does not mutate the original content');
  assert.deepEqual(insertContentBlock(content, textBlock('d'), 'missing').map((block) => block.id), ['a', 'b', 'd']);
});

test('moving blocks only swaps adjacent entries and ignores out-of-range directions', () => {
  const content = [textBlock('a'), textBlock('b'), textBlock('c')];
  assert.deepEqual(moveContentBlock(content, 1, -1).map((block) => block.id), ['b', 'a', 'c']);
  assert.equal(moveContentBlock(content, 0, -1), content);
  assert.equal(moveContentBlock(content, 2, 1), content);
});

test('updating and deleting blocks preserve unrelated entries', () => {
  const content = [textBlock('a', 'first'), textBlock('b', 'second')];
  const updated = updateContentBlock(content, 'a', { text: 'changed' });
  assert.equal((updated[0] as Extract<NoteBlock, { type: 'text' }>).text, 'changed');
  assert.deepEqual(removeContentBlock(updated, 'a').map((block) => block.id), ['b']);
});

test('save payload derives title and summary without rewriting the editor state', () => {
  const note: CreativeNote = {
    title: '   ',
    kind: 'note',
    summary: '',
    content: [textBlock('a', '正文摘要'), { id: 'img', type: 'image', src: '', caption: '' }],
    tags: [],
    stage: 'draft',
    favorite: false,
  };
  const payload = noteSavePayload(note, 'note-1');
  assert.equal(payload.id, 'note-1');
  assert.equal(payload.title, '未命名笔记');
  assert.equal(payload.summary, '正文摘要');
  assert.equal(note.title, '   ', 'editor state remains untouched');
});
