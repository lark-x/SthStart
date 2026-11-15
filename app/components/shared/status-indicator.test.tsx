import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusIndicator } from './status-indicator';

const render = (status: React.ComponentProps<typeof StatusIndicator>['status']) =>
  renderToStaticMarkup(<StatusIndicator status={status} label="状态" />);

test('stopped is neutral rather than an error', () => {
  const html = render('stopped');
  assert.match(html, /data-status="stopped"/);
  assert.match(html, /border-border-strong/);
  assert.match(html, /bg-surface-sunken/);
  assert.doesNotMatch(html, /bg-danger/);
});

test('only offline and error use the danger dot', () => {
  for (const status of ['offline', 'error'] as const) {
    const html = render(status);
    assert.match(html, /bg-danger/, status);
    assert.doesNotMatch(html, /border-border-strong/, status);
  }
  for (const status of ['stopping', 'running', 'starting'] as const) {
    assert.doesNotMatch(render(status), /bg-danger/, status);
  }
});
