'use client';

import React, { useEffect, useState, useMemo, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type {
  ActivityReviewItem,
  ActivityScene,
  SceneBeat,
  StageDefinition,
} from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { getJson } from '@/app/lib/api-client';
import { useActivity, useActivityDraft, useActivityPlaybackRevision } from '../../queries';
import { useCommitDraft } from '../../mutations';
import { resolveActivityStudioRoute } from '../../studio-route';
import { useStudioDraft } from '../../hooks/use-studio-draft';
import { getEffectiveStageScenes, writeStageScenes } from '../../scene-beat-utils';
import { submitBeatRender } from '../../beat-renders-api';
import { activityKeys } from '@/app/lib/query-keys';
import { useQueryClient } from '@tanstack/react-query';
import { StudioHeader } from './studio-header';
import { StudioOutlineRail } from './studio-outline-rail';
import { StudioBeatStream } from './studio-beat-stream';
import { BeatRenderWorkbench } from '../beat-render-workbench';
import { MediaWorkstation } from '../media-workstation';
import { ArtDirectionDialog } from '../art-direction-dialog';
import { StudioSettingsDrawer, type StudioSettingsTab } from './studio-settings-drawer';
import { StudioCandidateDialog } from './studio-candidate-dialog';
import { ReworkPanel } from '../rework-panel';
import { ComicWorkstation } from '../../comic/comic-workstation';
import { PlaybackWorkstation } from '../playback-workstation';
import { ExportPanel } from '../export-panel';
import { PanelRightClose, PanelRightOpen, Sparkles, X } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { StudioMenu, StudioMenuItem } from './studio-menu';

interface StudioShellProps {
  activityId: string;
}

function subscribeMobile(callback: () => void) {
  const mql = window.matchMedia('(max-width: 767px)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getMobileSnapshot() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function getServerSnapshot() {
  return false;
}

/** 深链接打开的浮层关闭后，从地址栏去掉这些参数，刷新时不会再次弹出。 */
const DEEP_LINK_PARAMS = ['tab', 'view', 'mode', 'panel', 'recordView', 'actorId', 'stageId', 'factId', 'recordId', 'jobId', 'slotId', 'batchId', 'reworkSlots'];

/** 与服务端 studioHash 一致：忽略键顺序与 undefined 字段，只比较内容本身。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
}
function sameDocument(a: unknown, b: unknown) {
  return a !== undefined && a !== null && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function createStudioId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 试演 / 导出浮层顶部的内容准备提示：准备中只读提示，失败时可重试，草稿始终保留。 */
function PrepareNotice({ status, error, onRetry }: { status: 'idle' | 'preparing' | 'ready' | 'error'; error: string | null; onRetry: () => void }) {
  if (status === 'preparing') return <p role="status" className="shrink-0 border-b border-border-subtle bg-surface-sunken px-4 py-1.5 text-xs text-muted">正在把最新草稿准备为试演内容…</p>;
  if (status !== 'error') return null;
  return <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-danger-fg/20 bg-danger-bg px-4 py-2 text-sm text-danger-fg">
    <span className="min-w-0 flex-1">{error || '准备试演内容失败'}；下方仍是上一版正式内容，你的草稿已保留。</span>
    <Button size="sm" variant="ghost" onClick={onRetry}>重新准备</Button>
  </div>;
}

const COMPACT_WORKBENCH_QUERY ='(min-width: 768px) and (max-width: 1279px)';
function subscribeCompactWorkbench(callback: () => void) {
  const mql = window.matchMedia(COMPACT_WORKBENCH_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}
function getCompactWorkbenchSnapshot() {
  return window.matchMedia(COMPACT_WORKBENCH_QUERY).matches;
}

export function StudioShell({ activityId }: StudioShellProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerSnapshot);
  const compactWorkbench = useSyncExternalStore(subscribeCompactWorkbench, getCompactWorkbenchSnapshot, getServerSnapshot);

  // 数据拉取与草稿管理器
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

  // 视图与选中状态
  const [viewMode, setViewMode] = useState<'storyboard' | 'comic' | 'materials'>('storyboard');
  const [mobileDrawing, setMobileDrawing] = useState(false);
  const [artOpen, setArtOpen] = useState(false);
  const mediaFlush = useRef<(() => Promise<boolean>) | null>(null);
  const [activeStageId, setActiveStageId] = useState<string>('');
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);

  // 侧栏折叠状态
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [rightInspectorOverride, setRightInspectorCollapsed] = useState<boolean | null>(null);
  const rightInspectorCollapsed = rightInspectorOverride ?? compactWorkbench;

  // 浮层状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<StudioSettingsTab>('basics');
  const [settingsFocusId, setSettingsFocusId] = useState<string | null>(null);
  const [playbackOpen, setPlaybackOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [candidateJobId, setCandidateJobId] = useState<string | null>(null);

  // 试演与导出消费正式内容版本：打开前把草稿落成版本（无变化时不新增版本）
  const [prepareStatus, setPrepareStatus] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle');
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const preparing = useRef<Promise<boolean> | null>(null);
  const commitDraftMutation = useCommitDraft();

  // 深链接：任务中心、复核面板等处的 ?tab=…&actorId=… / ?tab=records&jobId=… 打开对应浮层或视图
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const appliedSearch = useRef<string | null>(null);

  const { data: reviewData } = useQuery({
    queryKey: ['activity-review', activityId, activity?.headVersion],
    queryFn: () => getJson<{ items: ActivityReviewItem[] }>(`/api/admin/activities/${activityId}/review-items`),
    enabled: Boolean(activity),
  });
  const reviewCount = reviewData?.items.filter(item => item.decision === 'pending' || item.decision === 'rework').length ?? 0;

  // 正在生图的镜头 ID 集合
  const [generatingBeatIds, setGeneratingBeatIds] = useState<Set<string>>(new Set());
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const quickAttempts = useRef(new Map<string, string>());
  const quickLocks = useRef(new Set<string>());
  const draftFlushRef = useRef(draft.flush);
  useEffect(() => {
    draftFlushRef.current = draft.flush;
  });

  const activeStage = useMemo(() => {
    if (!document) return null;
    return document.stages.find((s) => s.id === activeStageId) || document.stages[0] || null;
  }, [document, activeStageId]);

  const scenes = useMemo(() => {
    if (!document || !activeStage) return [];
    return getEffectiveStageScenes(activeStage, document.scenes);
  }, [document, activeStage]);

  const activeScene = useMemo(() => {
    if (!scenes.length) return null;
    return scenes.find((s) => s.id === activeSceneId) || scenes[0];
  }, [scenes, activeSceneId]);

  const selectedBeat = useMemo(() => {
    if (!activeScene || !activeScene.beats.length) return null;
    return activeScene.beats.find((b) => b.id === selectedBeatId) || activeScene.beats[0] || null;
  }, [activeScene, selectedBeatId]);
  // 深链接打开的浮层或视图离开后，去掉地址栏里的定位参数，刷新不会再次打开
  const clearDeepLink = () => {
    const params = new URLSearchParams(window.location.search);
    if (!DEEP_LINK_PARAMS.some(key => params.has(key))) return;
    for (const key of DEEP_LINK_PARAMS) params.delete(key);
    const next = params.toString();
    appliedSearch.current = next;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const changeView = async (mode: typeof viewMode) => {
    if (mode === viewMode) return;
    if (mediaFlush.current && !await mediaFlush.current()) return;
    if (await draft.flush()) {
      mediaFlush.current = null;
      setViewMode(mode);
      clearDeepLink();
    }
  };

  /*
   * 试演与导出读取正式内容版本。进入前先保存草稿，草稿与当前版本不同才提交一次新版本，
   * 内容没变时不增加版本号；多次点击共用同一次准备。
   */
  const prepareContent = () => {
    if (preparing.current) return preparing.current;
    setPrepareStatus('preparing');
    setPrepareError(null);
    const run = (async () => {
      try {
        if (mediaFlush.current && !await mediaFlush.current()) throw new Error('素材修改尚未保存，请先处理素材页的提示。');
        if (!await draftFlushRef.current()) throw new Error('草稿尚未保存，请先处理页头下方的保存提示。');
        const latest = await refetchActivity();
        if (!latest.data) throw new Error('无法读取活动，请重试。');
        if (sameDocument(latest.data.currentContentRevision?.document, latest.data.draft.document)) return true;
        await commitDraftMutation.mutateAsync({
          id: activityId,
          expectedHeadVersion: latest.data.activity.headVersion,
          expectedDraftVersion: draft.version(),
        });
        // 提交后服务端草稿版本号会重置；同步过来，后续自动保存才不会误报冲突。
        const fresh = await refetchDraft();
        if (fresh.data?.draft) draft.resolve(fresh.data.draft, !draft.isClean());
        await refetchActivity();
        return true;
      } catch (error) {
        setPrepareError(error instanceof Error ? error.message : '准备试演内容失败');
        return false;
      }
    })().then(ok => {
      setPrepareStatus(ok ? 'ready' : 'error');
      return ok;
    }).finally(() => { preparing.current = null; });
    preparing.current = run;
    return run;
  };

  const openPlayback = () => {
    setExportOpen(false);
    setPlaybackOpen(true);
    void prepareContent();
  };
  const openExport = () => {
    setPlaybackOpen(false);
    setExportOpen(true);
    void prepareContent();
  };

  const documentReady = Boolean(document && activity);
  useEffect(() => {
    if (!documentReady || appliedSearch.current === search) return;
    appliedSearch.current = search;
    const params = new URLSearchParams(search);
    const { route } = resolveActivityStudioRoute(search);
    /* eslint-disable react-hooks/set-state-in-effect -- 地址栏是外部状态：每个链接只在载入后应用一次 */
    const jobId = params.get('jobId');
    if (jobId) setCandidateJobId(jobId);
    if (route.panel === 'activity-settings') {
      const actorId = params.get('actorId');
      const stageId = params.get('stageId');
      setSettingsTab(actorId ? 'actors' : stageId ? 'stages' : 'basics');
      setSettingsFocusId(actorId ? `actor-${actorId}` : stageId ? `stage-${stageId}` : null);
      setSettingsOpen(true);
    } else if (route.panel === 'art-direction') {
      setArtOpen(true);
    }
    if (route.tab === 'theater') openPlayback();
    else if (route.tab === 'delivery') openExport();
    else if (route.view === 'assets') setViewMode('materials');
    else if (route.view === 'comic') setViewMode('comic');
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只响应地址变化，打开函数每次渲染都会重建
  }, [documentReady, search]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void (async () => {
          if (mediaFlush.current && !await mediaFlush.current()) return;
          await draftFlushRef.current();
        })();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const clearDeepLinkRef = useRef(clearDeepLink);
  useEffect(() => {
    clearDeepLinkRef.current = clearDeepLink;
  });

  useEffect(() => {
    if (!playbackOpen && !exportOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
      setPlaybackOpen(false);
      setExportOpen(false);
      clearDeepLinkRef.current();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [playbackOpen, exportOpen]);

  if (activityError || draftError || (!activityLoading && !draftLoading && (!document || !activity))) {
    return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-paper p-6 text-sm">
      <p role="alert" className="text-danger-fg">{activityError?.message || draftError?.message || '活动或草稿暂不可用。'}</p>
      <Button variant="outline" onClick={() => { void refetchActivity(); void refetchDraft(); }}>重新加载</Button>
      <Link href="/apps/activities" className="text-muted hover:underline">返回活动列表</Link>
    </div>;
  }

  if (activityLoading || draftLoading || !document || !activity) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center bg-paper text-muted text-sm" role="status">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span>正在进入活动工作室…</span>
        </div>
      </div>
    );
  }

  // 更新当前幕所有场次的助手函数
  const handleUpdateScenes = (nextScenes: ActivityScene[]) => {
    if (!activeStage) return;
    const nextDoc = writeStageScenes(document, activeStage.id, nextScenes);
    draft.update(nextDoc);
  };

  // 修改活动标题
  const handleUpdateTitle = (newTitle: string) => {
    draft.update({
      ...document,
      activity: { ...document.activity, title: newTitle },
    });
  };

  // 单个分镜更新
  const handleUpdateBeat = (beatId: string, patch: Partial<SceneBeat>) => {
    if (!activeScene) return;
    const nextScenes = scenes.map((s) =>
      s.id === activeScene.id
        ? {
            ...s,
            beats: s.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b)),
          }
        : s
    );
    handleUpdateScenes(nextScenes);
  };

  // 新增分镜
  const handleAddBeat = (insertIndex?: number) => {
    if (!activeScene || !activeStage) return;
    const newBeatId = createStudioId('beat');
    const newBeat: SceneBeat = {
      id: newBeatId,
      sceneId: activeScene.id,
      stageId: activeStage.id,
      characterId: document.actors[0]?.id || 'narrator',
      characterName: document.actors[0]?.displayName || '旁白',
      action: '',
      dialogue: '',
      orderIndex: (activeScene.beats.length + 1) * 10,
    };

    const nextBeats = [...activeScene.beats];
    if (insertIndex !== undefined && insertIndex >= 0) {
      nextBeats.splice(insertIndex, 0, newBeat);
    } else {
      nextBeats.push(newBeat);
    }

    const nextScenes = scenes.map((s) =>
      s.id === activeScene.id ? { ...s, beats: nextBeats } : s
    );
    handleUpdateScenes(nextScenes);
    setSelectedBeatId(newBeatId);
  };

  // 删除分镜
  const handleDeleteBeat = (beatId: string) => {
    if (!activeScene) return;
    const nextBeats = activeScene.beats.filter((b) => b.id !== beatId);
    const nextScenes = scenes.map((s) =>
      s.id === activeScene.id ? { ...s, beats: nextBeats } : s
    );
    handleUpdateScenes(nextScenes);
    if (selectedBeatId === beatId) {
      setSelectedBeatId(nextBeats[0]?.id || null);
    }
  };

  // 新增场次
  const handleAddScene = (stageId: string) => {
    const targetStage = document.stages.find((s) => s.id === stageId);
    if (!targetStage) return;
    const stageScenes = getEffectiveStageScenes(targetStage, document.scenes);
    const newSceneId = createStudioId('scene');
    const newScene: ActivityScene = {
      id: newSceneId,
      stageId,
      title: `新场次 ${stageScenes.length + 1}`,
      timeText: '',
      locationText: targetStage.location || '',
      environment: '',
      beats: [
        {
          id: createStudioId('beat'),
          sceneId: newSceneId,
          stageId,
          characterId: document.actors[0]?.id || 'narrator',
          characterName: document.actors[0]?.displayName || '旁白',
          action: '',
          dialogue: '',
          orderIndex: 0,
        },
      ],
      orderIndex: stageScenes.length * 10,
    };

    const nextScenes = [...stageScenes, newScene];
    const nextDoc = writeStageScenes(document, stageId, nextScenes);
    draft.update(nextDoc);
    setActiveStageId(stageId);
    setActiveSceneId(newSceneId);
    setSelectedBeatId(newScene.beats[0]?.id || null);
  };

  // 更新场次
  const handleUpdateScene = (patch: Partial<ActivityScene>) => {
    if (!activeScene) return;
    const nextScenes = scenes.map((s) =>
      s.id === activeScene.id ? { ...s, ...patch } : s
    );
    handleUpdateScenes(nextScenes);
  };

  // 删除场次
  const handleDeleteScene = (sceneId: string) => {
    if (!window.confirm('确定要删除该场次及场次内的所有分镜吗？')) return;
    const nextScenes = scenes.filter((s) => s.id !== sceneId);
    handleUpdateScenes(nextScenes);
    if (activeSceneId === sceneId) {
      setActiveSceneId(nextScenes[0]?.id || null);
      setSelectedBeatId(nextScenes[0]?.beats[0]?.id || null);
    }
  };

  // 新增一幕
  const handleAddStage = () => {
    const newStageId = createStudioId('stage');
    const newStageOrder = document.stages.length + 1;
    const newStage: StageDefinition = {
      id: newStageId,
      title: `第 ${newStageOrder} 幕`,
      order: newStageOrder,
      actorIds: document.actors.map((a) => a.id),
      location: document.activity.location || '',
      instruction: '',
      requiredBeats: [],
      locked: false,
      endCondition: '',
      scenes: [],
    };

    const newSceneId = `scene_${crypto.randomUUID()}`;
    const newScene: ActivityScene = {
      id: newSceneId, stageId: newStageId, title: '新场次 1',
      timeText: '', locationText: newStage.location || '', environment: '',
      beats: [], orderIndex: 0,
    };
    const nextDoc = writeStageScenes({
      ...document,
      stages: [...document.stages, newStage],
    }, newStageId, [newScene]);
    draft.update(nextDoc);
    setActiveStageId(newStageId);
    setActiveSceneId(newSceneId);
    setSelectedBeatId(null);
  };

  // 单镜头生图
  const handleQuickGenerateBeat = async (beat: SceneBeat) => {
    if (!activeStage || !activeScene || quickLocks.current.has(beat.id)) return;
    quickLocks.current.add(beat.id);
    if (!await draft.flush()) { quickLocks.current.delete(beat.id); return; }
    const beatId = beat.id;
    setGeneratingBeatIds((prev) => new Set(prev).add(beatId));

    try {
      const identity = JSON.stringify([activeStage.id, activeScene.id, beatId, beat.action, beat.renderSettings]);
      const idempotencyKey = quickAttempts.current.get(identity) ?? `beat-${crypto.randomUUID()}`;
      quickAttempts.current.set(identity, idempotencyKey);
      await submitBeatRender(activityId, {
        stageId: activeStage.id,
        sceneId: activeScene.id,
        beatId,
        idempotencyKey,
        ...(beat.renderSettings?.customPrompt ? { customPrompt: beat.renderSettings.customPrompt } : {}),
        ...(beat.renderSettings?.negativePrompt !== undefined ? { negativePrompt: beat.renderSettings.negativePrompt } : {}),
      });
      quickAttempts.current.delete(identity);
      await queryClient.invalidateQueries({ queryKey: ['activity-beat-renders', activityId] });
      toast.success('已提交生成任务，进度与结果可在镜头工坊查看');
    } catch (err) {
      toast.error('提交生图失败', err instanceof Error ? err.message : undefined);
    } finally {
      quickLocks.current.delete(beat.id);
      setTimeout(() => {
        setGeneratingBeatIds((prev) => {
          const next = new Set(prev);
          next.delete(beatId);
          return next;
        });
      }, 1000);
    }
  };

  // 一键全幕批量生图
  const handleBatchGenerate = async () => {
    if (!activeStage) return;
    const allStageScenes = getEffectiveStageScenes(activeStage, document.scenes);
    const pendingBeats: { sceneId: string; beat: SceneBeat }[] = [];

    for (const sc of allStageScenes) {
      for (const bt of sc.beats) {
        if (!bt.mediaUrl && bt.mediaType !== 'video') {
          pendingBeats.push({ sceneId: sc.id, beat: bt });
        }
      }
    }

    if (pendingBeats.length === 0) {
      toast.info('当前幕所有镜头均已生成画面');
      return;
    }

    if (!await draft.flush()) return;
    setIsBatchGenerating(true);
    let successCount = 0;

    for (const { sceneId, beat } of pendingBeats) {
      try {
        const idempotencyKey = `batch-${activityId}-${beat.id}-${Date.now()}`;
        await submitBeatRender(activityId, {
          stageId: activeStage.id,
          sceneId,
          beatId: beat.id,
          idempotencyKey,
        });
        successCount++;
      } catch {
        // Continue others
      }
    }

    setIsBatchGenerating(false);
    toast.success(`已为 ${successCount} 个镜头排队生成画面，后台绘制中`);
  };

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-paper text-ink">
      {/* 48px 极简统一顶栏 */}
      <StudioHeader
        activity={activity}
        document={document}
        saveStatus={saveStatus}
        saveError={saveError}
        viewMode={viewMode}
        onViewModeChange={mode => { void changeView(mode); }}
        onUpdateTitle={handleUpdateTitle}
        onOpenPlayback={openPlayback}
        onBatchGenerate={handleBatchGenerate}
        isBatchGenerating={isBatchGenerating}
        onOpenSettings={() => { setSettingsFocusId(null); setSettingsOpen(true); }}
        onOpenExport={openExport}
        onOpenArt={() => setArtOpen(true)}
        onOpenRework={() => setReworkOpen(true)}
      />
      {/* 发布新版本后产生的复核项：保留、返工与处理历史都在复核面板里 */}
      {reviewCount > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning-border bg-warning-bg px-3 py-1.5 text-sm text-warning-fg">
          <span className="min-w-0 flex-1">内容修改影响了已有镜头、图片或回放，确认保留或加入返工后提示会消失。</span>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setReworkOpen(true)}>查看 {reviewCount} 项内容变化</Button>
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
        {viewMode === 'storyboard' ? <>
          <select aria-label="当前幕" className="h-9 min-w-0 flex-1 rounded-control border border-border-control bg-surface px-2 text-base text-ink" value={activeStage?.id ?? ''} onChange={event => { setActiveStageId(event.target.value); setActiveSceneId(null); }}>{document.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select>
          <select aria-label="当前场次" className="h-9 min-w-0 flex-1 rounded-control border border-border-control bg-surface px-2 text-base text-ink" value={activeScene?.id ?? ''} onChange={event => { setActiveSceneId(event.target.value); setSelectedBeatId(null); }}>{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select>
          <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => setMobileDrawing(value => !value)}>{mobileDrawing ? '返回剧情' : '镜头绘制'}</Button>
          <StudioMenu label="工作台操作">
            <StudioMenuItem onSelect={handleAddStage}>新增一幕</StudioMenuItem>
            <StudioMenuItem disabled={!activeStage} onSelect={() => { if (activeStage) handleAddScene(activeStage.id); }}>新增场次</StudioMenuItem>
          </StudioMenu>
        </> : <span className="px-1 text-sm text-muted">{viewMode === 'comic' ? '漫画工坊' : '素材制作'}</span>}
      </div>

      {viewMode === 'storyboard' && mobileDrawing && (
        <div className="shrink-0 border-b border-border-subtle bg-surface px-2 py-2 md:hidden">
          <select aria-label="选择镜头" className="h-9 w-full min-w-0 rounded-control border border-border-control bg-surface px-2 text-base text-ink" value={`${activeScene?.id ?? ''}|${selectedBeat?.id ?? ''}`} onChange={event => { const [sceneId, beatId] = event.target.value.split('|'); setActiveSceneId(sceneId); setSelectedBeatId(beatId); }}>{scenes.flatMap(scene => scene.beats.map((beat, index) => <option key={beat.id} value={`${scene.id}|${beat.id}`}>{scene.title} · {index + 1} · {beat.action || beat.dialogue || '镜头'}</option>))}</select>
        </div>
      )}

      {/* 核心工作台：三栏视口锁高布局 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧大纲导轨（仅分镜模式展示，避免漫画工坊出现双侧栏） */}
        {viewMode === 'storyboard' && (
          <div className="hidden md:flex"><StudioOutlineRail
            document={document}
            activeStageId={activeStage?.id ?? ''}
            activeSceneId={activeScene?.id ?? null}
            onSelectStage={(stId) => {
              setActiveStageId(stId);
              const target = document.stages.find((s) => s.id === stId);
              if (target) {
                const scs = getEffectiveStageScenes(target, document.scenes);
                setActiveSceneId(scs[0]?.id || null);
                setSelectedBeatId(scs[0]?.beats[0]?.id || null);
              }
            }}
            onSelectScene={(stId, scId) => {
              setActiveStageId(stId);
              setActiveSceneId(scId);
              const target = document.stages.find((s) => s.id === stId);
              if (target) {
                const scs = getEffectiveStageScenes(target, document.scenes);
                const found = scs.find((s) => s.id === scId);
                setSelectedBeatId(found?.beats[0]?.id || null);
              }
            }}
            onAddStage={handleAddStage}
            onAddScene={handleAddScene}
            collapsed={leftRailCollapsed}
            onToggleCollapse={() => setLeftRailCollapsed(!leftRailCollapsed)}
          /></div>
        )}

        {/* 中央主创作流 */}
        {viewMode === 'materials' ? <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4" data-autohide-scroll><MediaWorkstation activity={activity} document={document} actors={document.actors} currentMediaRevision={activityData?.currentMediaRevision} onUpdateDocument={draft.update} registerFlush={flush => { mediaFlush.current = flush; }} /></div> : viewMode === 'comic' ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <ComicWorkstation
              activity={activity}
              content={document}
              actors={document.actors}
              readingOnly={false}
              onBack={() => { void changeView('storyboard'); }}
              onEdit={() => {}}
            />
          </div>
        ) : (
          <div className={`${mobileDrawing ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-1`}><StudioBeatStream
            stage={activeStage!}
            scene={activeScene}
            actors={document.actors}
            selectedBeatId={selectedBeat?.id ?? null}
            onSelectBeat={setSelectedBeatId}
            onUpdateBeat={handleUpdateBeat}
            onAddBeat={handleAddBeat}
            onDeleteBeat={handleDeleteBeat}
            onUpdateScene={handleUpdateScene}
            onDeleteScene={handleDeleteScene}
            onQuickGenerateBeat={handleQuickGenerateBeat}
            generatingBeatIds={generatingBeatIds}
          /></div>
        )}

        {/* 右侧随动导演面板 */}
        {viewMode === 'storyboard' && activeStage && (
          <aside
            className={`${mobileDrawing ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 w-full flex-col border-l border-border-default bg-surface transition-[width] duration-150 ${
              rightInspectorCollapsed ? 'md:w-12' : 'md:w-80 lg:w-96'
            } md:shrink-0`}
          >
            {/* 44px 统一连续基线顶栏 */}
            <div className="h-11 px-2.5 border-b border-border-default bg-surface flex items-center justify-between shrink-0 select-none">
              {!rightInspectorCollapsed && (
                <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                  <Sparkles className="h-3.5 w-3.5 text-muted" />
                  <span>镜头工坊</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setRightInspectorCollapsed(!rightInspectorCollapsed)}
                className={`hidden md:flex h-7 w-7 rounded-control items-center justify-center text-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer shrink-0 ${
                  rightInspectorCollapsed ? 'mx-auto' : ''
                }`}
                title={rightInspectorCollapsed ? '展开镜头工坊' : '收起镜头工坊'}
                aria-label={rightInspectorCollapsed ? '展开镜头工坊' : '收起镜头工坊'}
              >
                {rightInspectorCollapsed ? (
                  <PanelRightOpen className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </button>
            </div>

            {rightInspectorCollapsed && !isMobile ? (
              <button type="button"
                onClick={() => setRightInspectorCollapsed(false)}
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
                      handleUpdateBeat(selectedBeat.id, { renderSettings: settings })
                    }
                    onAdopted={(nextDocument, draftVersion) => {
                      void draft.adoptBeatMedia(
                        { document: nextDocument, draftVersion },
                        { stageId: activeStage.id, sceneId: activeScene.id, beatId: selectedBeat.id }
                      );
                      void refetchActivity();
                    }}
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
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); setSettingsFocusId(null); clearDeepLink(); }}
        activity={activity}
        document={document}
        onUpdateDocument={(nextDoc) => draft.update(nextDoc)}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        focusId={settingsFocusId}
        profileDisabled={saveStatus === 'error' || saveStatus === 'conflict'}
        beforeApplyProfile={prepareContent}
        onProfileApplied={() => { void refetchActivity(); void refetchDraft(); }}
      />
      <ReworkPanel
        open={reworkOpen}
        onOpenChange={setReworkOpen}
        activityId={activityId}
        headVersion={activity.headVersion}
        document={document}
        onSaved={() => { void refetchActivity(); }}
      />
      {candidateJobId && <StudioCandidateDialog
        key={candidateJobId}
        activityId={activityId}
        jobId={candidateJobId}
        onClose={() => { setCandidateJobId(null); clearDeepLink(); }}
        onApplied={() => { void refetchActivity(); void refetchDraft(); }}
      />}
      <ArtDirectionDialog activity={activity} open={artOpen} onOpenChange={setArtOpen} beforeApply={draft.flush} onApplied={async () => { await refetchActivity(); }} />

      {/* 连贯试演弹窗 */}
      {playbackOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface overflow-hidden">
          <div className="h-11 px-4 border-b border-border-default flex items-center justify-between shrink-0 bg-surface">
            <span className="text-xs font-semibold text-ink">连贯试演与演播预览</span>
            <button
              type="button"
              onClick={() => { setPlaybackOpen(false); clearDeepLink(); }}
              className="h-7 w-7 rounded-control flex items-center justify-center text-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
              title="关闭试演预览"
              aria-label="关闭试演预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <PrepareNotice status={prepareStatus} error={prepareError} onRetry={() => { void prepareContent(); }} />
          <div className="flex-1 min-h-0 overflow-hidden">
            <PlaybackWorkstation
              key={`${activity.currentContentRevisionId || 'none'}:${activity.currentMediaRevisionId || 'none'}`}
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
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border-default bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="h-11 px-4 border-b border-border-default flex items-center justify-between shrink-0">
              <span className="text-xs font-bold text-ink">活动资产与格式导出</span>
              <button
                type="button"
                onClick={() => { setExportOpen(false); clearDeepLink(); }}
                className="h-7 w-7 rounded flex items-center justify-center text-muted hover:text-ink cursor-pointer"
                aria-label="关闭导出交付"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <PrepareNotice status={prepareStatus} error={prepareError} onRetry={() => { void prepareContent(); }} />
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <ExportPanel
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
    </main>
  );
}
