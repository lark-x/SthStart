'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpen,
  CalendarClock,
  FileText,
  Inbox,
  Lightbulb,
  PlugZap,
} from 'lucide-react';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { withResourceReturn } from './return-context';

export type ResourceView = 'notes' | 'inspiration' | 'collections' | 'pending' | 'sources';

export interface ResourceNavProps {
  activeView: ResourceView;
  onViewChange?: (view: ResourceView) => void;
  className?: string;
  showQuickLinks?: boolean;
}

export const RESOURCE_TABS: { id: ResourceView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'notes', label: '创作笔记', icon: BookOpen },
  { id: 'inspiration', label: '灵感素材', icon: Lightbulb },
  { id: 'collections', label: '搜集任务', icon: CalendarClock },
  { id: 'pending', label: '待整理箱', icon: Inbox },
  { id: 'sources', label: '数据源', icon: PlugZap },
];

/**
 * 资料库及相关页面共享的子导航
 * 通过 URL query (?view=notes|inspiration|collections|pending|sources) 驱动视图切换。
 */
export function ResourceNav({
  activeView,
  onViewChange,
  className = '',
  showQuickLinks = true,
}: ResourceNavProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const openWithResourceContext = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(withResourceReturn(href, window.location.search.slice(1)));
  };

  const handleTabChange = (nextId: string) => {
    const nextView = nextId as ResourceView;
    if (onViewChange) {
      onViewChange(nextView);
    } else {
      router.push(`/apps/resources?view=${nextView}`);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="resources-navigation flex min-w-0 items-center justify-between gap-x-4 gap-y-2">
        <PageTabs
          className="resources-view-tabs"
          variant="local"
          ariaLabel="资料库视图切换"
          value={activeView}
          tabs={RESOURCE_TABS.map((t) => ({ id: t.id, label: t.label }))}
          onChange={handleTabChange}
        />

        {showQuickLinks && (
          <div className="resources-quick-links flex shrink-0 items-center gap-1 text-sm text-muted" aria-label="相关记录通道">
            <Link
              href={withResourceReturn('/apps/story?type=reflection', searchParams?.toString() ?? '')}
              onClick={(event) => openWithResourceContext(event, '/apps/story?type=reflection')}
              className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-muted hover:bg-surface-hover hover:text-ink transition-colors"
              title="查看角色交互与对话体验感想"
            >
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              <span>对话感想</span>
            </Link>
            <Link
              href={withResourceReturn('/apps/narrative', searchParams?.toString() ?? '')}
              onClick={(event) => openWithResourceContext(event, '/apps/narrative')}
              className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-muted hover:bg-surface-hover hover:text-ink transition-colors"
              title="原作剧情任务链与原文检索"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>原作档案</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
