/**
 * 生成 `apps/service/src/activities/image-prompt-knowledge-data.ts`（计划 §8.2）。
 *
 *   node scripts/generate-parity-knowledge-data.mjs            # 重新生成
 *   node scripts/generate-parity-knowledge-data.mjs --check    # 只校验快照是否与来源一致
 *   node scripts/generate-parity-knowledge-data.mjs --ref <sha>
 *
 * 这是**离线生成工具**，不属于任何运行时路径：服务端只读取生成出来的静态 TS 数据文件，
 * 不在运行时 import 邻舍子模块。
 *
 * 为什么按 ref 而不是工作区：子模块 HEAD 会随上游同步变化，而词表内容必须钉在固定提交上。
 * 上游 main 已删掉「手部动作(拿着某物)」整组（holding bag / holding book / holding cup …），
 * 跟随 main 重新生成会丢掉故事配图最需要的持物词汇。用 `git show <ref>:<path>` 取内容，
 * 既不受工作区状态影响，也不需要切换子模块分支。
 */
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SOURCE_COMMIT = '6b4c2e517ef72eb606a6ea3577c11804c3a6c603';
const EXCLUDED_PREFIX = 'adult_';
const OUTPUT = 'apps/service/src/activities/image-prompt-knowledge-data.ts';
const SUBMODULE = 'upstream/linshe';
const UPSTREAM_DB = 'agent-core/src/db';

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个值。`);
  return value;
}

const SOURCE_COMMIT = readArg('--ref', DEFAULT_SOURCE_COMMIT);
const checkOnly = process.argv.includes('--check');

function show(path) {
  return execFileSync('git', ['-C', SUBMODULE, 'show', `${SOURCE_COMMIT}:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// 上游 JS 用相对路径读取同目录下的 data/imagePromptTags.yaml，且 import js-yaml。
// 因此临时目录必须放在项目内（.dsh-tmp 已被 .gitignore 忽略），保持同样的相对结构。
// 每次运行用独立目录：并行执行或中断都不会互相删除对方的临时文件。
const scratch = resolve(`.dsh-tmp/parity-knowledge-${process.pid}-${Date.now()}`);
rmSync(scratch, { recursive: true, force: true });
mkdirSync(join(scratch, 'data'), { recursive: true });
writeFileSync(join(scratch, 'imagePromptKnowledgePolicy.js'), show(`${UPSTREAM_DB}/imagePromptKnowledgePolicy.js`), 'utf8');
writeFileSync(join(scratch, 'imagePromptTagKnowledgeData.js'), show(`${UPSTREAM_DB}/imagePromptTagKnowledgeData.js`), 'utf8');
writeFileSync(join(scratch, 'imagePromptKnowledgeData.js'), show(`${UPSTREAM_DB}/imagePromptKnowledgeData.js`), 'utf8');
writeFileSync(join(scratch, 'data/imagePromptTags.yaml'), show(`${UPSTREAM_DB}/data/imagePromptTags.yaml`), 'utf8');

const tag = await import(pathToFileURL(join(scratch, 'imagePromptTagKnowledgeData.js')).href);
const framework = await import(pathToFileURL(join(scratch, 'imagePromptKnowledgeData.js')).href);

const SOURCE_TAG_SHA = tag.IMAGE_PROMPT_TAG_SOURCE_SHA256;
const UPSTREAM_VERSION = framework.IMAGE_PROMPT_KNOWLEDGE_VERSION;
const all = framework.IMAGE_PROMPT_KNOWLEDGE;

const normalize = (item) => ({
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
});

const isAdult = (item) => String(item.category).startsWith(EXCLUDED_PREFIX);
const items = all.filter((item) => !isAdult(item)).map(normalize);
const adultItems = all.filter(isAdult).map(normalize);
const adultCategories = [...new Set(adultItems.map((item) => item.category))].sort();

const hashOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// 安全集哈希保持原有语义：只有安全集变化才让向量索引整体重建。
const contentHash = hashOf(items);
const adultContentHash = hashOf(adultItems);
const datasetVersion = `linshe-parity-1+${contentHash.slice(0, 8)}`;
const adultDatasetVersion = `linshe-parity-adult-1+${adultContentHash.slice(0, 8)}`;
const tagCount = (list) => list.reduce((sum, item) => sum + item.executableTags.length, 0);

const lines = [];
lines.push('// 由上游词表按固定提交生成，请勿手工编辑。');
lines.push('// 重新生成：node scripts/generate-parity-knowledge-data.mjs（先读 docs/development/LINSHE_BORROW_LEDGER.md）。');
lines.push('//');
lines.push('// 来源仓库：SthStart/upstream/linshe（只读子模块，不修改工作区）');
lines.push(`// 来源提交：${SOURCE_COMMIT}`);
lines.push(`// 上游版本标识：${UPSTREAM_VERSION}`);
lines.push(`// 词表文件：${SUBMODULE}/${UPSTREAM_DB}/data/imagePromptTags.yaml`);
lines.push(`// 词表文件 SHA256：${SOURCE_TAG_SHA}`);
lines.push(`// 安全集数据集版本：${datasetVersion}`);
lines.push(`// 安全集内容哈希：${contentHash}`);
lines.push(`// 成人集数据集版本：${adultDatasetVersion}`);
lines.push(`// 成人集内容哈希：${adultContentHash}`);
lines.push('//');
lines.push('// 拆分规则：');
lines.push('// 1. 安全集：只保留通用类别（人物、服装、动作表情、环境、场景、物件、相机、画面风格、结构规则）；');
lines.push(`// 2. 成人集：以 \`${EXCLUDED_PREFIX}\` 开头的成人专用类别，共 ${adultCategories.length} 类：${adultCategories.join('、')}；`);
lines.push('// 3. 两集都不改写标签文本、搜索词与规则正文，不重新排序，不补写内容；');
lines.push('// 4. 成人集默认不参与检索，只有策略显式开启时才并入候选，并使用独立向量命名空间。');
lines.push('//');
lines.push(`// 安全集：${items.length} 条 / ${tagCount(items)} 个可执行标签；成人集：${adultItems.length} 条 / ${tagCount(adultItems)} 个可执行标签（上游共 ${all.length} 条）。`);
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
lines.push(`export const PARITY_KNOWLEDGE_ADULT_DATASET_VERSION = ${JSON.stringify(adultDatasetVersion)};`);
lines.push(`export const PARITY_KNOWLEDGE_ADULT_CONTENT_HASH = ${JSON.stringify(adultContentHash)};`);
lines.push(`export const PARITY_KNOWLEDGE_ADULT_CATEGORIES: readonly string[] = ${JSON.stringify(adultCategories)};`);
lines.push('');
lines.push('export const PARITY_KNOWLEDGE_ITEMS: readonly ParityKnowledgeItem[] = [');
for (const item of items) lines.push(`  ${JSON.stringify(item)},`);
lines.push('];');
lines.push('');
lines.push('/** 成人专用词表：默认不参与检索，仅在策略显式开启时使用。 */');
lines.push('export const PARITY_KNOWLEDGE_ADULT_ITEMS: readonly ParityKnowledgeItem[] = [');
for (const item of adultItems) lines.push(`  ${JSON.stringify(item)},`);
lines.push('];');
lines.push('');

const output = lines.join('\n');
if (checkOnly) {
  const current = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n');
  if (current !== output) throw new Error('图片知识快照与来源不一致，请审查差异后重新生成。');
} else {
  writeFileSync(OUTPUT, output, 'utf8');
}
rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify({
  ref: SOURCE_COMMIT, items: items.length, adultItems: adultItems.length, totalTags: tagCount(items),
  adultTags: tagCount(adultItems), contentHash, adultContentHash, datasetVersion, adultDatasetVersion,
  adultCategories, bytes: output.length,
}, null, 2));
