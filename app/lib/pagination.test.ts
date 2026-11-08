import assert from 'node:assert/strict';
import test from 'node:test';
import { getPageNumbers, getPagination, positiveInteger } from './pagination';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination } from '../components/ui/pagination';

test('pagination ranges cover empty, one, exact page, overflow and multiple pages', () => {
  for (const [total, page, expected] of [
    [0, 1, [1, 1, 0, 0]], [1, 1, [1, 1, 1, 1]], [20, 1, [1, 1, 1, 20]],
    [21, 2, [2, 2, 21, 21]], [81, 5, [5, 5, 81, 81]], [80, 5, [4, 4, 61, 80]],
  ] as const) {
    const result = getPagination(total, page, 20);
    assert.deepEqual([result.page, result.pageCount, result.start, result.end], expected);
  }
});
test('invalid page values and capacities cannot produce NaN, infinity or negative ranges', () => {
  for (const input of [null, '', '-1', '2.2', '1e3', 'Infinity', NaN, Infinity, -1, 1.5, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(positiveInteger(input, 20), 20);
  }
  assert.deepEqual(getPagination(NaN, Infinity, 0), { total: 0, page: 1, pageSize: 20, pageCount: 1, start: 0, end: 0 });
  assert.equal(positiveInteger('02'), 2);
});
test('large page counts remain bounded and keep first, current and last pages', () => {
  assert.deepEqual(getPageNumbers(1, 10), [1, 2, 3, 4, 5, 'ellipsis-end', 10]);
  assert.deepEqual(getPageNumbers(5, 10), [1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 10]);
  assert.deepEqual(getPageNumbers(10, 10), [1, 'ellipsis-start', 6, 7, 8, 9, 10]);
  for (const page of [1, 2, 50, 99, 100]) {
    const values = getPageNumbers(page, 100);
    assert.ok(values.length <= 7);
    assert.ok(values.includes(1) && values.includes(page) && values.includes(100));
  }
});

test('shared pagination exposes accessible controls, empty state, loading and compact options', () => {
  const render = (overrides = {}) => renderToStaticMarkup(createElement(Pagination, {
    total: 81, page: 2, pageSize: 20, onPageChange() {}, onPageSizeChange() {}, ...overrides,
  }));
  const normal = render();
  assert.match(normal, /当前 21–40 条/);
  for (const label of ['首页', '末页', '上一页', '下一页', '跳转页码', '每页条数']) assert.ok(normal.includes(label));
  assert.match(normal, /aria-current="page"/);
  const empty = render({ total: 0, page: 99 });
  assert.match(empty, /共 0 条/);
  assert.ok(!empty.includes('1 / 0'));
  const loading = render({ loading: true });
  assert.match(loading, /正在更新/);
  assert.match(loading, /aria-busy="true"/);
  assert.ok(!/<button(?![^>]*disabled)[^>]*>/.test(loading));
  const compact = render({ compact: true });
  assert.match(compact, /aria-haspopup="dialog"/);
  assert.match(compact, /分页选项/);
  assert.ok(!compact.includes('aria-label="第 2 页"'));
});
