#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const sourceNames = [
  'story-outline',
  'character-design',
  'scene-writing',
  'story-scene-flow',
  'continuity-check',
];

export const legacySkillDirs = [
  'story-character-design',
  'story-continuity-check',
  'story-outline',
  'story-scene-flow',
  'story-scene-writing',
];

export const targetSkillName = 'story-creative-suite';

const moduleMetadata = [
  { name: 'story-outline', title: '模块一：主线大纲规划 (Story Outline)' },
  { name: 'character-design', title: '模块二：人物深度塑造 (Character Design)' },
  { name: 'scene-writing', title: '模块三：场景与对白写作 (Scene Writing)' },
  { name: 'story-scene-flow', title: '模块四：小说转剧本流与解析器适配 (Scene Flow & StoryCompiler)' },
  { name: 'continuity-check', title: '模块五：剧情连贯性与逻辑审查 (Continuity Check)' },
];

export function extractBody(content, sourceName) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match || !/^name:[^\r\n]+(?=\r?$)/m.test(match[1])) {
    throw new Error(`Invalid skill frontmatter: ${sourceName}/SKILL.md`);
  }
  return content.slice(match[0].length).replace(/^(?:\r?\n)+/, '').trim();
}

export function assembleStorySuite(sourcesMap) {
  const sections = moduleMetadata.map(({ name, title }) => {
    const rawContent = sourcesMap[name];
    if (!rawContent) {
      throw new Error(`Missing source content for story module: ${name}`);
    }
    const body = extractBody(rawContent, name);
    // Replace top-level "# Title" with the structured section title, and demote child headings
    const contentWithoutH1 = body.replace(/^#\s+[^\r\n]+(?:\r?\n)*/, '');
    const adjustedBody = contentWithoutH1
      .replaceAll('### ', '#### ')
      .replaceAll('## ', '### ');
    return `## ${title}\n\n<!-- Source: apps/service/src/story/skills/${name}/SKILL.md -->\n\n${adjustedBody}`;
  });

  const header = `---
name: ${targetSkillName}
description: 在 SthStart 剧情创作中提供一体化创作套件：涵盖主线大纲规划、人物深度塑造、具体场景编写、小说转剧本流适配（StoryCompiler）以及剧情连贯性审查；遵循作者结构，统一协调创作与提案流程。
---

<!-- Generated from apps/service/src/story/skills/*. Edit the sources and run npm run skills:sync. -->

# 剧情创作一体化套件 (Story Creative Suite)

本套件整合 SthStart 剧情创作五大核心模块，遵循作者已有结构，协调剧情分析、创作、剧本流编译与版本提案全流程。

## 通用操作与提案规范

1. **资料获取与 MCP 优先**：
   - 优先使用用户提供的上下文与正文。
   - 当需要项目全局资料且 Story MCP 可用时，先确认当前项目，再使用 \`list_entries\`、\`read_entry\` 或 \`search_entries\`；当返回内容截断或有分页时补读。无 MCP 时在文本范围内展开，注明正式资料缺口。
2. **事实、推测与建议分层**：
   - 严格区分已有设定事实、合理推测与脑暴修改建议。不捏造未提供的条目或 ID。
3. **提案边界与作者主权**：
   - 分析、审查和草稿预览绝不自动提交提案，更不自动覆盖正文。
   - 仅在用户明确要求提交时，读取目标真实 ID 与 revision，调用 \`submit_proposal\`。说明提案待作者审阅。已授权的内容不反复弹窗确认。

---
`;

  return `${header}\n${sections.join('\n\n---\n\n')}\n`;
}

export function synchronize(root = rootDir, check = false) {
  const sourceSkillsDir = path.join(root, 'apps', 'service', 'src', 'story', 'skills');
  const targetDir = path.join(root, '.agents', 'skills', targetSkillName);
  const targetPath = path.join(targetDir, 'SKILL.md');

  const sourcesMap = {};
  for (const name of sourceNames) {
    const sourcePath = path.join(sourceSkillsDir, name, 'SKILL.md');
    sourcesMap[name] = fs.readFileSync(sourcePath, 'utf8');
  }

  const expectedSuite = assembleStorySuite(sourcesMap);
  const actualSuite = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;

  let differences = 0;

  // Check consolidated suite
  if (actualSuite?.replaceAll('\r\n', '\n') !== expectedSuite.replaceAll('\r\n', '\n')) {
    differences += 1;
    if (check) {
      console.error(`${actualSuite === null ? 'Missing' : 'Different'}: .agents/skills/${targetSkillName}/SKILL.md`);
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, expectedSuite, 'utf8');
      console.log(`Synced: .agents/skills/${targetSkillName}/SKILL.md`);
    }
  }

  // Check legacy skill directories to prune
  const agentsSkillsDir = path.join(root, '.agents', 'skills');
  for (const legacyName of legacySkillDirs) {
    const legacyDir = path.join(agentsSkillsDir, legacyName);
    if (fs.existsSync(legacyDir)) {
      differences += 1;
      if (check) {
        console.error(`Legacy skill directory present: .agents/skills/${legacyName}`);
      } else {
        fs.rmSync(legacyDir, { recursive: true, force: true });
        console.log(`Pruned legacy skill: .agents/skills/${legacyName}`);
      }
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

  const differences = synchronize(rootDir, check);
  if (check && differences) {
    console.error(`${differences} story skill drift(s) detected. Run npm run skills:sync.`);
    process.exitCode = 1;
  } else {
    console.log(check ? 'Consolidated story skill suite is in sync.' : `Story skill synchronization complete (${differences} update(s)).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
