import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoryDocument } from '@sthstart/contracts';
import { publicationPreselect } from './create-publication-dialog';

function chapter(id: string, title: string, position: number): StoryDocument {
  return {
    id,
    projectId: 'project-1',
    kind: 'chapter',
    title,
    body: '正文',
    position,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const chapters = [chapter('c1', '第一章', 0), chapter('c2', '第二章', 1)];

test('adopted chapter is preselected without adding the active chapter', () => {
  assert.deepEqual(publicationPreselect(chapters, 'c1', ['c2']), ['c2']);
});

test('active chapter remains the default when no adopted chapter is given', () => {
  assert.deepEqual(publicationPreselect(chapters, 'c2', undefined), ['c2']);
  assert.deepEqual(publicationPreselect(chapters, undefined, undefined), ['c1']);
});

test('an unknown explicit chapter does not silently fall back to the first chapter', () => {
  assert.deepEqual(publicationPreselect(chapters, undefined, ['missing']), []);
});

test('duplicate candidates collapse while keeping the requested order', () => {
  assert.deepEqual(publicationPreselect(chapters, 'c2', ['c2', 'c1']), ['c2', 'c1']);
});
