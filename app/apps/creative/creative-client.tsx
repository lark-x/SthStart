'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { RefreshCw, Sparkles, ImagePlus } from 'lucide-react';
import type { ArtifactDescriptor, CreativeTaskResponse, ImageConfiguration } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { SplitPanes } from '@/app/components/shared/split-panes';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { useToast } from '@/app/providers/ui-provider';
import {
  cancelCreativeTask,
  createCreativeTask,
  deleteCreativeArtifact,
  pinCreativeArtifact,
  retryCreativeTask,
  type CreativeTaskInput,
  uploadCreativeImage,
} from '@/app/features/creative/api';
import { useCreativeArtifacts, useCreativeGenerationOptions, useCreativeStatus, useCreativeTaskPages } from '@/app/features/creative/queries';
import {
  creativeImageAccept,
  creativeImageAllowed,
  creativeInputMaxBytes,
  formatByteLimit,
  EMPTY_CREATIVE_FORM,
  type CreativeFormState,
  type CreativeMode,
} from '@/app/features/creative/types';
import { useGenerationEvents } from '@/app/features/creative/events';
import { CreativeStatusCard } from '@/app/features/creative/components/status-card';
import { ImageGenerationPanel, type ImageGenerationInitial } from '@/app/features/generation/components/image-generation-panel';
import { ArtifactPicker } from '@/app/features/creative/components/artifact-picker';
import { VideoGenerator } from '@/app/features/creative/components/video-generator';
import { ImageResultPreview } from '@/app/features/creative/components/image-result-preview';
import { TaskList } from '@/app/features/creative/components/task-list';
import { MediaGallery } from '@/app/features/creative/components/media-gallery';
import { creativeKeys } from '@/app/lib/query-keys';
import { createActionLock } from './action-lock';

const IMAGE_TABS = [
  { value: 'text-to-image' as const, label: '文本生图', Icon: Sparkles },
  { value: 'image-to-image' as const, label: '图生图', Icon: ImagePlus },
];

type CreativeArtifactsPage = {
  items: ArtifactDescriptor[];
  total: number;
  nextOffset: number;
};

