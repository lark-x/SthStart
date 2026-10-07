/**
 * 一次性生成 `apps/service/src/activities/image-prompt-knowledge-data.ts`（计划 §8.2）。
 *
 *   node scripts/generate-parity-knowledge-data.mjs
 *
 * 这是**离线生成工具**，不属于任何运行时路径：服务端只读取生成出来的静态 TS 数据文件，
 * 不在运行时 import 邻舍子模块。重新生成前必须先确认上游提交未变；提交变化需要重新核对裁剪规则
 * 与内容哈希，并写进实施记录，不能悄悄换数据。
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as tag from '../upstream/linshe/agent-core/src/db/imagePromptTagKnowledgeData.js';
import * as framework from '../upstream/linshe/agent-core/src/db/imagePromptKnowledgeData.js';

const SOURCE_COMMIT = '6b4c2e517ef72eb606a6ea3577c11804c3a6c603';
const SOURCE_TAG_FILE = 'upstream/linshe/agent-core/src/db/data/imagePromptTags.yaml';
const SOURCE_TAG_SHA = tag.IMAGE_PROMPT_TAG_SOURCE_SHA256;
const UPSTREAM_VERSION = framework.IMAGE_PROMPT_KNOWLEDGE_VERSION;

const EXCLUDED_PREFIX = 'adult_';
const all = framework.IMAGE_PROMPT_KNOWLEDGE;
const kept = all.filter((item) => !String(item.category).startsWith(EXCLUDED_PREFIX));
const droppedCategories = [...new Set(all.filter((i) => String(i.category).startsWith(EXCLUDED_PREFIX)).map((i) => i.category))].sort();

const items = kept.map((item) => ({
  knowledgeId: String(item.knowledgeId),
  category: String(item.category),
  title: String(item.title ?? ''),
  searchTerms: String(item.searchTerms ?? ''),
  content: String(item.content ?? ''),
  isDefault: Boolean(item.isDefault),
  priority: Number(item.priority ?? 50),
  scenes: Array.isArray(item.scenes) ? item.scenes.map(String) : [],
  executableTags: (item.executableTags ?? []).map((entry) => ({
    tag: String(entry.tag ?? ''),
    label: String(entry.label ?? ''),
    group: String(entry.group ?? ''),
  })),
}));

const payload = JSON.stringify(items);
const contentHash = createHash('sha256').update(payload).digest('hex');
const datasetVersion = `linshe-parity-1+${contentHash.slice(0, 8)}`;

const lines = [];
lines.push('// 由上游词表裁剪生成，请勿手工编辑。重新生成前先阅读 docs/development/logs/activity-image-linshe-parity-v2-progress.md。');
lines.push('//');
lines.push(`// 来源仓库：SthStart/upstream/linshe（只读子模块）`);
lines.push(`// 来源提交：${SOURCE_COMMIT}`);
lines.push(`// 上游版本标识：${UPSTREAM_VERSION}`);
lines.push(`// 词表文件：${SOURCE_TAG_FILE}`);
lines.push(`// 词表文件 SHA256：${SOURCE_TAG_SHA}`);
lines.push(`// 数据集版本：${datasetVersion}`);
lines.push(`// 内容哈希（本文件 items 的稳定 JSON）：${contentHash}`);
lines.push('//');
lines.push('// 裁剪规则：');
lines.push(`// 1. 只保留通用类别（人物、服装、动作表情、环境、场景、物件、相机、画面风格、结构规则）；`);
lines.push(`// 2. 丢弃所有以 \`${EXCLUDED_PREFIX}\` 开头的成人专用类别，共 ${droppedCategories.length} 类：${droppedCategories.join('、')}；`);
lines.push('// 3. 不改写任何标签文本、搜索词与规则正文，不重新排序，不补写内容。');
lines.push('//');
lines.push(`// 条目数：${items.length}（上游共 ${all.length}）；可执行标签：${items.reduce((sum, item) => sum + item.executableTags.length, 0)} 条。`);
lines.push('');
lines.push('export interface ParityKnowledgeTag { tag: string; label: string; group: string }');
lines.push('');
lines.push('export interface ParityKnowledgeItem {');
lines.push('  knowledgeId: string;');
lines.push('  category: string;');
lines.push('  title: string;');
lines.push('  searchTerms: string;');
lines.push('  content: string;');
lines.push('  isDefault: boolean;');
lines.push('  priority: number;');
lines.push('  scenes: string[];');
lines.push('  executableTags: ParityKnowledgeTag[];');
lines.push('}');
lines.push('');
lines.push(`export const PARITY_KNOWLEDGE_DATASET_VERSION = ${JSON.stringify(datasetVersion)};`);
lines.push(`export const PARITY_KNOWLEDGE_SOURCE_COMMIT = ${JSON.stringify(SOURCE_COMMIT)};`);
lines.push(`export const PARITY_KNOWLEDGE_SOURCE_SHA256 = ${JSON.stringify(SOURCE_TAG_SHA)};`);
lines.push(`export const PARITY_KNOWLEDGE_CONTENT_HASH = ${JSON.stringify(contentHash)};`);
lines.push(`export const PARITY_KNOWLEDGE_DROPPED_CATEGORIES: readonly string[] = ${JSON.stringify(droppedCategories)};`);
lines.push('');
lines.push('export const PARITY_KNOWLEDGE_ITEMS: readonly ParityKnowledgeItem[] = [');
for (const item of items) {
  lines.push(`  ${JSON.stringify(item)},`);
}
lines.push('];');
lines.push('');

const output = lines.join('\n');
writeFileSync('apps/service/src/activities/image-prompt-knowledge-data.ts', output, 'utf8');
console.log(JSON.stringify({ items: items.length, totalTags: items.reduce((s, i) => s + i.executableTags.length, 0), contentHash, datasetVersion, bytes: output.length, droppedCategories }, null, 2));
