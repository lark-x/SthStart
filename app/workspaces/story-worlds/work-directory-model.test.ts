import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoryWorld } from '@sthstart/contracts';
import { mergeWorkDirectory } from './work-directory-model';

test('empty catalogs and pending works survive, completed setup merges once by stable id', () => {
  const result = mergeWorkDirectory([
    { name: '目录作品', aliases: ['旧名'], mediaType: '', workNature: 'canon' },
    { name: '已建作品', aliases: [], mediaType: '', worldId: 'w', workNature: 'derivative', parentWork: '目录作品' },
  ], [{ id: 'w', title: '已建作品', workNature: 'derivative', parentWork: '目录作品', summary: '正文' } as StoryWorld], [
    { id: 'w', title: '已建作品' }, { id: 'p', title: '未配置作品', workNature: 'original' },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result.find(item => item.worldId === 'w')?.state, 'ready');
  assert.equal(result.find(item => item.worldId === 'p')?.state, 'pending');
  assert.equal(result.find(item => item.name === '目录作品')?.state, 'catalog');
});

test('configuring a catalog work by alias produces a single entry', () => {
  const result = mergeWorkDirectory([{ name: '标准名', aliases: ['别名'], mediaType: '', workNature: 'canon' }], [], [{ id: 'w', title: '别名', workNature: 'canon' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].state, 'pending');
});
