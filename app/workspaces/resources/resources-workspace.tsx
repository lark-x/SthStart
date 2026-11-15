'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ResourceNav, RESOURCE_TABS, type ResourceView } from './resource-nav';
import { NotebookWorkspace } from '@/app/features/notebook/components/notebook-workspace';
import type { NoteAdoptAction } from '@/app/features/notebook/note-adoption';
import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';
import { CollectionManager } from '@/app/features/knowledge/components/collection-manager';
import { PendingInbox } from '@/app/features/knowledge/components/pending-inbox';
import { TopicLibraryView } from '@/app/workspaces/resources/topic-library-view';
import { McpSourceManager } from '@/app/features/mcp-sources/mcp-source-manager';
import { PageHeader } from '@/app/components/shared/page-header';

export interface ResourcesWorkspaceProps {
  initialView?: ResourceView;
}

/**
 * 资料库综合工作台：集中管理创作笔记、灵感素材、搜集任务、待整理箱与外部数据源。
 * 笔记模块只提供独立笔记工作区；知识视图和跨模块引用都在这里装配。
 */
export function ResourcesWorkspace({ initialView = 'notes' }: ResourcesWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams?.get('view') as ResourceView | null;
  const currentView: ResourceView = RESOURCE_TABS.some((tab) => tab.id === viewParam)
    ? viewParam!
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

  const adoptAction = useCallback<NoteAdoptAction>(({ noteId, disabled }) => (
    <AdoptIntoProject source={{ kind: 'note', id: noteId }} disabled={disabled} />
  ), []);

  return (
    <div className="resources-workspace-shell workspace-fill bg-paper text-ink">
      <div className="resources-workspace-header shrink-0 border-b border-border-subtle bg-surface/80 px-4 py-3 sm:px-6">
        <div className="min-w-0 w-full">
          <PageHeader
            compact
            title="资料库"
            description="集中管理创作笔记、灵感素材与搜集任务，供创作项目引用。"
            navigation={<ResourceNav activeView={currentView} onViewChange={handleViewChange} />}
          />
        </div>
      </div>

      <div className="resources-workspace-content relative flex-1 min-h-0 min-w-0">
        {/* 笔记工作区保持挂载：切换视图时未保存草稿仍由同一个编辑会话持有。 */}
        <div className={currentView === 'notes' ? 'resources-notes-container h-full' : 'hidden'}>
          <NotebookWorkspace
            embedded
            basePath="/apps/resources"
            adoptAction={adoptAction}
          />
        </div>

        {currentView === 'collections' && (
          <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto w-full max-w-[1400px]">
              <CollectionManager onOpenPending={() => handleViewChange('pending')} />
            </div>
          </div>
        )}

        {currentView === 'pending' && (
          <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto w-full max-w-[1400px]">
              <PendingInbox />
            </div>
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
