import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlessMantineProvider } from '@mantine/core';
import { Spinner } from './spinner';

const renderSpinner = (el: React.ReactElement) => renderToStaticMarkup(
  <HeadlessMantineProvider>{el}</HeadlessMantineProvider>,
);

test('Spinner is icon-only by default without leaking visible loading text', () => {
  const html = renderSpinner(<Spinner />);
  assert.doesNotMatch(html, /正在加载/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="加载中"/);
  assert.doesNotMatch(html, /<span class="text-sm"/);
});

test('Spinner renders explicit label only once and omits redundant sr-only duplicate', () => {
  const html = renderSpinner(<Spinner size="sm" label="正在读取档案…" />);
  assert.equal(html.match(/正在读取档案…/g)?.length, 1);
  assert.doesNotMatch(html, /sr-only/);
  assert.match(html, /h-4 w-4/);
});

test('Spinner honors compact box override when icon-only', () => {
  const html = renderSpinner(<Spinner className="h-3.5 w-3.5" />);
  assert.match(html, /h-full w-full/);
  assert.doesNotMatch(html, /正在加载/);
});

test('Spinner supports xs and 2xs explicit sizes', () => {
  assert.match(renderSpinner(<Spinner size="xs" />), /h-3 w-3/);
  assert.match(renderSpinner(<Spinner size="2xs" />), /h-2\.5 w-2\.5/);
});
