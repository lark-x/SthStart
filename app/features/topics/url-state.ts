import type { TopicKind } from '@sthstart/contracts';
import type { TopicListParams } from './api';

export const TOPIC_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const TOPIC_DEFAULT_PAGE_SIZE = TOPIC_PAGE_SIZE_OPTIONS[0];
/** 嵌入资料库时使用独立命名空间，避免覆写外层 `view=inspiration`。 */
export const TOPIC_EMBEDDED_URL_PREFIX = 'topic';

export type TopicView = 'all' | 'favorite' | 'used' | 'ignored';

export interface TopicListState {
  q: string;
  works: string[];
  kind: TopicKind | '';
  days: number;
  view: TopicView;
  page: number;
  pageSize: number;
}

const TOPIC_KINDS = new Set<TopicKind>(['meme', 'character', 'update', 'occasion']);
const TOPIC_VIEWS = new Set<TopicView>(['all', 'favorite', 'used', 'ignored']);
const TOPIC_DAYS = new Set([0, 7, 30, 90]);

export function defaultTopicDays(view: TopicView): number {
  return view === 'favorite' ? 0 : 30;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function key(prefix: string, name: string): string {
  return prefix ? `${prefix}_${name}` : name;
}

/** 解析主素材库或灵感选择器的 URL 状态；非法页码与容量会回到安全默认值。 */
export function parseTopicListState(input: string | URLSearchParams, prefix = ''): TopicListState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const rawView = params.get(key(prefix, 'view'));
  const view = rawView && TOPIC_VIEWS.has(rawView as TopicView) ? rawView as TopicView : 'all';
  const rawKind = params.get(key(prefix, 'kind'));
  const daysParam = params.get(key(prefix, 'days'));
  const rawDays = daysParam == null ? Number.NaN : Number(daysParam);
  const requestedSize = Number(params.get(key(prefix, 'pageSize')));
  return {
    q: params.get(key(prefix, 'q')) ?? '',
    works: [...new Set(params.getAll(key(prefix, 'works')).filter(Boolean))],
    kind: rawKind && TOPIC_KINDS.has(rawKind as TopicKind) ? rawKind as TopicKind : '',
    days: TOPIC_DAYS.has(rawDays) ? rawDays : defaultTopicDays(view),
    view,
    page: positiveInteger(params.get(key(prefix, 'page')), 1),
    pageSize: (TOPIC_PAGE_SIZE_OPTIONS as readonly number[]).includes(requestedSize)
      ? requestedSize
      : TOPIC_DEFAULT_PAGE_SIZE,
  };
}

export function topicListParams(state: TopicListState): TopicListParams {
  return {
    ...(state.q.trim() ? { q: state.q.trim() } : {}),
    ...(state.works.length ? { works: state.works } : {}),
    ...(state.kind ? { kinds: [state.kind] } : {}),
    days: state.days,
    view: state.view,
    page: state.page,
    pageSize: state.pageSize,
  };
}

/** 写入素材库状态，同时保留详情参数等同一路由上的其他查询参数。 */
export function applyTopicListState(params: URLSearchParams, state: TopicListState, prefix = ''): void {
  const names = ['q', 'works', 'kind', 'days', 'view', 'page', 'pageSize'].map((name) => key(prefix, name));
  for (const name of names) params.delete(name);
  const set = (name: string, value: string) => params.set(key(prefix, name), value);
  if (state.q.trim()) set('q', state.q.trim());
  for (const work of state.works) params.append(key(prefix, 'works'), work);
  if (state.kind) set('kind', state.kind);
  if (state.days !== defaultTopicDays(state.view)) set('days', String(state.days));
  if (state.view !== 'all') set('view', state.view);
  if (state.page > 1) set('page', String(state.page));
  if (state.pageSize !== TOPIC_DEFAULT_PAGE_SIZE) set('pageSize', String(state.pageSize));
}

/** 生成同一路由下的素材 URL；用于分页时实际 push 一条浏览器历史记录。 */
export function topicListUrl(currentHref: string, state: TopicListState, prefix = ''): string {
  const url = new URL(currentHref, 'http://sthstart.local');
  applyTopicListState(url.searchParams, state, prefix);
  return `${url.pathname}${url.search}${url.hash}`;
}
