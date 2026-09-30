import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify } from 'yaml';

class DshJsExpression {
  constructor(value) { this.value = value; }
}

const customTags = [{
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => new DshJsExpression(value),
  identify: (value) => value instanceof DshJsExpression,
  stringify: (item) => JSON.stringify(item.value.value),
}];

function js(value) { return new DshJsExpression(value); }

const output = process.argv[2];
if (!output) throw new Error('Usage: node generate-web-patch.mjs <output-path>');
const templateUrl = import.meta.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml');
const source = await readFile(fileURLToPath(templateUrl), 'utf8');
const document = parseDocument(source, { customTags });
if (document.errors.length) throw new Error(`Could not parse DSH standard preset: ${document.errors.map((e) => e.message).join('; ')}`);
const entries = document.toJS();
const preset = entries.find((entry) => entry?.insert?.some((row) => row?.id === 'preset-standard'))
  ?.insert?.find((row) => row?.id === 'preset-standard');
if (!preset || !Array.isArray(preset.config?.plugins)) throw new Error('The installed DSH web profile no longer exposes its standard plugin list.');

const mcp = {
  id: 'story-mcp',
  name: '@deepseek-ai/dsh-mcp-client',
  config: {
    serverName: 'story',
    transport: 'stdio',
    command: js('process.execPath'),
    args: ['--import', js('process.env.STHSTART_STORY_TSX_IMPORT_PATH'), js('process.env.STHSTART_STORY_MCP_SOURCE_PATH')],
    cwd: js('process.env.STHSTART_STORY_WORKSPACE'),
    env: {
      STHSTART_STORY_BRIDGE_TOKEN: js('process.env.STHSTART_STORY_BRIDGE_TOKEN'),
      STHSTART_STORY_PROJECT_ID: js('process.env.STHSTART_STORY_PROJECT_ID'),
      STHSTART_STORY_PORTAL_URL: js('process.env.STHSTART_STORY_PORTAL_URL'),
    },
    failOnStartupError: true,
  },
};
const previous = preset.config.plugins.findIndex((entry) => entry?.id === mcp.id);
if (previous === -1) preset.config.plugins.push(mcp);
else preset.config.plugins[previous] = mcp;

// 定制 SthStart 剧情创作专属 Persona
const personaIndex = preset.config.plugins.findIndex((entry) => entry?.id === 'persona');
const storyPersona = {
  id: 'persona',
  name: '@deepseek-ai/dsh-persona',
  config: {
    prefix: `你是由 {{model}} 模型驱动的 SthStart 剧情小说创作首席顾问与编剧协作者。
你的核心任务是协助创作者完成纯文字小说构思、世界观拓展、分卷大纲架构以及高质量正文创作。
【核心工作原则】
1. 纯文字小说优先：注重文学修辞、视听化白描、心理活动与场景氛围，杜绝生硬机械的代码化表达。
2. 尊重既有设定：你可以使用已加载的 story MCP 工具（get_project / list_entries / read_entry / search_entries）查询当前作品的世界观背景与角色小传，在对话与正文创作中严格保持角色声线、性格与设定的一致性。
3. 主动建议并提议落地：当与作者商讨确定了大纲、设定或某一章的完整小说正文后，主动调用 submit_proposal 工具向 SthStart 提交为正式提案（支持 create 新建章节或 update 更新大纲），方便作者在前端一键审阅合并入库！`,
    suffix: `当前项目工作区为 {{cwd}}。`,
  },
};
if (personaIndex === -1) preset.config.plugins.unshift(storyPersona);
else preset.config.plugins[personaIndex] = storyPersona;

// 注入剧情专属技能目录
const skillFsIndex = preset.config.plugins.findIndex((entry) => entry?.id === 'skill-filesystem');
const skillsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/service/src/story/skills');
if (skillFsIndex !== -1) {
  preset.config.plugins[skillFsIndex].config = {
    ...preset.config.plugins[skillFsIndex].config,
    customSkillDirs: [skillsDir],
  };
}

// DSH Web otherwise creates its first Workspace under the user's shared
// Documents/deepseek-harness directory even when DSH_HOME is project-specific.
entries.push({ id: 'workspace-controller', config: {
  documentsDirectory: js('process.env.STHSTART_STORY_WORKSPACE'),
} });

const resolvedOutput = resolve(output);
await mkdir(dirname(resolvedOutput), { recursive: true });
await writeFile(resolvedOutput, stringify(entries, { customTags, lineWidth: 120 }), 'utf8');
