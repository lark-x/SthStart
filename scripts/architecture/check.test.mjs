import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, applyExceptions } from './check.mjs';

function fixture(files, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sthstart-architecture-'));
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler', paths: { '@/*': ['./*'] } } }));
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
    }
    run(analyze(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('aliases, reexports and dynamic imports reveal a runtime cycle; type edges do not', () => {
  fixture({
    'app/features/a/first.ts': "export { value } from '@/app/features/b/second'; export type { Shape } from './types';",
    'app/features/a/types.ts': "import type { value } from './first'; export type Shape = typeof value;",
    'app/features/b/second.ts': "export const value = 1; export const load = () => import('../a/first');",
  }, report => {
    assert.equal(report.cycles.length, 1);
    assert.equal(report.cycles[0].length, 2);
    assert.equal(report.featureCycles.length, 1);
    assert.equal(report.edges.filter(edge => edge.typeOnly).length, 2);
  });
});

test('client reachability follows helpers into server code and UI cannot call business', () => {
  fixture({
    'app/components/ui/input.ts': "'use client'; import '@/app/lib/forward'; import '@/app/features/b/api';",
    'app/lib/forward.ts': "export * from '@/app/server/session';",
    'app/server/session.ts': "export const secret = 'fixture';",
    'app/features/b/api.ts': 'export const fetchB = () => 1;',
  }, report => {
    assert.ok(report.violations.some(issue => issue.rule === 'client-server'));
    assert.ok(report.violations.some(issue => issue.rule === 'ui-business'));
  });
});

test('pure models reject browser globals and React but accept a local document variable', () => {
  fixture({
    'app/features/a/model/bad.ts': "import { useState } from 'react'; export const bad = () => window.location;",
    'app/features/a/model/good.ts': 'export function transform(document: string) { return document.trim(); }',
  }, report => {
    assert.ok(report.violations.some(issue => issue.to === 'react'));
    assert.ok(report.violations.some(issue => issue.to === 'window'));
    assert.ok(!report.violations.some(issue => issue.from.endsWith('/good.ts')));
  });
});

test('exact exceptions cannot hide new edges and become stale when fixed', () => {
  const old = { rule: 'ui-business', from: 'old.ts', to: 'business.ts', reason: 'Compatibility adapter', task: 'DEV-017' };
  const current = { rule: 'ui-business', from: 'new.ts', to: 'business.ts' };
  assert.deepEqual(applyExceptions({ violations: [old, current] }, [old]).violations, [current]);
  assert.deepEqual(applyExceptions({ violations: [] }, [old]).stale, [old]);
});
