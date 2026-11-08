import type { NavApp } from './navigation';

/** 按路径为导航项打分：精确匹配 > activePaths > 子路径前缀 > 门户。侧栏高亮、工具栏位置与页面标题图标共用。 */
function computeAppScore(pathname: string, app: NavApp): number {
  const baseHref = app.href.split('?')[0];

  // 1. Exact match on app.href base
  if (baseHref !== '/' && pathname === baseHref) {
    return 100;
  }

  // 2. Exact match in activePaths
  if (app.activePaths?.some((p) => pathname === p)) {
    return 95;
  }

  // 3. Sub-path prefix in activePaths (e.g. /apps/resources/... or /apps/notebook/...)
  if (app.activePaths?.some((p) => pathname.startsWith(`${p}/`))) {
    return 90;
  }

  // 4. Sub-path prefix in app.href
  if (baseHref !== '/' && pathname.startsWith(`${baseHref}/`)) {
    return 85;
  }

  // 5. Portal
  if (app.href === '/' && pathname === '/') {
    return 50;
  }

  return 0;
}

export function findBestActiveApp(pathname: string, candidates: NavApp[]): NavApp | undefined {
  let bestScore = 0;
  let bestApp: NavApp | undefined;

  for (const app of candidates) {
    const score = computeAppScore(pathname, app);
    if (score > bestScore) {
      bestScore = score;
      bestApp = app;
    }
  }

  return bestScore > 0 ? bestApp : undefined;
}
