import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, stat, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { execute } from '../../scripts/testing/run.mjs';
import { synchronize, sourceNames, targetSkillName, legacySkillDirs } from '../../scripts/sync-story-skills.mjs';

test('story skill sources have usable discovery metadata and readonly synchronization passes', async () => {
  const hash = async () => {
    const contents = await Promise.all(sourceNames.map(name => readFile(`apps/service/src/story/skills/${name}/SKILL.md`, 'utf8')));
    for (const content of contents) {
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
      assert.ok(match);
      const metadata = parse(match[1]);
      assert.equal(typeof metadata.name, 'string');
      assert.ok(metadata.description?.trim());
    }
    return createHash('sha256').update(contents.join('\n')).digest('hex');
  };
  const before = await hash();
  const result = await execute(process.execPath, ['scripts/sync-story-skills.mjs', '--check']);
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(await hash(), before, '只读检查不应改变 Skill 源文件');
});

test('synchronizer preserves CRLF-equivalent files, prunes legacy skills, detects drift readonly, is idempotent and leaves unmanaged skills alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-sync-'));
  const source = name => join(root, 'apps/service/src/story/skills', name, 'SKILL.md');
  const target = join(root, '.agents/skills', targetSkillName, 'SKILL.md');
  const legacyDir = join(root, '.agents/skills', legacySkillDirs[0]);

  try {
    for (const name of sourceNames) {
      await mkdir(join(source(name), '..'), { recursive: true });
      await writeFile(source(name), `---\nname: ${name}\ndescription: 示例技能 ${name}\n---\n\n# 模块标题\n\n正文内容\n`);
    }

    // Set up an unmanaged custom skill
    const unmanaged = join(root, '.agents/skills/custom/SKILL.md');
    await mkdir(join(unmanaged, '..'), { recursive: true });
    await writeFile(unmanaged, '作者自己的技能');

    // Create a mock legacy directory to test pruning
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'SKILL.md'), '旧版单体技能');

    // Readonly check detects target missing (1) + legacy dir present (1) = 2 differences
    assert.equal(synchronize(root, true), 2);
    await assert.rejects(stat(target), { code: 'ENOENT' });

    // Sync writes target and prunes legacy dir
    assert.equal(synchronize(root, false), 2);
    assert.ok(await stat(target));
    await assert.rejects(access(legacyDir), { code: 'ENOENT' }, '旧版技能目录应当被清理');

    // CRLF equivalence check
    await writeFile(target, (await readFile(target, 'utf8')).replaceAll('\n', '\r\n'));
    const beforeTime = (await stat(target)).mtimeMs;
    assert.equal(synchronize(root, true), 0);
    assert.equal(synchronize(root, false), 0);
    assert.equal((await stat(target)).mtimeMs, beforeTime);

    // Drift detection
    await writeFile(target, '漂移副本');
    assert.equal(synchronize(root, true), 1);
    assert.equal(await readFile(target, 'utf8'), '漂移副本');
    assert.equal(synchronize(root, false), 1);
    assert.notEqual(await readFile(target, 'utf8'), '漂移副本');

    // Custom skills are left alone
    assert.equal(await readFile(unmanaged, 'utf8'), '作者自己的技能');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
