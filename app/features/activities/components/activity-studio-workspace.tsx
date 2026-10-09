'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  MessageSquare,
  Camera,
  PlaySquare,
  History,
  Download,
  Check,
  AlertCircle,
  Sparkles,
  Save,
  Clock,
  Compass,
  Bookmark,
  ChevronRight,
  ChevronDown,
  Layers,
  Users,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Trash2,
  Lightbulb,
  ExternalLink,
  Menu,
  ListTodo,
  MoreHorizontal,
  Settings,
  Palette,
} from 'lucide-react';
import type { Activity, ContentDocument, ActivityReviewItem } from '@sthstart/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicOverview, useAppLlmStatus } from '@/app/features/public-services/queries';
import { updateLlmAssignments } from '@/app/features/public-services/api';
import { providerKeys } from '@/app/lib/query-keys';
import { getJson } from '@/app/lib/api-client';
import { fetchGenerationEngines } from '@/app/features/generation/api';
import { useActivity, useActivityDraft, useActivityPlaybackRevision } from '../queries';
import { useCommitDraft } from '../mutations';
import { useStudioDraft } from '../hooks/use-studio-draft';
import { StagesEditor } from './stages-editor';
import { SceneBeatEditor } from './scene-beat-editor';
import { StageRailNav } from './stage-rail-nav';
import { RecordsEditor } from './records-editor';
import { MediaWorkstation } from './media-workstation';
import { PlaybackWorkstation } from './playback-workstation';
import { ExportPanel } from './export-panel';
import { ActivityCreationProfile } from './creation-profile-picker';
import { ReworkPanel } from './rework-panel';
import { GenerationModal } from './generation-modal';
import { CandidateReviewPanel } from './candidate-review-panel';
import { useActivityGeneration } from '../hooks/use-activity-generation';
import { HistoryDrawer } from './history-drawer';
import { ImageWorkbench } from './image-workbench';
import { ActivityPresetsModal } from './activity-presets-modal';
import { ActorAssetPickerDialog } from './actor-asset-picker-dialog';
import { ActivityReflectDialog } from '@/app/features/knowledge/components/activity-reflect-dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { FormField } from '@/app/components/ui/form-field';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { ShortFieldGrid } from '@/app/components/ui/form-section';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';
import { getEffectiveStageScenes } from '../scene-beat-utils';
import { navigateActivityStudio, resolveActivityStudioRoute, type ActivityStudioRoute, type StudioTab } from '../studio-route';
import { useImageConfigDraft } from '../queries';
import { ArtDirectionDialog } from './art-direction-dialog';
import { ComicWorkstation } from '../comic/comic-workstation';
import { ActivityGallery } from './activity-gallery';
import { StudioSmartDialog } from './studio-smart-dialog';

interface ActivityStudioWorkspaceProps {
  activityId: string;
}

/** 视觉工坊核心流转阶段：以分镜漫画与视听剧场为双核心产物 */
type PipelineStep = 'script' | 'playback' | 'media' | 'planning' | 'export';

const PIPELINE_STEPS = [
  { id: 'studio' as const, label: '创作工坊', icon: MessageSquare, desc: '剧情记录、分镜、漫画和素材制作' },
  { id: 'theater' as const, label: '阅读与演播', icon: PlaySquare, desc: '漫画逐格阅读与原活动回放' },
  { id: 'delivery' as const, label: '资产与交付', icon: Download, desc: '活动画廊与导出' },
] as const;

function cleanStageTitle(title: string) {
  return title.replace(/^(?:(?:第\s*[一二三四五六七八九十0-9]+\s*(?:幕|阶段)|阶段\s*[一二三四五六七八九十0-9]+)\s*(?:[·：:-]\s*)?)+/, '').trim() || title;
}

