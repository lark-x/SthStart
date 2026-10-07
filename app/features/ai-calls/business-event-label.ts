import type { AiCallSummary } from '@sthstart/contracts';

/**
 * 业务事件的中文名称（计划 §14）。
 *
 * 日志列表与详情始终显示中文名称，并把原始事件 ID 作为次要信息保留——
 * 中文名称是给人看的，事件 ID 才是可检索、可与服务端对照的事实。
 */
export const BUSINESS_EVENT_LABELS: Record<string, string> = {
  'activity.beat.render': '镜头绘制',
  'activity.comic.panel.render': '漫画画格绘制',
  'activity.media.slot.render': '素材绘制',
  'activity.studio.storyboard': '智能分镜',
  'activity.studio.refine': '智能细化',
  'activity.image.prompt.optimize': '画面描述优化',
  'activity.image.hires': '图片放大细化',
  'activity.image.edit': '图片编辑',
};

export function businessEventLabel(businessEvent: string | null | undefined): string {
  const value = String(businessEvent ?? '').trim();
  if (!value) return '未命名调用';
  return BUSINESS_EVENT_LABELS[value] ?? value;
}

/** 列表项标题：中文名称 + 原始事件 ID（未收录时只显示一次，不重复）。 */
export function businessEventTitle(businessEvent: string | null | undefined): string {
  const label = businessEventLabel(businessEvent);
  const value = String(businessEvent ?? '').trim();
  return label === value ? label : `${label} · ${value}`;
}

/** 日志详情分组（计划 §15.3）：来源 → 优化 → 规则 → 最终输入 → 实际图 → 产物。 */
export const AI_CALL_DETAIL_SECTIONS = [
  { key: 'source', title: '来源', hint: '这次调用由哪个业务对象、哪次作业发起。' },
  { key: 'optimization', title: '优化', hint: '文本模型的原始响应与用量，不做截断。' },
  { key: 'rules', title: '规则', hint: '实际生效的参数与各执行阶段，含规则／知识诊断。' },
  { key: 'finalInput', title: '最终输入', hint: '真正提交给生成实例的正负提示词与请求快照。' },
  { key: 'actualImage', title: '实际图', hint: '这次调用实际使用的工作流、版本与模型。' },
  { key: 'artifacts', title: '产物', hint: '本次调用产生的图片与其哈希、可用性。' },
] as const;

export type AiCallDetailSectionKey = (typeof AI_CALL_DETAIL_SECTIONS)[number]['key'];

/** 供列表分组使用：同一追踪下的多阶段作业标题。 */
export function traceGroupTitle(calls: ReadonlyArray<Pick<AiCallSummary, 'businessEvent'>>): string {
  const first = calls[0]?.businessEvent;
  return `${businessEventLabel(first)} · 多阶段作业`;
}
