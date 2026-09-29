import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { CreateNativeStoryProposalSchema, StoryDocumentSchema, StoryEntryRevisionSchema } from './story.js';

test('Story contracts accept chapters and distinguish valid DSH create/update proposals', () => {
  assert.equal(Value.Check(StoryDocumentSchema, { id: 'chapter-1', projectId: 'p', kind: 'chapter', title: '第一章', body: '# 正文', position: 0, revision: 1, createdAt: 'now', updatedAt: 'now' }), true);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'update', kind: 'chapter', targetId: 'chapter-1', baseRevision: 2, proposedTitle: '第一章', proposedBody: '新稿', reason: '调整节奏' }), true);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'create', kind: 'scene', targetId: null, baseRevision: null, proposedTitle: '旧港', proposedBody: '雾中的港口', reason: '补充场景' }), true);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'create', kind: 'outline', targetId: null, baseRevision: null, proposedTitle: '大纲', proposedBody: '', reason: '不可创建第二份大纲' }), false);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'update', kind: 'chapter', targetId: null, baseRevision: null, proposedTitle: '第一章', proposedBody: '', reason: '缺少基准目标' }), false);
  assert.equal(Value.Check(StoryEntryRevisionSchema, { id: 'rev', projectId: 'p', entryKind: 'chapter', entryId: 'chapter-1', revision: 1, snapshot: { kind: 'chapter', title: '第一章', body: '' }, source: 'baseline', proposalId: null, createdAt: 'now' }), true);
});
