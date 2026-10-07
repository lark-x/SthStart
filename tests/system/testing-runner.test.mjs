import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventory, selectFiles } from '../../scripts/testing/catalog.mjs';
import { parseArgs, summarizeTap, execute } from '../../scripts/testing/run.mjs';

test('recursive inventory finds deep frontend and playback tests, but keeps exercises and现场 scripts out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'testing-catalog-'));
  try {
    for (const file of ['app/features/a/deep/value.test.ts', 'packages/activity-playback/src/comic/a.test.ts',
      'tests/learning/a.answer.test.ts', 'tests/learning/a.exercise.ts', 'scripts/verify-live.mjs', 'app/node_modules/ignored.test.ts']) {
      await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), '');
    }
    const catalog = await inventory(root);
    assert.equal(catalog.files.length, 3);
    assert.deepEqual(selectFiles(catalog, { suite: 'portal' }).map(item => item.file), ['app/features/a/deep/value.test.ts']);
    assert.equal(selectFiles(catalog, { files: ['packages\\activity-playback\\src\\comic\\a.test.ts'] })[0].suite, 'playback');
    assert.deepEqual(catalog.onsite, ['scripts/verify-live.mjs']);
    assert.throws(() => selectFiles(catalog, { files: ['missing.test.ts'] }), /未收集/);
    assert.throws(() => selectFiles(catalog, { suite: 'contracts' }), /为空/);
    assert.throws(() => selectFiles(catalog, { suite: 'unknown' }), /未知/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runner validates arguments and preserves skipped/cancelled TAP counts', () => {
  assert.equal(parseArgs(['--suite', 'portal', '--file', 'a.test.ts', '--reverse']).reverse, true);
  for (const args of [['--file'], ['--timeout', 'NaN'], ['--wat']]) assert.throws(() => parseArgs(args));
  assert.deepEqual(summarizeTap('# tests 3\n# pass 1\n# fail 0\n# skipped 1\n# cancelled 1\n# todo 0\n'),
    { tests: 3, pass: 1, fail: 0, skipped: 1, cancelled: 1, todo: 0 });
});

test('executor distinguishes failed processes, missing executables, and timeout', async () => {
  const failed = await execute(process.execPath, ['-e', 'process.exit(4)']);
  assert.equal(failed.exitCode, 4); assert.equal(failed.unavailable, false);
  assert.equal((await execute('sthstart-definitely-missing-executable', [])).unavailable, true);
  const timed = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 150 });
  assert.equal(timed.timedOut, true);
});
