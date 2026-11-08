import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { KnowledgeSearchQuerySchema, KnowledgeSearchResponseSchema } from './index.js';

test('knowledge search pagination is optional and bounded', () => {
  assert.ok(Value.Check(KnowledgeSearchQuerySchema, { kinds: ['note', 'narrative', 'topic', 'collection'], offset: 100, limit: 20 }));
  assert.ok(Value.Check(KnowledgeSearchQuerySchema, { q: '原文' }));
  for (const invalid of [{ offset: -1 }, { offset: 1.2 }, { limit: 0 }, { limit: 201 }, { kinds: ['other'] }]) {
    assert.equal(Value.Check(KnowledgeSearchQuerySchema, invalid), false);
  }
});

test('knowledge search keeps old response compatibility and original source kinds', () => {
  assert.ok(Value.Check(KnowledgeSearchResponseSchema, { items: [], total: 0, truncated: false }));
  for (const kind of ['note', 'narrative', 'topic', 'collection']) {
    assert.ok(Value.Check(KnowledgeSearchResponseSchema, { items: [{ kind, id: 'id', title: '标题', excerpt: '正文' }], total: 101, truncated: false, offset: 100, limit: 20, hasMore: false }));
  }
});
