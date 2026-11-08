'use client';

import { usePathname } from 'next/navigation';
import { NAV_ALL } from './navigation';
import { findBestActiveApp } from './nav-match';

/** 页面标题旁的模块图标：按当前路由找到所属模块，用它的识别色铺底。 */
export function PageHeaderIcon({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const app = findBestActiveApp(pathname, NAV_ALL);
  if (!app || app.href === '/') return null;
  const Icon = app.icon;
  return (
    <span className="tpl-title-icon" data-tone={app.tone} data-compact={compact || undefined} aria-hidden="true">
      <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
    </span>
  );
}
