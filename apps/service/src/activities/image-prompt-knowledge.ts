import type { KnowledgeHit } from '@sthstart/contracts';
import {
  PARITY_KNOWLEDGE_CONTENT_HASH, PARITY_KNOWLEDGE_DATASET_VERSION, PARITY_KNOWLEDGE_ITEMS,
  PARITY_KNOWLEDGE_SOURCE_COMMIT, PARITY_KNOWLEDGE_SOURCE_SHA256,
  type ParityKnowledgeItem, type ParityKnowledgeTag,
} from './image-prompt-knowledge-data.js';

/**
 * 关键词知识检索与作用域规则（计划 §8）。
 *
 * 本轮只移植邻舍的关键词分支：日志与诊断明确标记 `keyword`，不冒充 `hybrid`。
 * 不做向量库、不做嵌入服务、不做同步调度器。
 *
 * 与邻舍的差异（有意为之）：
 * - 邻舍用全局正则清理原提示词；本模块只在**结构化作用域**内增删标签，
 *   从不重写自然语言，避免删掉另一个角色的相反姿态或关系句。
 * - 每个作用域最多 9 条知识；候选标签沿用邻舍的分类配额。
 */

export const MAX_KNOWLEDGE_PER_SCOPE = 9;
const DEFAULT_CATEGORY_LIMIT = 2;
/** 与邻舍 imagePromptPreparer 的 CATEGORY_LIMITS 一致。 */
export const CATEGORY_LIMITS = new Map<string, number>([
  ['character_vocabulary', 2],
  ['clothing_vocabulary', 3],
  ['expression_pose_vocabulary', 3],
  ['environment_vocabulary', 4],
  ['scene_vocabulary', 3],
  ['object_vocabulary', 2],
  ['camera_vocabulary', 2],
  ['visual_style_vocabulary', 2],
]);
const FRAMEWORK_KEYWORD_BOOST = 15;

export const TAG_ALIASES = new Map<string, string[]>([
  ['closed_eyes', ['eyes closed']],
  ['looking_at_viewer', ['looking at the viewer', 'direct eye contact', 'eye contact']],
  ['facing_away', ['back view', 'back facing']],
  ['from_behind', ['back view']],
  ['full_body', ['whole body']],
  ['close-up', ['closeup', 'headshot']],
  ['rain', ['rainy']],
]);

export const KNOWLEDGE_CONFLICT_GROUPS: string[][] = [
  ['close-up', 'close_up', 'full_body', 'wide_shot', 'cowboy_shot', 'upper_body'],
  ['from_front', 'from_behind'],
  ['from_above', 'from_below'],
  ['looking_at_viewer', 'facing_away', 'looking_away'],
  ['standing', 'sitting', 'lying', 'on_back'],
  ['open_mouth', 'closed_mouth'],
  ['spread_fingers', 'clenched_fist'],
  ['spread_legs', 'legs_together'],
];

export interface KnowledgeDatasetInfo {
  datasetVersion: string;
  sourceCommit: string;
  sourceSha256: string;
  contentHash: string;
  itemCount: number;
  tagCount: number;
}

export function knowledgeDatasetInfo(): KnowledgeDatasetInfo {
  return {
    datasetVersion: PARITY_KNOWLEDGE_DATASET_VERSION,
    sourceCommit: PARITY_KNOWLEDGE_SOURCE_COMMIT,
    sourceSha256: PARITY_KNOWLEDGE_SOURCE_SHA256,
    contentHash: PARITY_KNOWLEDGE_CONTENT_HASH,
    itemCount: PARITY_KNOWLEDGE_ITEMS.length,
    tagCount: PARITY_KNOWLEDGE_ITEMS.reduce((sum, item) => sum + item.executableTags.length, 0),
  };
}

// ── 归一化与打分（移植邻舍口径） ──

