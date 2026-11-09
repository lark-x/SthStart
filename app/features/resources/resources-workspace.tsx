'use client';

import React, { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ResourceNav, type ResourceView } from './resource-nav';
import { NotebookWorkspace } from '@/app/features/notebook/components/notebook-workspace';
import { TopicLibraryView } from '@/app/features/topics/components/topic-library-view';
import { McpSourceManager } from '@/app/features/mcp-sources/mcp-source-manager';
import { PageHeader } from '@/app/components/shared/page-header';

export interface ResourcesWorkspaceProps {
  initialView?: ResourceView;
}

/**
 * 资料库综合工作台：
 * 集中管理创作笔记、灵感素材、搜集任务、待整理箱与外部数据源。
 * 默认直接复用 NotebookWorkspace 呈现真实完整笔记工作区，
 * 传入 embedded 隐藏内层重复的 PageHeader 和 PageTabs。
 */
export function ResourcesWorkspace({ initialView = 'notes' }: ResourcesWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams?.get('view') as ResourceView | null;
  const currentView: ResourceView =
    viewParam === 'inspiration' ||
    viewParam === 'collections' ||
    viewParam === 'pending' ||
    viewParam === 'sources'
      ? viewParam
      : initialView;

  const handleViewChange = useCallback(
    (nextView: ResourceView) => {
      // 素材分页使用浏览器 history，Next 的 searchParams 可能尚未同步；
      // 读取当前地址可保留 topic_* 状态并只替换外层资料库视图。
      const params = new URLSearchParams(
        typeof window === 'undefined' ? searchParams?.toString() ?? '' : window.location.search
      );
      if (nextView === 'notes') {
        params.delete('view');
      } else {
        params.set('view', nextView);
      }
      router.push(`/apps/resources${params.size ? `?${params.toString()}` : ''}`, { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <div className="resources-workspace-shell workspace-fill bg-paper text-ink">
      {/* 资料库顶部领域说明与统一子导航 */}
      <div className="resources-workspace-header shrink-0 border-b border-border-subtle bg-surface/80 px-4 py-3 sm:px-6">
        <div className="min-w-0 w-full space-y-2">
          <PageHeader
            compact
            title="资料库"
            description="集中管理创作笔记、灵感素材与搜集任务，供创作项目引用。"
          />

          <ResourceNav activeView={currentView} onViewChange={handleViewChange} />
        </div>
      </div>

      {/* 视图内容区：notes / collections / pending 复用 NotebookWorkspace 主体 */}
      <div className="resources-workspace-content flex-1 min-h-0 min-w-0">
        {(currentView === 'notes' || currentView === 'collections' || currentView === 'pending') && (
          <div className="resources-notes-container h-full">
            <NotebookWorkspace embedded />
          </div>
        )}

        {currentView === 'inspiration' && (
          <div className="resources-inspiration-container h-full overflow-y-auto">
            <TopicLibraryView embedded />
          </div>
        )}

        {currentView === 'sources' && (
          <div className="resources-sources-container h-full overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto w-full max-w-[1400px] space-y-4">
              <div className="border-b border-border-subtle pb-3">
                <h2 className="text-base font-semibold text-ink">数据源连接</h2>
                <p className="text-xs text-muted">
                  配置 MCP (Model Context Protocol) 知识源与外部协议接口，供资料搜集与查证检索。
                </p>
              </div>
              <McpSourceManager />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
