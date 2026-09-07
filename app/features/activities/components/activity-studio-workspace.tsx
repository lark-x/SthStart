'use client';

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
import { useSaveDraft, useCommitDraft, useUpdateActivity } from '../mutations';
import { StagesEditor } from './stages-editor';
import { RecordsEditor } from './records-editor';
import { MediaWorkstation } from './media-workstation';
import { PlaybackWorkstation } from './playback-workstation';
import { GenerationModal } from './generation-modal';
import { HistoryDrawer } from './history-drawer';
import { ExportModal } from './export-modal';
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

  // Focus stage in records tab
  const [focusedStageId, setFocusedStageId] = useState<string | undefined>(undefined);

  // Queries
  const { data: activityData, isLoading: activityLoading, error: activityError, refetch: refetchActivity } =
    useActivity(activityId);
  const { data: draftData, isLoading: draftLoading, refetch: refetchDraft } =
    useActivityDraft(activityId);

  // Local draft document state
  const [document, setDocument] = useState<ContentDocument | null>(null);
  const [draftVersion, setDraftVersion] = useState<number>(1);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'conflict' | 'error' | 'unsaved'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mutations
  const saveDraftMutation = useSaveDraft();
  const commitDraftMutation = useCommitDraft();
  const updateActivityMutation = useUpdateActivity();

  // Initialize document from draftData or currentContentRevision
  useEffect(() => {
    if (draftData?.draft?.document) {
      setDocument(draftData.draft.document);
      setDraftVersion(draftData.draft.draftVersion);
    } else if (activityData?.currentContentRevision?.document) {
      setDocument(activityData.currentContentRevision.document);
      setDraftVersion(1);
    }
  }, [draftData, activityData]);

  // Debounced auto-save timer ref
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latestDocRef = useRef<ContentDocument | null>(null);
  const latestDraftVersionRef = useRef<number>(draftVersion);

  latestDocRef.current = document;
  latestDraftVersionRef.current = draftVersion;

  // Auto-save logic
  const triggerAutoSave = useCallback(
    async (docToSave: ContentDocument) => {
      if (!activityId) return;
      setSaveStatus('saving');
      setErrorMessage(null);

      try {
        const res = await saveDraftMutation.mutateAsync({
          id: activityId,
          expectedDraftVersion: latestDraftVersionRef.current,
          document: docToSave,
        });

        setDraftVersion(res.draftVersion);
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } catch (err: any) {
        if (err?.message?.includes('draft_version_conflict') || err?.error === 'draft_version_conflict') {
          setSaveStatus('conflict');
          setErrorMessage('检测到其他端或标签页更新了草稿，产生版本冲突。');
        } else {
          setSaveStatus('error');
          setErrorMessage(err instanceof Error ? err.message : '自动保存草稿失败');
        }
      }
    },
    [activityId, saveDraftMutation]
  );

  const handleUpdateDocument = (newDoc: ContentDocument) => {
    setDocument(newDoc);
    setSaveStatus('unsaved');

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      triggerAutoSave(newDoc);
    }, 1200);
  };

  // Commit draft to publish new revision
  const handleCommitDraft = async () => {
    if (!activityData?.activity) return;
    setErrorMessage(null);

    try {
      // First ensure draft is saved
      if (document && saveStatus === 'unsaved') {
        await triggerAutoSave(document);
      }

      await commitDraftMutation.mutateAsync({
        id: activityId,
        expectedHeadVersion: activityData.activity.headVersion,
        expectedDraftVersion: draftVersion,
      });

      setSaveStatus('saved');
      refetchActivity();
      refetchDraft();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '提交发布版本失败');
    }
  };

  const handleReloadConflict = () => {
    refetchDraft();
    setSaveStatus('saved');
    setErrorMessage(null);
  };

  const activity = activityData?.activity;
  const stages = document?.stages || [];
  const actors = document?.actors || [];

  if (activityLoading || draftLoading) {
    return (
      <main className="min-h-screen w-full bg-[#f4f0e7] flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-8 w-8 text-[#e45d35] animate-spin" />
          <p className="text-xs text-[#18201d] font-semibold">正在载入活动工作区…</p>
        </div>
      </main>
    );
  }

  if (activityError || !activity || !document) {
    return (
      <main className="min-h-screen w-full bg-[#f4f0e7] p-8">
        <div className="max-w-md mx-auto space-y-4">
          <Alert variant="danger" title="无法进入活动工作室">
            {activityError ? (activityError as Error).message : '活动不存在或已被删除'}
          </Alert>
          <Link
            href="/apps/activities"
            className="inline-flex items-center gap-1.5 text-xs text-[#e45d35] font-semibold hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回活动列表
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-[#f4f0e7] text-[#18201d] px-3 sm:px-6 md:px-10 py-5">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Studio Top Navigation Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-[4px_14px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] shadow-xs">
          <div className="flex items-center gap-3">
            <Link
              href="/apps/activities"
              className="p-1.5 rounded hover:bg-stone-100 text-[#68716d] hover:text-[#18201d] transition-colors"
              title="返回活动列表"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-[#18201d]">{activity.title}</h1>
                <Badge variant="outline" className="text-[10px] font-mono bg-stone-100 text-stone-700">
                  Head v{activity.headVersion}
                </Badge>
                {activity.theme && (
                  <Badge variant="outline" className="text-[10px] text-stone-600 bg-stone-50 border-stone-200">
                    {activity.theme}
                  </Badge>
                )}
              </div>

              {/* Auto-save & CAS Draft Indicator */}
              <div className="flex items-center gap-2 text-[11px]">
                {saveStatus === 'saving' && (
                  <span className="text-amber-600 flex items-center gap-1">
                    <Spinner className="h-3 w-3 animate-spin" />
                    自动保存草稿中…
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="text-emerald-600 flex items-center gap-1 font-medium">
                    <Check className="h-3 w-3" />
                    草稿已就绪 (d{draftVersion})
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
                      重新载入最新草稿
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryDrawerOpen(true)}
              className="text-xs h-8 flex items-center gap-1.5"
            >
              <History className="h-3.5 w-3.5 text-[#68716d]" />
              <span>版本回溯</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportModalOpen(true)}
              className="text-xs h-8 flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5 text-[#68716d]" />
              <span>导出工程</span>
            </Button>

            <Button
              size="sm"
              onClick={handleCommitDraft}
              disabled={commitDraftMutation.isPending}
              className="text-xs h-8 px-3.5 bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{commitDraftMutation.isPending ? '提交中…' : '提交发布版本'}</span>
            </Button>
          </div>
        </header>

        {errorMessage && (
          <Alert variant="danger" title="系统提示">
            {errorMessage}
          </Alert>
        )}

        {/* 4 Main Workspace Tabs */}
        <div className="flex items-center gap-1.5 border-b border-[rgb(24_32_29/14%)] pb-1">
          {[
            { id: 'records', label: '记录创作 (Chat & Moments)', icon: MessageSquare },
            { id: 'settings', label: '活动与阶段设定', icon: Settings2 },
            { id: 'media', label: '媒体镜头工作台', icon: Camera },
            { id: 'playback', label: '回放编排与预览', icon: PlaySquare },
          ].map((tab) => {
            const Icon = tab.icon;
            const isCurrent = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-[4px_10px_0_0] text-xs font-semibold transition-all cursor-pointer ${
                  isCurrent
                    ? 'bg-[#fffdf8] text-[#e45d35] border-t-2 border-x border-[#e45d35] -mb-1.5 shadow-xs'
                    : 'text-[#68716d] hover:text-[#18201d]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Workstation Content View */}
        <div className="py-1">
          {/* TAB 1: Settings & Stages */}
          {activeTab === 'settings' && (
            <div className="space-y-5">
              {/* Basic info metadata editor */}
              <div className="p-5 rounded-[4px_16px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] space-y-3">
                <h3 className="text-sm font-bold text-[#18201d] flex items-center gap-2">
                  <Compass className="h-4 w-4 text-[#e45d35]" />
                  活动基本属性
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-medium text-[#18201d]">活动标题</label>
                    <Input
                      value={activity.title}
                      onChange={(e) => {
                        updateActivityMutation.mutate({
                          id: activity.id,
                          expectedHeadVersion: activity.headVersion,
                          patch: { title: e.target.value },
                        });
                      }}
                      className="h-8 text-xs bg-transparent"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#18201d]">活动主题</label>
                    <Input
                      value={activity.theme || ''}
                      onChange={(e) => {
                        updateActivityMutation.mutate({
                          id: activity.id,
                          expectedHeadVersion: activity.headVersion,
                          patch: { theme: e.target.value },
                        });
                      }}
                      className="h-8 text-xs bg-transparent"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#18201d]">活动地点</label>
                    <Input
                      value={activity.location || ''}
                      onChange={(e) => {
                        updateActivityMutation.mutate({
                          id: activity.id,
                          expectedHeadVersion: activity.headVersion,
                          patch: { location: e.target.value },
                        });
                      }}
                      className="h-8 text-xs bg-transparent"
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
              onOpenAiGenerator={() => setGenerationModalOpen(true)}
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
        </div>

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
      </div>
    </main>
  );
}
