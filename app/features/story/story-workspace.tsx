'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileClock, FolderOpen, Settings2, ShieldCheck } from 'lucide-react';
import type { StoryCharacter, StoryDocument, StoryEntry } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { Drawer } from '@/app/components/ui/drawer';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { storyKeys } from '@/app/lib/query-keys';
import {
  useInvalidateStoryContent, useStoryBridgeStatus, useStoryCharacters, useStoryDocuments,
  useStoryProject, useStoryProposals, useStorySearch,
} from './queries';
import { StoryEntryEditor } from './story-entry-editor';
import { StoryReviewPanel } from './story-review-panel';
import { StoryOutlinePane } from './components/story-outline-pane';
import { StoryAgentConnectDialog } from './components/story-agent-connect-dialog';
import { StoryWorkCastDialog } from './components/story-work-cast-dialog';
import { StoryWorkspaceHeader } from './components/story-workspace-header';
import { StoryEmptyState } from './components/story-empty-state';
import { StoryTreePanel } from './components/story-tree-panel';
import { StoryCreateEntryDialog } from './components/story-create-entry-dialog';
import { StoryProjectSettingsDialog } from './components/story-project-settings-dialog';
import { useCharacters } from '@/app/features/characters/queries';
import { useStoryFlushRegistry } from './hooks/use-story-flush-registry';
import { useStoryWorkspaceLayout } from './hooks/use-story-workspace-layout';
import { useStoryPanels } from './hooks/use-story-panels';
import { useStoryProjectSettings } from './hooks/use-story-project-settings';
import { useStoryEntryCreation } from './hooks/use-story-entry-creation';
import { useStoryEntrySelection } from './hooks/use-story-entry-selection';
import { useStoryChapterReorder } from './hooks/use-story-chapter-order';
import { storyBackTarget } from './model/story-route';
import {
  bibleEntryCount, bibleGroupsOf, buildEntryRows, documentOf, filteredChaptersOf,
  getEntryLabel, totalWordCount,
  type NewKind,
} from './model/story-entry';

/** Context handed to S3 assembly when the S3 production flow replaces the local publication dialog. */
export interface StoryProductionContext {
  projectId: string;
  projectTitle: string;
  chapters: StoryDocument[];
  activeEntry: StoryEntry | null;
  /** Lets the upper-owned production dialog flush the active editor before freezing revisions. */
  flush: () => Promise<boolean>;
}

/** Context for the upper Story workspace to open its own derivatives/export dialog. */
export interface StoryDerivativesContext {
  projectId: string;
  projectTitle: string;
  chapterTitle: string;
  chapterBody: string;
  activeEntry: StoryEntry | null;
}

/**
 * Upper-workspace integration points. Production and derivatives dialogs are owned by the upper
 * Story workspace; Story only supplies context and the trigger. Character adoption stays a
 * one-way Story -> Characters action until S3 replaces it.
 */
export interface StoryWorkspaceActions {
  onCreateProduction?: (context: StoryProductionContext) => void;
  onOpenDerivatives?: (context: StoryDerivativesContext) => void;
  onAdoptCharacter?: (context: { projectId: string; projectTitle: string; workId: string | null | undefined }) => void;
  extraMenuItems?: ReactNode;
  extraHeaderActions?: ReactNode;
}

