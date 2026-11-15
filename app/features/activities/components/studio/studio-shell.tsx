'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityReviewItem } from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { getJson } from '@/app/lib/api-client';
import { activityKeys } from '@/app/lib/query-keys';
import { useActivity, useActivityDraft } from '../../queries/activities';
import { useActivityPlaybackRevision } from '../../queries/playback';
import { resolveActivityStudioRoute } from '../../studio-route';
import { useStudioDraft } from '../../hooks/use-studio-draft';
import { useStudioSelection } from '../../studio/hooks/use-studio-selection';
import { useStudioLayout } from '../../studio/hooks/use-studio-layout';
import { useStudioOverlays } from '../../studio/hooks/use-studio-overlays';
import { useStudioDeepLink } from '../../studio/hooks/use-studio-deep-link';
import { useStudioKeyboardShortcuts } from '../../studio/hooks/use-studio-keyboard-shortcuts';
import { useStudioDocumentActions } from '../../studio/hooks/use-studio-document-actions';
import { useStudioCandidateAdoption } from '../../studio/hooks/use-studio-candidate-adoption';
import { useStudioRenderTasks } from '../../studio/hooks/use-studio-render-tasks';
import { useStudioPreviewPreparation } from '../../studio/hooks/use-studio-preview-preparation';
import type { StudioViewMode } from '../../studio/model/studio-view';
import {
  LazyComicWorkstation,
  LazyExportPanel,
  LazyMediaWorkstation,
  LazyPlaybackWorkstation,
} from '../../studio/lazy-workstations';
import { StudioHeader } from './studio-header';
import { StudioOutlineRail } from './studio-outline-rail';
import { StudioBeatStream } from './studio-beat-stream';
import { BeatRenderWorkbench } from '../beat-render-workbench';
import { ArtDirectionDialog } from '../art-direction-dialog';
import { StudioSettingsDrawer } from './studio-settings-drawer';
import { StudioCandidateDialog } from './studio-candidate-dialog';
import { ReworkPanel } from '../rework-panel';
import { PanelRightClose, PanelRightOpen, Sparkles, X } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { StudioMenu, StudioMenuItem } from './studio-menu';

interface StudioShellProps {
  activityId: string;
}

/** 试演 / 导出浮层顶部的内容准备提示：准备中只读提示，失败时可重试，草稿始终保留。 */
function PrepareNotice({ status, error, onRetry }: { status: 'idle' | 'preparing' | 'ready' | 'error'; error: string | null; onRetry: () => void }) {
  if (status === 'preparing') return <div className="shrink-0 border-b border-border-subtle bg-surface-sunken px-4 py-1.5"><Spinner size="sm" label="正在把最新草稿准备为试演内容…" className="text-xs" /></div>;
  if (status !== 'error') return null;
  return <div className="shrink-0 border-b border-danger-fg/20 bg-danger-bg px-4 py-2">
    <Alert variant="danger" title="准备试演内容失败">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">{error || '准备试演内容失败'}；下方仍是上一版正式内容，你的草稿已保留。</span>
        <Button size="sm" variant="ghost" onClick={onRetry}>重新准备</Button>
      </div>
    </Alert>
  </div>;
}

