/**
 * 页面原型（sthstart-design-language §2–§6）的纯逻辑：控件预算、视图选择、少数据判定。
 * 不依赖 React，便于单测；组件见 page-archetypes.tsx。
 */

/** 页头动作。带 href 渲染为链接，否则为按钮。 */
export interface CollectionAction {
  id: string;
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

/** 设计语言 §3：1 个主操作 + 最多 2 个次操作，其余进入溢出菜单。 */
export const MAX_SECONDARY_ACTIONS = 2;

export function splitCollectionActions<T extends CollectionAction>(
  secondary: readonly T[] = [],
  overflow: readonly T[] = [],
  limit = MAX_SECONDARY_ACTIONS,
): { visible: T[]; overflow: T[] } {
  const visible = secondary.slice(0, Math.max(0, limit));
  const spilled = secondary.slice(Math.max(0, limit));
  return { visible, overflow: [...spilled, ...overflow] };
}

export type CollectionView = 'card' | 'row';

export const COLLECTION_VIEW_PARAM = 'view';

/** 少于该数量时按"少数据"处理：强制卡片视图，内容区收窄居中（设计语言 §6）。 */
export const SPARSE_COLLECTION_THRESHOLD = 3;

export function parseCollectionView<V extends string>(
  raw: string | null | undefined,
  allowed: readonly V[],
  fallback: V,
): V {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as V) : fallback;
}

export function isSparseCollection(itemCount: number | undefined): boolean {
  return typeof itemCount === 'number' && itemCount > 0 && itemCount < SPARSE_COLLECTION_THRESHOLD;
}

/**
 * 实际生效的视图：少数据时用 sparseView（默认卡片），否则沿用用户选择。
 * itemCount 未知（加载中）时不改变用户选择，避免闪动。
 */
export function resolveCollectionView<V extends string>(
  requested: V,
  itemCount: number | undefined,
  sparseView: V,
): V {
  return isSparseCollection(itemCount) ? sparseView : requested;
}

/** 写回 URL：默认值不写入，保持链接简短；其余查询参数原样保留。 */
export function collectionViewSearch<V extends string>(
  current: string,
  next: V,
  fallback: V,
  param = COLLECTION_VIEW_PARAM,
): string {
  const params = new URLSearchParams(current.startsWith('?') ? current.slice(1) : current);
  if (next === fallback) params.delete(param);
  else params.set(param, next);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** 可删除的筛选胶囊。 */
export interface CollectionFilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/** Overview 的少数据判定：0–2 条时展示"下一步"建议，最多 3 条。 */
export const MAX_NEXT_STEPS = 3;

export function pickNextSteps<T>(steps: readonly T[], itemCount: number): T[] {
  if (itemCount >= SPARSE_COLLECTION_THRESHOLD) return [];
  return steps.slice(0, MAX_NEXT_STEPS);
}