export function CreativeClient() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const statusQuery = useCreativeStatus();
  const optionsQuery = useCreativeGenerationOptions();
  const tasksQuery = useCreativeTaskPages();
  const artifactsQuery = useCreativeArtifacts();
  const [mode, setMode] = useState<CreativeMode>('text-to-image');
  const [form, setForm] = useState<CreativeFormState>(EMPTY_CREATIVE_FORM);
  const [resultView, setResultView] = useState<'media' | 'tasks'>('media');
  const [sourceArtifact, setSourceArtifact] = useState<ArtifactDescriptor | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [lastFrameArtifact, setLastFrameArtifact] = useState<ArtifactDescriptor | null>(null);
  const [lastFramePreview, setLastFramePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLock] = useState(createActionLock);
  const [taskActionCount, setTaskActionCount] = useState(0);
  const [pageError, setPageError] = useState('');
  const serviceDetailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const details = serviceDetailsRef.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape' || event.isComposing) return;
        details.open = false;
        details.querySelector('summary')?.focus();
      } else if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, []);

  // ── 预设选择（规划 §10.1）：工作流选择 → 预设选择；表单随选择变化。 ──
  const imageOptions = mode === 'text-to-image' || mode === 'image-to-image'
    ? optionsQuery.data?.purposes.find((item) => item.purpose === mode)
    : undefined;
  const [selectedImageConfiguration, setSelectedImageConfiguration] = useState<ImageConfiguration>();
  const [imageInitial, setImageInitial] = useState<ImageGenerationInitial | null>(null);
  const [mobilePane, setMobilePane] = useState<'configuration' | 'results'>('configuration');
  // 上传是异步的，完成回填前必须确认模式没有变化，否则图生图的参考图
  // 会以幽灵状态残留进文生图模式，导致后续提交被服务端拒绝且无法移除。
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const lastProgressSyncRef = useRef(0);

  useEffect(() => () => {
    if (sourcePreview?.startsWith('blob:')) URL.revokeObjectURL(sourcePreview);
  }, [sourcePreview]);
  useEffect(() => () => {
    if (lastFramePreview?.startsWith('blob:')) URL.revokeObjectURL(lastFramePreview);
  }, [lastFramePreview]);

  const tasks = useMemo(() => {
    const seen = new Set<string>();
    return (tasksQuery.data?.pages.flatMap(page => page.items) ?? []).filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)));
  }, [tasksQuery.data]);
  // 媒体库是 created_at DESC + OFFSET 分页：上传/删除/10s 轮询都会移动偏移
  // 基准，先加载的旧页与按新序位取到的下一页可能重叠，按 id 去重避免
  // 重复卡片与重复 React key。
  const artifacts = useMemo(() => {
    const seen = new Set<string>();
    const items: ArtifactDescriptor[] = [];
    for (const page of artifactsQuery.data?.pages ?? []) {
      for (const artifact of page.items) {
        if (seen.has(artifact.id)) continue;
        seen.add(artifact.id);
        items.push(artifact);
      }
    }
    return items;
  }, [artifactsQuery.data]);
  const artifactsTotal = artifactsQuery.data?.pages[0]?.total ?? 0;
  const binding = statusQuery.data?.modes[
    mode === 'text-to-image' ? 'textToImage'
    : mode === 'image-to-image' ? 'imageToImage'
    : mode === 'h3-t2v' ? 'h3T2v'
    : mode === 'h3-i2v' ? 'h3I2v'
    : 'h3Fl2va'
  ];
  const imageReferenceKey = selectedImageConfiguration?.referenceInputKey ?? 'sourceImage';
  const referenceBinding = selectedImageConfiguration ? { ...binding, inputCapabilities: selectedImageConfiguration.inputCapabilities } as typeof binding : binding;
  const ready = Boolean(binding?.ready);
  const serviceError = statusQuery.error ?? optionsQuery.error ?? tasksQuery.error ?? artifactsQuery.error;
  const sortedTasks = useMemo(() => tasks.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [tasks]);
  const isVideoMode = mode.startsWith('h3-');
  const videoTabs = [
    { value: 'h3-t2v' as const, label: '文生视频', Icon: Sparkles },
    { value: 'h3-i2v' as const, label: '图生视频', Icon: ImagePlus },
    { value: 'h3-fl2va' as const, label: '首尾帧视频', Icon: ImagePlus },
  ];

  useGenerationEvents((event) => {
    if (event.appId !== 'creative-center') return;
    // 生成期间的 progress 事件可能每秒多条，节流到 3 秒一次，
    // 避免全量任务列表被高频重取；2s 轮询兜底保证最终一致。
    if (event.eventType === 'progress') {
      const now = Date.now();
      if (now - lastProgressSyncRef.current < 3_000) return;
      lastProgressSyncRef.current = now;
    }
    void queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
    if (event.eventType === 'succeeded' || event.eventType === 'failed' || event.eventType === 'abandoned') {
      void queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
    }
  });

  const updateForm = (key: keyof CreativeFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const handleModeChange = (nextMode: CreativeMode) => {
    setMode(nextMode);
    setImageInitial(null);
    setSelectedImageConfiguration(undefined);
    setPageError('');
    if (nextMode === 'text-to-image' || nextMode === 'h3-t2v') {
      setSourceArtifact(null);
      setSourcePreview(null);
    }
    if (nextMode === 'text-to-image' || nextMode === 'image-to-image' || nextMode === 'h3-t2v' || nextMode === 'h3-i2v') {
      setLastFrameArtifact(null);
      setLastFramePreview(null);
    }
  };

  const handleFrameUpload = async (file: File | undefined, target: 'first' | 'last') => {
    if (!file) return;
    const inputKey = target === 'last' ? 'lastFrame' : mode === 'image-to-image' ? imageReferenceKey : 'firstFrame';
    const maxBytes = creativeInputMaxBytes(mode === 'image-to-image' ? referenceBinding : binding, inputKey);
    if (!creativeImageAllowed(mode === 'image-to-image' ? referenceBinding : binding, inputKey, file.type)) {
      setPageError('当前工作流不接受这种图片格式，请按输入框提示选择文件。');
      return;
    }
    if (file.size > maxBytes) {
      setPageError(`参考图片不能超过 ${formatByteLimit(maxBytes)}。`);
      return;
    }
    setPageError('');
    setUploading(true);
    const requestedMode = mode;
    const previewUrl = URL.createObjectURL(file);
    try {
      const artifact = await uploadCreativeImage(file);
      if (modeRef.current !== requestedMode) {
        URL.revokeObjectURL(previewUrl);
        toast.info('图片已加入媒体库', '但生成模式已切换，未用作本次参考图。');
        return;
      }
      if (target === 'first') {
        setSourcePreview(previewUrl);
        setSourceArtifact(artifact);
      } else {
        setLastFramePreview(previewUrl);
        setLastFrameArtifact(artifact);
      }
      await queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
      toast.success(isVideoMode ? `${target === 'first' ? '首帧' : '尾帧'}图片已加入媒体库` : '参考图片已加入媒体库');
    } catch (err) {
      URL.revokeObjectURL(previewUrl);
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async () => {
    if (submitting || uploading) return;
    setPageError('');
    if (!form.prompt.trim()) {
      setPageError('请先写下提示词。');
      return;
    }
    if (!ready) {
      setPageError('当前模式还没有可用的公共生成工作流，请先完成生成配置。');
      return;
    }
    if ((mode === 'image-to-image' || mode === 'h3-i2v' || mode === 'h3-fl2va') && !sourceArtifact) {
      setPageError(mode === 'image-to-image' ? '图生图需要先上传参考图片。' : '图生视频需要先上传首帧图片。');
      return;
    }
    if (mode === 'h3-fl2va' && !lastFrameArtifact) {
      setPageError('首尾帧视频需要同时上传尾帧图片。');
      return;
    }
    const duration = Number(form.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      setPageError('请填写有效的视频时长。');
      return;
    }
    if (!actionLock.acquire('create')) return;
    setSubmitting(true);
    try {
      const payload: CreativeTaskInput = {
        mode: mode as 'h3-t2v' | 'h3-i2v' | 'h3-fl2va',
        prompt: form.prompt.trim(), duration, aspectRatio: form.aspectRatio.trim() || '16:9',
        seed: form.seed.trim() ? Number(form.seed) : null,
        firstFrameId: sourceArtifact?.id, lastFrameId: lastFrameArtifact?.id,
      };
      await createCreativeTask(payload);
      setResultView('tasks');
      toast.success('创作任务已提交，将在后台执行');
      void statusQuery.refetch();
      void tasksQuery.refetch();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      actionLock.release('create');
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!actionLock.acquire('task:' + id)) return;
    setTaskActionCount(count => count + 1);
    try {
      await cancelCreativeTask(id);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
      toast.success('已请求取消任务');
    } catch (error) {
      toast.error('取消任务失败', error instanceof Error ? error.message : String(error));
    } finally {
      actionLock.release('task:' + id);
      setTaskActionCount(count => count - 1);
    }
  };

  const handleRetry = async (id: string) => {
    if (!actionLock.acquire('task:' + id)) return;
    setTaskActionCount(count => count + 1);
    try {
      await retryCreativeTask(id);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
      toast.success('已创建重试任务');
    } catch (error) {
      toast.error('重试任务失败', error instanceof Error ? error.message : String(error));
    } finally {
      actionLock.release('task:' + id);
      setTaskActionCount(count => count - 1);
    }
  };

  const handleReplay = (task: CreativeTaskResponse) => {
    const values = task.replay.inputs;
    setMode(task.replay.mode);
    if (!task.replay.mode.startsWith('h3-')) {
      setImageInitial({ presetId: task.replay.presetId ?? undefined, parameters: values, seed: task.actualSeed });
      setMobilePane('configuration');
    }
    setForm({
      prompt: String(values.prompt ?? ''),
      negativePrompt: String(values.negativePrompt ?? ''),
      width: String(values.width ?? 1024),
      height: String(values.height ?? 1024),
      steps: String(values.steps ?? 20),
      duration: String(values.duration ?? 4),
      aspectRatio: String(values.aspectRatio ?? '16:9'),
      seed: task.actualSeed == null ? '' : String(task.actualSeed),
    });
    const sourceId = task.replay.inputArtifactIds[0];
    const lastId = task.replay.inputArtifactIds[1];
    // 素材可能不在当前已加载分页中：找不到时用 sourceId 直接构造
    // portal 代理 URL 兜底预览，并保留 id 供提交时传递，避免静默丢失。
    const sourceArtifactItem = sourceId ? artifacts.find((item) => item.id === sourceId) : undefined;
    setSourceArtifact(sourceArtifactItem ?? (sourceId ? { id: sourceId } as unknown as ArtifactDescriptor : null));
    setSourcePreview(sourceArtifactItem?.url ?? (sourceId ? `/api/admin/creative/artifacts/${encodeURIComponent(sourceId)}` : null));
    const lastFrameItem = lastId ? artifacts.find((item) => item.id === lastId) : undefined;
    setLastFrameArtifact(lastFrameItem ?? (lastId ? { id: lastId } as unknown as ArtifactDescriptor : null));
    setLastFramePreview(lastFrameItem?.url ?? (lastId ? `/api/admin/creative/artifacts/${encodeURIComponent(lastId)}` : null));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast.info('已载入任务参数', '你可以修改提示词后再次生成。');
  };

  const handlePin = async (artifact: ArtifactDescriptor) => {
    try {
      await pinCreativeArtifact(artifact.id, !artifact.pinned);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
      toast.success(artifact.pinned ? '已取消固定' : '已固定到媒体库');
    } catch (error) {
      toast.error('更新固定状态失败', error instanceof Error ? error.message : String(error));
    }
  };

  const handleDelete = async (artifact: ArtifactDescriptor) => {
    if (!window.confirm(`确定删除“${artifact.originalName ?? '这个作品'}”吗？`)) return;
    try {
      await deleteCreativeArtifact(artifact.id);
      // 无限查询的已加载分页不会因失效而立刻重取，先乐观移除避免
      // 删除后作品仍停留在媒体库里；随后的失效会与服务端真值对齐。
      queryClient.setQueryData<InfiniteData<CreativeArtifactsPage>>(creativeKeys.artifacts(), (current) => current ? {
        ...current,
        pages: current.pages.map((page, index) => ({
          ...page,
          total: index === 0 ? Math.max(0, page.total - 1) : page.total,
          items: page.items.filter((item) => item.id !== artifact.id),
        })),
      } : current);
      // 任务卡的缩略图直接引用产物 URL，删除后同步失效任务缓存，
      // 否则最多 10s 内任务卡仍渲染已 404 的图片。
      void queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
      void queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
      toast.success('作品已删除');
    } catch (error) {
      toast.error('删除失败', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <PageContainer className="space-y-4 py-4 sm:space-y-5 sm:py-6">
      <PageHeader
        compact
        title="自由生成"
        description="独立尝试画面与视频创意。生成结果可在媒体库中加入创作项目。"
        actions={
          <div className="flex items-center gap-3">
            <details ref={serviceDetailsRef} className="relative text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-muted">
                <span className={`h-2 w-2 rounded-full ${ready ? 'bg-success' : 'bg-warning'}`} />
                服务{ready ? '已就绪' : '待配置'}
              </summary>
              <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[80vw] rounded-panel border border-border-subtle bg-surface p-4 shadow-floating">
                <CreativeStatusCard status={statusQuery.data} onRefresh={() => void statusQuery.refetch()} />
                {!ready && <a href="/settings/generation" className="mt-3 inline-block text-sm text-accent underline">前往生成设置</a>}
              </div>
            </details>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void statusQuery.refetch();
              void optionsQuery.refetch();
              void tasksQuery.refetch();
              void artifactsQuery.refetch();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            刷新
          </Button>
          </div>
        }
      />

      {(pageError || serviceError) && (
        <Alert
          variant="danger"
          title={pageError ? '图像工坊操作未完成' : '图像工坊暂时无法完成操作'}
          onDismiss={pageError ? () => setPageError('') : undefined}
        >
          {pageError || (serviceError instanceof Error ? serviceError.message : String(serviceError))}
        </Alert>
      )}

      {/* 紧凑任务状态与视口切换工具栏 */}
      <div className="xl:hidden">
        {/* 移动端两栏切换 */}
        <div className="flex items-center gap-1 xl:hidden bg-surface-sunken p-0.5 rounded-control border border-border-subtle" role="group" aria-label="生图工作区分栏">
          <button
            type="button"
            aria-pressed={mobilePane === 'configuration'}
            onClick={() => setMobilePane('configuration')}
            className={`px-2.5 py-1 rounded-[calc(var(--radius-control)-2px)] text-xs font-medium transition-colors ${
              mobilePane === 'configuration'
                ? 'bg-surface text-ink font-semibold shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
          >
            参数配置
          </button>
          <button
            type="button"
            aria-pressed={mobilePane === 'results'}
            onClick={() => setMobilePane('results')}
            className={`px-2.5 py-1 rounded-[calc(var(--radius-control)-2px)] text-xs font-medium transition-colors ${
              mobilePane === 'results'
                ? 'bg-surface text-ink font-semibold shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
          >
            作品 / 任务
          </button>
        </div>
      </div>

      <PageTabs
        ariaLabel="生成模式"
        value={mode}
        onChange={(id) => handleModeChange(id as CreativeMode)}
        className="flex-nowrap overflow-x-auto"
        tabs={[...IMAGE_TABS, ...videoTabs].map(({ value, label, Icon }) => ({
          id: value,
          panelId: `creative-panel-${value}`,
          label: <><Icon className="h-4 w-4" aria-hidden="true" />{label}</>,
        }))}
      />
      <SplitPanes
        resizable
        storageKey="sthstart_creative_split"
        defaultSplitRatio={0.4}
        minLeftWidth={360}
        minRightWidth={360}
        leftClassName={`${!isVideoMode ? 'creative-configuration' : ''} ${mobilePane === 'configuration' ? '' : 'hidden xl:block'}`}
        rightClassName={mobilePane === 'results' ? '' : 'hidden xl:block'}
        className="creative-split gap-6 xl:grid-cols-[minmax(360px,2fr)_minmax(0,3fr)]"
        from="xl"
        labels={{ left: '生成参数', right: '生成结果' }}
        left={
          <div id={`creative-panel-${mode}`} role="tabpanel" aria-label="生成参数">
            {isVideoMode ? (
              <VideoGenerator
                form={form}
                mode={mode as 'h3-t2v' | 'h3-i2v' | 'h3-fl2va'}
                binding={binding}
                firstFrameArtifact={sourceArtifact}
                firstFramePreview={sourcePreview}
                lastFrameArtifact={lastFrameArtifact}
                lastFramePreview={lastFramePreview}
                uploading={uploading}
                submitting={submitting}
                onFormChange={updateForm}
                onSubmit={() => {
                  void handleCreate();
                }}
                onFirstFrameSelect={(file) => {
                  void handleFrameUpload(file, 'first');
                }}
                onFirstFrameRemove={() => {
                  setSourceArtifact(null);
                  setSourcePreview(null);
                }}
                onLastFrameSelect={(file) => {
                  void handleFrameUpload(file, 'last');
                }}
                onLastFrameRemove={() => {
                  setLastFrameArtifact(null);
                  setLastFramePreview(null);
                }}
              />
            ) : (
              <ImageGenerationPanel
                key={mode}
                appId="creative-center"
                purpose={mode}
                contextKey={`creative:${mode}`}
                onConfigurationChange={setSelectedImageConfiguration}
                options={imageOptions}
                loading={optionsQuery.isLoading}
                initial={imageInitial}
                onRefresh={() => {
                  void optionsQuery.refetch();
                }}
                blockedReason={
                  uploading
                    ? '参考图片正在上传…'
                    : mode === 'image-to-image' && !sourceArtifact
                    ? '请先添加参考图片。'
                    : mode === 'image-to-image' &&
                      sourceArtifact &&
                      (!creativeImageAllowed(referenceBinding, imageReferenceKey, sourceArtifact.contentType ?? '') ||
                        sourceArtifact.byteSize > creativeInputMaxBytes(referenceBinding, imageReferenceKey))
                    ? '现有参考图片不符合所选方案的格式或大小限制，请重新选择。'
                    : undefined
                }
                referenceInput={
                  mode === 'image-to-image' ? (
                    <ArtifactPicker
                      id="creative-source"
                      label="参考图片"
                      hint={`最大 ${formatByteLimit(
                        creativeInputMaxBytes(referenceBinding, imageReferenceKey)
                      )}；保持主体描述与参考图一致。`}
                      accept={creativeImageAccept(referenceBinding, imageReferenceKey)}
                      artifact={sourceArtifact}
                      previewUrl={sourcePreview}
                      uploading={uploading}
                      onSelect={(file) => {
                        void handleFrameUpload(file, 'first');
                      }}
                      onRemove={() => {
                        setSourceArtifact(null);
                        setSourcePreview(null);
                      }}
                    />
                  ) : undefined
                }
                onGenerate={async (input) => {
                  const { parameters, ...selection } = input;
                  await createCreativeTask({
                    mode: mode as 'text-to-image' | 'image-to-image',
                    ...selection,
                    parameters,
                    ...(mode === 'image-to-image' && sourceArtifact ? { sourceArtifactId: sourceArtifact.id } : {}),
                  });
                  setResultView('tasks');
                  setMobilePane('results');
                  toast.success('图片任务已提交');
                  void tasksQuery.refetch();
                  void statusQuery.refetch();
                }}
              />
            )}
          </div>
        }
        right={
          <div className="min-w-0 space-y-5">
            {!isVideoMode && sortedTasks.some(task => !task.replay.mode.startsWith('h3-') && task.artifacts.some(item => item.mediaKind === 'image')) && (
              <ImageResultPreview
                tasks={sortedTasks.filter((task) => !task.replay.mode.startsWith('h3-'))}
                onReplay={handleReplay}
              />
            )}
            <PageTabs ariaLabel="创作结果视图" value={resultView} onChange={value => setResultView(value as 'media' | 'tasks')} tabs={[
              { id: 'media', label: '媒体库', count: artifactsTotal, panelId: 'creative-results-media' },
              { id: 'tasks', label: '生成任务', count: sortedTasks.length, panelId: 'creative-results-tasks' },
            ]} />
            <div id={`creative-results-${resultView}`} role="tabpanel" aria-label={resultView === 'media' ? '媒体库' : '生成任务'}>
            {resultView === 'media' && artifactsQuery.isError && <div role="alert" className="space-y-2 text-sm text-danger-fg"><p>媒体读取失败，已有结果会保留。</p><Button variant="outline" disabled={artifactsQuery.isFetching} onClick={() => { if (artifactsQuery.isFetchNextPageError) void artifactsQuery.fetchNextPage(); else void artifactsQuery.refetch(); }}>重新读取媒体</Button></div>}
            {resultView === 'tasks' && tasksQuery.isError && <div role="alert" className="space-y-2 text-sm text-danger-fg"><p>任务读取失败，无法确认当前任务状态。</p><Button variant="outline" disabled={tasksQuery.isFetching} onClick={() => void tasksQuery.refetch()}>重新读取任务</Button></div>}
            {resultView === 'media' ? (artifactsQuery.isError && !artifactsQuery.data ? null :
              <MediaGallery
                artifacts={artifacts}
                total={artifactsTotal}
                isLoading={artifactsQuery.isLoading}
                hasMore={Boolean(artifactsQuery.hasNextPage)}
                isLoadingMore={artifactsQuery.isFetchingNextPage}
                onLoadMore={() => {
                  if (!artifactsQuery.isFetching && artifactsQuery.hasNextPage) void artifactsQuery.fetchNextPage();
                }}
                onPin={handlePin}
                onDelete={handleDelete}
              />
            ) : (tasksQuery.isError && !tasksQuery.data ? null :
              <fieldset disabled={taskActionCount > 0} aria-busy={taskActionCount > 0} className="min-w-0">
              <legend className="sr-only">生成任务操作</legend>
              {taskActionCount > 0 && <p role="status" className="text-sm text-muted">正在处理任务操作…</p>}
              <TaskList
                tasks={sortedTasks}
                isLoading={tasksQuery.isLoading}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onReplay={handleReplay}
              />
              </fieldset>
            )}
            {resultView === 'tasks' && tasksQuery.hasNextPage && <Button variant="outline" disabled={tasksQuery.isFetching} onClick={() => { if (!tasksQuery.isFetching) void tasksQuery.fetchNextPage(); }}>{tasksQuery.isFetchingNextPage ? '正在加载…' : tasksQuery.isFetchNextPageError ? '重试加载更多任务' : '加载更多任务'}</Button>}
            {resultView === 'tasks' && tasks.length > 0 && !tasksQuery.hasNextPage && !tasksQuery.isFetching && !tasksQuery.isError && <p role="status" className="text-sm text-muted">已显示全部任务</p>}
            </div>
          </div>
        }
      />
    </PageContainer>
  );
}
