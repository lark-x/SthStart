import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { ProjectListQuerySchema, ProjectListSchema, ProjectPageSchema } from './projects.js';

test('project paginated query validates capacity, page, search length and sort', () => {
  assert.ok(Value.Check(ProjectListQuerySchema, {}));
  assert.ok(Value.Check(ProjectListQuerySchema, { page: 2, pageSize: 100, q: '星海', sort: 'title' }));
  for (const query of [{ page: 0 }, { page: 1.5 }, { pageSize: 101 }, { pageSize: -1 }, { q: 'x'.repeat(201) }, { sort: 'sql' }]) {
    assert.equal(Value.Check(ProjectListQuerySchema, query), false);
  }
});
test('legacy project list response remains valid and page metadata is required only for paged response', () => {
  assert.ok(Value.Check(ProjectListSchema, { items: [] }));
  assert.equal(Value.Check(ProjectPageSchema, { items: [] }), false);
  assert.ok(Value.Check(ProjectPageSchema, { items: [], page: 1, pageSize: 20, total: 0 }));
});
