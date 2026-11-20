'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { NoteKind } from '@sthstart/contracts';
import { NotebookWorkspace } from '@/app/features/notebook/components/notebook-workspace';
import { OfflineNotebook } from '@/app/features/notebook/components/offline-notebook';
import type { NoteAdoptAction } from '@/app/features/notebook/note-adoption';
import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';
import { CollectionManager } from '@/app/features/knowledge/components/collection-manager';
import { PendingInbox } from '@/app/features/knowledge/components/pending-inbox';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageTabs } from '@/app/components/ui/page-tabs';

type LegacyNotebookView = 'notes' | 'collections' | 'pending';

function useNoteAdoptAction() {
  return useCallback<NoteAdoptAction>(({ noteId, disabled }) => (
    <AdoptIntoProject source={{ kind: 'note', id: noteId }} disabled={disabled} />
  ), []);
}

/**
 * 旧 /apps/notebook 入口适配：保留资料 / 搜集任务 / 待整理三个视图与笔记详情路由，
 * 知识视图的装配停留在资料库组合层，不再下沉到笔记模块。
 */
export function NotebookEntryWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const adoptAction = useNoteAdoptAction();
  const viewParam = searchParams?.get('view');
  const view: LegacyNotebookView =
    viewParam === 'collections' || viewParam === 'pending' ? viewParam : 'notes';

  const setView = (next: LegacyNotebookView) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (next === 'notes') params.delete('view');
    else params.set('view', next);
    router.push(`/apps/notebook${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  return (
    <div className="notebook-workspace-shell notebook-list-page workspace-fill bg-paper text-ink">
      <header className="notebook-workspace-header notebook-list-header sticky top-0 z-30 px-4 sm:px-6 py-2 bg-paper/95 backdrop-blur-md border-b border-border-subtle">
        <PageHeader compact title="创作笔记" />
      </header>

      <div className="shrink-0 border-b border-border-subtle px-4 py-2 sm:px-6">
        <PageTabs
          variant="page"
          ariaLabel="创作笔记视图"
          value={view}
          tabs={[{ id: 'notes', label: '笔记' }, { id: 'collections', label: '搜集任务' }, { id: 'pending', label: '待整理' }]}
          onChange={(next) => {
            if (next === 'notes' || next === 'collections' || next === 'pending') setView(next);
          }}
        />
      </div>

      {view !== 'notes' && (
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-350">
            {view === 'collections'
              ? <CollectionManager onOpenPending={() => setView('pending')} />
              : <PendingInbox />}
          </div>
        </div>
      )}

      <div className={view === 'notes' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <NotebookWorkspace
          hideChrome
          basePath="/apps/notebook"
          adoptAction={adoptAction}
        />
      </div>
    </div>
  );
}

/** 笔记详情/新建入口：保留原路由与顶栏，只向上注入跨模块动作。 */
export function NotebookEditorEntry({
  initialNoteId,
  isNew = false,
  initialKind,
}: {
  initialNoteId?: string;
  isNew?: boolean;
  initialKind?: NoteKind;
}) {
  const adoptAction = useNoteAdoptAction();
  return (
    <NotebookWorkspace
      initialNoteId={initialNoteId}
      isNew={isNew}
      initialKind={initialKind}
      adoptAction={adoptAction}
    />
  );
}

/** 离线壳仍由笔记模块渲染，项目动作由入口层注入，避免笔记反向依赖项目模块。 */
export function OfflineNotebookEntry() {
  const adoptAction = useNoteAdoptAction();
  return <OfflineNotebook adoptAction={adoptAction} />;
}
