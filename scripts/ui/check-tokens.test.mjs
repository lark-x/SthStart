import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compare, run, scanRepository, scanSource, toBaseline } from './check-tokens.mjs';

const count = (text, rule) => scanSource(text).counts[rule];

test('palette matches Tailwind color utilities with shades, opacity and variants only', () => {
  assert.equal(count('<div className="bg-sky-50 text-amber-700 border-emerald-300" />', 'palette'), 3);
  assert.equal(count('<div className="hover:bg-black/60 from-black/80 via-black/10 text-white" />', 'palette'), 4);
  assert.equal(count('<div className="ring-red-500/[0.4] border-t-rose-200" />', 'palette'), 2);
  // 语义 token 类与 CSS 变量名不算原生色板。
  assert.equal(count('<div className="bg-surface-sunken text-fg-muted border-hairline text-tone-blue-fg" />', 'palette'), 0);
  assert.equal(count("const v = 'var(--tone-blue)'; const w = 'text-whiteish';", 'palette'), 0);
});

test('hex, tiny text, heavy weight, arbitrary px and glyph rules', () => {
  assert.equal(count("color: '#665995', stroke: '#fff', id: '#section-abcdef1'", 'hex'), 1);
  assert.equal(count('text-[10px] text-[11.5px] text-[12px] text-[9px]', 'tinyText'), 3);
  assert.equal(count('font-bold font-extrabold font-black font-semibold font-boldish', 'heavyWeight'), 3);
  assert.equal(count('p-[7px] mt-[13px] -translate-y-[2px] sm:rounded-tl-[6px] min-w-[220px] text-[13px] w-[50%]', 'arbitraryPx'), 5);
  assert.equal(count("label: '✓ 已发生', other: '○ 规划', emoji: '🎉', mark: '© 2026'", 'glyphIcon'), 3);
});

test('comment lines are skipped but code on the same file is counted with line numbers', () => {
  const source = ['// 禁止 bg-sky-50 这类写法', ' * 例如 font-bold', '<div className="bg-sky-50" />'].join('\r\n');
  const result = scanSource(source);
  assert.equal(result.counts.palette, 1);
  assert.equal(result.counts.heavyWeight, 0);
  assert.deepEqual(result.hits.palette, [{ line: 3, match: 'bg-sky-50' }]);
});

test('compare is a ratchet: increases fail, new files must be zero, decreases and removals are reported', () => {
  const scan = {
    unreadable: [],
    files: {
      'app/features/a.tsx': scanSource('bg-sky-50 bg-sky-100 font-bold'),
      'app/features/b.tsx': scanSource('p-[7px]'),
      'app/features/new.tsx': scanSource('text-[10px]'),
      'app/features/clean.tsx': scanSource('bg-surface'),
    },
  };
  const baseline = { version: 1, counts: {
    'app/features/a.tsx': { palette: 1, heavyWeight: 3 },
    'app/features/b.tsx': { arbitraryPx: 1 },
    'app/features/gone.tsx': { hex: 2 },
  } };
  const result = compare(baseline, scan);
  assert.deepEqual(result.increases.map(item => [item.file, item.rule, item.allowed, item.current, item.isNewFile]), [
    ['app/features/a.tsx', 'palette', 1, 2, false],
    ['app/features/new.tsx', 'tinyText', 0, 1, true],
  ]);
  assert.deepEqual(result.increases[0].hits.map(hit => hit.match), ['bg-sky-50', 'bg-sky-100']);
  assert.deepEqual(result.decreases.map(item => [item.file, item.rule, item.allowed, item.current]), [
    ['app/features/a.tsx', 'heavyWeight', 3, 1],
    ['app/features/gone.tsx', 'hex', 2, 0],
  ]);
  assert.deepEqual(result.removed, ['app/features/gone.tsx']);
  assert.deepEqual(toBaseline(scan).counts['app/features/clean.tsx'], undefined, 'clean files stay out of the baseline');
});

function fixtureRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sthstart-ui-check-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('run: missing baseline fails until --update, increases block --update, decreases tighten it', () => {
  const root = fixtureRoot({
    'app/features/a.tsx': '<div className="bg-sky-50 font-bold" />',
    'app/features/a.test.tsx': '<div className="bg-red-500" />',
    'app/components/ui/x.tsx': '<div className="bg-red-500" />',
  });
  const out = [];
  const io = { root, log: line => out.push(line), error: line => out.push(line) };
  try {
    assert.equal(run([], io), 1, 'no baseline yet');
    assert.equal(run(['--update'], io), 0, 'first --update creates the baseline');
    const baselineFile = path.join(root, 'scripts/ui/baseline.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(baselineFile, 'utf8')).counts, { 'app/features/a.tsx': { palette: 1, heavyWeight: 1 } },
      'tests and components/ui are outside the scan');
    assert.equal(run([], io), 0);

    fs.writeFileSync(path.join(root, 'app/features/a.tsx'), '<div className="bg-sky-50 bg-sky-100 font-bold" />');
    out.length = 0;
    assert.equal(run([], io), 1);
    assert.ok(out.some(line => line.includes('app/features/a.tsx:1  bg-sky-100')), 'reports file and line');
    assert.equal(run(['--update'], io), 1, '--update refuses while something increased');

    fs.writeFileSync(path.join(root, 'app/features/a.tsx'), '<div className="bg-surface font-semibold" />');
    assert.equal(run(['--update'], io), 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(baselineFile, 'utf8')).counts, {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unreadable files are reported, never counted as zero', () => {
  const root = fixtureRoot({ 'app/features/locked.tsx': 'bg-sky-50', 'app/features/ok.tsx': 'bg-surface' });
  try {
    const read = file => {
      if (file.endsWith('locked.tsx')) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return fs.readFileSync(file, 'utf8');
    };
    const scan = scanRepository(root, { read });
    assert.deepEqual(scan.unreadable, [{ file: 'app/features/locked.tsx', error: 'EACCES' }]);
    assert.equal(scan.files['app/features/locked.tsx'], undefined);
    assert.ok(scan.files['app/features/ok.tsx']);
    // 基线里有、但这次读不了的文件不能被当成已清零。
    const result = compare({ version: 1, counts: { 'app/features/locked.tsx': { palette: 1 } } }, scan);
    assert.deepEqual(result.decreases, []);
    assert.deepEqual(result.removed, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
