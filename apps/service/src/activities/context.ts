import type { ActorSnapshot, ContentDocument } from '@sthstart/contracts';
import { buildCharacterContextSections, toCharacterRuntime } from '@sthstart/contracts';

function text(value: unknown, max = 600): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 一条角色人设的缩减记录，便于调用方在任务元数据里留痕。 */
export type ActorContextReduction = { actorId: string; displayName: string; reduced: readonly string[] };

export type DescribeActorOptions = {
  includeExamples?: number;
  /** 单个角色的字符预算。 */
  budgetChars?: number;
};

function describeActorLines(actor: ActorSnapshot, options: DescribeActorOptions): { lines: string[]; reduced: readonly string[] } {
  const runtime = toCharacterRuntime(actor.persona ?? {});
  const context = buildCharacterContextSections(runtime, {
    includeExamples: options.includeExamples ?? 0,
    budgetChars: options.budgetChars ?? 1_200,
  });
  const lines = [
    `- [ID: ${actor.id}] ${actor.displayName}${runtime.englishName ? `（${text(runtime.englishName, 80)}）` : ''}${runtime.work ? ` 出自《${text(runtime.work, 120)}》` : ''}`,
    `  - 活动职责：${actor.activityRole || '活动参与者'}`,
    ...context.sections.map((section) => `  - ${section.label}：${section.text.replace(/\n/g, '\n    ')}`),
    actor.outfitDescription ? `  - 本次服装：${text(actor.outfitDescription, 200)}` : '',
  ].filter(Boolean) as string[];
  return { lines, reduced: context.reduced };
}

/**
 * 把一位角色写成生成上下文。
 * 人设语义统一由 @sthstart/contracts 的运行时视图提供；这里只负责活动场景的排版，
 * 并返回缩减记录，避免超限时静默丢弃关键约束。
 */
export function describeActor(actor: ActorSnapshot, options: DescribeActorOptions = {}): string {
  return describeActorLines(actor, options).lines.join('\n');
}

/** 与 describeActor 相同，但同时给出被缩减的部分，供任务元数据留痕。 */
export function describeActorWithDiagnostics(actor: ActorSnapshot, options: DescribeActorOptions = {}) {
  return describeActorLines(actor, options);
}

export function describeCast(content: ContentDocument, options: { includeExamples?: number } = {}): string {
  return (content.actors || []).map((actor) => describeActor(actor, options)).join('\n');
}

/** 参与角色之间的关系描述，用于保持互动符合既定关系。 */
export function describeRelationships(content: ContentDocument): string {
  const byId = new Map((content.actors || []).map((actor) => [actor.id, actor.displayName]));
  return (content.relationships || [])
    .map((relation) => {
      const from = byId.get(relation.fromActorId) || relation.fromActorId;
      const to = byId.get(relation.toActorId) || relation.toActorId;
      return `- ${from} → ${to}：${relation.description}`;
    })
    .join('\n');
}

/**
 * 只返回真正位于目标阶段之前的已发生事实。
 * 整场生成时可用 extraFacts 追加本批次前序候选产生的事实。
 */
export function describePriorFacts(content: ContentDocument, stageId?: string, extraFacts: string[] = []): string {
  const orderOf = new Map((content.stages || []).map((stage) => [stage.id, stage.order]));
  const currentOrder = stageId ? orderOf.get(stageId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  const lines = (content.facts || [])
    .filter((fact) => fact.status === 'happened')
    .filter((fact) => (orderOf.get(fact.stageId) ?? 0) < currentOrder)
    .map((fact) => `- ${fact.text}`);
  return [...lines, ...extraFacts.map((fact) => `- ${fact}`)].join('\n');
}

/** 活动基本设定，包含日期与寿星等用户设定，模型不得改写。 */
export function describeActivity(content: ContentDocument, instruction?: string): string {
  const birthdayNames = (content.activity.birthdayActorIds || [])
    .map((id) => (content.actors || []).find((actor) => actor.id === id)?.displayName)
    .filter((name): name is string => !!name);
  return [
    `- 标题：${content.activity.title}`,
    `- 类型：${content.activity.type}`,
    `- 主题：${content.activity.theme || '自由创作'}`,
    `- 地点：${content.activity.location || '活动现场'}`,
    content.activity.scheduledDate ? `- 日期：${content.activity.scheduledDate}（由用户指定，不可修改）` : '',
    birthdayNames.length ? `- 寿星：${birthdayNames.join('、')}（由用户指定，不可修改，每位都需要安排参与）` : '',
    `- 规则：${content.activity.rules || '自由'}`,
    instruction ? `- 本次补充要求：${instruction}` : '',
  ].filter(Boolean).join('\n');
}
