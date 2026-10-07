#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only these five generated targets belong to this synchronizer.
// Register new story skills explicitly; never modify other workspace skills.
const managedSkills = [
  ['character-design', 'story-character-design'],
  ['continuity-check', 'story-continuity-check'],
  ['scene-writing', 'story-scene-writing'],
  ['story-outline', 'story-outline'],
  ['story-scene-flow', 'story-scene-flow'],
];

export function generatedContent(content, sourceName, targetName) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match || !/^name:[^\r\n]+(?=\r?$)/m.test(match[1])) {
    throw new Error(`Invalid skill frontmatter: ${sourceName}/SKILL.md`);
  }
  const frontmatter = match[1].replace(/^name:[^\r\n]+(?=\r?$)/m, `name: ${targetName}`);
  const sourcePath = `apps/service/src/story/skills/${sourceName}/SKILL.md`;
  const note = `<!-- Generated from ${sourcePath}. Edit the source and run npm run skills:sync. -->`;
  const body = content.slice(match[0].length).replace(/^(?:\r?\n)+/, '');
  return `---\n${frontmatter}\n---\n\n${note}\n\n${body}`;
}

export function synchronize(root = rootDir, check = false) {
  const sourceSkillsDir = path.join(root, 'apps', 'service', 'src', 'story', 'skills');
  const targetSkillsDir = path.join(root, '.agents', 'skills');
  const entries = managedSkills.map(([sourceName, targetName]) => {
    const sourcePath = path.join(sourceSkillsDir, sourceName, 'SKILL.md');
    const targetPath = path.join(targetSkillsDir, targetName, 'SKILL.md');
    const expected = generatedContent(fs.readFileSync(sourcePath, 'utf8'), sourceName, targetName);
    const actual = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
    return { targetName, targetPath, expected, actual };
  });
  let differences = 0;
  for (const { targetName, targetPath, expected, actual } of entries) {
    // Git's Windows checkout may use CRLF. Compare logical text without rewriting equal copies.
    if (actual?.replaceAll('\r\n', '\n') === expected.replaceAll('\r\n', '\n')) continue;
    differences += 1;
    if (check) console.error(`${actual === null ? 'Missing' : 'Different'}: .agents/skills/${targetName}/SKILL.md`);
    else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, expected, 'utf8'); console.log(`Synced: .agents/skills/${targetName}/SKILL.md`);
    }
  }
  return differences;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: npm run skills:sync [-- --check]\n--check reports missing or different generated skills without writing files.');
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Unknown arguments. Use --check for a read-only check, or no arguments to sync.');
  }
  const check = args[0] === '--check';

  // Read every source before writing anything, so a missing source cannot cause a partial sync.
  const differences = synchronize(rootDir, check);
  if (check && differences) {
    console.error(`${differences} story skill(s) need syncing. Run npm run skills:sync.`);
    process.exitCode = 1;
  } else {
    console.log(check ? 'All 5 story skills are in sync.' : `Story skill synchronization complete (${differences} updated).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
