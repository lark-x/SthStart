import { Value } from '@sinclair/typebox/value';
import {
  DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS,
  DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS,
  StructuredVisualPromptSchema,
  type KnowledgeHit,
  type RemovedTagDiagnostic,
  type StructuredVisualPrompt,
} from '@sthstart/contracts';
import { compileVisualPrompt, normalizeTagKey, type StructuredActorBlock } from './image-prompt-v2.js';
import {
  applyScopedKnowledgeRules, knowledgeDatasetInfo, resolveScopedConflicts, retrieveImagePromptKnowledge,
  selectExecutableTagsForScope, toKnowledgeHits, type KnowledgeRemovedTag, type SelectedKnowledgeTag,
} from './image-prompt-knowledge.js';

/**
 * 结构化（tags）优化分支（计划 §7.3 / §8.2）。
 *
 * 模型只返回约定 JSON；解析、作用域校验与知识补全全部在服务端完成。
 * 任何一步失败都不提交图片任务，并使用计划 §19 的错误码。
 */

export const STRUCTURED_ERROR_CODES = {
  invalidJson: 'prompt_optimizer_invalid_json',
  actorScope: 'prompt_optimizer_actor_scope_invalid',
  truncated: 'prompt_optimizer_truncated',
} as const;

export interface OptimizerVisualBlocks {
  personCount: string | null;
  characters: StructuredActorBlock[];
  camera: string[];
  environment: string[];
  details: string[];
  naturalLanguage: string;
}

export interface StructuredOptimizationInput {
  /** 模型返回的原始文本。 */
  content: string;
  /** 上游 finish_reason；`length` 表示被截断。 */
  finishReason: string | null;
  /** 本次目标声明的角色作用域，必须与模型输出一致。 */
  actorScope: Array<{ actorId: string; displayName?: string }>;
  knowledgeMode: 'none' | 'keyword';
  /** 知识召回与作用域匹配使用的来源文本。 */
  sourcePrompt: string;
  /** 明确可见人数标签；无法确定时留空，不猜。 */
  personCount?: string | null;
}

export interface StructuredOptimizationResult {
  structured: StructuredVisualPrompt;
  blocks: OptimizerVisualBlocks;
  /** 不含画风与触发词的编译结果，用于记录与日志。 */
  optimizedPrompt: string;
  knowledgeHits: KnowledgeHit[];
  knowledgeVersion: string | null;
  removedTags: RemovedTagDiagnostic[];
  warnings: string[];
}

export class StructuredOptimizationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'StructuredOptimizationError';
    this.code = code;
  }
}

