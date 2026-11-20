import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlessMantineProvider } from '@mantine/core';
import { usePagination } from '@mantine/hooks';
import { getPageNumbers } from '../../lib/pagination';
import { Pagination } from './pagination';

const render = (markup: React.ReactElement) => renderToStaticMarkup(
  createElement(HeadlessMantineProvider, null, markup),
);

const renderPagination = (overrides: Partial<React.ComponentProps<typeof Pagination>> = {}) => render(
  createElement(Pagination, {
    total: 201, page: 5, pageSize: 20,
    onPageChange() {}, onPageSizeChange() {},
    ...overrides,
  }),
);

function MantineRange({ page }: { page: number }) {
  const { range } = usePagination({ total: 100, page, siblings: 1, boundaries: 1 });
  return <span>{range.join(',')}</span>;
}

test('Mantine range matches the existing first, neighbour and last page contract', () => {
  for (const page of [1, 2, 5, 10, 50, 99, 100]) {
    const legacy = getPageNumbers(page, 100).map(token => typeof token === 'number' ? token : 'dots');
    assert.equal(render(<MantineRange page={page} />), `<span>${legacy.join(',')}</span>`);
  }
});

test('numbered navigation uses Mantine compound controls and keeps Chinese page labels', () => {
  const html = renderPagination();
  assert.match(html, /class="[^"]*pagination-control[^"]*pagination-number[^"]*"[^>]*aria-label="第 1 页"/);
  assert.match(html, /class="[^"]*pagination-control[^"]*pagination-number[^"]*"[^>]*aria-current="page"[^>]*aria-label="第 5 页"/);
  assert.match(html, /class="[^"]*pagination-control[^"]*pagination-number[^"]*"[^>]*aria-label="第 11 页"/);
  assert.match(html, /aria-label="上一页"/);
  assert.match(html, /aria-label="下一页"/);
  assert.match(html, /class="pagination-ellipsis"/);
  assert.match(html, /共 201 条，当前 81–100 条/);
  assert.match(html, /aria-label="每页 20 条，更改每页条数"/, 'accessible name starts with the visible label');
  assert.match(html, /aria-label="跳页 5 \/ 11，跳到指定页，当前第 5 页，共 11 页"/);
});

test('compact presentation keeps paging usable without numbered controls', () => {
  const html = renderPagination({ compact: true });
  assert.doesNotMatch(html, /pagination-number/);
  assert.match(html, /aria-label="上一页"/);
  assert.match(html, /aria-label="下一页"/);
  assert.match(html, /5 \/ 11/);
  assert.match(html, /aria-haspopup="dialog"/);
});

test('loading disables every Mantine page control', () => {
  const html = renderPagination({ loading: true });
  assert.match(html, /aria-busy="true"/);
  for (const control of html.matchAll(/<button\b[^>]*pagination-(?:control|number|previous|next)[^>]*>/g)) {
    assert.match(control[0], /\bdisabled=""/);
  }
});

test('page controls are defined outside the Mantine layer so project tokens win', () => {
  const css = readFileSync(new URL('../../styles/pagination.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@layer\s+mantine/);
  assert.match(css, /\.pagination-control\s*\{/);
  assert.match(css, /\.pagination-control\[aria-current='page'\]/);
  assert.match(css, /\.pagination-control:focus-visible/);
  assert.match(css, /\.pagination-control:disabled/);
  assert.match(css, /\.pagination-dots\s*\{[^}]*display: flex;[^}]*min-width: 0;/);
  assert.doesNotMatch(css, /\.pagination-dots[^}]*var\(--pagination-control-size\)/);
  assert.match(css, /@container pagination \(width < 720px\)[\s\S]*\.pagination-numbers/);
  assert.match(css, /@media \(max-width: 639px\), \(pointer: coarse\)[\s\S]*--control-h-touch/);
});
