'use client';
import { AppSwitcher } from '@/app/components/shared/app-switcher';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Settings2,
  MessageSquare,
  Camera,
  PlaySquare,
  History,
  Download,
  Check,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Save,
  Clock,
  Compass,
  FileCheck,
} from 'lucide-react';
import type { Activity, ContentDocument } from '@sthstart/contracts';
import { useActivity, useActivityDraft } from '../queries';
import { useCommitDraft } from '../mutations';
import { useStudioDraft } from '../hooks/use-studio-draft';
import { StagesEditor } from './stages-editor';
import { RecordsEditor } from './records-editor';
import { MediaWorkstation } from './media-workstation';
import { PlaybackWorkstation } from './playback-workstation';
import { GenerationModal } from './generation-modal';
import { HistoryDrawer } from './history-drawer';
import { ExportModal } from './export-modal';
import { ImageWorkbench } from './image-workbench';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';

interface ActivityStudioWorkspaceProps {
  activityId: string;
}

export function ActivityStudioWorkspace({ activityId }: ActivityStudioWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'records' | 'media' | 'playback'>('records');

  // Modals & Drawers state
  const [generationModalOpen, setGenerationModalOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [workbenchSlotId, setWorkbenchSlotId] = useState<string | null>(null);

  // Focus stage in records tab
  const [focusedStageId, setFocusedStageId] = useState<string | undefined>(undefined);

  // Queries
  const { data: activityData, isLoading: activityLoading, error: activityError, refetch: refetchActivity } =
    useActivity(activityId);
  const { data: draftData, isLoading: draftLoading, refetch: refetchDraft } =
    useActivityDraft(activityId);

  const draft = useStudioDraft(activityId, draftData?.draft);
  const { document, status: saveStatus } = draft;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [serverDraft, setServerDraft] = useState<{ document: ContentDocument; draftVersion: number } | null>(null);
  const commitDraftMutation = useCommitDraft();
  const handleUpdateDocument = draft.update;
  const handleCommitDraft = async () => {
    if (committing) return;
    setCommitting(true);
    setErrorMessage(null);
    try {
      if (!await draft.flush()) return;
      const fresh = await refetchActivity();
      if (!fresh.data) throw new Error('无法读取当前版本，请重试');
      await commitDraftMutation.mutateAsync({ id: activityId, expectedHeadVersion: fresh.data.activity.headVersion, expectedDraftVersion: draft.version() });
      const latest = await refetchDraft();
      if (latest.data?.draft) draft.resolve(latest.data.draft, false);
      await refetchActivity();
    } catch (err) { setErrorMessage(err instanceof Error ? err.message : '保存新版本失败'); }
    finally { setCommitting(false); }
  };
  const handleReloadConflict = async () => {
    const latest = await refetchDraft();
    if (latest.data?.draft) setServerDraft(latest.data.draft);
  };

  const activity = activityData?.activity;
  const stages = document?.stages || [];
  const actors = document?.actors || [];

  if (activityLoading || draftLoading) {
    return (
      <main className="min-h-screen w-full bg-paper flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-8 w-8 text-accent animate-spin" />
          <p className="text-sm text-ink font-semibold">正在载入活动工作区…</p>
        </div>
      </main>
    );
  }

  if (activityError || !activity || !document) {
    return (
      <main className="min-h-screen w-full bg-paper p-8">
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
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-paper text-ink px-3 sm:px-6 md:px-10 py-5">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Studio Top Navigation Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-[4px_14px_4px_4px] bg-surface border border-[rgb(24_32_29/14%)] shadow-xs">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link
              href="/apps/activities"
              className="p-1.5 rounded hover:bg-stone-100 text-muted hover:text-ink transition-colors"
              title="返回活动列表"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <AppSwitcher />
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-lg font-bold text-ink">{document.activity.title}</h1>
                <Badge variant="outline" className="text-sm font-mono bg-stone-100 text-stone-700">
                  版本 {activity.headVersion}
                </Badge>
                {activity.theme && (
                  <Badge variant="outline" className="text-sm text-stone-600 bg-stone-50 border-stone-200">
                    {activity.theme}
                  </Badge>
                )}
              </div>

              {/* Auto-save & CAS Draft Indicator */}
              <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
                {saveStatus === 'saving' && (
                  <span className="text-amber-600 flex items-center gap-1">
                    <Spinner className="h-3 w-3 animate-spin" />
                    自动保存草稿中…
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="text-emerald-600 flex items-center gap-1 font-medium">
                    <Check className="h-3 w-3" />
                    已保存
                  </span>
                )}
                {saveStatus === 'unsaved' && (
                  <span className="text-stone-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    正在编辑…
                  </span>
                )}
                {saveStatus === 'conflict' && (
                  <div className="flex items-center gap-1 text-rose-600">
                    <AlertCircle className="h-3 w-3" />
                    <span>草稿版本冲突</span>
                    <button
                      type="button"
                      onClick={handleReloadConflict}
                      className="underline font-semibold ml-1 cursor-pointer"
                    >
                      比较与恢复
                    </button>
                  </div>
                )}
                {saveStatus === 'error' && (
                  <span className="text-rose-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    保存失败
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryDrawerOpen(true)}
              className="text-sm h-8 flex items-center gap-1.5"
            >
              <History className="h-3.5 w-3.5 text-muted" />
              <span>版本回溯</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportModalOpen(true)}
              className="text-sm h-8 flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5 text-muted" />
              <span>导出工程</span>
            </Button>

            <Button
              size="sm"
              onClick={handleCommitDraft}
              disabled={committing || saveStatus === 'conflict' || saveStatus === 'error'}
              className="text-sm h-8 px-3.5 bg-accent hover:bg-accent-dark text-white flex items-center gap-1.5 shadow-xs"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{committing ? '保存中…' : '保存新版本'}</span>
            </Button>
          </div>
        </header>

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
        {/* 4 Main Workspace Tabs */}
        <div className="studio-tabs flex items-center gap-1.5 border-b border-[rgb(24_32_29/14%)] pb-1">
          {[
            { id: 'records', label: '记录', icon: MessageSquare },
            { id: 'settings', label: '设定', icon: Settings2 },
            { id: 'media', label: '素材', icon: Camera },
            { id: 'playback', label: '回放', icon: PlaySquare },
          ].map((tab) => {
            const Icon = tab.icon;
            const isCurrent = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                aria-pressed={isCurrent}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-[4px_10px_0_0] text-sm font-semibold transition-all cursor-pointer ${
                  isCurrent
                    ? 'bg-surface text-accent border-t-2 border-x border-accent -mb-1.5 shadow-xs'
                    : 'text-muted hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Workstation Content View */}
        <fieldset disabled={committing} className="min-w-0 border-0 p-0 py-1">
          {/* TAB 1: Settings & Stages */}
          {activeTab === 'settings' && (
            <div className="space-y-5">
              {/* Basic info metadata editor */}
              <div className="p-5 rounded-[4px_16px_4px_4px] bg-surface border border-[rgb(24_32_29/14%)] space-y-3">
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <Compass className="h-4 w-4 text-accent" />
                  活动基本属性
                </h3>
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
                </div>
              </div>

              {/* Stages editor */}
              <StagesEditor
                stages={stages}
                actors={actors}
                onChange={(newStages) => handleUpdateDocument({ ...document, stages: newStages })}
              />
            </div>
          )}

          {/* TAB 2: Records (Chat & Moments) */}
          {activeTab === 'records' && (
            <RecordsEditor
              document={document}
              stages={stages}
              actors={actors}
              currentStageId={focusedStageId}
              onSelectStage={setFocusedStageId}
              onUpdateDocument={handleUpdateDocument}
              onOpenAiGenerator={async () => { if (await draft.flush()) setGenerationModalOpen(true); }}
              onOpenWorkbench={(slotId) => setWorkbenchSlotId(slotId)}
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
        </fieldset>

        {/* AI Generation Modal */}
        <GenerationModal
          open={generationModalOpen}
          onOpenChange={setGenerationModalOpen}
          activity={activity}
          stages={stages}
          currentStageId={focusedStageId}
          onCandidateAdopted={() => {
            refetchActivity();
            refetchDraft();
          }}
        />

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
        <ExportModal
          open={exportModalOpen}
          onOpenChange={setExportModalOpen}
          activity={activity}
        />

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
      </div>
    </main>
  );
}
