'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Settings2,
  MessageSquare,
  Camera,
  PlaySquare,
  History,
  Download,
  Check,
  Share2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Save,
  Clock,
  Compass,
  FileCheck,
  Bookmark,
} from 'lucide-react';
import type { Activity, ContentDocument } from '@sthstart/contracts';
import { useActivity, useActivityDraft } from '../queries';
import { useCommitDraft } from '../mutations';
import { useStudioDraft } from '../hooks/use-studio-draft';
import { StagesEditor } from './stages-editor';
import { ActivityReflectDialog } from '@/app/features/knowledge/components/activity-reflect-dialog';
import { RecordsEditor } from './records-editor';
import { MediaWorkstation } from './media-workstation';
import { PlaybackWorkstation } from './playback-workstation';
import { ExportPanel } from './export-panel';
import { ActivityCreationProfile } from './creation-profile-picker';
import { ReworkPanel } from './rework-panel';
import { GenerationModal } from './generation-modal';
import { ProductionOverview } from './production-overview';
import { HistoryDrawer } from './history-drawer';
import { ImageWorkbench } from './image-workbench';
import { ActivityPresetsModal } from './activity-presets-modal';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';
import { PageContainer, WorkbenchColumns } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageTabs } from '@/app/components/ui/page-tabs';

interface ActivityStudioWorkspaceProps {
  activityId: string;
}

/**
 * 工作室的四步：内容 → 素材 → 回放 → 导出。
 *
 * 顺序与 activity-guidance 的进度编号、ProductionOverview 的按钮去向共用同一份定义，
 * 避免出现「提示说第 1 步是设定、界面却停在记录」这类两套坐标系。
 */
const STUDIO_TABS = [
  { id: 'content', label: '内容', icon: MessageSquare },
  { id: 'media', label: '素材', icon: Camera },
  { id: 'playback', label: '回放', icon: PlaySquare },
  { id: 'export', label: '导出', icon: Download },
] as const;
type StudioTab = (typeof STUDIO_TABS)[number]['id'];

/** 旧链接兼容：settings 与 records 都并入 content。 */
const LEGACY_TAB_MAP: Record<string, StudioTab> = {
  settings: 'content',
  records: 'content',
  media: 'media',
  playback: 'playback',
  export: 'export',
};

