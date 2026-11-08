import type { MediaLibraryKind, MediaLibraryStatus } from '@sthstart/contracts';

export const MEDIA_PAGE_SIZE_OPTIONS = [24, 48, 96] as const;
export const MEDIA_DEFAULT_PAGE_SIZE = MEDIA_PAGE_SIZE_OPTIONS[0];

const MEDIA_KINDS = new Set<MediaLibraryKind>(['image', 'video', 'audio', 'file']);
const MEDIA_STATUSES = new Set<MediaLibraryStatus>(['ready', 'missing', 'quarantined']);

export interface MediaListState {
  q: string;
  mediaKind: MediaLibraryKind | 'all';
  status: MediaLibraryStatus | 'all';
  appId: string;
  page: number;
  pageSize: number;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

/** URL 中的媒体筛选只接受页面实际支持的枚举与容量。 */
export function parseMediaListState(input: string | URLSearchParams): MediaListState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const kind = params.get('mediaKind');
  const status = params.get('status');
  const requestedSize = Number(params.get('pageSize'));
  return {
    q: params.get('q') ?? '',
    mediaKind: kind && MEDIA_KINDS.has(kind as MediaLibraryKind) ? kind as MediaLibraryKind : 'all',
    status: status && MEDIA_STATUSES.has(status as MediaLibraryStatus) ? status as MediaLibraryStatus : 'all',
    appId: params.get('appId')?.trim() || 'all',
    page: positiveInteger(params.get('page'), 1),
    pageSize: (MEDIA_PAGE_SIZE_OPTIONS as readonly number[]).includes(requestedSize)
      ? requestedSize
      : MEDIA_DEFAULT_PAGE_SIZE,
  };
}

/** 写入媒体列表状态，同时保留同一 URL 上的其他参数。 */
export function applyMediaListState(params: URLSearchParams, state: MediaListState): void {
  const setOrDelete = (key: string, value: string | null) => {
    if (value) params.set(key, value);
    else params.delete(key);
  };
  setOrDelete('q', state.q.trim() || null);
  setOrDelete('mediaKind', state.mediaKind === 'all' ? null : state.mediaKind);
  setOrDelete('status', state.status === 'all' ? null : state.status);
  setOrDelete('appId', state.appId === 'all' ? null : state.appId);
  setOrDelete('page', state.page > 1 ? String(state.page) : null);
  setOrDelete('pageSize', state.pageSize !== MEDIA_DEFAULT_PAGE_SIZE ? String(state.pageSize) : null);
}

/** 生成媒体列表 URL；分页调用方用 pushState 创建可后退的历史记录。 */
export function mediaListUrl(currentHref: string, state: MediaListState): string {
  const url = new URL(currentHref, 'http://sthstart.local');
  applyMediaListState(url.searchParams, state);
  return `${url.pathname}${url.search}${url.hash}`;
}
