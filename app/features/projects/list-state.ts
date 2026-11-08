import type { ProjectListQuery } from '@sthstart/contracts';
import { positiveInteger } from '../../lib/pagination';

export const PROJECT_PAGE_SIZES = [20, 50, 100] as const;
export function readProjectListState(params: Pick<URLSearchParams, 'get'>) {
  const size = positiveInteger(params.get('pageSize'), 20);
  const sort = params.get('sort');
  return {
    page: Math.min(positiveInteger(params.get('page')), 2147483647),
    pageSize: PROJECT_PAGE_SIZES.includes(size as 20 | 50 | 100) ? size : 20,
    q: (params.get('q') ?? '').trim().slice(0, 200),
    sort: sort === 'title' || sort === 'created' ? sort : 'updated',
  } satisfies ProjectListQuery;
}
export type ProjectListState = ReturnType<typeof readProjectListState>;
export function projectListHref(state: ProjectListState, existing = '') {
  const params = new URLSearchParams(existing);
  params.delete('new');
  params.set('page', String(state.page));
  params.set('pageSize', String(state.pageSize));
  params.set('sort', state.sort);
  if (state.q) params.set('q', state.q); else params.delete('q');
  return '/apps/projects?' + params.toString();
}
/** Only a canonical project-list URL is a valid return target. */
export function projectReturnHref(value: string | null) {
  if (!value || !value.startsWith('/apps/projects?')) return '/apps/projects';
  return projectListHref(readProjectListState(new URLSearchParams(value.slice(value.indexOf('?') + 1))));
}