export function StudioShell({ activityId }: StudioShellProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  // 数据拉取与草稿管理器：草稿控制器只在这里创建，工作台按需加载不重建它。
  const {
    data: activityData,
    isLoading: activityLoading,
    refetch: refetchActivity,
    error: activityError,
  } = useActivity(activityId);

  const {
    data: draftData,
    isLoading: draftLoading,
    error: draftError,
    refetch: refetchDraft,
  } = useActivityDraft(activityId);

  const draft = useStudioDraft(activityId, draftData?.draft);
  const { document, status: saveStatus, error: saveError } = draft;

  const activity = activityData?.activity;
  const playbackRevision = useActivityPlaybackRevision(
    activityId,
    activity?.currentPlaybackRevisionId || undefined
  ).data || null;

  // 视图、选中与浮层状态分别由各自的 Studio 模块持有。
  const layout = useStudioLayout();
  const selection = useStudioSelection(document);
  const {
    activeStage,
    activeScene,
    selectedBeat,
    scenes,
    activeSceneId,
    selectedBeatId,
  } = selection;

  const mediaFlush = useRef<(() => Promise<boolean>) | null>(null);
  const draftFlushRef = useRef(draft.flush);
  useEffect(() => {
    draftFlushRef.current = draft.flush;
  });

  const preview = useStudioPreviewPreparation({
    activityId,
    draft,
    mediaFlushRef: mediaFlush,
    refetchActivity,
    refetchDraft,
  });
  const overlays = useStudioOverlays({ prepareContent: preview.prepareContent });

  const actions = useStudioDocumentActions({
    document,
    activeStage,
    activeScene,
    activeSceneId,
    scenes,
    selectedBeatId,
    updateDocument: draft.update,
    setActiveStageId: selection.setActiveStageId,
    setActiveSceneId: selection.setActiveSceneId,
    setSelectedBeatId: selection.setSelectedBeatId,
  });
  const candidate = useStudioCandidateAdoption({
    draft,
    activeStage,
    activeScene,
    selectedBeat,
    refetchActivity,
    refetchDraft,
  });
  const renderTasks = useStudioRenderTasks({
    activityId,
    document,
    activeStage,
    activeScene,
    draft,
    queryClient,
    toast,
  });

  const { data: reviewData } = useQuery({
    queryKey: ['activity-review', activityId, activity?.headVersion],
    queryFn: () => getJson<{ items: ActivityReviewItem[] }>('/api/admin/activities/' + activityId + '/review-items'),
    enabled: Boolean(activity),
  });
  const reviewCount = reviewData?.items.filter(item => item.decision === 'pending' || item.decision === 'rework').length ?? 0;

  const documentReady = Boolean(document && activity);

  /** 深链接：任务中心、复核面板等处的 ?tab=…&actorId=… / ?tab=records&jobId=… 打开对应浮层或视图。 */
  const applyRoute = (currentSearch: string) => {
    const params = new URLSearchParams(currentSearch);
    const { route } = resolveActivityStudioRoute(currentSearch);
    const jobId = params.get('jobId');
    if (jobId) overlays.setCandidateJobId(jobId);
    if (route.panel === 'activity-settings') {
      const actorId = params.get('actorId');
      const stageId = params.get('stageId');
      overlays.setSettingsTab(actorId ? 'actors' : stageId ? 'stages' : 'basics');
      overlays.setSettingsFocusId(actorId ? 'actor-' + actorId : stageId ? 'stage-' + stageId : null);
      overlays.setSettingsOpen(true);
    } else if (route.panel === 'art-direction') {
      overlays.setArtOpen(true);
    }
    if (route.tab === 'theater') overlays.openPlayback();
    else if (route.tab === 'delivery') overlays.openExport();
    else if (route.view === 'assets') layout.setViewMode('materials');
    else if (route.view === 'comic') layout.setViewMode('comic');
  };
  const { clearDeepLink } = useStudioDeepLink({ documentReady, search, applyRoute });

  useStudioKeyboardShortcuts({
    mediaFlushRef: mediaFlush,
    draftFlushRef,
    overlaysOpen: overlays.playbackOpen || overlays.exportOpen,
    onEscape: () => {
      overlays.setPlaybackOpen(false);
      overlays.setExportOpen(false);
      clearDeepLink();
    },
  });

  const changeView = async (mode: StudioViewMode) => {
    if (mode === layout.viewMode) return;
    if (mediaFlush.current && !await mediaFlush.current()) return;
    if (await draft.flush()) {
      mediaFlush.current = null;
      layout.setViewMode(mode);
      clearDeepLink();
    }
  };

  if (activityError || draftError || (!activityLoading && !draftLoading && (!document || !activity))) {
    return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
      <WorkspaceHeader
        title="活动工作室"
        backHref="/apps/activities"
        backLabel="活动列表"
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">
        <AsyncState
          status="error"
          title="活动工作室暂不可用"
          description={activityError?.message || draftError?.message || '活动或草稿暂不可用。'}
          onRetry={() => { void refetchActivity(); void refetchDraft(); }}
          className="w-full max-w-xl"
        />
        <Link href="/apps/activities" className="text-muted hover:underline">返回活动列表</Link>
      </div>
    </div>;
  }

  if (activityLoading || draftLoading || !document || !activity) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
        <WorkspaceHeader title="活动工作室" backHref="/apps/activities" backLabel="活动列表" />
        <div className="flex flex-1 items-center justify-center">
          <Spinner label="正在进入活动工作室…" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-paper text-ink">
      {/* 48px 极简统一顶栏 */}
      <StudioHeader
        activity={activity}
        document={document}
        saveStatus={saveStatus}
        saveError={saveError}
        viewMode={layout.viewMode}
        onViewModeChange={mode => { void changeView(mode); }}
        onUpdateTitle={actions.handleUpdateTitle}
        onOpenPlayback={overlays.openPlayback}
        onBatchGenerate={renderTasks.handleBatchGenerate}
        isBatchGenerating={renderTasks.isBatchGenerating}
        onOpenSettings={() => { overlays.setSettingsFocusId(null); overlays.setSettingsOpen(true); }}
        onOpenExport={overlays.openExport}
        onOpenArt={() => overlays.setArtOpen(true)}
        onOpenRework={() => overlays.setReworkOpen(true)}
      />
      {/* 发布新版本后产生的复核项：保留、返工与处理历史都在复核面板里 */}
      {reviewCount > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning-border bg-warning-bg px-3 py-1.5 text-sm text-warning-fg">
          <span className="min-w-0 flex-1">内容修改影响了已有镜头、图片或回放，确认保留或加入返工后提示会消失。</span>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => overlays.setReworkOpen(true)}>查看 {reviewCount} 项内容变化</Button>
        </div>
      )}
      {(saveStatus === 'error' || saveStatus === 'conflict') && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-danger-fg/20 bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          <span className="min-w-0 flex-1">{saveError || '草稿尚未同步，你的输入仍保留在本机。'}</span>
          {saveStatus === 'error' ? <Button size="sm" variant="ghost" onClick={draft.retry}>重试保存</Button> : <>
            <Button size="sm" variant="ghost" onClick={() => {
              if (!window.confirm('使用当前内容覆盖服务器新版本？请先核对版本差异。')) return;
              void refetchDraft().then(result => { if (result.data?.draft) draft.resolve(result.data.draft, true); });
            }}>保留本机内容并重试</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              if (!window.confirm('放弃本机未保存修改并载入服务器版本？')) return;
              void refetchDraft().then(result => { if (result.data?.draft) draft.resolve(result.data.draft, false); });
            }}>载入服务器版本</Button>
          </>}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-2 py-2 md:hidden">
        {layout.viewMode === 'storyboard' ? <>
          <div className="min-w-0 flex-1"><Select aria-label="当前幕" className="text-base" value={activeStage?.id ?? ''} onChange={event => selection.selectStage(event.target.value)}>{document.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</Select></div>
          <div className="min-w-0 flex-1"><Select aria-label="当前场次" className="text-base" disabled={!scenes.length} value={activeScene?.id ?? ''} onChange={event => { if (activeStage) selection.selectScene(activeStage.id, event.target.value); }}>{scenes.length === 0 && <option value="">暂无场次</option>}{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</Select></div>
          <Button size="sm" variant="outline" className="h-9 shrink-0" disabled={!selectedBeat && !layout.mobileDrawing} onClick={() => layout.setMobileDrawing(value => !value)}>{layout.mobileDrawing ? '返回剧情' : '镜头绘制'}</Button>
          <StudioMenu label="工作台操作">
            <StudioMenuItem onSelect={actions.handleAddStage}>新增一幕</StudioMenuItem>
            <StudioMenuItem disabled={!activeStage} onSelect={() => { if (activeStage) actions.handleAddScene(activeStage.id); }}>新增场次</StudioMenuItem>
          </StudioMenu>
        </> : <span className="px-1 text-sm text-muted">{layout.viewMode === 'comic' ? '漫画工坊' : '素材制作'}</span>}
      </div>

      {layout.viewMode === 'storyboard' && layout.mobileDrawing && (
        <div className="shrink-0 border-b border-border-subtle bg-surface px-2 py-2 md:hidden">
          <Select aria-label="选择镜头" className="w-full min-w-0 text-base" value={(activeScene?.id ?? '') + '|' + (selectedBeat?.id ?? '')} onChange={event => { const [sceneId, beatId] = event.target.value.split('|'); if (activeStage) selection.selectScene(activeStage.id, sceneId); selection.setSelectedBeatId(beatId); }}>{scenes.flatMap(scene => scene.beats.map((beat, index) => <option key={beat.id} value={scene.id + '|' + beat.id}>{scene.title} · {index + 1} · {beat.action || beat.dialogue || '镜头'}</option>))}</Select>
        </div>
      )}

      {/* 核心工作台：三栏视口锁高布局 */}
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden md:gap-4 md:px-5 md:pb-4">
        {/* 左侧大纲导轨（仅分镜模式展示，避免漫画工坊出现双侧栏） */}
        {layout.viewMode === 'storyboard' && (
          <div className="hidden min-h-0 md:flex md:overflow-hidden md:rounded-panel md:bg-surface md:shadow-xs"><StudioOutlineRail
            document={document}
            activeStageId={activeStage?.id ?? ''}
            activeSceneId={activeScene?.id ?? null}
            onSelectStage={selection.selectStage}
            onSelectScene={selection.selectScene}
            onAddStage={actions.handleAddStage}
            onAddScene={actions.handleAddScene}
            collapsed={layout.leftRailCollapsed}
            onToggleCollapse={() => layout.setLeftRailCollapsed(!layout.leftRailCollapsed)}
          /></div>
        )}

        {/* 中央主创作流：非当前视图按需载入，草稿控制器保持挂载 */}
        {layout.viewMode === 'materials' ? <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:rounded-panel md:bg-surface md:shadow-xs" data-autohide-scroll>
          <LazyMediaWorkstation
            activity={activity}
            document={document}
            actors={document.actors}
            currentMediaRevision={activityData?.currentMediaRevision}
            onUpdateDocument={draft.update}
            registerFlush={flush => { mediaFlush.current = flush; }}
          />
        </div> : layout.viewMode === 'comic' ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden md:rounded-panel md:bg-surface md:shadow-xs">
            <LazyComicWorkstation
              embedded
              registerFlush={flush => { mediaFlush.current = flush; }}
              activity={activity}
              content={document}
              actors={document.actors}
              readingOnly={false}
              onBack={() => { void changeView('storyboard'); }}
              onEdit={() => {}}
            />
          </div>
        ) : (
          <div className={(layout.mobileDrawing ? 'hidden md:flex' : 'flex') + ' min-h-0 min-w-0 flex-1 md:overflow-hidden md:rounded-panel md:bg-surface md:shadow-xs'}><StudioBeatStream
            stage={activeStage!}
            scene={activeScene}
            actors={document.actors}
            selectedBeatId={selectedBeat?.id ?? null}
            onSelectBeat={selection.selectBeat}
            onAddScene={() => { if (activeStage) actions.handleAddScene(activeStage.id); }}
            onUpdateBeat={actions.handleUpdateBeat}
            onAddBeat={actions.handleAddBeat}
            onDeleteBeat={actions.handleDeleteBeat}
            onUpdateScene={actions.handleUpdateScene}
            onDeleteScene={actions.handleDeleteScene}
            onQuickGenerateBeat={renderTasks.handleQuickGenerateBeat}
            generatingBeatIds={renderTasks.generatingBeatIds}
          /></div>
        )}

        {/* 右侧随动导演面板 */}
        {layout.viewMode === 'storyboard' && activeStage && (
          <aside
            className={(layout.mobileDrawing ? 'flex' : 'hidden md:flex') + ' min-h-0 min-w-0 w-full flex-col overflow-hidden bg-surface transition-[width] duration-150 md:rounded-panel md:shadow-xs ' + (layout.rightInspectorCollapsed ? 'md:w-12' : 'md:w-80 lg:w-96') + ' md:shrink-0'}
          >
            {/* 44px 统一连续基线顶栏 */}
            <div className="h-11 px-2.5 border-b border-border-default bg-surface flex items-center justify-between shrink-0 select-none">
              {!layout.rightInspectorCollapsed && (
                <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                  <Sparkles className="h-3.5 w-3.5 text-muted" />
                  <span>镜头工坊</span>
                </span>
              )}
              <IconButton
                icon={layout.rightInspectorCollapsed ? PanelRightOpen : PanelRightClose}
                label={layout.rightInspectorCollapsed ? '展开镜头工坊' : '收起镜头工坊'}
                size="icon"
                className={'hidden md:inline-flex h-7 w-7 shrink-0 ' + (layout.rightInspectorCollapsed ? 'mx-auto' : '')}
                onClick={() => layout.setRightInspectorCollapsed(!layout.rightInspectorCollapsed)}
              />
            </div>

            {layout.rightInspectorCollapsed && !layout.isMobile ? (
              <button type="button"
                onClick={() => layout.setRightInspectorCollapsed(false)}
                className="flex-1 flex flex-col items-center py-4 cursor-pointer hover:bg-surface-hover/50 text-muted hover:text-ink transition-colors"
                title="点击展开镜头工坊"
              >
                <span className="[writing-mode:vertical-rl] text-xs font-medium tracking-widest text-muted hover:text-ink select-none">
                  镜头工坊
                </span>
              </button>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-3" data-autohide-scroll>
                {selectedBeat && activeScene ? (
                  <BeatRenderWorkbench
                    activityId={activityId}
                    stageId={activeStage.id}
                    scene={activeScene}
                    beat={selectedBeat}
                    document={document}
                    onBeforeAction={draft.flush}
                    onSettingsChange={(settings) =>
                      actions.handleUpdateBeat(selectedBeat.id, { renderSettings: settings })
                    }
                    onAdopted={candidate.handleAdopted}
                    onAutoAppliedCheck={() => {
                      if (draft.isClean())
                        void queryClient.invalidateQueries({
                          queryKey: activityKeys.draft(activityId),
                        });
                    }}
                  />
                ) : (
                  <p className="text-xs text-muted">选择一个镜头开始绘制。</p>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* 统一全局设置抽屉 */}
      <StudioSettingsDrawer
        open={overlays.settingsOpen}
        onClose={() => { overlays.setSettingsOpen(false); overlays.setSettingsFocusId(null); clearDeepLink(); }}
        activity={activity}
        document={document}
        onUpdateDocument={(nextDoc) => draft.update(nextDoc)}
        tab={overlays.settingsTab}
        onTabChange={overlays.setSettingsTab}
        focusId={overlays.settingsFocusId}
        profileDisabled={saveStatus === 'error' || saveStatus === 'conflict'}
        beforeApplyProfile={preview.prepareContent}
        onProfileApplied={() => { void refetchActivity(); void refetchDraft(); }}
      />
      <ReworkPanel
        open={overlays.reworkOpen}
        onOpenChange={overlays.setReworkOpen}
        activityId={activityId}
        headVersion={activity.headVersion}
        document={document}
        onSaved={() => { void refetchActivity(); }}
      />
      {overlays.candidateJobId && <StudioCandidateDialog
        key={overlays.candidateJobId}
        activityId={activityId}
        jobId={overlays.candidateJobId}
        onClose={() => { overlays.setCandidateJobId(null); clearDeepLink(); }}
        onApplied={candidate.handleCandidateApplied}
      />}
      <ArtDirectionDialog activity={activity} open={overlays.artOpen} onOpenChange={overlays.setArtOpen} beforeApply={draft.flush} onApplied={async () => { await refetchActivity(); }} />

      {/* 连贯试演弹窗 */}
      {overlays.playbackOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface overflow-hidden">
          <div className="h-11 px-4 border-b border-border-default flex items-center justify-between shrink-0 bg-surface">
            <span className="text-xs font-semibold text-ink">连贯试演与演播预览</span>
            <IconButton icon={X} label="关闭试演预览" size="icon" className="h-7 w-7" onClick={() => { overlays.setPlaybackOpen(false); clearDeepLink(); }} />
          </div>
          <PrepareNotice status={preview.prepareStatus} error={preview.prepareError} onRetry={() => { void preview.prepareContent(); }} />
          <div className="flex-1 min-h-0 overflow-hidden">
            <LazyPlaybackWorkstation
              key={(activity.currentContentRevisionId || 'none') + ':' + (activity.currentMediaRevisionId || 'none')}
              activity={activity}
              document={document}
              currentPlaybackRevision={playbackRevision}
              mediaRevision={activityData?.currentMediaRevision || null}
              actors={document.actors}
            />
          </div>
        </div>
      )}

      {/* 导出交付浮层 */}
      {overlays.exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border-default bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="h-11 px-4 border-b border-border-default flex items-center justify-between shrink-0">
              <span className="text-xs font-bold text-ink">活动资产与格式导出</span>
              <IconButton icon={X} label="关闭导出交付" size="icon" className="h-7 w-7" onClick={() => { overlays.setExportOpen(false); clearDeepLink(); }} />
            </div>
            <PrepareNotice status={preview.prepareStatus} error={preview.prepareError} onRetry={() => { void preview.prepareContent(); }} />
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <LazyExportPanel
                activity={activity}
                creationProfile={document.activity.creationProfile}
                contentRevision={activityData?.currentContentRevision || null}
                mediaRevision={activityData?.currentMediaRevision || null}
                playbackRevision={playbackRevision || null}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
