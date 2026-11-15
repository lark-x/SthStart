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

function isSafeInternalHref(value: string) {
  return value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u0020]/.test(value);
}

export interface ProjectBackTarget {
  href: string;
  label: string;
}

/** Project overview can be reached from the project directory or the Story directory. */
export function projectBackTarget(value: string | null): ProjectBackTarget {
  if (value && isSafeInternalHref(value) && /^\/apps\/story(?:[?#]|$)/.test(value)) {
    return { href: value, label: '返回剧情项目' };
  }
  return { href: projectReturnHref(value), label: '返回创作项目列表' };
}

/** The project overview keeps the list return target so both back links survive the editor round trip. */
export function projectOverviewHref(projectId: string, listReturn: string | null) {
  const base = '/apps/projects/' + encodeURIComponent(projectId);
  const target = projectBackTarget(listReturn);
  return target.href === '/apps/projects' ? base : base + '?returnTo=' + encodeURIComponent(target.href);
}

/** Continue into the Story editor while preserving the project and list return targets. */
export function projectEditorHref(projectId: string, listReturn: string | null, entryId?: string) {
  const params = new URLSearchParams();
  params.set('returnTo', projectOverviewHref(projectId, listReturn));
  if (entryId) params.set('entry', entryId);
  return '/apps/story/' + encodeURIComponent(projectId) + '?' + params.toString();
}