/** 去掉 Markdown 围栏与说明文字，只留下 JSON 主体。 */
function extractJsonObject(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function tagsOf(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
}

/** 规则新增标签的归属槽位：规则只补语义明确的少数标签，其余按外观处理。 */
const RULE_TAG_TARGETS: Record<string, 'personCount' | 'camera' | 'environment' | 'expression'> = {
  solo: 'personCount', 'close-up': 'camera', close_up: 'camera', full_body: 'camera',
  wide_shot: 'camera', night: 'environment', closed_eyes: 'expression',
};

function tagDiff(before: readonly string[], after: readonly string[]): { added: string[]; removed: Set<string> } {
  const beforeKeys = new Set(before.map(normalizeTagKey));
  const afterKeys = new Set(after.map(normalizeTagKey));
  return {
    added: after.filter((tag) => !beforeKeys.has(normalizeTagKey(tag))),
    removed: new Set(before.filter((tag) => !afterKeys.has(normalizeTagKey(tag))).map(normalizeTagKey)),
  };
}

function dropKeys(values: readonly string[], removed: ReadonlySet<string>): string[] {
  return values.filter((tag) => !removed.has(normalizeTagKey(tag)));
}

/** 规则新增与知识补全可能给出同一个标签；同一作用域内只保留第一次出现。 */
function uniqueByKey(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of values) {
    const key = normalizeTagKey(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function parseStructuredOptimization(input: StructuredOptimizationInput): StructuredOptimizationResult {
  if (input.finishReason === 'length') {
    throw new StructuredOptimizationError('模型结果未完整结束（达到长度上限），未提交图片任务。', STRUCTURED_ERROR_CODES.truncated);
  }
  const json = extractJsonObject(input.content);
  if (!json) {
    // 有起始花括号但没有结束花括号，说明结果被截断，而不是格式非法。
    const trimmed = input.content.trim();
    const truncated = trimmed.includes('{') && !trimmed.includes('}');
    throw new StructuredOptimizationError(
      truncated ? '模型结果未完整结束，未提交图片任务。' : '模型未返回合法结构化结果，未提交图片任务。',
      truncated ? STRUCTURED_ERROR_CODES.truncated : STRUCTURED_ERROR_CODES.invalidJson,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // JSON 被截断时 lastIndexOf('}') 之前的内容通常仍不合法；按截断报告更准确。
    throw new StructuredOptimizationError('模型未返回合法结构化结果，未提交图片任务。',
      input.content.trim().endsWith('}') ? STRUCTURED_ERROR_CODES.invalidJson : STRUCTURED_ERROR_CODES.truncated);
  }
  if (!Value.Check(StructuredVisualPromptSchema, parsed)) {
    throw new StructuredOptimizationError('模型返回的结构不符合约定字段，未提交图片任务。', STRUCTURED_ERROR_CODES.invalidJson);
  }
  const structured = parsed as StructuredVisualPrompt;

  // 作用域校验必须显式：多角色缺少或增加人物一律拒绝。
  const expected = input.actorScope.map((actor) => actor.actorId);
  const returned = structured.actors.map((actor) => actor.actorId);
  const sameSet = expected.length === returned.length && expected.every((id) => returned.includes(id));
  if (!sameSet) {
    throw new StructuredOptimizationError(
      `优化结果的角色与本次目标不一致（目标 ${expected.length} 人，返回 ${returned.length} 人），未提交图片任务。`,
      STRUCTURED_ERROR_CODES.actorScope,
    );
  }

  const warnings: string[] = [];
  const removedTags: RemovedTagDiagnostic[] = [];
  const knowledgeHits: KnowledgeHit[] = [];
  const knowledgeVersion = knowledgeDatasetInfo().datasetVersion;
  const retrieval = input.knowledgeMode === 'keyword'
    ? retrieveImagePromptKnowledge(input.sourcePrompt, { mode: 'keyword', limit: 24 })
    : null;

  const pushRemoved = (entries: readonly KnowledgeRemovedTag[], scope: string) => {
    for (const entry of entries) removedTags.push({ scope, tag: entry.tag, reason: entry.reason });
  };
  const pushSelected = (selected: readonly SelectedKnowledgeTag[], scope: string, actorId: string | null) => {
    void scope;
    knowledgeHits.push(...toKnowledgeHits(selected, actorId));
  };

  // 全局作用域：相机、场景、细节各自独立选择，避免第二个角色的同标签被挤掉。
  let personCount = input.personCount ?? null;
  const globalSelect = (values: string[], scope: string, target: 'camera' | 'environment' | 'details'): string[] => {
    if (!retrieval) return values;
    const text = values.join(', ');
    const selection = selectExecutableTagsForScope(text, retrieval.items, { scope });
    const resolved = resolveScopedConflicts(selection.selected);
    pushRemoved(selection.removedTags, scope);
    pushRemoved(resolved.removedTags, scope);
    warnings.push(...selection.warnings);
    // 规则在该作用域自己的标签数组上增删；自然语言从不参与。
    const rules = applyScopedKnowledgeRules({ items: retrieval.items, sourceText: text, tags: values });
    pushRemoved(rules.removedTags, scope);
    pushSelected(resolved.selected, scope, null);
    const diff = tagDiff(values, rules.tags);
    const kept = dropKeys(values, diff.removed);
    const routed: string[] = [];
    for (const tag of diff.added) {
      if (RULE_TAG_TARGETS[normalizeTagKey(tag)] === 'personCount') { personCount ??= tag; continue; }
      if (RULE_TAG_TARGETS[normalizeTagKey(tag)] === target) routed.push(tag);
    }
    return uniqueByKey([...kept, ...routed, ...resolved.selected.map((item) => item.tag)]);
  };

  const camera = globalSelect(tagsOf(structured.camera), 'camera', 'camera');
  const environment = globalSelect(tagsOf(structured.scene), 'environment', 'environment');
  const details = globalSelect(tagsOf(structured.details), 'details', 'details');

  const characters: StructuredActorBlock[] = [];
  for (const actor of structured.actors) {
    const fields = {
      identity: tagsOf(actor.identity), appearance: tagsOf(actor.appearance), clothing: tagsOf(actor.clothing),
      action: tagsOf(actor.action), expression: tagsOf(actor.expression),
    };
    if (retrieval) {
      // 每个角色块独立去重：第二个角色同样的发色不会被删掉。
      const own = [...fields.identity, ...fields.appearance, ...fields.clothing, ...fields.action, ...fields.expression];
      const scope = `actor:${actor.actorId}`;
      const selection = selectExecutableTagsForScope(own.join(', '), retrieval.items, { scope });
      const resolved = resolveScopedConflicts(selection.selected);
      pushRemoved(selection.removedTags, scope);
      pushRemoved(resolved.removedTags, scope);
      warnings.push(...selection.warnings);
      const rules = applyScopedKnowledgeRules({ items: retrieval.items, sourceText: own.join(', '), tags: own });
      pushRemoved(rules.removedTags, scope);
      pushSelected(resolved.selected, scope, actor.actorId);
      const diff = tagDiff(own, rules.tags);
      fields.identity = dropKeys(fields.identity, diff.removed);
      fields.appearance = dropKeys(fields.appearance, diff.removed);
      fields.clothing = dropKeys(fields.clothing, diff.removed);
      fields.action = dropKeys(fields.action, diff.removed);
      fields.expression = dropKeys(fields.expression, diff.removed);
      for (const tag of diff.added) {
        // 规则补的姿势／表情类标签进入动作槽位，其余按外观处理；不新建角色。
        if (RULE_TAG_TARGETS[normalizeTagKey(tag)] === 'expression') fields.action.push(tag);
        else if (RULE_TAG_TARGETS[normalizeTagKey(tag)] === 'personCount') personCount ??= tag;
        else fields.appearance.push(tag);
      }
      // 知识只提供可选措辞：按类别归属到对应槽位，不新建角色。
      for (const item of resolved.selected) {
        if (item.category === 'clothing_vocabulary') fields.clothing.push(item.tag);
        else if (item.category === 'expression_pose_vocabulary') fields.action.push(item.tag);
        else fields.appearance.push(item.tag);
      }
      // 规则新增与知识补全可能撞车；每个槽位内部各自去重一次。
      fields.identity = uniqueByKey(fields.identity);
      fields.appearance = uniqueByKey(fields.appearance);
      fields.clothing = uniqueByKey(fields.clothing);
      fields.action = uniqueByKey(fields.action);
      fields.expression = uniqueByKey(fields.expression);
    }
    characters.push({ actorId: actor.actorId, ...fields });
  }

  const blocks: OptimizerVisualBlocks = {
    personCount,
    characters, camera, environment, details,
    naturalLanguage: String(structured.naturalLanguage ?? '').trim(),
  };
  const compiled = compileVisualPrompt(blocks);
  removedTags.push(...compiled.diagnostics.removedTags.map((entry) => ({ scope: entry.scope, tag: entry.tag, reason: entry.reason })));
  warnings.push(...compiled.diagnostics.warnings);

  return {
    structured,
    blocks,
    optimizedPrompt: compiled.positive,
    knowledgeHits,
    knowledgeVersion: retrieval ? knowledgeVersion : null,
    removedTags,
    warnings,
  };
}

/**
 * 结构化模式下的系统指令（计划 §5.2）。
 *
 * 修复要点：固定 JSON 协议**必须始终在场**。此前本函数只是把 `instructions` 原样拼接，
 * 于是一条 outputFormat='tags' 的策略如果沿用了 prose 默认文本
 * （“Return one English prompt line only”），实际下发的 tags 指令就变成了 prose 语义。
 *
 * 规则：
 * - 协议段永远来自 `DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS`，用户配置只能**补充**改写规则。
 * - 历史 prose 默认文本视为“未配置”，不再当作 tags 的补充规则；判定用**精确相等**，不做关键词模糊匹配，
 *   以免误删用户自定义规则。
 * - `instructions` 本身已是 tags 默认协议时不重复拼接同一段。
 * - 末尾重申 JSON 协议不可被补充规则覆盖。
 */
export function buildStructuredSystemPrompt(input: {
  instructions: string;
  actorScope: Array<{ actorId: string; displayName?: string }>;
}): string {
  const trimmed = input.instructions.trim();
  const protocol = DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS.trim();
  const isProseDefault = trimmed === DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS.trim();
  const isTagsDefault = trimmed === protocol;
  const rules = !trimmed || isProseDefault || isTagsDefault ? '' : trimmed;
  const actorList = input.actorScope.length
    ? input.actorScope.map((actor) => `${actor.actorId}${actor.displayName ? ` (${actor.displayName})` : ''}`).join(', ')
    : '（本次没有人物角色；actors 必须是空数组）';
  const sections = [protocol];
  if (rules) sections.push(`补充改写规则（不得改变上面的 JSON 协议、字段约束与角色范围）：\n${rules}`);
  sections.push(`actorId 只能取以下值，且每个值必须恰好出现一次：${actorList}`);
  sections.push('重申：只返回 JSON 对象本身，不要输出任何 JSON 之外的文字；JSON 协议不可被补充规则覆盖。');
  return sections.join('\n\n');
}
