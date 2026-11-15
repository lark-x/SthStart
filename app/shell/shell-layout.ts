/**
 * 外框布局判定：只根据当前地址决定工具栏、工作台高度锁与嵌入模式。
 *
 * 页面自己渲染 WorkspaceHeader 时，外框不能再画一条全局指令条。把路由清单
 * 收在这里，避免在组件里散落 pathname 判断，也便于用单元测试固定边界。
 */

/** 邻舍与工作区嵌入模式：使用精简外框，由页面自身提供退回全站导航的动作。 */
export const EMBED_PREFIXES = ['/apps/linshe'] as const;

export interface ShellSearchParams {
  get(name: string): string | null;
  has(name: string): boolean;
}

export interface ShellLocation {
  pathname: string;
  searchParams: ShellSearchParams;
}

export type ShellWorkspaceKind = 'creative' | 'editor' | 'library';

export interface ShellLayout {
  /** 页面自带 WorkspaceHeader，外框隐藏全局指令条。 */
  workspaceHeader: boolean;
  /** 工作台锁视口高度；普通页面保留文档滚动。 */
  workspace: boolean;
  workspaceKind: ShellWorkspaceKind;
  embed: boolean;
}

export function resolveShellLayout({ pathname, searchParams }: ShellLocation): ShellLayout {
  const isActivityStudio = pathname.startsWith('/apps/activities/') && pathname !== '/apps/activities/new';
  const isStoryWorkspace = pathname.startsWith('/apps/story/') && pathname.split('/').filter(Boolean).length === 3;
  const isWorldAuthoring = pathname === '/apps/story-worlds/new' || /^\/apps\/story-worlds\/[^/]+\/(?:edit|setup)\/?$/.test(pathname);
  const isStoryWorldsWorkspace = !isWorldAuthoring && (pathname === '/apps/story-worlds' || pathname.startsWith('/apps/story-worlds/'));
  const isNarrativeFocus = pathname === '/apps/narrative'
    && (searchParams.get('view') === 'review'
      || (!searchParams.has('project') && !['research', 'import'].includes(searchParams.get('mode') ?? 'read')));
  const isNotebookEditor = pathname.startsWith('/apps/notebook/') && pathname !== '/apps/notebook/offline';

  const workspaceHeader = isActivityStudio
    || isStoryWorkspace
    || isStoryWorldsWorkspace
    || isNotebookEditor
    || isNarrativeFocus;
  const workspace = workspaceHeader
    || pathname === '/apps/resources'
    || pathname === '/apps/notebook'
    || pathname === '/apps/creative';
  const workspaceKind: ShellWorkspaceKind = pathname === '/apps/creative'
    ? 'creative'
    : workspaceHeader
      ? 'editor'
      : 'library';
  const embed = EMBED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  return { workspaceHeader, workspace, workspaceKind, embed };
}
