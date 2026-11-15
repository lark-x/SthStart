/** Route targets shared by the Story workspace header and its upper assembly. */
export function storyBackTarget({
  projectId,
  isReflection,
  returnTo,
}: {
  projectId: string;
  isReflection: boolean;
  returnTo: string | null | undefined;
}) {
  const safe = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    && !/[\\\u0000-\u0020]/.test(returnTo) ? returnTo : null;
  if (isReflection) {
    return {
      href: safe && /^\/apps\/story(?:[?#]|$)/.test(safe) ? safe : '/apps/story?type=reflection',
      label: '返回剧情项目',
    };
  }
  const projectPrefix = '/apps/projects/' + encodeURIComponent(projectId);
  return {
    href: safe && (safe === projectPrefix || safe.startsWith(projectPrefix + '?'))
      ? safe
      : projectPrefix,
    label: '返回项目总览',
  };
}
