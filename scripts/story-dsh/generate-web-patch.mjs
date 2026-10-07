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

// Optional, separate capability. Never reuse the Story or administrator credential.
if (process.env.STHSTART_PUBLICATION_BRIDGE_TOKEN) {
  preset.config.plugins.push({
    id: 'publication-mcp', name: '@deepseek-ai/dsh-mcp-client',
    config: { serverName: 'publication', transport: 'stdio', command: js('process.execPath'),
      args: ['--import', js('process.env.STHSTART_STORY_TSX_IMPORT_PATH'), resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/service/src/publication/mcp-server.ts')],
      cwd: js('process.env.STHSTART_STORY_WORKSPACE'),
      env: { STHSTART_PUBLICATION_BRIDGE_TOKEN: js('process.env.STHSTART_PUBLICATION_BRIDGE_TOKEN'),
        STHSTART_STORY_PROJECT_ID: js('process.env.STHSTART_STORY_PROJECT_ID'),
        STHSTART_STORY_PORTAL_URL: js('process.env.STHSTART_STORY_PORTAL_URL') }, failOnStartupError: true },
  });
}

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
3. 主动建议并提议落地：当与作者商讨确定了大纲、设定或某一章的完整小说正文后，主动调用 submit_proposal 工具向 SthStart 提交为正式提案（支持 create 新建章节或 update 更新大纲），方便作者在前端一键审阅合并入库！
4. 续接创作时先用 list_proposals 查已有提案；需要历史依据时用 list_entry_revisions/read_entry_revision。过期提案先重读当前内容再提交新提案，迁移基线不代表真实早期历史。`,
    suffix: `当前项目工作区为 {{cwd}}。`,
  },
};
if (personaIndex === -1) preset.config.plugins.unshift(storyPersona);
else preset.config.plugins[personaIndex] = storyPersona;
// dsh-persona registers a unique deployment:persona-prefix section per agent scope.
// Keep one persona and extend its instructions instead of installing a second plugin.
if (process.env.STHSTART_PUBLICATION_BRIDGE_TOKEN) {
  storyPersona.config.prefix += '\n【制作作品】制作作品请使用独立 publication MCP。新会话先 list_publications/list_runs 找回作品与任务，再读取冻结来源和草稿。get_publication_options 查询真实配置，validate_publication_plan/preview_publication_run 核对方案；历史批准存在不等于有效。英文画面提示词由你一次编写，不依赖后端二次改写。局部修改用 patch_publication_plan，冲突后先重读。list_shot_images/list_utterance_audio 查询候选，read_publication_artifact 读取预览；仅支持文本或媒体未进入上下文时不能声称已看图/听审。提交方案后等待人类确认预算；只能执行已批准的方案。unknown 结果不得自动重投；正式剧情仍只通过 Story 待审提案改变。';
}

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
