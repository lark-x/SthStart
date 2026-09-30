import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CreateNativeStoryProposalSchema,
  StoryDocumentSchema,
  StoryEntryRevisionSchema,
  StoryProjectSchema,
  StoryDshStatusSchema,
  StoryScriptProjectSchema,
} from './story.js';

test('Story contracts accept chapters and distinguish valid DSH create/update proposals', () => {
  assert.equal(Value.Check(StoryDocumentSchema, { id: 'chapter-1', projectId: 'p', kind: 'chapter', title: '第一章', body: '# 正文', position: 0, revision: 1, createdAt: 'now', updatedAt: 'now' }), true);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'update', kind: 'chapter', targetId: 'chapter-1', baseRevision: 2, proposedTitle: '第一章', proposedBody: '新稿', reason: '调整节奏' }), true);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'create', kind: 'scene', targetId: null, baseRevision: null, proposedTitle: '旧港', proposedBody: '雾中的港口', reason: '补充场景' }), true);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'create', kind: 'outline', targetId: null, baseRevision: null, proposedTitle: '大纲', proposedBody: '', reason: '不可创建第二份大纲' }), false);
  assert.equal(Value.Check(CreateNativeStoryProposalSchema, { operation: 'update', kind: 'chapter', targetId: null, baseRevision: null, proposedTitle: '第一章', proposedBody: '', reason: '缺少基准目标' }), false);
  assert.equal(Value.Check(StoryEntryRevisionSchema, { id: 'rev', projectId: 'p', entryKind: 'chapter', entryId: 'chapter-1', revision: 1, snapshot: { kind: 'chapter', title: '第一章', body: '' }, source: 'baseline', proposalId: null, createdAt: 'now' }), true);

  // 验证带有 workId 的剧情项目
  assert.equal(Value.Check(StoryProjectSchema, {
    id: 'proj-1',
    title: '雾港夜行',
    summary: '测试项目',
    workId: '原神',
    revision: 1,
    contextSettings: { contextWindow: 65536, outputTokens: 4096, compactThreshold: 0.75, retainTokens: 4096 },
    createdAt: 'now',
    updatedAt: 'now',
  }), true);

  // 验证 DSH 状态
  assert.equal(Value.Check(StoryDshStatusSchema, {
    running: true,
    port: 3081,
    url: 'http://127.0.0.1:3081',
    projectId: 'proj-1',
  }), true);

  // 验证小说衍生剧本工程结构
  assert.equal(Value.Check(StoryScriptProjectSchema, {
    title: '雾港夜行',
    chapterTitle: '第一章 迷雾重重',
    characters: ['荧', '派蒙'],
    lines: [
      { type: 'scene_header', content: '离岛港口 - 夜' },
      { type: 'narration', content: '夜幕降临，码头边泛起微光。' },
      { type: 'dialogue', speaker: '派蒙', emotion: '疑惑', content: '前面的雾气好像越来越浓了呢……' },
    ],
  }), true);
});