export function ActivityStudioWorkspace({ activityId }: ActivityStudioWorkspaceProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [studioRoute, setStudioRoute] = useState<ActivityStudioRoute>(() => resolveActivityStudioRoute(searchParams.toString()).route);
  const comicMode = studioRoute.view === 'comic' && studioRoute.tab === 'studio' || studioRoute.tab === 'theater' && studioRoute.mode === 'comic';
  const initialRouteHandled = useRef(false);
  const lastSynchronizedJobId = useRef(searchParams.get('jobId'));

  // 当前流水线步骤
  const currentStep: PipelineStep = studioRoute.tab === 'theater' ? 'playback' : studioRoute.tab === 'delivery' ? 'export'
    : studioRoute.view === 'assets' ? 'media' : 'script';
  const comicFlush = useRef<(() => Promise<boolean>) | null>(null);
  const mediaFlush = useRef<(() => Promise<boolean>) | null>(null);
  const routeTransition = useRef(0);
  const acceptedSearch = useRef(resolveActivityStudioRoute(searchParams.toString()).canonicalSearch);

  // 剧情创作内部的子视图（场次分镜流 / 群聊 / 朋友圈 / 剧情事实）
  const [contentView, setContentView] = useState<'beats' | 'chat' | 'moments' | 'facts'>(studioRoute.view === 'records' ? studioRoute.recordView : 'beats');
  const [mobileStagePickerOpen, setMobileStagePickerOpen] = useState(false);
  const [moreViewsOpen, setMoreViewsOpen] = useState(false);
  const moreViewsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreViewsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreViewsRef.current && !moreViewsRef.current.contains(e.target as Node)) {
        setMoreViewsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreViewsOpen(false);
      }
    };
    window.document.addEventListener('mousedown', handleClickOutside);
    window.document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.document.removeEventListener('mousedown', handleClickOutside);
      window.document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreViewsOpen]);

  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!headerMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHeaderMenuOpen(false);
    };
    window.document.addEventListener('mousedown', handleClickOutside);
    window.document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.document.removeEventListener('mousedown', handleClickOutside);
      window.document.removeEventListener('keydown', handleKeyDown);
    };
  }, [headerMenuOpen]);

  // 当前聚焦的阶段 ID
  const [focusedStageId, setFocusedStageId] = useState<string | undefined>(
    searchParams.get('stageId') || undefined
  );

  // 辅助 AI 面板默认收起；用户可在当前标签页中记住自己的展开选择。
  const [copilotOpen, setCopilotOpen] = useState(false);

  useEffect(() => {
    try { setCopilotOpen(sessionStorage.getItem(`sthstart:activity-assistant:${activityId}`) === 'true'); } catch { /* optional session preference */ }
  }, [activityId]);
  const changeCopilotOpen = (open: boolean) => {
    setCopilotOpen(open);
    try { sessionStorage.setItem(`sthstart:activity-assistant:${activityId}`, String(open)); } catch { /* optional session preference */ }
  };

  // 弹窗与抽屉状态
  const [generationModalOpen, setGenerationModalOpen] = useState(false);
  const [generationStageId, setGenerationStageId] = useState<string | undefined>(
    searchParams.get('stageId') || undefined
  );
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [presetsModalOpen, setPresetsModalOpen] = useState(false);
  const [workbenchSlotId, setWorkbenchSlotId] = useState<string | null>(null);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [expandedActorId, setExpandedActorId] = useState<string | null>(null);
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [activityBasicsOpen, setActivityBasicsOpen] = useState(false);
  const [activityBasicsDiscardOpen, setActivityBasicsDiscardOpen] = useState(false);
  const [activityBasicsError, setActivityBasicsError] = useState('');
  const [activityBasicsDraft, setActivityBasicsDraft] = useState({ title: '', theme: '', location: '', scheduledDate: '' });

  // 数据查询
  const {
    data: activityData,
    isLoading: activityLoading,
    error: activityError,
    refetch: refetchActivity,
  } = useActivity(activityId);

  const {
    data: draftData,
    isLoading: draftLoading,
    refetch: refetchDraft,
  } = useActivityDraft(activityId);

  const { data: reviews } = useQuery({
    queryKey: ['activity-review', activityId, activityData?.activity?.headVersion],
    queryFn: () =>
      getJson<{ items: ActivityReviewItem[] }>(`/api/admin/activities/${activityId}/review-items`),
    enabled: !!activityData?.activity?.headVersion,
  });

  const playbackQuery = useActivityPlaybackRevision(activityId, activityData?.activity?.currentPlaybackRevisionId || undefined);

  const draft = useStudioDraft(activityId, draftData?.draft);
  const { document, status: saveStatus } = draft;
  const imageConfigQuery = useImageConfigDraft(activityId);

  // 定位锚点处理
  useEffect(() => {
    if (!document) return;
    const record = searchParams.get('recordId');
    const actor = searchParams.get('actorId');
    const stage = searchParams.get('stageId');
    const fact = searchParams.get('factId');
    const frame = requestAnimationFrame(() => {
      const target = window.document.getElementById(
        record
          ? `record-${record}`
          : actor
          ? `actor-${actor}`
          : stage
          ? `stage-${stage}`
          : fact
          ? `fact-${fact}`
          : ''
      );
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [searchParams, currentStep, !!document]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [serverDraft, setServerDraft] = useState<{
    document: ContentDocument;
    draftVersion: number;
  } | null>(null);
  const commitDraftMutation = useCommitDraft();

  const handleUpdateDocument = draft.update;

  const openActivityBasics = () => {
    if (!document) return;
    setActivityBasicsDraft({
      title: document.activity.title,
      theme: document.activity.theme ?? '',
      location: document.activity.location ?? '',
      scheduledDate: document.activity.scheduledDate ?? '',
    });
    setActivityBasicsError('');
    setActivityBasicsOpen(true);
  };

  const requestCloseActivityBasics = () => {
    if (!document) { setActivityBasicsOpen(false); return; }
    const changed = activityBasicsDraft.title !== document.activity.title
      || activityBasicsDraft.theme !== (document.activity.theme ?? '')
      || activityBasicsDraft.location !== (document.activity.location ?? '')
      || activityBasicsDraft.scheduledDate !== (document.activity.scheduledDate ?? '');
    if (changed) setActivityBasicsDiscardOpen(true);
    else setActivityBasicsOpen(false);
  };

  const saveActivityBasics = async () => {
    if (!document) return;
    handleUpdateDocument({
      ...document,
      activity: {
        ...document.activity,
        title: activityBasicsDraft.title.trim(),
        theme: activityBasicsDraft.theme,
        location: activityBasicsDraft.location,
        scheduledDate: activityBasicsDraft.scheduledDate || null,
      },
    });
    if (await draft.flush()) setActivityBasicsOpen(false);
    else setActivityBasicsError(draft.error || '保存失败。内容仍保留在窗口中，请重试。');
  };

  // 保存新版本
  const handleCommitDraft = async () => {
    if (committing) return false;
    setCommitting(true);
    setErrorMessage(null);
    try {
      if (!(await draft.flush())) return false;
      const fresh = await refetchActivity();
      if (!fresh.data) throw new Error('无法读取当前版本，请重试');
      await commitDraftMutation.mutateAsync({
        id: activityId,
        expectedHeadVersion: fresh.data.activity.headVersion,
        expectedDraftVersion: draft.version(),
      });
      const latest = await refetchDraft();
      if (latest.data?.draft) draft.resolve(latest.data.draft, false);
      await refetchActivity();
      return true;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '保存新版本失败');
      return false;
    } finally {
      setCommitting(false);
    }
  };

  const handleReloadConflict = async () => {
    const latest = await refetchDraft();
    if (latest.data?.draft) setServerDraft(latest.data.draft);
  };

  const handleBeatServerDraft = (server: { document: ContentDocument; draftVersion: number }) => {
    if (draft.isClean()) {
      setServerDraft(null);
      draft.resolve(server, false);
    } else {
      // Background rendering can update the server draft while the user is typing.
      // Keep their local copy untouched and route the server update through the existing conflict UI.
      setServerDraft(server);
    }
  };

  const refreshBeatServerDraft = async () => {
    const latest = await refetchDraft();
    if (latest.data?.draft) handleBeatServerDraft(latest.data.draft);
  };

  // 进入素材/回放/导出前，先落盘并确认版本
  const prepareContent = async () => {
    if (committing || !(await draft.flush())) return false;
    try {
      const latest = await refetchActivity();
      if (!latest.data) throw new Error('无法读取活动，请重试');
      if (
        JSON.stringify(latest.data.currentContentRevision?.document) ===
        JSON.stringify(latest.data.draft.document)
      )
        return true;
      return await handleCommitDraft();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '准备活动内容失败');
      return false;
    }
  };

  // 流水线步骤切换
  const navigateStudio = async (patch: Partial<ActivityStudioRoute>) => {
    if (!(await draft.flush()) || comicFlush.current && !(await comicFlush.current()) || mediaFlush.current && !(await mediaFlush.current())) return;
    setErrorMessage(null);
    router.push(`${pathname}?${navigateActivityStudio(searchParams.toString(), patch)}`, { scroll: false });
  };
  const navigateStep = (tab: StudioTab) => navigateStudio({ tab, panel: null });
  const flushStudioInputs = async () => await draft.flush() && (!comicFlush.current || await comicFlush.current()) && (!mediaFlush.current || await mediaFlush.current());
  const selectStudioJob = async (id: string | null) => {
    if (!await flushStudioInputs()) return;
    const params = new URLSearchParams(navigateActivityStudio(searchParams.toString(), { panel: 'smart-create' }));
    if (id) params.set('studioJobId', id); else params.delete('studioJobId');
    router.push(`${pathname}?${params}`, { scroll: false });
  };
  const changeContentView = (view: typeof contentView) => {
    void navigateStudio({ tab: 'studio', view: view === 'beats' ? 'storyboard' : 'records',
      ...(view === 'beats' ? {} : { recordView: view }) });
  };
  const selectFocusedStage = async (stageId: string) => {
    if (!(await draft.flush()) || comicFlush.current && !(await comicFlush.current()) || mediaFlush.current && !(await mediaFlush.current())) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('stageId', stageId);
    router.push(`${pathname}?${params}`, { scroll: false });
  };
  useEffect(() => {
    if (!activityData?.activity || !draftData?.draft) return;
    const synchronized = resolveActivityStudioRoute(searchParams.toString());
    if (synchronized.canonicalSearch !== searchParams.toString()) {
      router.replace(`${pathname}?${synchronized.canonicalSearch}`, { scroll: false });
      return;
    }
    const transition = ++routeTransition.current;
    if (synchronized.canonicalSearch !== acceptedSearch.current || JSON.stringify(synchronized.route) !== JSON.stringify(studioRoute)) {
      void (async () => {
        const saved = await draft.flush() && (!comicFlush.current || await comicFlush.current()) && (!mediaFlush.current || await mediaFlush.current());
        if (transition !== routeTransition.current) return;
        if (!saved) {
          setErrorMessage('先处理未保存输入或版本冲突，当前编辑内容已保留。');
          router.replace(`${pathname}?${acceptedSearch.current}`, { scroll: false });
          return;
        }
        acceptedSearch.current = synchronized.canonicalSearch;
        setFocusedStageId(new URLSearchParams(synchronized.canonicalSearch).get('stageId') || undefined);
        setStudioRoute(synchronized.route);
        setContentView(synchronized.route.view === 'records' ? synchronized.route.recordView : 'beats');
      })();
    }
    if (!initialRouteHandled.current) {
      initialRouteHandled.current = true;
      if (searchParams.get('jobId')) {
        setGenerationStageId(searchParams.get('stageId') || undefined);
        setGenerationModalOpen(true);
      }
    }
  }, [activityData, draftData, searchParams, studioRoute]);

  const activity = activityData?.activity;
  const stages = document?.stages || [];
  const effectiveStageId = stages.some((stage) => stage.id === focusedStageId) ? focusedStageId : stages[0]?.id;
  const effectiveStage = stages.find((stage) => stage.id === effectiveStageId);
  const effectiveGenerationStageId = stages.some((stage) => stage.id === generationStageId)
    ? generationStageId
    : effectiveStageId;
  const actors = document?.actors || [];
  const playbackRevision = playbackQuery.data || activityData?.currentPlaybackRevision || null;
  const [assetPickerActor, setAssetPickerActor] = useState<import('@sthstart/contracts').ActorSnapshot | null>(null);

  // 就地新增幕（不跳页，直接在当前活动追加新幕并聚焦）
  const handleAddStageInPlace = () => {
    if (!document) return;
    const nextIdx = stages.length + 1;
    const newStageId = `stage_${Date.now()}`;
    const newStage = {
      id: newStageId,
      title: `第 ${nextIdx} 幕 · 新阶段`,
      order: nextIdx,
      actorIds: actors.map((a) => a.id),
      location: document.activity.location || '',
      instruction: '',
      requiredBeats: [],
      locked: false,
      endCondition: '',
    };

    const nextStages = [...stages, newStage];
    handleUpdateDocument({ ...document, stages: nextStages });
    setFocusedStageId(newStageId);
  };

  // AI 创作伴侣：读取公共服务配置中的真实可用大模型
  const queryClient = useQueryClient();
  const { data: publicOverview } = usePublicOverview();
  const { data: appLlmStatus } = useAppLlmStatus('activities');

  // ComfyUI 生图引擎状态感知
  const enginesQuery = useQuery({
    queryKey: ['generation', 'engines'],
    queryFn: fetchGenerationEngines,
    staleTime: 30_000,
  });
  const comfyEngine = useMemo(() => {
    return enginesQuery.data?.find((e) => e.kind === 'comfyui' && Boolean(e.enabled));
  }, [enginesQuery.data]);

  // 过滤出用户实际配置且启用的文本大模型
  const configuredTextProfiles = useMemo(() => {
    return (publicOverview?.profiles || []).filter(
      (p) => p.enabled && p.capabilities?.includes('text')
    );
  }, [publicOverview?.profiles]);

  // 当前活动绑定的文本模型 ID
  const assignedTextProfileId =
    appLlmStatus?.text?.profile?.id ||
    publicOverview?.llmAssignments?.find((a) => a.appId === 'activities')?.textProfileId ||
    '';

  const activeProfile = useMemo(() => {
    return configuredTextProfiles.find((p) => p.id === assignedTextProfileId);
  }, [configuredTextProfiles, assignedTextProfileId]);

  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSelection, setProfileSelection] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => setProfileSelection(assignedTextProfileId), [assignedTextProfileId]);

  const handleProfileChange = async (newProfileId: string) => {
    setProfileError(null);
    setProfileSelection(newProfileId);
    setProfileSaving(true);
    try {
      await updateLlmAssignments('activities', {
        textProfileId: newProfileId,
        multimodalProfileId: publicOverview?.llmAssignments?.find((a) => a.appId === 'activities')?.multimodalProfileId ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: providerKeys.llmStatus('activities') });
      await queryClient.invalidateQueries({ queryKey: providerKeys.overview() });
    } catch (err) {
      setProfileSelection(assignedTextProfileId);
      setProfileError(err instanceof Error ? err.message : '修改应用默认模型失败');
    } finally {
      setProfileSaving(false);
    }
  };

  const [copilotGenType, setCopilotGenType] = useState<'shot' | 'continue-chat' | 'moment' | 'stage'>('continue-chat');
  const [copilotUserPrompt, setCopilotUserPrompt] = useState<string>('');
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [preparingGeneration, setPreparingGeneration] = useState(false);
  const generationRequestInFlight = useRef(false);

  const handleCopilotGenerate = async (requestedMode = copilotGenType) => {
    if (generationRequestInFlight.current || !document || generation.running || generation.starting || profileSaving) return;
    generationRequestInFlight.current = true;
    setPreparingGeneration(true);
    setCopilotError(null);
    try {
      const curStageId = effectiveStageId;
      if (!curStageId) {
        setCopilotError('请先创建或选择一幕。');
        return;
      }
      if (!appLlmStatus?.text?.ready || !activeProfile) {
        setProfileError('当前活动没有已绑定且可用的文本模型，请前往公共服务配置。');
        return;
      }
      if (!(await draft.flush())) return;

      let startedJobId: string | null = null;
      if (requestedMode === 'shot') {
        startedJobId = await generation.start({
          mode: 'shot',
          scope: { stageId: curStageId },
          userInstruction: copilotUserPrompt.trim() || undefined,
        });
      } else if (requestedMode === 'continue-chat') {
        const conversationId =
          document.messages?.find((m) => m.stageId === curStageId)?.conversationId ||
          document.conversations?.find((conversation) => conversation.kind === 'group')?.id ||
          'group_main';
        startedJobId = await generation.start({
          mode: 'continue-chat',
          scope: { stageId: curStageId, conversationId },
          userInstruction: copilotUserPrompt.trim() || undefined,
        });
      } else if (requestedMode === 'moment') {
        const author = actors[0]?.id;
        if (!author) {
          setCopilotError('活动中还没有可用于发布动态的角色。');
          return;
        }
        startedJobId = await generation.start({
          mode: 'moment',
          scope: { stageId: curStageId, authorActorId: author },
          userInstruction: copilotUserPrompt.trim() || undefined,
        });
      } else if (requestedMode === 'stage') {
        startedJobId = await generation.start({
          mode: 'stage',
          scope: { stageId: curStageId },
          userInstruction: copilotUserPrompt.trim() || undefined,
        });
      }
      if (startedJobId) updateCurrentJobId(startedJobId, curStageId);
    } finally {
      generationRequestInFlight.current = false;
      setPreparingGeneration(false);
    }
  };

  // 生成状态与控制
  const generation = useActivityGeneration(activityId, searchParams.get('jobId'));
  const [reviewCandidateId, setReviewCandidateId] = useState<string | null>(null);
  const updateCurrentJobId = (jobId: string | null, stageId?: string) => {
    lastSynchronizedJobId.current = jobId;
    generation.selectJob(jobId);
    const params = new URLSearchParams(window.location.search);
    if (jobId) params.set('jobId', jobId);
    else params.delete('jobId');
    if (jobId && stageId) params.set('stageId', stageId);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  useEffect(() => {
    const urlJobId = searchParams.get('jobId');
    if (urlJobId === lastSynchronizedJobId.current) return;
    lastSynchronizedJobId.current = urlJobId;
    generation.selectJob(urlJobId);
  }, [generation.selectJob, searchParams]);

  const reviewCount =
    reviews?.items.filter((item) => item.decision === 'pending' || item.decision === 'rework')
      .length ?? 0;

  // 统计信息

  if (activityLoading || draftLoading) {
    return (
      <div className="w-full min-h-[500px] bg-paper flex items-center justify-center p-8">
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
    <div className="w-full h-dvh max-h-dvh bg-paper text-ink flex flex-col overflow-hidden" data-embed="true">
      {/* 1. 极简单行顶栏 (48px 高度，彻底释放垂直空间) */}
      <header className="h-12 border-b border-border-default bg-surface px-2 sm:px-4 lg:px-6 flex items-center justify-between gap-2 shrink-0 sticky top-0 z-30 shadow-2xs">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link
            href="/apps/activities"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink transition-colors shrink-0"
            title="返回活动列表"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden md:inline">活动列表</span>
          </Link>

          <span className="text-border-control">/</span>

          <h1 className="text-sm font-bold text-ink truncate max-w-[34vw] sm:max-w-xs md:max-w-md">
            {document.activity.title}
          </h1>

          <Badge variant="outline" className="hidden sm:inline-flex bg-surface-muted font-mono text-xs text-ink shrink-0">
            v{activity.headVersion}
          </Badge>

          {/* 实时保存状态 */}
          <div role="status" aria-live="polite" className="hidden sm:flex items-center gap-1.5 text-xs text-muted shrink-0">
            {saveStatus === 'saving' && (
              <span className="flex items-center gap-1 text-warning-fg">
                <Spinner className="h-3 w-3 animate-spin" />
                正在保存…
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1 text-success-fg font-medium">
                <Check className="h-3 w-3" />
                已保存
              </span>
            )}
            {saveStatus === 'unsaved' && (
              <span className="flex items-center gap-1 text-muted">
                <Clock className="h-3 w-3" />
                正在编辑
              </span>
            )}
            {saveStatus === 'conflict' && (
              <span className="flex items-center gap-1 text-danger-fg font-semibold cursor-pointer" onClick={handleReloadConflict}>
                <AlertCircle className="h-3 w-3" />
                版本冲突(点击对比)
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="flex items-center gap-1 text-danger-fg font-semibold">
                <AlertCircle className="h-3 w-3" />
                保存失败
              </span>
            )}
            {comfyEngine ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 border border-emerald-500/20" title={`已连接 ${comfyEngine.name} (${comfyEngine.base_url})`}>
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ComfyUI 已配置
              </span>
            ) : (
              <Link href="/settings/generation" className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 border border-amber-500/20 hover:bg-amber-500/20" title="点击前往配置 ComfyUI">
                <span className="size-1.5 rounded-full bg-amber-500" />
                ComfyUI 待连接
              </Link>
            )}
          </div>
        </div>

        {/* 顶栏中央：核心视觉工坊流程导航 */}
        <nav aria-label="工坊产物阶段" className="hidden lg:flex items-center gap-1 bg-surface-muted p-1 rounded-[var(--radius-control)] border border-border-default shadow-2xs">
          {PIPELINE_STEPS.map((step) => {
            const Icon = step.icon;
            const isActive = studioRoute.tab === step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => void navigateStep(step.id)}
                aria-current={isActive ? 'step' : undefined}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-control)] text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-surface text-accent shadow-2xs font-bold'
                    : 'text-muted hover:text-ink hover:bg-surface/50'
                }`}
                title={step.desc}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-accent' : 'text-muted'}`} />
                <span>{step.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 顶部动作栏：主行动高亮，次级管理收拢至更多菜单 */}
        <div className="flex items-center gap-2 shrink-0">
          {reviewCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReworkOpen(true)}
              className="h-8 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 font-medium"
            >
              <span>{reviewCount} 项待审</span>
            </Button>
          )}

          {/* 主要行动：智能制作 */}
          <Button
            size="sm"
            variant="accent"
            onClick={() => void navigateStudio({ panel: 'smart-create' })}
            className="h-8 px-3 text-xs font-semibold flex items-center gap-1.5 shadow-xs"
            title="智能生成与制作活动内容"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>智能制作</span>
          </Button>

          {/* 保存新版本 */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleCommitDraft}
            disabled={committing || saveStatus === 'conflict' || saveStatus === 'error'}
            aria-label={committing ? '正在保存新版本' : '保存新版本'}
            className="h-8 px-2.5 text-xs text-ink hover:text-accent font-medium flex items-center gap-1"
            title="将当前工作台内容沉淀为新版本"
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{committing ? '保存中...' : '保存版本'}</span>
          </Button>

          {/* 更多管理操作菜单 */}
          <div className="relative" ref={headerMenuRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHeaderMenuOpen((v) => !v)}
              className="h-8 px-2 text-xs text-muted hover:text-ink flex items-center gap-1"
              title="更多操作与配置"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              <span className="hidden md:inline">更多</span>
            </Button>
            {headerMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-lg border border-border-default bg-surface p-1 shadow-lg anim-zoom-in-95">
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    void navigateStudio({ panel: 'art-direction' });
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-2 text-ink"
                >
                  <Palette className="h-3.5 w-3.5 text-muted" />
                  <span>美术画风设置</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    void navigateStudio({ panel: 'activity-settings' });
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-2 text-ink"
                >
                  <Settings className="h-3.5 w-3.5 text-muted" />
                  <span>活动基础设置</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setHistoryDrawerOpen(true);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-2 text-ink"
                >
                  <History className="h-3.5 w-3.5 text-muted" />
                  <span>版本历史与回溯</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setPresetsModalOpen(true);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-2 text-ink"
                >
                  <Bookmark className="h-3.5 w-3.5 text-muted" />
                  <span>预设与模板管理</span>
                </button>
                {document.activity.planningBasis?.inspiration && (
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setInspirationOpen((v) => !v);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-2 text-ink border-t border-border-subtle mt-0.5 pt-1.5"
                  >
                    <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                    <span>灵感来源依据</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* AI Copilot 侧栏开关 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeCopilotOpen(!copilotOpen)}
            className={`h-8 w-8 p-0 text-muted hover:text-ink ${comicMode ? 'hidden' : ''} ${copilotOpen ? 'text-accent' : ''}`}
            title={copilotOpen ? '收起 AI 助手' : '展开 AI 助手'}
            aria-label={copilotOpen ? '收起 AI 助手' : '展开 AI 助手'}
          >
            {copilotOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>

          {/* 全站导航与全局任务入口 */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('sthstart:open-nav-drawer'))}
            className="inline-flex h-8 items-center gap-1 px-2.5 rounded-md border border-border-default bg-surface text-xs font-medium text-ink hover:bg-surface-muted/60 hover:border-accent transition-colors cursor-pointer"
            title="全站导航"
            aria-label="打开全站导航"
          >
            <Menu className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            <span className="hidden xl:inline">导航</span>
          </button>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('sthstart:open-task-drawer'))}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-default bg-surface text-ink hover:bg-surface-muted/60 hover:border-accent transition-colors cursor-pointer"
            title="全局任务抽屉"
            aria-label="打开全局任务抽屉"
          >
            <ListTodo className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav aria-label="活动流程" className="lg:hidden flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-default bg-surface px-2 py-1.5">
        {PIPELINE_STEPS.map((step) => {
          const Icon = step.icon;
          const active = studioRoute.tab === step.id;
          return (
            <button key={step.id} type="button" onClick={() => void navigateStep(step.id)}
              aria-current={active ? 'step' : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold ${active ? 'bg-accent text-white' : 'text-muted hover:bg-surface-muted hover:text-ink'}`}>
              <Icon className="h-3.5 w-3.5" />{step.label.replace(/^\d+\.\s*/, '')}
            </button>
          );
        })}
      </nav>

      <section aria-label="工作区子视图" className="flex shrink-0 items-center justify-between gap-x-4 border-b border-border-default/60 bg-surface px-3 py-1.5 sm:px-6">
        <div className="flex items-center gap-1 bg-surface-muted p-0.5 rounded-lg border border-border-default/60">
          {studioRoute.tab === 'studio' ? (
            (['storyboard', 'comic', 'records', 'assets'] as const).map((view) => {
              const label = { storyboard: '分镜', comic: '漫画', records: '剧情记录', assets: '素材制作' }[view];
              const active = studioRoute.view === view;
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => void navigateStudio({ view })}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    active ? 'bg-surface text-accent shadow-xs font-semibold' : 'text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })
          ) : studioRoute.tab === 'theater' ? (
            (['activity', 'comic'] as const).map((mode) => {
              const label = mode === 'comic' ? '漫画阅读' : '活动回放';
              const active = studioRoute.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => void navigateStudio({ mode })}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    active ? 'bg-surface text-accent shadow-xs font-semibold' : 'text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })
          ) : (
            (['gallery', 'exports'] as const).map((deliveryView) => {
              const label = deliveryView === 'gallery' ? '活动画廊' : '导出产物';
              const active = studioRoute.deliveryView === deliveryView;
              return (
                <button
                  key={deliveryView}
                  type="button"
                  onClick={() => void navigateStudio({ deliveryView })}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    active ? 'bg-surface text-accent shadow-xs font-semibold' : 'text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void navigateStudio({ panel: 'art-direction' })}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent transition-colors py-1 px-2 rounded-md hover:bg-surface-muted cursor-pointer"
            title="点击修改美术画风配置"
          >
            <Palette className="h-3.5 w-3.5 text-accent" />
            <span className="max-w-xs truncate">
              {imageConfigQuery.data?.document.artDirection
                ? `${imageConfigQuery.data.document.artDirection.selectedStyle?.name ?? '自定义画风'} · ${imageConfigQuery.data.document.artDirection.quality === 'draft' ? '草图' : '成稿'} · ${imageConfigQuery.data.document.artDirection.canvas.width}×${imageConfigQuery.data.document.artDirection.canvas.height}`
                : '沿用原活动画风'}
            </span>
          </button>
        </div>
      </section>



      {/* 冲突提示 Banner */}
      {serverDraft && (
        <section className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-700 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              检测到服务器草稿冲突，请选择保留内容：
            </span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { draft.resolve(serverDraft, true); setServerDraft(null); }}>保留本地输入并覆盖</Button>
              <Button size="sm" variant="outline" onClick={() => { draft.resolve(serverDraft, false); setServerDraft(null); }}>改用服务器草稿</Button>
            </div>
          </div>
        </section>
      )}

      {/* 灵感来源弹层（若点击展开） */}
      {inspirationOpen && document.activity.planningBasis?.inspiration && (
        <div className="bg-surface-raised border-b border-border-default px-6 py-3 text-xs space-y-2">
          <div className="flex items-center justify-between font-bold text-ink">
            <span>灵感来源 · {document.activity.planningBasis.inspiration.ideaName}</span>
            <button type="button" onClick={() => setInspirationOpen(false)} className="text-muted hover:text-ink">关闭</button>
          </div>
          <p className="text-muted">{document.activity.planningBasis.inspiration.adaptation}</p>
        </div>
      )}

      {/* 2. 主体工作区：现代化极简布局 (56px 场次胶卷导轨 + 沉浸式宽幅中央分镜流 + 可选 AI 伴侣) */}
      <div className="relative flex-1 flex overflow-hidden min-h-0">

        {/* === 左侧：现代化紧凑场次导轨 (56px 胶卷导轨，悬停展开详细信息) === */}
        {currentStep === 'script' && !comicMode && stages.length > 0 && (
          <StageRailNav
            stages={stages}
            scenes={document.scenes || []}
            activeStageId={effectiveStageId}
            onSelectStage={(stId) => {
              void selectFocusedStage(stId);
            }}
            onAddStage={handleAddStageInPlace}
          />
        )}

        {/* === 中间：沉浸核心工作台 (Flex-1) === */}
        <main className={`flex-1 h-full min-h-0 flex flex-col bg-paper min-w-0 ${comicMode || (currentStep === 'script' && contentView === 'beats') ? 'overflow-hidden' : 'overflow-y-auto'}`}>

          {/* 错误提示 */}
          {(errorMessage || draft.error) && (
            <div className="p-4 border-b border-border-default bg-red-500/5">
              <Alert variant="danger" title="系统提示">
                {errorMessage || draft.error}
                {saveStatus === 'error' && <Button size="sm" onClick={draft.retry} className="ml-2">重试保存</Button>}
              </Alert>
            </div>
          )}

          {/* 步骤 1：基础企划与阶段大纲 (Planning & Stages) */}
          {studioRoute.panel === 'activity-settings' && (
            <ResponsiveEditOverlay open onOpenChange={open => { if (!open) void navigateStudio({ panel: null }); }} title="活动设置" description="主题、演员和阶段目标；修改按原草稿队列保存，失败时保留输入。">
            <div className="p-6 max-w-5xl mx-auto w-full space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-border-default">
                <div>
                  <h2 className="text-base font-bold text-ink flex items-center gap-2">
                    <Compass className="h-5 w-5 text-accent" />
                    1. 基础企划与阶段大纲
                  </h2>
                  <p className="text-xs text-muted mt-0.5">
                    设定活动基本属性、参与者个性及分阶段目标（Beats）。修改会自动存入草稿。
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setReflectOpen(true)} className="text-xs">
                  整理为个人设定
                </Button>
              </div>

              <section className="flex min-w-0 items-start justify-between gap-4 rounded-[var(--radius-panel)] bg-surface-muted px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-ink">{document.activity.title || '未命名活动'}</h3>
                  <p className="mt-1 truncate text-sm text-muted">{[document.activity.theme, document.activity.location].filter(Boolean).join(' · ') || '尚未填写主题或地点'}</p>
                  <p className="mt-0.5 text-xs text-muted">{document.activity.scheduledDate ? `活动日期 · ${document.activity.scheduledDate}` : '未排期'}</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={openActivityBasics}>编辑活动资料</Button>
              </section>

              {/* 参与角色列表（改用清晰卡片，替代原生 details） */}
              <div className="p-4 rounded-[var(--radius-panel)] bg-surface border border-border-default space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    参与角色 ({actors.length})
                  </h3>
                  <span className="text-xs text-muted">点击卡片展开服装与职责设定</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {actors.map((actor) => {
                    const isExpanded = expandedActorId === actor.id;
                    return (
                      <div
                        key={actor.id}
                        id={`actor-${actor.id}`}
                        className="rounded-[var(--radius-control)] border border-border-default bg-surface-raised p-3 space-y-2 transition-all"
                      >
                        <div
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => setExpandedActorId(isExpanded ? null : actor.id)}
                        >
                          <div className="flex items-center gap-2.5">
                            {/* 头像缩略图 */}
                            <div className="relative h-8 w-8 rounded-full overflow-hidden border border-border-default bg-surface-muted shrink-0">
                              {actor.avatarUrl ? (
                                <Image
                                  src={actor.avatarUrl}
                                  alt={actor.displayName}
                                  fill
                                  unoptimized
                                  className="object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-muted">
                                  {actor.displayName.slice(0, 1)}
                                </div>
                              )}
                            </div>
                            <div>
                              <span className="font-bold text-sm text-ink">{actor.displayName}</span>
                              <span className="text-xs text-muted font-normal ml-1.5">({actor.activityRole || '本场角色'})</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {actor.sourceCharacterId && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAssetPickerActor(actor);
                                }}
                                className="text-xs text-accent font-medium hover:underline px-2 py-0.5 rounded bg-accent/10 hover:bg-accent/20 transition-colors"
                              >
                                选头像/立绘
                              </button>
                            )}
                            <button type="button" className="text-xs text-muted hover:text-ink font-medium">
                              {isExpanded ? '收起' : '设定'}
                            </button>
                          </div>
                        </div>

                        {/* 如果已设置立绘，展示立绘指示 */}
                        {actor.portraitUrl && (
                          <div className="text-[11px] text-muted flex items-center gap-1.5 pt-1 border-t border-border-subtle/50">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-500" />
                            <span>已指定独立立绘</span>
                          </div>
                        )}

                        {isExpanded && (
                          <div className="pt-2 border-t border-border-subtle space-y-2 text-xs">
                            <div>
                              <label className="block text-[11px] font-medium text-muted mb-1">服装装扮</label>
                              <Input
                                value={actor.outfitDescription}
                                onChange={(e) =>
                                  handleUpdateDocument({
                                    ...document,
                                    actors: actors.map((a) => (a.id === actor.id ? { ...a, outfitDescription: e.target.value } : a)),
                                  })
                                }
                                className="h-7 text-xs bg-transparent"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-muted mb-1">本场职责</label>
                              <Input
                                value={actor.activityRole}
                                onChange={(e) =>
                                  handleUpdateDocument({
                                    ...document,
                                    actors: actors.map((a) => (a.id === actor.id ? { ...a, activityRole: e.target.value } : a)),
                                  })
                                }
                                className="h-7 text-xs bg-transparent"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-muted mb-1">身份设定描述</label>
                              <Input
                                value={String(actor.persona?.identity || '')}
                                onChange={(e) =>
                                  handleUpdateDocument({
                                    ...document,
                                    actors: actors.map((a) =>
                                      a.id === actor.id
                                        ? { ...a, persona: { ...a.persona, identity: e.target.value } }
                                        : a
                                    ),
                                  })
                                }
                                className="h-7 text-xs bg-transparent"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 阶段设定 */}
              <StagesEditor
                stages={stages}
                actors={actors}
                onChange={(newStages) => handleUpdateDocument({ ...document, stages: newStages })}
              />

              {/* 高级选项：创作偏好 */}
              <details className="rounded-[var(--radius-panel)] bg-surface-muted p-4">
                <summary className="cursor-pointer text-sm font-semibold text-ink">创作偏好与模板（高级）</summary>
                <div className="mt-4">
                <ActivityCreationProfile
                  activityId={activity.id}
                  headVersion={activity.headVersion}
                  value={document.activity.creationProfile}
                  disabled={saveStatus !== 'saved'}
                  onApplied={() => {
                    void refetchActivity();
                    void refetchDraft();
                  }}
                />
                </div>
              </details>
            </div>
            </ResponsiveEditOverlay>
          )}

          {/* 步骤 2：剧情创作 (RecordsEditor - 释放垂直空间) */}
          {currentStep === 'script' && !comicMode && (() => {
            const currentStage = effectiveStage;
            const stageIndex = stages.findIndex((s) => s.id === effectiveStageId);

            return (
            <div className="flex-1 flex flex-col h-full min-h-0">
                {!stages.length && (
                  <div className="m-auto max-w-lg p-8 text-center">
                    <Layers className="mx-auto mb-3 h-10 w-10 text-accent" />
                    <h2 className="text-base font-semibold text-ink">还没有阶段</h2>
                    <p className="mt-2 text-sm text-muted">先建立第一幕，再添加场次、分镜与对话。</p>
                    <Button type="button" className="mt-4" onClick={handleAddStageInPlace}>新建第一幕</Button>
                  </div>
                )}
                {/* 阶段大纲目标与 Beats 卡片 */}
                {currentStage && (
                  <div className="border-b border-border-default bg-surface px-4 py-1.5 space-y-1.5 shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded bg-accent/10 text-accent font-bold text-xs shrink-0">
                          第 {stageIndex >= 0 ? stageIndex + 1 : 1} 幕
                        </span>
                        <h2 className="text-sm font-bold text-ink truncate">
                          {cleanStageTitle(currentStage.title)}
                        </h2>
                        {currentStage.location && (
                          <span className="text-xs text-muted shrink-0">地点: {currentStage.location}</span>
                        )}
                        {currentStage.endCondition && (
                          <span className="text-xs text-muted shrink-0 hidden xl:inline">完结条件: {currentStage.endCondition}</span>
                        )}
                        <button type="button" onClick={() => setMobileStagePickerOpen(!mobileStagePickerOpen)}
                          aria-expanded={mobileStagePickerOpen}
                          className="xl:hidden rounded border border-border-default px-2 py-0.5 text-xs text-muted hover:text-ink">
                          切换幕
                        </button>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] bg-surface-muted p-0.5 text-xs">
                          {([
                            { id: 'beats' as const, label: `分镜漫剧 (${getEffectiveStageScenes(currentStage, document.scenes).length})` },
                            { id: 'chat' as const, label: `剧本对话 (${document.messages.filter(m => m.stageId === currentStage.id).length})` },
                          ]).map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                changeContentView(v.id);
                                setMoreViewsOpen(false);
                              }}
                              className={`px-3 py-1 rounded-[var(--radius-control)] transition-colors cursor-pointer ${
                                contentView === v.id
                                  ? 'bg-surface font-semibold text-ink shadow-2xs'
                                  : 'text-muted hover:text-ink'
                              }`}
                            >
                              {v.label}
                            </button>
                          ))}

                          {/* 更多视图下拉菜单 (朋友圈 / 剧情事实) */}
                          <div ref={moreViewsRef} className="relative inline-block">
                            <button
                              type="button"
                              onClick={() => setMoreViewsOpen(!moreViewsOpen)}
                              className={`px-2.5 py-1 rounded-[var(--radius-control)] transition-colors cursor-pointer flex items-center gap-1 ${
                                (contentView === 'moments' || contentView === 'facts')
                                  ? 'bg-surface font-semibold text-ink shadow-2xs'
                                  : 'text-muted hover:text-ink'
                              }`}
                              title="更多视图 (朋友圈、剧情事实)"
                              aria-haspopup="true"
                              aria-expanded={moreViewsOpen}
                            >
                              <span>
                                {contentView === 'moments'
                                  ? `朋友圈 (${document.posts.filter(p => p.stageId === currentStage.id).length})`
                                  : contentView === 'facts'
                                  ? `剧情事实 (${document.facts.filter(f => f.stageId === currentStage.id).length})`
                                  : '更多视图'}
                              </span>
                              <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${moreViewsOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {moreViewsOpen && (
                              <div className="absolute right-0 top-full mt-1 z-50 min-w-[130px] rounded-lg border border-border-default bg-surface p-1 shadow-md space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    changeContentView('moments');
                                    setMoreViewsOpen(false);
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer flex items-center justify-between ${
                                    contentView === 'moments'
                                      ? 'bg-accent/10 font-bold text-accent'
                                      : 'text-muted hover:text-ink hover:bg-surface-muted'
                                  }`}
                                >
                                  <span>朋友圈</span>
                                  <span className="font-mono text-[10px]">
                                    ({document.posts.filter(p => p.stageId === currentStage.id).length})
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    changeContentView('facts');
                                    setMoreViewsOpen(false);
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer flex items-center justify-between ${
                                    contentView === 'facts'
                                      ? 'bg-accent/10 font-bold text-accent'
                                      : 'text-muted hover:text-ink hover:bg-surface-muted'
                                  }`}
                                >
                                  <span>剧情事实</span>
                                  <span className="font-mono text-[10px]">
                                    ({document.facts.filter(f => f.stageId === currentStage.id).length})
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {mobileStagePickerOpen && (
                      <div className="xl:hidden flex gap-2 overflow-x-auto border-t border-border-subtle pt-2">
                        {stages.map((stage, index) => (
                          <button key={stage.id} type="button" aria-pressed={stage.id === currentStage.id} onClick={() => { void selectFocusedStage(stage.id); setMobileStagePickerOpen(false); }}
                            className={`shrink-0 rounded-[var(--radius-control)] px-3 py-1.5 text-xs ${stage.id === currentStage.id ? 'bg-accent text-white' : 'bg-surface-muted text-ink'}`}>
                            第 {index + 1} 幕 · {cleanStageTitle(stage.title)}
                          </button>
                        ))}
                        <button type="button" onClick={handleAddStageInPlace} className="shrink-0 rounded-[var(--radius-control)] border border-dashed border-border-default px-3 py-1.5 text-xs text-accent">新增一幕</button>
                      </div>
                    )}

                    {/* 阶段指导说明与关键事件 (Beats) - 紧凑单行条 */}
                    {(currentStage.instruction || (currentStage.requiredBeats && currentStage.requiredBeats.length > 0)) && (
                      <div className="flex items-center justify-between gap-2 text-xs text-muted pt-1 border-t border-border-subtle/50">
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          {currentStage.instruction && (
                            <span className="truncate inline-flex items-center gap-1" title={currentStage.instruction}>
                              <span className="px-1.5 py-0.2 rounded bg-surface-muted text-ink font-semibold text-[11px] shrink-0">目标</span>
                              <span className="truncate text-ink/80 text-[11px]">{currentStage.instruction}</span>
                            </span>
                          )}
                        </div>
                        {currentStage.requiredBeats && currentStage.requiredBeats.length > 0 && (
                          <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
                            <span className="text-[10px] font-semibold text-muted shrink-0">关键事件:</span>
                            {currentStage.requiredBeats.map((beat) => {
                              const isMentioned =
                                document.messages.some((m) => m.stageId === currentStage.id && m.text.includes(beat.text)) ||
                                document.facts.some((f) => f.stageId === currentStage.id && f.text.includes(beat.text));
                              return (
                                <span
                                  key={beat.id}
                                  title={beat.text}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] shrink-0 ${
                                    isMentioned
                                      ? 'bg-emerald-500/10 text-emerald-700 font-medium'
                                      : 'bg-surface-muted text-muted'
                                  }`}
                                >
                                  <span>{isMentioned ? '✓' : '○'}</span>
                                  <span className="max-w-[110px] truncate">{beat.text}</span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 核心编辑器 */}
                <div className={`flex-1 min-h-0 ${contentView === 'beats' ? 'flex flex-col overflow-hidden p-3 sm:p-4' : 'overflow-y-auto p-4 sm:p-6'}`}>
                  {!currentStage ? null : contentView === 'beats' ? (
                    <SceneBeatEditor
                      activityId={activityId}
                      focusedSceneId={new URLSearchParams(acceptedSearch.current).get('sceneId') || undefined}
                      focusedBeatId={new URLSearchParams(acceptedSearch.current).get('beatId') || undefined}
                      onFocusTarget={async (sceneId, beatId) => {
                        if (!(await draft.flush())) return false;
                        const params = new URLSearchParams(acceptedSearch.current);
                        params.set('sceneId', sceneId);
                        if (beatId) params.set('beatId', beatId); else params.delete('beatId');
                        router.push(`${pathname}?${params}`, { scroll: false });
                        return true;
                      }}
                      stage={currentStage}
                      document={document}
                      actors={actors}
                      onUpdateDocument={handleUpdateDocument}
                      onBeforeMediaGeneration={() => draft.flush()}
                      onAdoptMediaResult={(nextDocument, draftVersion) => handleBeatServerDraft({ document: nextDocument, draftVersion })}
                      onAutoAppliedCheck={() => { void refreshBeatServerDraft(); }}
                    />
                  ) : (
                    <RecordsEditor
                      document={document}
                      stages={stages}
                      actors={actors}
                      currentStageId={effectiveStageId}
                      onSelectStage={stageId => void selectFocusedStage(stageId)}
                      hideStageSelector={true}
                      onUpdateDocument={handleUpdateDocument}
                      hideViewTabs
                      onOpenWorkbench={(slotId) => setWorkbenchSlotId(slotId)}
                      activeView={contentView}
                      onActiveViewChange={(v) => changeContentView(v === 'script' ? 'beats' : v)}
                    />
                  )}
                </div>
              </div>
            );
          })()}

          {/* 步骤 3：视觉与素材 (MediaWorkstation) */}
          {currentStep === 'media' && (
            <div className="p-6 max-w-6xl mx-auto w-full">
              <MediaWorkstation
                registerFlush={callback => { mediaFlush.current = callback; }}
                activity={activity}
                document={document}
                currentMediaRevision={activityData.currentMediaRevision}
                actors={actors}
                onUpdateDocument={handleUpdateDocument}
              />
            </div>
          )}

          {comicMode && (
            <div className="min-h-0 flex-1 overflow-hidden"><ComicWorkstation
              activity={activity} content={document} actors={actors} readingOnly={studioRoute.tab === 'theater'}
              registerFlush={callback => { comicFlush.current = callback; }}
              onBack={() => void navigateStudio({ tab: 'studio', view: 'storyboard', mode: 'activity' })}
              onEdit={() => void navigateStudio({ tab: 'studio', view: 'comic' })} /></div>
          )}
          {currentStep === 'playback' && !comicMode && (
            <div className={`flex-1 min-h-0 ${comicMode ? 'overflow-hidden p-0' : 'overflow-y-auto p-4 sm:p-6'}`}>
              <PlaybackWorkstation
                key={`${activity.id}:${activity.currentContentRevisionId || 'none'}:${activity.currentMediaRevisionId || 'none'}`}
                activity={activity}
                document={document}
                currentPlaybackRevision={playbackRevision}
                mediaRevision={activityData.currentMediaRevision || null}
                actors={actors}
                hideModeSwitcher
              />
            </div>
          )}

          {/* 步骤 4：导出交付 (ExportPanel) */}
          {currentStep === 'export' && studioRoute.deliveryView === 'exports' && (
            <div className="p-6 max-w-5xl mx-auto w-full">
              <ExportPanel
                activity={activity}
                creationProfile={document.activity.creationProfile}
                mediaRevision={activityData.currentMediaRevision}
                playbackRevision={playbackRevision}
                contentRevision={activityData.currentContentRevision}
              />
            </div>
          )}
          {currentStep === 'export' && studioRoute.deliveryView === 'gallery' && <ActivityGallery activityId={activity.id} onCreate={() => void navigateStudio({ tab: 'studio', view: 'assets' })} />}
          <ArtDirectionDialog activity={activity} open={studioRoute.panel === 'art-direction'}
            onOpenChange={open => { if (!open) void navigateStudio({ panel: null }); }}
            beforeApply={() => draft.flush()} onApplied={async () => { await refetchActivity(); await imageConfigQuery.refetch(); }} />
          <StudioSmartDialog key={activity.id} activityId={activity.id} content={document} open={studioRoute.panel === 'smart-create'}
            stageId={focusedStageId} sceneId={new URLSearchParams(acceptedSearch.current).get('sceneId') ?? undefined}
            beatId={new URLSearchParams(acceptedSearch.current).get('beatId') ?? undefined} panelId={new URLSearchParams(acceptedSearch.current).get('panelId') ?? undefined}
            jobId={new URLSearchParams(acceptedSearch.current).get('studioJobId')}
            onClose={() => void navigateStudio({ panel: null })} onSelectJob={id => void selectStudioJob(id)} beforeAction={flushStudioInputs}
            onApplied={async () => { await refetchActivity(); await refetchDraft(); }} />
        </main>

        {/* === 右侧：统一 AI 伴侣侧栏 (Copilot Panel) === */}
        {/* === 右侧：统一 AI 伴侣侧栏 (三段式透明工作流) === */}
        {copilotOpen && !comicMode && (
          <aside className="fixed inset-x-0 top-24 bottom-0 z-40 flex w-full min-h-0 flex-col border-l border-border-default bg-surface shadow-xs xl:relative xl:inset-auto xl:z-auto xl:h-full xl:w-80 xl:shrink-0 xl:w-88">
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* 头部标题与模型运行状态 */}
              <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <span>AI 创作伴侣</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${generation.running ? 'bg-amber-500/10 text-amber-600 border-amber-500/30 animate-pulse' : 'bg-purple-500/10 text-purple-600 border-purple-500/30'}`}>
                    {generation.running ? '任务进行中' : generation.failed ? '生成失败' : !appLlmStatus?.text?.ready ? '模型未就绪' : generation.candidates.length ? '候选待审' : '待命'}
                  </Badge>
                  <button type="button" className="xl:hidden rounded border border-border-default px-2 py-1 text-xs text-muted hover:text-ink" aria-label="收起 AI 助手" onClick={() => changeCopilotOpen(false)}>收起</button>
                </div>
              </div>

              {/* 段落 ①：模型选择与生成内容类型 */}
              <div className="p-3 rounded-xl bg-surface-raised border border-border-default space-y-2.5 text-xs shadow-2xs">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-bold text-muted">
                    <span className="flex items-center gap-1.5">
                      <span>所有活动的默认文本模型</span>
                      <Link
                        href="/settings/public-services?section=routing&app=activities"
                        target="_blank"
                        className="text-[10px] text-accent hover:underline font-normal inline-flex items-center gap-0.5"
                        title="前往公共服务配置与路由模型"
                      >
                        配置 <ExternalLink className="h-2.5 w-2.5" />
                      </Link>
                    </span>
                    <span
                      className={`text-[10px] font-medium flex items-center gap-1 ${
                        appLlmStatus?.text?.ready ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          appLlmStatus?.text?.ready ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                      />
                      {appLlmStatus?.text?.ready ? '在线' : '未就绪'}
                    </span>
                  </div>

                  {configuredTextProfiles.length > 0 ? (
                    <select
                      value={profileSelection || activeProfile?.id || ''}
                      onChange={(e) => void handleProfileChange(e.target.value)}
                      disabled={!configuredTextProfiles.length || profileSaving}
                      className="w-full h-8 rounded-lg border border-border-default bg-surface px-2.5 text-xs font-semibold text-ink focus:border-accent focus:outline-none"
                    >
                      {!activeProfile && <option value="" disabled>{assignedTextProfileId ? '当前绑定模型未启用或无文本能力' : '尚未绑定文本模型'}</option>}
                      {configuredTextProfiles.map((p) => {
                        const isAssigned = p.id === assignedTextProfileId;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.model || '未设定具体模型名'}){isAssigned ? ' [应用默认]' : ''}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] space-y-1">
                      <div className="font-semibold flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                        <span>未配置文本模型</span>
                      </div>
                      <p className="text-[10px] text-amber-700 leading-tight">
                        当前尚未在公共服务中添加可用的大模型。
                      </p>
                      <Link
                        href="/settings/public-services?section=models"
                        target="_blank"
                        className="inline-flex items-center gap-1 text-[11px] text-accent font-semibold underline pt-0.5"
                      >
                        前往公共服务添加模型 <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                  <p className="text-[10px] leading-relaxed text-muted">修改后会影响活动应用中的所有活动，不是本活动专属设置。</p>
                  {profileError && <p role="alert" className="rounded border border-danger-fg/20 bg-danger-fg/5 px-2 py-1.5 text-[11px] text-danger-fg">{profileError}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted">生成目标内容</label>
                  <div className="grid grid-cols-2 gap-1.5 text-xs font-medium">
                    {[
                      { id: 'shot' as const, label: '配图描述' },
                      { id: 'continue-chat' as const, label: '续写对话' },
                      { id: 'moment' as const, label: '朋友圈文案' },
                      { id: 'stage' as const, label: '本幕对话与动态' },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setCopilotGenType(t.id)}
                        className={`py-1.5 px-2 rounded-lg border text-left transition-all cursor-pointer text-[11px] font-semibold ${
                          copilotGenType === t.id
                            ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/30 shadow-2xs'
                            : 'border-border-default bg-surface hover:bg-surface-muted text-muted hover:text-ink'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 段落 ②：提交给文本任务的提示词 */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-accent uppercase tracking-wider flex items-center gap-1">
                    <Send className="h-3 w-3" />
                    提示词工作台 (Prompt)
                  </span>
                  <span className="text-[10px] text-muted">将真实交付模型</span>
                </div>

                {/* 用户创作意图 Prompt 输入框 */}
              <div className="space-y-1">
                  <Textarea
                    value={copilotUserPrompt}
                    onChange={(e) => setCopilotUserPrompt(e.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault();
                        if (appLlmStatus?.text?.ready && activeProfile && stages.length && !profileSaving && !preparingGeneration && !generation.running && !generation.starting) {
                          void handleCopilotGenerate();
                        }
                      }
                    }}
                    placeholder="补充本次写作的事件、情绪或风格要求…"
                    rows={3}
                    className="text-xs font-medium text-ink bg-surface-muted/40 focus:bg-surface leading-relaxed rounded-lg"
                  />
                </div>

                {/* 阶段上下文目标 */}
                {effectiveStage && (
                  <div className="p-2 rounded-lg bg-surface-muted/50 border border-border-subtle text-[11px] space-y-1">
                    <div className="font-semibold text-ink flex items-center justify-between">
                      <span>阶段目标</span>
                      <span className="text-muted font-mono">
                        第 {stages.findIndex((s) => s.id === effectiveStage.id) + 1} 幕
                      </span>
                    </div>
                    <p className="text-muted truncate" title={effectiveStage.instruction}>
                      {effectiveStage.instruction || '未填写阶段行动要求'}
                    </p>
                  </div>
                )}

                <p className="rounded-lg border border-border-subtle bg-surface-muted/40 p-2 text-[11px] leading-relaxed text-muted">
                  此处指令会随本次文本任务提交；阶段主旨和系统提示词微调在阶段设置中编辑。
                </p>
              </div>

              {/* 段落 ③：生成执行按钮 */}
              <div className="pt-1">
                <Button
                  size="sm"
                  onClick={() => void handleCopilotGenerate()}
                  disabled={preparingGeneration || generation.running || generation.starting || !appLlmStatus?.text?.ready || !activeProfile || profileSaving || stages.length === 0}
                  className="w-full h-8 text-xs bg-accent text-white hover:bg-accent-dark font-bold flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{preparingGeneration ? '正在准备…' : generation.running ? '正在生成…' : generation.starting ? '正在提交…' : '生成候选'}</span>
                </Button>
                {copilotError && <p role="alert" className="mt-2 text-[11px] text-danger-fg">{copilotError}</p>}
                {generation.errorMsg && <p role="alert" className="mt-2 text-[11px] text-danger-fg">{generation.errorMsg}</p>}
                {generation.failed && <p role="alert" className="mt-2 text-[11px] text-danger-fg">{generation.job?.errorMessage || '生成任务失败，可调整要求后重试。'}</p>}
                {generation.queryError && <p role="alert" className="mt-2 text-[11px] text-danger-fg">读取当前任务失败：{generation.queryError}</p>}
                <Button type="button" variant="outline" size="sm" className="mt-2 w-full h-8 text-xs"
                  disabled={!stages.length || !appLlmStatus?.text?.ready || profileSaving || preparingGeneration || generation.running || generation.starting}
                  onClick={() => { setGenerationStageId(effectiveStageId); setGenerationModalOpen(true); }}>
                  高级生成：整场规划与局部重写
                </Button>
              </div>

              {/* 候选采纳区 (替代原来的行内候选面板) */}
              <div className="space-y-2 pt-2 border-t border-border-subtle">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted">
                    待采纳候选 ({generation.candidates.length})
                  </span>
                  {generation.candidates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateCurrentJobId(null)}
                      className="text-[11px] text-accent hover:underline cursor-pointer"
                    >
                      收起候选
                    </button>
                  )}
                </div>

                {generation.candidates.length === 0 ? (
                  <div className="p-4 rounded-[var(--radius-control)] border border-dashed border-border-control text-center text-muted text-xs">
                    暂无待处理候选
                  </div>
                ) : (
                  <div className="space-y-2">
                    {generation.candidates.map((cand) => {
                      const payload = cand.payload as Record<string, unknown> & {
                        messages?: Array<{ text?: string; speakerActorId?: string }>;
                        posts?: Array<{ text?: string; authorActorId?: string }>;
                      };
                      const nameOf = (actorId?: string) =>
                        actors.find((a) => a.id === actorId)?.displayName || actorId || '角色';
                      const lines = [
                        ...(payload.messages || []).map((m) => `${nameOf(m.speakerActorId)}: ${m.text || ''}`),
                        ...(payload.posts || []).map((p) => `${nameOf(p.authorActorId)}（动态）: ${p.text || ''}`),
                      ];
                      const modeLabels: Record<string, string> = {
                        plan: '阶段规划', 'whole-text': '整场生成',
                        'rewrite-records': '局部重写', invite: '邀请文案', wish: '生日祝福',
                        moment: '朋友圈文案', shot: '配图描述', 'continue-chat': '续写对话',
                        stage: '本幕对话与动态',
                      };
                      const stageTitles = Array.isArray(payload.stages)
                        ? (payload.stages as Array<{ title?: string }>).map((item) => item.title).filter(Boolean).slice(0, 3)
                        : [];
                      const overview = typeof payload.overview === 'string' ? payload.overview
                        : typeof payload.summary === 'string' ? payload.summary : '';

                      return (
                        <div
                          key={cand.id}
                          className="p-3 rounded-[var(--radius-control)] bg-purple-500/5 border border-purple-500/20 space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between text-[11px] text-purple-700 font-semibold">
                            <span>{modeLabels[generation.job?.mode || ''] || '文本候选'}</span>
                          </div>
                          <div className="text-ink text-xs space-y-1 max-h-36 overflow-y-auto leading-relaxed">
                            {overview ? (
                              <div className="bg-surface/80 p-1.5 rounded whitespace-pre-wrap break-words">{overview}</div>
                            ) : lines.length > 0 ? (
                              lines.map((l, idx) => (
                                <div key={idx} className="bg-surface/80 p-1.5 rounded text-[11px]">
                                  {l}
                                </div>
                              ))
                            ) : stageTitles.length > 0 ? (
                              <div className="bg-surface/80 p-1.5 rounded">阶段：{stageTitles.join('、')}</div>
                            ) : (
                              <p className="text-muted">新生成候选内容</p>
                            )}
                          </div>
                          <Button type="button" size="sm" variant="outline" className="w-full"
                            onClick={() => setReviewCandidateId(cand.id)}>
                            审阅此候选
                          </Button>
                        </div>
                      );
                    })}
                    {reviewCandidateId && generation.candidates.some((candidate) => candidate.id === reviewCandidateId) && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-ink">
                          <span>候选差异审阅</span>
                          <button type="button" className="text-muted hover:text-ink" onClick={() => setReviewCandidateId(null)}>关闭</button>
                        </div>
                        <CandidateReviewPanel
                          key={reviewCandidateId}
                          activityId={activityId}
                          candidateId={reviewCandidateId}
                          onApplied={() => {
                            setReviewCandidateId(null);
                            void refetchActivity();
                            void refetchDraft();
                            updateCurrentJobId(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {currentStep === 'script' && (
              <div className="p-3 border-t border-border-subtle text-[10px] text-muted text-center">
                在提示词输入框内按 Ctrl/⌘ + Enter 可生成；候选需先审阅再采用。
              </div>
            )}
          </aside>
        )}

      </div>

      {/* 模态框与抽屉 */}
      <ResponsiveEditOverlay
        open={activityBasicsOpen}
        onOpenChange={(open) => { if (open) setActivityBasicsOpen(true); else requestCloseActivityBasics(); }}
        title="编辑活动资料"
        description="修改将保存到活动草稿；日期会同步用于角色日历。"
        footer={<><Button type="button" variant="outline" onClick={requestCloseActivityBasics}>取消</Button><Button type="button" disabled={!activityBasicsDraft.title.trim()} onClick={() => void saveActivityBasics()}>保存资料</Button></>}
      >
        <div className="space-y-5">
          <FormField label="活动标题" required>
            <Input value={activityBasicsDraft.title} onChange={(event) => setActivityBasicsDraft((value) => ({ ...value, title: event.target.value }))} maxLength={120} />
          </FormField>
          <ShortFieldGrid>
            <FormField label="活动主题"><Input value={activityBasicsDraft.theme} onChange={(event) => setActivityBasicsDraft((value) => ({ ...value, theme: event.target.value }))} /></FormField>
            <FormField label="活动地点"><Input value={activityBasicsDraft.location} onChange={(event) => setActivityBasicsDraft((value) => ({ ...value, location: event.target.value }))} /></FormField>
          </ShortFieldGrid>
          <FormField label="活动日期" hint="可留空；填写后会同步到角色日历。">
            <Input type="date" value={activityBasicsDraft.scheduledDate} onChange={(event) => setActivityBasicsDraft((value) => ({ ...value, scheduledDate: event.target.value }))} />
          </FormField>
          {(activityBasicsError || draft.error) && <Alert variant="danger" title="资料尚未保存">{activityBasicsError || draft.error}</Alert>}
        </div>
      </ResponsiveEditOverlay>
      <ConfirmDialog
        open={activityBasicsDiscardOpen}
        onOpenChange={setActivityBasicsDiscardOpen}
        title="放弃活动资料修改？"
        description="当前弹窗中的临时修改尚未保存，关闭后将丢弃这些修改。"
        cancelLabel="继续编辑"
        confirmLabel="放弃修改"
        onConfirm={() => { setActivityBasicsOpen(false); setActivityBasicsError(''); }}
      />

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

      {generationModalOpen && (
        <GenerationModal
          open={generationModalOpen}
          onOpenChange={setGenerationModalOpen}
          activity={activity}
          document={document}
          stages={stages}
          currentStageId={effectiveGenerationStageId}
          jobId={generation.jobId}
          onJobIdChange={updateCurrentJobId}
          onBeforeGenerate={() => draft.flush()}
          job={generation.job || null}
          candidates={generation.candidates}
          starting={generation.starting}
          startError={generation.errorMsg}
          onStartGeneration={generation.start}
          onReviewCandidate={(candidateId) => {
            setReviewCandidateId(candidateId);
            changeCopilotOpen(true);
            setGenerationModalOpen(false);
          }}
          canGenerate={Boolean(appLlmStatus?.text?.ready && activeProfile && stages.length && !profileSaving && !generation.running && !generation.starting)}
        />
      )}

      <HistoryDrawer
        open={historyDrawerOpen}
        onOpenChange={setHistoryDrawerOpen}
        activity={activity}
        onRestored={() => {
          refetchActivity();
          refetchDraft();
        }}
      />

      <ReworkPanel
        open={reworkOpen}
        onOpenChange={setReworkOpen}
        activityId={activityId}
        headVersion={activity.headVersion}
        document={document}
        onSaved={() => {
          void refetchActivity();
        }}
      />

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

      {presetsModalOpen && document && (
        <ActivityPresetsModal
          isOpen={presetsModalOpen}
          onClose={() => setPresetsModalOpen(false)}
          activity={activity}
          document={document}
        />
      )}

      {/* 挑选头像与立绘对话框 */}
      {assetPickerActor && (
        <ActorAssetPickerDialog
          actor={assetPickerActor}
          open={!!assetPickerActor}
          onOpenChange={(open) => {
            if (!open) setAssetPickerActor(null);
          }}
          onConfirm={(payload) => {
            if (!document) return;
            handleUpdateDocument({
              ...document,
              actors: actors.map((a) =>
                a.id === assetPickerActor.id
                  ? {
                      ...a,
                      ...(payload.avatarAssetId ? { avatarAssetId: payload.avatarAssetId, avatarUrl: payload.avatarUrl } : {}),
                      ...(payload.portraitAssetId ? { portraitAssetId: payload.portraitAssetId, portraitUrl: payload.portraitUrl } : {}),
                    }
                  : a
              ),
            });
            setAssetPickerActor(null);
          }}
        />
      )}
    </div>
  );
}
