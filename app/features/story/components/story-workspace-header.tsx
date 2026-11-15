'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { Check, Film, FolderOpen, PanelLeft, PanelLeftClose, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';

function subscribeNarrow(listener: () => void) {
  const query = window.matchMedia('(max-width: 1023px)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
const readNarrow = () => window.matchMedia('(max-width: 1023px)').matches;

export function StoryWorkspaceHeader({
  projectId, title, isReflection, pendingProposalCount, bridgePaired, sidebarCollapsed,
  onToggleSidebar, onCreateProduction, onOpenReview, onOpenAgent, onOpenTree, onOpenProjectTools,
  extraMenuItems, extraActions, backHref, backLabel,
}: {
  projectId: string;
  title: string;
  isReflection: boolean;
  pendingProposalCount: number;
  bridgePaired: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** Omit until the upper Story workspace owns the production dialog. */
  onCreateProduction?: () => void;
  onOpenReview: () => void;
  onOpenAgent: () => void;
  onOpenTree: () => void;
  onOpenProjectTools: () => void;
  extraMenuItems?: ReactNode;
  extraActions?: ReactNode;
  /** Return target supplied by the upper workspace so list filters survive the round trip. */
  backHref?: string;
  backLabel?: string;
}) {
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  return <WorkspaceHeader
    title={title}
    backHref={backHref ?? (isReflection ? '/apps/story?type=reflection' : `/apps/projects/${projectId}`)}
    backLabel={backLabel ?? (isReflection ? '返回剧情项目' : '返回项目总览')}
    status={
      <div className="flex min-w-0 items-center gap-1.5">
        {isReflection && <span className="shrink-0 text-xs text-muted">对话感想</span>}
        {pendingProposalCount > 0 && (
          <span className="shrink-0 text-xs font-medium text-accent">{pendingProposalCount} 条待审阅</span>
        )}
      </div>
    }
    actions={
      <>
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? '展开大纲资料树' : '收起大纲资料树'}
          className="hidden lg:flex p-1.5 text-muted hover:text-ink"
          title={sidebarCollapsed ? '展开大纲资料树 (Ctrl+B)' : '收起大纲资料树 (Ctrl+B)'}
        >
          {sidebarCollapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>

        {extraActions}

        <RowActionsMenu
          label="更多项目操作"
          items={[
            ...(!isReflection && onCreateProduction ? [{
              label: '制作作品',
              icon: <Film className="size-4 text-muted" aria-hidden="true" />,
              onSelect: onCreateProduction,
            }] : []),
            {
              label: `审阅提案${pendingProposalCount > 0 ? `（${pendingProposalCount}）` : ''}`,
              icon: <Check className="size-4 text-muted" aria-hidden="true" />,
              onSelect: onOpenReview,
            },
            {
              label: `AI 协作（MCP）${bridgePaired ? '' : '（未配对）'}`,
              icon: <Sparkles className="size-4 text-muted" aria-hidden="true" />,
              onSelect: onOpenAgent,
            },
            {
              label: '打开资料树',
              icon: <FolderOpen className="size-4 text-muted" aria-hidden="true" />,
              onSelect: onOpenTree,
              hidden: !narrow,
            },
            {
              label: '项目工具与设置',
              icon: <Settings2 className="size-4 text-muted" aria-hidden="true" />,
              onSelect: onOpenProjectTools,
            },
          ]}
        />
        {/* Upper-owned commands stay inline actions; the shared menu remains the only popover menu. */}
        {extraMenuItems && <div className="flex items-center gap-1">{extraMenuItems}</div>}
      </>
    }
  />;
}