export function StoryWorkspace({
  projectId, actions, overlay,
}: {
  projectId: string;
  actions?: StoryWorkspaceActions;
  /** Upper workspace-owned dialogs (production, derivatives) mounted inside the workspace root. */
  overlay?: ReactNode | ((context: StoryProductionContext & StoryDerivativesContext) => ReactNode);
}) {
  const searchParams = useSearchParams();
  const client = useQueryClient();
  const project = useStoryProject(projectId);
  const documents = useStoryDocuments(projectId);
  const characters = useStoryCharacters(projectId);
  const charactersLibrary = useCharacters();
  const proposals = useStoryProposals(projectId, { refetchInterval: 20_000 });
  const bridge = useStoryBridgeStatus(projectId, { refetchInterval: 20_000 });
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');

  const { flush, register: registerFlush } = useStoryFlushRegistry();
  const layout = useStoryWorkspaceLayout();
  const panels = useStoryPanels();
  const settings = useStoryProjectSettings(projectId, setNotice);
  const refreshEntry = useInvalidateStoryContent(projectId);

  const entries = useMemo(
    () => buildEntryRows(documents.data?.items, characters.data?.items),
    [characters.data, documents.data],
  );
  const isReflection = project.data?.projectType === 'reflection';
  const back = storyBackTarget({
    projectId,
    isReflection: Boolean(isReflection),
    returnTo: searchParams.get('returnTo'),
  });
  const selection = useStoryEntrySelection({
    entries,
    documents: documents.data?.items,
    isReflection,
    urlEntryId: searchParams.get('entry'),
    flush,
    onNotice: setNotice,
    closeTree: () => layout.setTreeOpen(false),
  });
  const chapters = selection.chapters;
  const activeEntry = selection.activeEntry;
  const activeId = selection.activeId;

  const creation = useStoryEntryCreation({
    projectId,
    flush,
    refreshEntries: refreshEntry,
    onCreated: (kind, id) => {
      selection.selectCreated(kind, id);
      setNotice(`${getEntryLabel(kind, isReflection)}已创建。`);
    },
  });
  const reorderChapter = useStoryChapterReorder({
    projectId, project: project.data, documents: documents.data?.items, flush, onNotice: setNotice,
  });

  const libraryMap = useMemo(() => {
    const map = new Map<string, { avatarUrl?: string | null; work?: string | null; displayName?: string }>();
    for (const character of charactersLibrary.data?.items ?? []) {
      const info = {
        avatarUrl: character.avatarUrl || null,
        work: character.draft?.work?.trim() || null,
        displayName: character.displayName || character.draft?.displayName || '',
      };
      if (character.id) map.set(character.id, info);
      if (info.displayName) map.set(info.displayName, info);
    }
    return map;
  }, [charactersLibrary.data]);

  const castList = useMemo(() => (characters.data?.items ?? []).map((character) => {
    const library = character.sourceCharacterId ? libraryMap.get(character.sourceCharacterId) : null;
    return {
      id: character.id,
      name: character.name,
      avatarUrl: library?.avatarUrl || null,
      work: library?.work || null,
      notes: character.notes,
    };
  }), [characters.data, libraryMap]);

  const outlineDoc = useMemo(() => (documents.data?.items ?? []).find((item) => item.kind === 'outline'), [documents.data]);
  const totalWords = useMemo(() => totalWordCount(chapters), [chapters]);
  const filteredChapters = useMemo(() => filteredChaptersOf(chapters, search), [chapters, search]);
  const bibleGroups = useMemo(() => bibleGroupsOf(entries), [entries]);
  const bibleCount = useMemo(() => bibleEntryCount(entries), [entries]);
  const pendingProposalCount = proposals.data?.items.filter((item) => item.status === 'pending').length ?? 0;
  const searchResults = useStorySearch(projectId, search);

  const onSaved = useCallback((entry: StoryEntry) => {
    if (documentOf(entry)) {
      client.setQueryData<{ items: StoryDocument[] }>(storyKeys.documents(projectId), (old) => old && ({ items: old.items.map((item) => item.id === entry.id ? entry : item) }));
    } else {
      client.setQueryData<{ items: StoryCharacter[] }>(storyKeys.characters(projectId), (old) => old && ({ items: old.items.map((item) => item.id === entry.id ? entry : item) }));
    }
    void client.invalidateQueries({ queryKey: storyKeys.proposals(projectId) });
  }, [client, projectId]);
  const onConflict = useCallback(() => { void refreshEntry(); }, [refreshEntry]);

  if (project.isLoading) return <div className="story-workspace-root flex h-full min-h-0 flex-col bg-paper text-ink">
    <WorkspaceHeader title="剧情与记录工作室" backHref={back.href} backLabel={back.label} />
    <div className="flex flex-1 items-center justify-center p-6" role="status">
      <AsyncState status="loading" title="正在打开剧情项目" rows={3} className="w-full max-w-md" />
    </div>
  </div>;
  if (!project.data) return <div className="story-workspace-root flex h-full min-h-0 flex-col bg-paper text-ink">
    <WorkspaceHeader title="剧情与记录工作室" backHref={back.href} backLabel={back.label} />
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3">
        <Alert variant="danger" title="无法打开剧情项目">
          {project.error instanceof Error ? project.error.message : '项目不存在或已被移除。'}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void project.refetch()}>重新加载</Button>
          <Link href={back.href} className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
            返回{back.label}
          </Link>
        </div>
      </div>
    </div>
  </div>;

  const projectData = project.data;
  const openCreateFromTree = (kind: NewKind) => {
    creation.openCreate(kind);
    layout.setTreeOpen(false);
  };
  const openProjectSettingsFromTree = () => settings.openSettings(projectData, { workId: '' });
  const openCharacterLibrary = () => {
    if (actions?.onAdoptCharacter) {
      actions.onAdoptCharacter({ projectId, projectTitle: projectData.title, workId: projectData.workId });
      return;
    }
    panels.setWorkCastOpen(true);
  };
  const createProduction = () => {
    actions?.onCreateProduction?.({ projectId, projectTitle: projectData.title, chapters, activeEntry, flush });
  };
  const openDerivatives = actions?.onOpenDerivatives ? () => {
    actions.onOpenDerivatives!({
      projectId,
      projectTitle: projectData.title,
      chapterTitle: activeEntry && 'title' in activeEntry ? activeEntry.title : '本章',
      chapterBody: activeEntry ? ('body' in activeEntry ? activeEntry.body : activeEntry.notes) : '',
      activeEntry,
    });
  } : undefined;

  const treePanel = <StoryTreePanel
    project={projectData}
    isReflection={isReflection}
    search={search}
    onSearchChange={setSearch}
    searchLoading={searchResults.isLoading}
    searchResults={searchResults.data}
    entries={entries}
    chapters={chapters}
    filteredChapters={filteredChapters}
    totalWords={totalWords}
    bibleCount={bibleCount}
    bibleGroups={bibleGroups}
    outlineDoc={outlineDoc}
    activeId={activeId}
    castList={castList}
    navTab={selection.navTab}
    onNavTabChange={selection.setNavTab}
    onChooseEntry={(row) => void selection.chooseEntry(row)}
    onReorderChapter={(chapterId, direction) => void reorderChapter(chapterId, direction)}
    onCreate={openCreateFromTree}
    onOpenProjectSettings={openProjectSettingsFromTree}
    onOpenCharacterLibrary={openCharacterLibrary}
  />;

  return <div className="story-workspace-root flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-paper text-ink">
    <StoryWorkspaceHeader
      projectId={projectId}
      title={projectData.title}
      isReflection={isReflection}
      pendingProposalCount={pendingProposalCount}
      bridgePaired={Boolean(bridge.data?.paired)}
      sidebarCollapsed={layout.sidebarCollapsed}
      onToggleSidebar={layout.toggleSidebar}
      onCreateProduction={actions?.onCreateProduction ? createProduction : undefined}
      onOpenReview={() => panels.openReview('proposals')}
      onOpenAgent={() => panels.setAgentConnectOpen(true)}
      onOpenTree={() => layout.setTreeOpen(true)}
      onOpenProjectTools={() => panels.setProjectToolsOpen(true)}
      extraMenuItems={actions?.extraMenuItems}
      extraActions={actions?.extraHeaderActions}
      backHref={back.href}
      backLabel={back.label}
    />

    {notice && <Alert variant="info" className="mx-2 shrink-0 sm:mx-5" onDismiss={() => setNotice('')}>{notice}</Alert>}

    {/* 三栏式视口锁高工作台主体 */}
    <div className="relative flex min-h-0 min-w-0 flex-1 gap-0 overflow-hidden md:gap-4 md:px-5 md:pb-4">
      <StoryOutlinePane hidden={layout.zenMode || layout.sidebarCollapsed}>
        {treePanel}
      </StoryOutlinePane>

      <section aria-label="正式写作工作台" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none bg-surface shadow-none md:rounded-panel md:shadow-xs">
        {documents.isLoading || characters.isLoading ? <div className="p-6"><AsyncState status="loading" title="正在加载项目资料" rows={3} /></div> : documents.error || characters.error ? <div className="space-y-3 p-6"><Alert variant="danger" title="项目资料加载失败">已有草稿不会清除。</Alert><Button variant="outline" onClick={() => { void documents.refetch(); void characters.refetch(); }}>重新加载资料</Button></div> : activeEntry ? (
          <div className={`story-editor-frame h-full min-h-0 w-full overflow-hidden ${layout.zenMode ? 'zen-workspace' : ''}`}>
            <StoryEntryEditor
              key={`${'name' in activeEntry ? 'character' : 'document'}:${activeEntry.id}`}
              projectId={projectId}
              entry={activeEntry}
              castList={isReflection ? [] : castList}
              prevChapter={selection.previousChapter}
              nextChapter={selection.nextChapter}
              onSwitchChapter={(targetId) => void selection.switchChapter(targetId)}
              onCreateNextChapter={() => creation.openCreate('chapter')}
              onSaved={onSaved}
              onConflict={onConflict}
              onRegisterFlush={registerFlush}
              zenMode={layout.zenMode}
              onToggleZen={layout.toggleZen}
              onOpenDerivatives={isReflection ? undefined : openDerivatives}
              isReflection={isReflection}
            />
          </div>
        ) : (
          <StoryEmptyState
            isReflection={isReflection}
            onCreate={(kind) => creation.openCreate(kind)}
            onOpenAgent={() => panels.setAgentConnectOpen(true)}
          />
        )}
      </section>

      {/* 审阅面板 */}
      <StoryReviewPanel
        open={panels.reviewOpen}
        onOpenChange={panels.setReviewOpen}
        projectId={projectId}
        entries={entries}
        activeEntry={activeEntry}
        flushEditor={flush}
        onRefreshEntry={refreshEntry}
        tab={panels.reviewTab}
        onTabChange={panels.setReviewTab}
      />
    </div>

    {/* 抽屉导航（小屏幕模式） */}
    <Drawer open={layout.treeOpen} onOpenChange={layout.setTreeOpen} title="项目资料" description="选择条目后回到正文编辑。">
      <div className="h-full min-h-0">{treePanel}</div>
    </Drawer>

    {/* 从角色库按作品引入角色弹窗 */}
    <StoryWorkCastDialog
      open={panels.workCastOpen}
      onOpenChange={panels.setWorkCastOpen}
      projectId={projectId}
      defaultWorkId={projectData.workId}
      existingSources={new Set((characters.data?.items ?? []).filter((character) => character.sourceCharacterId).map((character) => character.sourceCharacterId + ':' + character.sourceVersion))}
      onCharacterAdded={() => void refreshEntry()}
    />

    {/* AI 协作与 MCP 基础设施向导弹窗 */}
    <StoryAgentConnectDialog
      open={panels.agentConnectOpen}
      onOpenChange={panels.setAgentConnectOpen}
      projectId={projectId}
      projectTitle={projectData.title}
      onOpenProposals={() => panels.openReview('proposals')}
      pendingProposalsCount={pendingProposalCount}
    />

    {/* 更多项目工具 */}
    <ResponsiveEditOverlay open={panels.projectToolsOpen} onOpenChange={panels.setProjectToolsOpen} title="项目工具" description="正文创作留在工作区；版本、旧会话与配对状态按需查看。" footer={<Button type="button" onClick={() => panels.setProjectToolsOpen(false)}>完成</Button>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" className="justify-start" onClick={() => { panels.setProjectToolsOpen(false); panels.openReview('archive'); }}><FolderOpen className="size-4" />查看旧会话归档</Button>
        <Button variant="outline" className="justify-start" onClick={() => { panels.setProjectToolsOpen(false); panels.openReview('revisions'); }}><FileClock className="size-4" />查看版本历史</Button>
        <Button variant="outline" className="justify-start" onClick={() => { panels.setProjectToolsOpen(false); panels.setAgentConnectOpen(true); }}><ShieldCheck className="size-4" />MCP 与 AI 连接向导</Button>
        <Button variant="outline" className="justify-start" onClick={() => { panels.setProjectToolsOpen(false); settings.openSettings(projectData); }}><Settings2 className="size-4" />编辑项目名称与简介</Button>
      </div>
    </ResponsiveEditOverlay>

    <StoryCreateEntryDialog
      newKind={creation.creation.newKind}
      isReflection={isReflection}
      title={creation.creation.newTitle}
      body={creation.creation.newBody}
      error={creation.creation.createError}
      creating={creation.creation.creating}
      onTitleChange={creation.changeTitle}
      onBodyChange={creation.changeBody}
      onSubmit={() => void creation.submit()}
      onClose={creation.closeCreate}
    />

    <StoryProjectSettingsDialog
      open={settings.projectSettingsOpen}
      isReflection={isReflection}
      title={settings.projectTitle}
      summary={settings.projectSummary}
      workId={settings.projectWorkId}
      onOpenChange={settings.setProjectSettingsOpen}
      onTitleChange={settings.setProjectTitle}
      onSummaryChange={settings.setProjectSummary}
      onWorkIdChange={settings.setProjectWorkId}
      onSave={() => void settings.saveProject(projectData)}
    />

    {typeof overlay === 'function' ? overlay({
      projectId, projectTitle: projectData.title, chapters, activeEntry, flush,
      chapterTitle: activeEntry && 'title' in activeEntry ? activeEntry.title : '本章',
      chapterBody: activeEntry ? ('body' in activeEntry ? activeEntry.body : activeEntry.notes) : '',
    }) : overlay}
  </div>;
}