export function ActivityStudioWorkspace({ activityId }: ActivityStudioWorkspaceProps) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<StudioTab>('content');

  // Modals & Drawers state
  const [generationModalOpen, setGenerationModalOpen] = useState(false);
  const [generationStageId, setGenerationStageId] = useState<string | undefined>(searchParams.get('stageId') || undefined);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [reworkOpen,setReworkOpen]=useState(false);
  const [presetsModalOpen, setPresetsModalOpen] = useState(false);
  const [workbenchSlotId, setWorkbenchSlotId] = useState<string | null>(null);

  /** 内容 tab 内的同层视图：设定 / 群聊 / 朋友圈 / 事件。 */
  const [contentView, setContentView] = useState<'settings' | 'chat' | 'moments' | 'facts'>('chat');

  useEffect(() => {
    const tab = searchParams.get('tab');
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- URL 查询参数是外部状态：按 ?tab / ?jobId 深链打开对应面板。 */
    if (tab && LEGACY_TAB_MAP[tab]) {
      setActiveTab(LEGACY_TAB_MAP[tab]);
      // 旧链接带 tab=settings 时直接落到设定视图，带 tab=records 时落到群聊。
      if (tab === 'settings') setContentView('settings');
      else if (tab === 'records') setContentView('chat');
    }
    if (searchParams.get('jobId')) setGenerationModalOpen(true);
  }, [searchParams]);

  // Focus stage in records tab
  const [focusedStageId, setFocusedStageId] = useState<string | undefined>(searchParams.get('stageId')||undefined);

  // Queries
  const { data: activityData, isLoading: activityLoading, error: activityError, refetch: refetchActivity } =
    useActivity(activityId);
  const { data: draftData, isLoading: draftLoading, refetch: refetchDraft } =
    useActivityDraft(activityId);

  const draft = useStudioDraft(activityId, draftData?.draft);
  const { document, status: saveStatus } = draft;
  useEffect(()=>{
    if(!document)return;
    const record=searchParams.get('recordId');const actor=searchParams.get('actorId');const stage=searchParams.get('stageId');const fact=searchParams.get('factId');
    const frame=requestAnimationFrame(()=>{const target=window.document.getElementById(record?`record-${record}`:actor?`actor-${actor}`:stage?`stage-${stage}`:fact?`fact-${fact}`:'');if(target instanceof HTMLDetailsElement)target.open=true;target?.scrollIntoView({block:'center',behavior:'smooth'});});
    return ()=>cancelAnimationFrame(frame);
  },[searchParams,activeTab,!!document]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [serverDraft, setServerDraft] = useState<{ document: ContentDocument; draftVersion: number } | null>(null);
  const commitDraftMutation = useCommitDraft();
  const handleUpdateDocument = draft.update;
  const handleCommitDraft = async () => {
    if (committing) return false;
    setCommitting(true);
    setErrorMessage(null);
    try {
      if (!await draft.flush()) return false;
      const fresh = await refetchActivity();
      if (!fresh.data) throw new Error('无法读取当前版本，请重试');
      await commitDraftMutation.mutateAsync({ id: activityId, expectedHeadVersion: fresh.data.activity.headVersion, expectedDraftVersion: draft.version() });
      const latest = await refetchDraft();
      if (latest.data?.draft) draft.resolve(latest.data.draft, false);
      await refetchActivity();
      return true;
    } catch (err) { setErrorMessage(err instanceof Error ? err.message : '保存新版本失败'); return false; }
    finally { setCommitting(false); }
  };
  const handleReloadConflict = async () => {
    const latest = await refetchDraft();
    if (latest.data?.draft) setServerDraft(latest.data.draft);
  };
  const prepareContent = async () => {
    if (committing || !await draft.flush()) return false;
    try {
      const latest = await refetchActivity();
      if (!latest.data) throw new Error('无法读取活动，请重试');
      if (JSON.stringify(latest.data.currentContentRevision?.document) === JSON.stringify(latest.data.draft.document)) return true;
      return await handleCommitDraft();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '准备活动内容失败');
      return false;
    }
  };
  const navigateTab = async (tab: typeof activeTab) => {
    // 素材、回放、导出都消费已发布内容，进入前先把草稿落成版本。
    if ((tab === 'media' || tab === 'playback' || tab === 'export') && !await prepareContent()) return;
    setActiveTab(tab);
  };

  const activity = activityData?.activity;
  const stages = document?.stages || [];
  const [reflectOpen, setReflectOpen] = useState(false);
  const actors = document?.actors || [];

  if (activityLoading || draftLoading) {
    return (
      <div className="w-full bg-paper flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-8 w-8 text-accent animate-spin" />
          <p className="text-sm text-ink font-semibold">正在载入活动工作区…</p>
        </div>
      </div>
    );
  }

  if (activityError || !activity || !document) {
    return (
      <div className="w-full bg-paper p-8">
        <div className="max-w-md mx-auto space-y-4">
          <Alert variant="danger" title="无法进入活动工作室">
            {activityError ? (activityError as Error).message : '活动不存在或已被删除'}
          </Alert>
          <Link
            href="/apps/activities"
            className="inline-flex items-center gap-1.5 text-sm text-accent font-semibold hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回活动列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-paper text-ink py-5">
      <PageContainer className="space-y-4">
        {document.activity.planningBasis?.inspiration && (
          <details className="rounded-lg border border-border-default bg-surface p-3 text-sm">
            <summary className="cursor-pointer font-semibold">灵感来源 · {document.activity.planningBasis.inspiration.ideaName}</summary>
            <p className="mt-2">{document.activity.planningBasis.inspiration.adaptation}</p>
            {document.activity.planningBasis.inspiration.topics.map(topic => <p key={topic.id} className="mt-2"><strong>{topic.title}</strong>：{topic.summary}</p>)}
            {(document.activity.planningBasis.inspiration.sources ?? []).map((source, index) => <div key={index} className="mt-2 text-muted">
              {/^(https?:)\/\//.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.sourceName} · {source.documentLocator || '查看来源'}</a> : <span>{source.sourceName} · {source.documentLocator}</span>}
              <p>{source.excerpt}</p>
            </div>)}
          </details>
        )}
        {/* 对象页头（§8.5）：活动名、保存/版本状态与当前主要动作固定在页头。 */}
        <PageHeader
          backHref="/apps/activities"
          backLabel="返回活动列表"
          title={document.activity.title}
          status={
            <>
              <Badge variant="outline" className="bg-surface-muted font-mono text-xs text-ink">
                版本 {activity.headVersion}
              </Badge>
              <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
                {saveStatus === 'saving' && (
                  <span className="flex items-center gap-1 text-warning-fg">
                    <Spinner className="h-3 w-3 animate-spin" />
                    自动保存草稿中…
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="flex items-center gap-1 font-medium text-success-fg">
                    <Check className="h-3 w-3" />
                    已保存
                  </span>
                )}
                {saveStatus === 'unsaved' && (
                  <span className="flex items-center gap-1 text-muted">
                    <Clock className="h-3 w-3" />
                    正在编辑…
                  </span>
                )}
                {saveStatus === 'conflict' && (
                  <div className="flex items-center gap-1 text-danger-fg">
                    <AlertCircle className="h-3 w-3" />
                    <span>草稿版本冲突</span>
                    <button
                      type="button"
                      onClick={handleReloadConflict}
                      className="ml-1 cursor-pointer font-semibold underline"
                    >
                      比较与恢复
                    </button>
                  </div>
                )}
                {saveStatus === 'error' && (
                  <span className="flex items-center gap-1 text-danger-fg">
                    <AlertCircle className="h-3 w-3" />
                    保存失败
                  </span>
                )}
              </div>
            </>
          }
          actions={
            <details className="rounded-lg border border-border-default bg-surface p-2">
            <summary className="cursor-pointer px-2 text-sm font-medium">更多操作</summary>
            <p className="px-2 pt-2 text-xs text-muted">编辑会自动保存。只有需要保留一个可回溯节点时，才需保存新版本。</p>
            <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setReworkOpen(true)}>内容变化与处理历史</Button>
            {/* 导出已升为页级 tab，不再在折叠菜单里重复一份入口。 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryDrawerOpen(true)}
              className="flex h-8 items-center gap-1.5 text-sm"
            >
              <History className="h-3.5 w-3.5 text-muted" />
              <span className="hidden sm:inline">版本回溯</span>
              <span className="sm:hidden">回溯</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPresetsModalOpen(true)}
              className="flex h-8 items-center gap-1.5 text-sm"
            >
              <Bookmark className="h-3.5 w-3.5 text-muted" />
              <span className="hidden sm:inline">预设/模板</span>
              <span className="sm:hidden">预设</span>
            </Button>

            <Button
              size="sm"
              onClick={handleCommitDraft}
              disabled={committing || saveStatus === 'conflict' || saveStatus === 'error'}
              className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-sm"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{committing ? '保存中…' : '保存新版本'}</span>
            </Button>
            </div>
            </details>
          }
        />

        {(errorMessage || draft.error) && (
          <Alert variant="danger" title="系统提示">
            {errorMessage || draft.error}
            {saveStatus === 'error' && <Button onClick={draft.retry}>重试保存</Button>}
          </Alert>
        )}

        {serverDraft && <section className="rounded-lg border border-border-default bg-surface p-4 space-y-3" aria-label="草稿冲突比较">
          <h2 className="font-semibold">比较草稿后选择保留内容</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <details><summary>本地输入</summary><pre className="max-h-64 overflow-auto text-sm">{JSON.stringify(document, null, 2)}</pre></details>
            <details><summary>服务器草稿</summary><pre className="max-h-64 overflow-auto text-sm">{JSON.stringify(serverDraft.document, null, 2)}</pre></details>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { draft.resolve(serverDraft, true); setServerDraft(null); }}>保留本地输入并保存</Button>
            <Button onClick={() => { draft.resolve(serverDraft, false); setServerDraft(null); }}>改用服务器草稿</Button>
          </div>
        </section>}

        {/* 活动生产流水线概览条 (M1) */}
        <ReworkPanel open={reworkOpen} onOpenChange={setReworkOpen} activityId={activityId} headVersion={activity.headVersion} document={document} onSaved={() => { void refetchActivity(); }} />
        <ProductionOverview document={document} headVersion={activity.headVersion} onReview={()=>setReworkOpen(true)}
          activityId={activityId}
          onAction={async (action) => {
            if (action === 'generate_text' || action === 'review_candidates') {
              if (await draft.flush()) { setGenerationStageId(undefined); setGenerationModalOpen(true); }
            } else if (action === 'preview_export') {
              if (await prepareContent()) void navigateTab('export');
            }
          }}
          onOpenBatchCandidates={async () => { if (await draft.flush()) setGenerationModalOpen(true); }}
          onNavigateTab={(tab, view) => { if (view) setContentView(view); void navigateTab(tab); }}
        />

        {/* 工作模式：设定 / 记录 / 素材 / 回放，使用页级 tab 语义（§7.4）。 */}
        <PageTabs
          className="activity-workflow-tabs w-full sm:w-fit"
          ariaLabel="活动工作模式"
          value={activeTab}
          onChange={(id) => { void navigateTab(id as typeof activeTab); }}
          tabs={STUDIO_TABS.map((tab) => ({
            id: tab.id,
            panelId: `activity-panel-${tab.id}`,
            label: (
              <>
                <tab.icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </>
            ),
          }))}
        />

        {/* Workstation Content View */}

        {reflectOpen && (
          <ActivityReflectDialog
            open={reflectOpen}
            onOpenChange={setReflectOpen}
            activityId={activityId}
            activityTitle={document?.activity.title || '未命名活动'}
            version={draft.version()}
            stages={stages.map((stage) => ({ id: stage.id, title: stage.title, instruction: stage.instruction }))}
          />
        )}
        <fieldset disabled={committing} className="min-w-0 border-0 p-0 py-1">
          {/* 内容 tab 的同层视图：设定 / 群聊 / 朋友圈 / 事件 */}
          {activeTab === 'content' && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="内容视图">
              {([
                { id: 'settings' as const, label: '设定', icon: Settings2 },
                { id: 'chat' as const, label: '群聊', icon: MessageSquare },
                { id: 'moments' as const, label: '朋友圈', icon: Share2 },
                { id: 'facts' as const, label: '事件', icon: FileCheck },
              ]).map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  aria-selected={contentView === view.id}
                  onClick={() => setContentView(view.id)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm transition-colors ${
                    contentView === view.id
                      ? 'border-accent bg-accent/10 font-semibold text-accent-dark'
                      : 'border-border-subtle text-muted hover:bg-surface-hover'
                  }`}
                >
                  <view.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {view.label}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'content' && contentView === 'settings' && (
            <div className="space-y-4">
            <div className="text-sm text-muted">只需确认活动内容、参与者和阶段安排。下面的改动会自动保存；服装、创作偏好等都可以稍后调整。</div>
            <WorkbenchColumns
              left={(
                <div className="p-4 rounded-[var(--radius-panel)] bg-surface border border-border-default space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                      <Compass className="h-4 w-4 text-accent" />
                      活动基本属性
                    </h3>
                    <Button size="sm" variant="ghost" onClick={() => setReflectOpen(true)}>整理为个人设定</Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-sm font-medium text-ink">活动标题</label>
                      <Input
                        aria-label="活动标题"
                        value={document.activity.title}
                        onChange={(e) => handleUpdateDocument({ ...document, activity: { ...document.activity, title: e.target.value } })}
                        className="h-8 text-sm bg-transparent"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-ink">活动主题</label>
                      <Input
                        aria-label="活动主题"
                        value={document.activity.theme || ''}
                        onChange={(e) => handleUpdateDocument({ ...document, activity: { ...document.activity, theme: e.target.value } })}
                        className="h-8 text-sm bg-transparent"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-ink">活动地点</label>
                      <Input
                        aria-label="活动地点"
                        value={document.activity.location || ''}
                        onChange={(e) => handleUpdateDocument({ ...document, activity: { ...document.activity, location: e.target.value } })}
                        className="h-8 text-sm bg-transparent"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-sm font-medium text-ink">活动日期（可选，写入后出现在角色日历）</label>
                      <Input
                        aria-label="活动日期"
                        type="date"
                        value={document.activity.scheduledDate || ''}
                        onChange={(e) => handleUpdateDocument({ ...document, activity: { ...document.activity, scheduledDate: e.target.value || null } })}
                        className="h-8 text-sm bg-transparent"
                      />
                      <p className="text-xs text-muted">
                        {saveStatus === 'saved' ? '当前日期已保存。' : '日期修改会随草稿自动保存，保存完成后才会同步到日历。'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 border-t border-border-subtle pt-2">
                    <span className="text-xs text-muted">参与角色：</span>
                    {actors.map((actor) => (
                      <details key={actor.id} id={`actor-${actor.id}`} className="w-full rounded border border-border-default p-2"><summary className="cursor-pointer text-sm">{actor.displayName} · 修改本场设定</summary><div className="mt-2 space-y-2">
                        <label className="block text-xs">服装<Input value={actor.outfitDescription} onChange={e=>handleUpdateDocument({...document,actors:actors.map(a=>a.id===actor.id?{...a,outfitDescription:e.target.value}:a)})}/></label>
                        <label className="block text-xs">本场职责<Input value={actor.activityRole} onChange={e=>handleUpdateDocument({...document,actors:actors.map(a=>a.id===actor.id?{...a,activityRole:e.target.value}:a)})}/></label>
                        <label className="block text-xs">身份描述<Input value={String(actor.persona.identity||'')} onChange={e=>handleUpdateDocument({...document,actors:actors.map(a=>a.id===actor.id?{...a,persona:{...a.persona,identity:e.target.value}}:a)})}/></label>
                        <p className="text-xs text-muted">修改仅用于本场活动；保存新版本后可查看影响清单。外观提示词和参考图可在媒体提示词工作台继续调整。</p>
                      </div></details>
                    ))}
                  </div>
                  <details className="rounded-lg border border-border-subtle p-3">
                  <summary className="cursor-pointer text-sm font-medium">高级选项：创作偏好与模板（可选）</summary>
                  <ActivityCreationProfile activityId={activity.id} headVersion={activity.headVersion} value={document.activity.creationProfile} disabled={saveStatus!=='saved'} onApplied={()=>{void refetchActivity();void refetchDraft();}}/>
                  <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
                    <span className="text-xs text-muted">复用本场活动设置</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPresetsModalOpen(true)}
                      className="text-xs flex items-center gap-1.5"
                    >
                      <Bookmark className="h-3.5 w-3.5 text-accent" />
                      另存为模板 / 预设管理
                    </Button>
                  </div>
                  </details>
                </div>
              )}
              right={(
                <StagesEditor
                  stages={stages}
                  actors={actors}
                  onChange={(newStages) => handleUpdateDocument({ ...document, stages: newStages })}
                />
              )}
            />
            </div>
          )}

          {/* 内容 tab：群聊 / 朋友圈 / 事件（由 contentView 决定） */}
          {activeTab === 'content' && contentView !== 'settings' && (
            <RecordsEditor
              document={document}
              stages={stages}
              actors={actors}
              currentStageId={focusedStageId}
              onSelectStage={setFocusedStageId}
              onUpdateDocument={handleUpdateDocument}
              onOpenAiGenerator={async (stageId) => { if (await draft.flush()) { setGenerationStageId(stageId); setGenerationModalOpen(true); } }}
              onOpenWorkbench={(slotId) => setWorkbenchSlotId(slotId)}
              activeView={contentView}
              onActiveViewChange={setContentView}
            />
          )}

          {/* TAB 3: Media Workstation */}
          {activeTab === 'media' && (
            <MediaWorkstation
              activity={activity}
              document={document}
              currentMediaRevision={activityData.currentMediaRevision}
              actors={actors}
              onUpdateDocument={handleUpdateDocument}
            />
          )}

          {/* TAB 4: Playback & Export */}
          {activeTab === 'playback' && (
            <PlaybackWorkstation
              activity={activity}
              document={document}
              currentPlaybackRevision={activityData.currentPlaybackRevision}
              actors={actors}
            />
          )}

          {/* 导出：链路末端，与内容/素材/回放同层 */}
          {activeTab === 'export' && (
            <ExportPanel
              activity={activity}
              creationProfile={document.activity.creationProfile}
            />
          )}
        </fieldset>

        {/* AI Generation Modal */}
        {generationModalOpen && <GenerationModal
          open={generationModalOpen}
          onOpenChange={setGenerationModalOpen}
          activity={activity}
          stages={stages}
          currentStageId={generationStageId}
          onCandidateAdopted={() => {
            refetchActivity();
            refetchDraft();
          }}
        />}

        {/* History Drawer */}
        <HistoryDrawer
          open={historyDrawerOpen}
          onOpenChange={setHistoryDrawerOpen}
          activity={activity}
          onRestored={() => {
            refetchActivity();
            refetchDraft();
          }}
        />

        {/* Export Modal */}

        {/* Image Workbench Modal */}
        {workbenchSlotId && document && (
          <ImageWorkbench
            isOpen={Boolean(workbenchSlotId)}
            onClose={() => setWorkbenchSlotId(null)}
            activity={activity}
            document={document}
            initialSlotId={workbenchSlotId}
            currentMediaRevision={activityData.currentMediaRevision}
          />
        )}

        {/* Activity Presets Modal */}
        {presetsModalOpen && document && (
          <ActivityPresetsModal
            isOpen={presetsModalOpen}
            onClose={() => setPresetsModalOpen(false)}
            activity={activity}
            document={document}
          />
        )}
      </PageContainer>
    </div>
  );
}
