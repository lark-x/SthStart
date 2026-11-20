import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  WorldChapterCopilotRequestSchema,
  WorldChapterCopilotResponseSchema,
  WorldCopilotReferenceSchema,
  WorldManuscriptCreateDocSchema,
  WorldManuscriptDocResponseSchema,
  WorldManuscriptSaveDocSchema,
  WorldMcpReadRequestSchema,
  WorldMcpReadResponseSchema,
} from './story-hub.js';

test('WorldMcpReadRequestSchema enforces bounds and rejects unknown properties', () => {
  assert.equal(Value.Check(WorldMcpReadRequestSchema, { locator: 'doc/1' }), true);
  assert.equal(Value.Check(WorldMcpReadRequestSchema, {
    sourceId: 's',
    locator: 'x',
    offset: 0,
    limit: 1,
    toolName: '',
  }), true);
  assert.equal(Value.Check(WorldMcpReadRequestSchema, {
    sourceId: 's'.repeat(160),
    locator: 'l'.repeat(500),
    offset: 100000,
    limit: 300,
    toolName: 't'.repeat(120),
  }), true);

  for (const invalid of [
    {},
    { locator: '' },
    { locator: 'l'.repeat(501) },
    { locator: 'doc/1', sourceId: '' },
    { locator: 'doc/1', sourceId: 's'.repeat(161) },
    { locator: 'doc/1', offset: -1 },
    { locator: 'doc/1', offset: 100001 },
    { locator: 'doc/1', offset: 1.5 },
    { locator: 'doc/1', limit: 0 },
    { locator: 'doc/1', limit: 301 },
    { locator: 'doc/1', limit: 2.5 },
    { locator: 'doc/1', toolName: 't'.repeat(121) },
    { locator: 'doc/1', extraField: 'unexpected' },
  ]) {
    assert.equal(Value.Check(WorldMcpReadRequestSchema, invalid), false);
  }
});

test('WorldMcpReadResponseSchema validates offsets, nullable totalLines, and content bounds', () => {
  const base = {
    sourceId: 'src-1',
    sourceName: 'Source Name',
    toolUsed: 'akasha_read',
    locator: 'chapter/1',
    title: 'Chapter 1',
    content: 'Excerpt text',
    startOffset: 0,
    endOffset: 10,
    totalLines: null,
    hasMore: false,
  };
  assert.equal(Value.Check(WorldMcpReadResponseSchema, base), true);
  assert.equal(Value.Check(WorldMcpReadResponseSchema, { ...base, totalLines: 120, hasMore: true }), true);
  assert.equal(Value.Check(WorldMcpReadResponseSchema, { ...base, startOffset: -1 }), false);
  assert.equal(Value.Check(WorldMcpReadResponseSchema, { ...base, totalLines: -1 }), false);
  assert.equal(Value.Check(WorldMcpReadResponseSchema, { ...base, content: 'c'.repeat(40001) }), false);
});

test('WorldManuscriptCreateDocSchema enforces bounds, kind literals, and rejects unknown properties', () => {
  assert.equal(Value.Check(WorldManuscriptCreateDocSchema, { title: 'A' }), true);
  assert.equal(Value.Check(WorldManuscriptCreateDocSchema, {
    branchId: 'b'.repeat(160),
    projectId: 'p'.repeat(160),
    kind: 'chapter',
    title: 't'.repeat(120),
    body: 'x'.repeat(100000),
  }), true);
  assert.equal(Value.Check(WorldManuscriptCreateDocSchema, {
    branchId: 'b',
    projectId: 'p',
    kind: 'scene',
    title: 'Scene 1',
    body: '',
  }), true);

  for (const invalid of [
    {},
    { title: '' },
    { title: 't'.repeat(121) },
    { title: 'Valid', branchId: '' },
    { title: 'Valid', branchId: 'b'.repeat(161) },
    { title: 'Valid', projectId: '' },
    { title: 'Valid', projectId: 'p'.repeat(161) },
    { title: 'Valid', kind: 'outline' },
    { title: 'Valid', body: 'x'.repeat(100001) },
    { title: 'Valid', unknownKey: true },
  ]) {
    assert.equal(Value.Check(WorldManuscriptCreateDocSchema, invalid), false);
  }
});

test('WorldManuscriptSaveDocSchema and WorldManuscriptDocResponseSchema enforce revision and bounds', () => {
  assert.equal(Value.Check(WorldManuscriptSaveDocSchema, {
    projectId: 'p',
    expectedRevision: 1,
    title: 'T',
    body: '',
  }), true);
  assert.equal(Value.Check(WorldManuscriptSaveDocSchema, {
    projectId: 'p'.repeat(160),
    expectedRevision: 99,
    title: 't'.repeat(120),
    body: 'b'.repeat(100000),
  }), true);

  for (const invalid of [
    { expectedRevision: 1, title: 'T', body: '' },
    { projectId: '', expectedRevision: 1, title: 'T', body: '' },
    { projectId: 'p'.repeat(161), expectedRevision: 1, title: 'T', body: '' },
    { projectId: 'p', expectedRevision: 0, title: 'T', body: '' },
    { projectId: 'p', expectedRevision: 1.5, title: 'T', body: '' },
    { projectId: 'p', expectedRevision: 1, title: '', body: '' },
    { projectId: 'p', expectedRevision: 1, title: 't'.repeat(121), body: '' },
    { projectId: 'p', expectedRevision: 1, title: 'T', body: 'b'.repeat(100001) },
    { projectId: 'p', expectedRevision: 1, title: 'T', body: '', extra: 1 },
  ]) {
    assert.equal(Value.Check(WorldManuscriptSaveDocSchema, invalid), false);
  }

  assert.equal(Value.Check(WorldManuscriptDocResponseSchema, {
    projectId: 'proj-1',
    document: {
      id: 'doc-1',
      kind: 'chapter',
      title: 'Chapter 1',
      body: 'Body text',
      position: 0,
      revision: 1,
      updatedAt: '2026-11-18T00:00:00Z',
      wordCount: 9,
    },
  }), true);
});