export function normalizeForMatch(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTagKey(value: unknown): string {
  return normalizeForMatch(value).replace(/\s+/g, '_');
}

function phraseInPrompt(promptText: string, phrase: string): boolean {
  const normalized = normalizeForMatch(phrase);
  if (!normalized) return false;
  if (/[\p{Script=Han}]/u.test(normalized)) return promptText.includes(normalized);
  return ` ${promptText} `.includes(` ${normalized} `);
}

function chineseHanBigrams(text: string): string[] {
  const words = String(text ?? '').match(/[\u3400-\u9fff]+/g) ?? [];
  const grams = new Set<string>();
  for (const word of words) {
    if (word.length === 1) grams.add(word);
    for (let index = 0; index < word.length - 1; index += 1) grams.add(word.slice(index, index + 2));
  }
  return [...grams];
}

function scoreChineseLabelOverlap(labelText: string, matchText: string): number {
  if (!/[\p{Script=Han}]/u.test(labelText || '') || !/[\p{Script=Han}]/u.test(matchText || '')) return 0;
  const labelGrams = chineseHanBigrams(labelText);
  if (!labelGrams.length) return 0;
  const matchGrams = new Set(chineseHanBigrams(matchText));
  const matched = labelGrams.filter((gram) => matchGrams.has(gram)).length;
  if (matched === 0) return 0;
  if (matched === labelGrams.length) return 16;
  if (matched / labelGrams.length >= 0.5) return 14;
  return 10;
}

export function scoreExecutableTag(matchText: string, entry: ParityKnowledgeTag): number {
  const tag = String(entry?.tag ?? '').trim();
  if (!tag) return 0;
  const normalizedTag = normalizeForMatch(tag);
  if (!normalizedTag) return 0;
  let score = 0;
  if (phraseInPrompt(matchText, normalizedTag)) score = 20;
  const label = normalizeForMatch(entry?.label);
  if (label && phraseInPrompt(matchText, label)) score = Math.max(score, 20);
  for (const alias of TAG_ALIASES.get(normalizeTagKey(tag)) ?? []) {
    if (phraseInPrompt(matchText, alias)) score = Math.max(score, 16);
  }
  if (score === 0) score = scoreChineseLabelOverlap(label, matchText);
  if (score === 0) {
    const parts = normalizedTag.split(' ').filter((part) => part.length > 1);
    const matched = parts.filter((part) => phraseInPrompt(matchText, part)).length;
    if (parts.length >= 2 && matched === parts.length) score = 12;
  }
  return score;
}

/** 中文不像英文可以用空格分词；滑动 n-gram 才能命中标签里的连续子串。 */
export function tokenizeKnowledgeQuery(text: string): string[] {
  const normalized = String(text ?? '').toLowerCase();
  const latin = normalized.match(/[a-z0-9_()-]{2,}/g) ?? [];
  const han = [...normalized.matchAll(/[\u3400-\u9fff]+/g)].flatMap(([word]) => {
    if (word.length === 1) return [word];
    const grams: string[] = [];
    for (let size = Math.min(4, word.length); size >= 2; size -= 1) {
      for (let index = 0; index <= word.length - size; index += 1) grams.push(word.slice(index, index + size));
    }
    return grams;
  });
  return [...new Set([...latin, ...han])];
}

export interface KnowledgeRetrievalOptions {
  /** 本轮只实现 keyword；其它取值返回明确错误，不静默降级。 */
  mode?: 'keyword' | 'vector' | 'hybrid';
  limit?: number;
  scene?: string | null;
  items?: readonly ParityKnowledgeItem[];
}

export interface KnowledgeRetrievalResult {
  mode: 'keyword';
  items: ParityKnowledgeItem[];
  durationMs: number;
  dataset: KnowledgeDatasetInfo;
  note: string;
}

/**
 * 关键词检索：searchTerms(3) / title(2) / content(1)，默认条目给 0.05，
 * 规则类条目（非 `ipk.lib.`）命中后加 15，按分数与 priority 排序。
 */
export function retrieveImagePromptKnowledge(
  query: string,
  options: KnowledgeRetrievalOptions = {},
): KnowledgeRetrievalResult {
  const requested = options.mode ?? 'keyword';
  if (requested !== 'keyword') {
    throw Object.assign(new Error(`本轮只支持关键词补全（keyword），不支持 ${requested}。`), {
      code: 'knowledge_mode_unsupported', statusCode: 400,
    });
  }
  const startedAt = Date.now();
  const source = options.items ?? PARITY_KNOWLEDGE_ITEMS;
  const terms = tokenizeKnowledgeQuery(query);
  const scene = options.scene ?? null;
  const limit = Math.max(1, options.limit ?? 20);
  const scored: Array<{ item: ParityKnowledgeItem; score: number }> = [];
  for (const item of source) {
    if (scene && item.scenes.length && !item.scenes.includes(scene)) continue;
    const title = item.title.toLowerCase();
    const searchTerms = item.searchTerms.toLowerCase();
    const content = item.content.toLowerCase();
    let score = item.isDefault ? 0.05 : 0;
    let matched = false;
    for (const term of terms) {
      if (searchTerms.includes(term)) { score += 3; matched = true; }
      if (title.includes(term)) { score += 2; matched = true; }
      if (content.includes(term)) { score += 1; matched = true; }
    }
    // 默认条目（isDefault）即使没有词命中也要保留：它们承载 count/camera/gaze
    // 这类作用域规则，邻舍的关键词分支同样是 `score > 0` 而不是“必须命中”。
    if (score <= 0) continue;
    // 命中才给规则条目加权，未命中的默认规则不靠权重挤掉词表条目（与邻舍一致）。
    if (matched && !item.knowledgeId.startsWith('ipk.lib.')) score += FRAMEWORK_KEYWORD_BOOST;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || b.item.priority - a.item.priority);
  return {
    mode: 'keyword',
    items: scored.slice(0, limit).map((entry) => entry.item),
    durationMs: Date.now() - startedAt,
    dataset: knowledgeDatasetInfo(),
    note: '仅关键词召回；未使用向量库，也未与向量结果混合。',
  };
}

// ── 候选标签选择 ──

export interface SelectedKnowledgeTag {
  tag: string;
  key: string;
  category: string;
  knowledgeId: string;
  score: number;
  priority: number;
  reason: string;
}

export interface KnowledgeRemovedTag { tag: string; knowledgeId: string; reason: string }

/** 否定语境检测：命中否定词时不补全该标签，且不做全局删除。 */
export function isNegatedNearby(text: string, phrase: string): boolean {
  const normalized = normalizeForMatch(text);
  const target = normalizeForMatch(phrase);
  if (!normalized || !target) return false;
  const index = normalized.indexOf(target);
  if (index < 0) return false;
  const window = normalized.slice(Math.max(0, index - 24), index);
  return /(?:^|\s)(?:no|not|without|never|avoid|exclude|remove|absent|missing)(?:\s|$)/.test(window)
    || /(?:没有|不|无|未|别|禁止|避免|去掉|移除)/.test(window);
}

function exactPromptSegments(prompt: string): Set<string> {
  return new Set(String(prompt ?? '')
    .split(/[,;\n]+/)
    .map(normalizeTagKey)
    .filter(Boolean));
}

export interface SelectTagsOptions {
  /** 该作用域已有的标签键；这些键不再补全。 */
  existingKeys?: ReadonlySet<string>;
  /** 作用域上限，默认 9。 */
  limit?: number;
  /** 作用域名称，写入诊断。 */
  scope: string;
}

export interface SelectTagsResult {
  selected: SelectedKnowledgeTag[];
  removedTags: KnowledgeRemovedTag[];
  warnings: string[];
}

/**
 * 为**一个作用域**选择可执行标签。绝不在调用方之间共享去重集合，
 * 因此第二个角色不会被第一个角色的同标签挤掉。
 */
export function selectExecutableTagsForScope(
  sourceText: string,
  items: readonly ParityKnowledgeItem[],
  options: SelectTagsOptions,
): SelectTagsResult {
  const matchText = normalizeForMatch(sourceText);
  const existing = new Set(options.existingKeys ?? exactPromptSegments(sourceText));
  const limit = Math.max(1, options.limit ?? MAX_KNOWLEDGE_PER_SCOPE);
  const warnings: string[] = [];
  const removedTags: KnowledgeRemovedTag[] = [];
  const candidates: SelectedKnowledgeTag[] = [];
  for (const item of items) {
    for (const entry of item.executableTags) {
      const tag = String(entry?.tag ?? '').trim();
      if (!tag) continue;
      const score = scoreExecutableTag(matchText, entry);
      if (score === 0) continue;
      if (isNegatedNearby(sourceText, tag) || (entry.label && isNegatedNearby(sourceText, entry.label))) {
        removedTags.push({ tag, knowledgeId: item.knowledgeId, reason: '来源中的否定语境，未补全该标签' });
        continue;
      }
      candidates.push({
        tag, key: normalizeTagKey(tag), category: item.category, knowledgeId: item.knowledgeId,
        score, priority: item.priority, reason: entry.label ? `matched:${entry.label}` : 'matched:tag',
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.priority - a.priority || a.tag.length - b.tag.length);
  const selected: SelectedKnowledgeTag[] = [];
  const seen = new Set<string>();
  const categoryCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (!candidate.key || seen.has(candidate.key) || existing.has(candidate.key)) continue;
    const count = categoryCounts.get(candidate.category) ?? 0;
    const categoryLimit = CATEGORY_LIMITS.get(candidate.category) ?? DEFAULT_CATEGORY_LIMIT;
    if (count >= categoryLimit) continue;
    selected.push(candidate);
    seen.add(candidate.key);
    categoryCounts.set(candidate.category, count + 1);
  }
  if (candidates.length > selected.length) {
    warnings.push(`作用域 ${options.scope}：${candidates.length} 个候选标签中选中 ${selected.length} 条（上限 ${limit}，分类配额生效）。`);
  }
  return { selected, removedTags, warnings };
}

// ── 作用域规则 ──

export interface ScopedRuleInput {
  /** 该作用域可用的规则类知识（`ipk.*` 规则条目）。 */
  items: readonly ParityKnowledgeItem[];
  /** 该作用域的来源文本，用于判定规则是否适用。 */
  sourceText: string;
  /** 该作用域已有的标签（会被规则读取与增删）。 */
  tags: string[];
}

export interface ScopedRuleResult {
  tags: string[];
  removedTags: KnowledgeRemovedTag[];
  appliedRules: string[];
  warnings: string[];
}

const MULTI_PERSON_PATTERN = /\b(two|three|duo|couple|group|crowd|multiple|2girls|2boys|3girls|3boys)\b|\b1girl\s+1boy\b/;

/**
 * 在一个作用域内应用规则：只增删该作用域的标签数组，不触碰自然语言。
 * 无法安全归因时保留原句并给出诊断。
 */
export function applyScopedKnowledgeRules(input: ScopedRuleInput): ScopedRuleResult {
  const tags = [...input.tags];
  const removedTags: KnowledgeRemovedTag[] = [];
  const appliedRules: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(input.items.map((item) => item.knowledgeId));
  const matchText = normalizeForMatch(input.sourceText);
  const keys = new Set(tags.map(normalizeTagKey));

  const add = (tag: string, knowledgeId: string, reason: string) => {
    if (phraseInPrompt(matchText, tag)) return;
    if (keys.has(normalizeTagKey(tag))) return;
    tags.push(tag);
    keys.add(normalizeTagKey(tag));
    appliedRules.push(`${knowledgeId}:add:${tag}:${reason}`);
  };
  const remove = (targets: string[], knowledgeId: string, reason: string) => {
    const targetKeys = new Set(targets.map(normalizeTagKey));
    for (let index = tags.length - 1; index >= 0; index -= 1) {
      if (!targetKeys.has(normalizeTagKey(tags[index]))) continue;
      removedTags.push({ tag: tags[index], knowledgeId, reason });
      keys.delete(normalizeTagKey(tags[index]));
      tags.splice(index, 1);
    }
  };

  if (ids.has('ipk.count.solo') && !MULTI_PERSON_PATTERN.test(matchText)) {
    add('solo', 'ipk.count.solo', 'single-subject default');
    remove(['2girls', '2boys', '3girls', '3boys', 'multiple_girls', 'multiple_boys'], 'ipk.count.solo', 'conflicts with solo');
  }
  if (ids.has('ipk.gaze.sleep') && /\b(sleep|sleeping|asleep|unconscious|nap|napping)\b/.test(matchText)) {
    add('closed_eyes', 'ipk.gaze.sleep', 'sleep requires closed eyes');
    remove(['looking_at_viewer', 'direct_eye_contact', 'open_eyes'], 'ipk.gaze.sleep', 'conflicts with sleeping');
  }
  if (ids.has('ipk.camera.closeup') && /\b(close up|closeup|headshot|face focus)\b/.test(matchText)) {
    add('close-up', 'ipk.camera.closeup', 'explicit close-up framing');
    remove(['full_body', 'wide_shot'], 'ipk.camera.closeup', 'conflicts with close-up');
  } else if (ids.has('ipk.camera.fullbody') && /\b(full body|whole body)\b/.test(matchText)) {
    add('full_body', 'ipk.camera.fullbody', 'explicit full-body framing');
    remove(['close-up', 'close_up', 'headshot'], 'ipk.camera.fullbody', 'conflicts with full body');
  }
  if (ids.has('ipk.gaze.away') && /\b(from behind|back view|facing away)\b/.test(matchText) && !/\bover shoulder\b/.test(matchText)) {
    remove(['looking_at_viewer'], 'ipk.gaze.away', 'conflicts with facing away');
  }
  if (ids.has('ipk.environment.night') && /\b(night|nighttime|evening)\b/.test(matchText)) {
    add('night', 'ipk.environment.night', 'explicit night scene');
    remove(['bright_sunlight', 'daytime'], 'ipk.environment.night', 'conflicts with night');
  }
  if (ids.has('ipk.environment.day') && /\b(day|daytime|morning|afternoon)\b/.test(matchText)) {
    remove(['night', 'moonlight'], 'ipk.environment.day', 'conflicts with daytime');
  }
  return { tags, removedTags, appliedRules, warnings };
}

/** 同一作用域内的互斥组裁决：只保留分数最高的一条，其余进入诊断。 */
export function resolveScopedConflicts(
  selected: SelectedKnowledgeTag[],
): { selected: SelectedKnowledgeTag[]; removedTags: KnowledgeRemovedTag[] } {
  const removedTags: KnowledgeRemovedTag[] = [];
  const result = [...selected];
  for (const group of KNOWLEDGE_CONFLICT_GROUPS) {
    const groupKeys = new Set(group.map(normalizeTagKey));
    const matches = result.filter((item) => groupKeys.has(item.key))
      .sort((a, b) => b.score - a.score || b.priority - a.priority);
    if (matches.length <= 1) continue;
    const keep = matches[0];
    for (const item of matches.slice(1)) {
      const index = result.indexOf(item);
      if (index >= 0) result.splice(index, 1);
      removedTags.push({ tag: item.tag, knowledgeId: item.knowledgeId, reason: `conflicts with ${keep.tag}` });
    }
  }
  return { selected: result, removedTags };
}

/** 转换成契约里的诊断结构。 */
export function toKnowledgeHits(
  selected: readonly SelectedKnowledgeTag[],
  actorId: string | null,
): KnowledgeHit[] {
  return selected.map((item) => ({
    knowledgeId: item.knowledgeId,
    actorId,
    tags: [item.tag],
    score: item.score,
    reason: item.reason,
  }));
}
