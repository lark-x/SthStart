import { positiveInteger } from '@/app/lib/pagination';

export const STORY_PAGE_SIZES = [20, 50, 100] as const;
export type StoryListType = 'all' | 'fiction' | 'reflection';
export type StoryListSort = 'updated' | 'title';

export interface StoryListState {
  type: StoryListType;
  q: string;
  sort: StoryListSort;
  page: number;
  pageSize: number;
}

/** Story directory keeps its filters, type view and paging in the URL. */
export function readStoryListState(params: Pick<URLSearchParams, 'get'>): StoryListState {
  const type = params.get('type');
  const sort = params.get('sort');
  const pageSize = positiveInteger(params.get('pageSize'), 20);
  return {
    type: type === 'fiction' || type === 'reflection' ? type : 'all',
    q: (params.get('q') ?? '').trim().slice(0, 200),
    sort: sort === 'title' ? 'title' : 'updated',
    page: positiveInteger(params.get('page')),
    pageSize: STORY_PAGE_SIZES.includes(pageSize as 20 | 50 | 100) ? pageSize : 20,
  };
}

/** Preserve unrelated flags such as `from` and `returnTo` while normalizing directory state. */
export function storyListHref(state: StoryListState, existing = '') {
  const params = new URLSearchParams(existing);
  if (state.type === 'all') params.delete('type'); else params.set('type', state.type);
  if (state.q) params.set('q', state.q); else params.delete('q');
  params.set('sort', state.sort);
  params.set('page', String(state.page));
  params.set('pageSize', String(state.pageSize));
  return '/apps/story?' + params.toString();
}

/** Fiction projects open the overview; reflection records open their focused editor. */
export function storyProjectHref(projectId: string, projectType: 'fiction' | 'reflection', listHref: string) {
  const base = (projectType === 'reflection' ? '/apps/story/' : '/apps/projects/') + encodeURIComponent(projectId);
  return base + '?returnTo=' + encodeURIComponent(listHref);
}