test('WorldChapterCopilotRequestSchema and related schemas enforce bounds and reject unknown properties', () => {
  for (const mode of ['beats', 'turn', 'draft', 'polish', 'check'] as const) {
    assert.equal(Value.Check(WorldChapterCopilotRequestSchema, { mode }), true);
  }

  const maxRef = {
    title: 'r'.repeat(300),
    locator: 'l'.repeat(500),
    excerpt: 'e'.repeat(8000),
  };
  assert.equal(Value.Check(WorldCopilotReferenceSchema, maxRef), true);
  assert.equal(Value.Check(WorldCopilotReferenceSchema, { ...maxRef, extra: true }), false);

  assert.equal(Value.Check(WorldChapterCopilotRequestSchema, {
    mode: 'draft',
    action: '靠近门边的旧信箱',
    branchId: 'b'.repeat(160),
    arcId: 'a'.repeat(160),
    chapterTitle: 'c'.repeat(200),
    instruction: 'i'.repeat(8000),
    beats: Array.from({ length: 12 }, () => 'x'.repeat(1000)),
    actorIds: Array.from({ length: 20 }, (_, idx) => `actor-${idx}`),
    locationId: 'loc'.repeat(50),
    existingBody: 'y'.repeat(100000),
    references: Array.from({ length: 10 }, () => maxRef),
    targetWordCount: 300,
  }), true);
  assert.equal(Value.Check(WorldChapterCopilotRequestSchema, {
    mode: 'polish',
    targetWordCount: 8000,
  }), true);

  for (const invalid of [
    {},
    { mode: 'unknown' },
    { mode: 'beats', branchId: '' },
    { mode: 'beats', branchId: 'b'.repeat(161) },
    { mode: 'beats', arcId: '' },
    { mode: 'beats', arcId: 'a'.repeat(161) },
    { mode: 'beats', chapterTitle: 'c'.repeat(201) },
    { mode: 'beats', instruction: 'i'.repeat(8001) },
    { mode: 'beats', beats: Array.from({ length: 13 }, () => 'beat') },
    { mode: 'beats', beats: ['x'.repeat(1001)] },
    { mode: 'beats', actorIds: Array.from({ length: 21 }, (_, idx) => `a-${idx}`) },
    { mode: 'beats', actorIds: [''] },
    { mode: 'beats', actorIds: ['a'.repeat(161)] },
    { mode: 'beats', locationId: '' },
    { mode: 'beats', locationId: 'l'.repeat(161) },
    { mode: 'beats', existingBody: 'y'.repeat(100001) },
    { mode: 'beats', references: Array.from({ length: 11 }, () => maxRef) },
    { mode: 'beats', references: [{ title: 't'.repeat(301), excerpt: 'ok' }] },
    { mode: 'beats', references: [{ title: 'ok', locator: 'l'.repeat(501), excerpt: 'ok' }] },
    { mode: 'beats', references: [{ title: 'ok', excerpt: 'e'.repeat(8001) }] },
    { mode: 'beats', references: [{ title: 'ok', excerpt: 'ok', extra: 1 }] },
    { mode: 'beats', targetWordCount: 299 },
    { mode: 'beats', targetWordCount: 8001 },
    { mode: 'beats', targetWordCount: 1000.5 },
    { mode: 'turn', action: 'a'.repeat(2001) },
    { mode: 'beats', unknownField: 'nope' },
  ]) {
    assert.equal(Value.Check(WorldChapterCopilotRequestSchema, invalid), false);
  }

  assert.equal(Value.Check(WorldChapterCopilotResponseSchema, {
    mode: 'check',
    modelUsed: 'deepseek-chat',
    beats: ['Beat 1'],
    choices: [],
    prose: 'Draft prose',
    issues: [
      { severity: 'warning', category: 'canon', quote: 'quote', detail: 'canon mismatch' },
      { severity: 'suggestion', category: 'tom', detail: 'mind state note' },
      { severity: 'suggestion', category: 'voice', detail: 'voice note' },
      { severity: 'warning', category: 'style', detail: 'style note' },
    ],
    extractedFacts: ['Fact 1'],
  }), true);
  assert.equal(Value.Check(WorldChapterCopilotResponseSchema, {
    mode: 'check',
    modelUsed: 'deepseek-chat',
    beats: [],
    choices: [],
    prose: '',
    issues: [{ severity: 'error', category: 'canon', detail: 'bad' }],
    extractedFacts: [],
  }), false);
});
