import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { execute } from '../../scripts/testing/run.mjs';
import { synchronize } from '../../scripts/sync-story-skills.mjs';

const names = ['character-design', 'continuity-check', 'scene-writing', 'story-outline', 'story-scene-flow'];
test('story skill sources have usable discovery metadata and readonly synchronization passes', async () => {
  const hash = async () => {
    const contents = await Promise.all(names.map(name => readFile(`apps/service/src/story/skills/${name}/SKILL.md`, 'utf8')));
    for (const content of contents) {
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content); assert.ok(match);
      const metadata = parse(match[1]);
      assert.equal(typeof metadata.name, 'string'); assert.ok(metadata.description?.trim());
    }
    return createHash('sha256').update(contents.join('\n')).digest('hex');
  };
  const before = await hash();
  const result = await execute(process.execPath, ['scripts/sync-story-skills.mjs', '--check']);
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(await hash(), before, '只读检查不应改变 Skill 源文件');
});

test('synchronizer preserves CRLF-equivalent files, detects drift readonly, is idempotent and leaves unmanaged skills alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-sync-'));
  const source = name => join(root, 'apps/service/src/story/skills', name, 'SKILL.md');
  const target = join(root, '.agents/skills/story-outline/SKILL.md');
  try {
    for (const name of names) { await mkdir(join(source(name), '..'), { recursive: true }); await writeFile(source(name), `---\nname: ${name}\ndescription: 示例技能\n---\n\n正文\n`); }
    const unmanaged = join(root, '.agents/skills/custom/SKILL.md');
    await mkdir(join(unmanaged, '..'), { recursive: true }); await writeFile(unmanaged, '作者自己的技能');
    assert.equal(synchronize(root, true), 5);
    await assert.rejects(stat(target), { code: 'ENOENT' });
    assert.equal(synchronize(root), 5);
    await writeFile(target, (await readFile(target, 'utf8')).replaceAll('\n', '\r\n'));
    const before = (await stat(target)).mtimeMs;
    assert.equal(synchronize(root, true), 0); assert.equal(synchronize(root), 0);
    assert.equal((await stat(target)).mtimeMs, before);
    await writeFile(target, '漂移副本');
    assert.equal(synchronize(root, true), 1); assert.equal(await readFile(target, 'utf8'), '漂移副本');
    assert.equal(synchronize(root), 1); assert.equal(await readFile(unmanaged, 'utf8'), '作者自己的技能');
  } finally { await rm(root, { recursive: true, force: true }); }
});
