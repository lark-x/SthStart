'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Sparkles, ImagePlus } from 'lucide-react';
import type { ArtifactDescriptor, CreativeTaskResponse } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { PageHeader } from '@/app/components/shared/page-header';
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
import { useCreativeArtifacts, useCreativeStatus, useCreativeTasks } from '@/app/features/creative/queries';
import {
  creativeImageAllowed,
  creativeInputMaxBytes,
  formatByteLimit,
  EMPTY_CREATIVE_FORM,
  type CreativeFormState,
  type CreativeMode,
} from '@/app/features/creative/types';
import { useGenerationEvents } from '@/app/features/creative/events';
import { CreativeStatusCard } from '@/app/features/creative/components/status-card';
import { ImageGenerator } from '@/app/features/creative/components/image-generator';
import { VideoGenerator } from '@/app/features/creative/components/video-generator';
import { TaskList } from '@/app/features/creative/components/task-list';
import { MediaGallery } from '@/app/features/creative/components/media-gallery';
import { creativeKeys } from '@/app/lib/query-keys';

const IMAGE_TABS = [
  { value: 'text-to-image' as const, label: '文本生图', Icon: Sparkles },
  { value: 'image-to-image' as const, label: '图生图', Icon: ImagePlus },
];

export function CreativeClient() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const statusQuery = useCreativeStatus();
  const tasksQuery = useCreativeTasks();
  const artifactsQuery = useCreativeArtifacts();
  const [mode, setMode] = useState<CreativeMode>('text-to-image');
  const [form, setForm] = useState<CreativeFormState>(EMPTY_CREATIVE_FORM);
  const [sourceArtifact, setSourceArtifact] = useState<ArtifactDescriptor | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [lastFrameArtifact, setLastFrameArtifact] = useState<ArtifactDescriptor | null>(null);
  const [lastFramePreview, setLastFramePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState('');
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

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const artifacts = useMemo(
    () => artifactsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [artifactsQuery.data]
  );
  const artifactsTotal = artifactsQuery.data?.pages[0]?.total ?? 0;
  const binding = statusQuery.data?.modes[
    mode === 'text-to-image' ? 'textToImage'
    : mode === 'image-to-image' ? 'imageToImage'
    : mode === 'h3-t2v' ? 'h3T2v'
    : mode === 'h3-i2v' ? 'h3I2v'
    : 'h3Fl2va'
  ];
  const ready = Boolean(binding?.ready);
  const serviceError = statusQuery.error ?? tasksQuery.error ?? artifactsQuery.error;
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
    const inputKey = target === 'last' ? 'lastFrame' : mode === 'image-to-image' ? 'sourceImage' : 'firstFrame';
    const maxBytes = creativeInputMaxBytes(binding, inputKey);
    if (!creativeImageAllowed(binding, inputKey, file.type)) {
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
    // 提交走 onClick 而非 form submit，输入框的 min/max 不会生效，这里补上基本校验。
    const width = Number(form.width);
    const height = Number(form.height);
    const steps = Number(form.steps);
    const duration = Number(form.duration);
    if (!isVideoMode && (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)) {
      setPageError('请填写有效的宽度和高度。');
      return;
    }
    if (!isVideoMode && (!Number.isFinite(steps) || steps <= 0)) {
      setPageError('请填写有效的采样步数。');
      return;
    }
    if (isVideoMode && (!Number.isFinite(duration) || duration <= 0)) {
      setPageError('请填写有效的视频时长。');
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreativeTaskInput = isVideoMode ? {
        mode,
        prompt: form.prompt.trim(),
        duration,
        aspectRatio: form.aspectRatio.trim() || '16:9',
        seed: form.seed.trim() ? Number(form.seed) : null,
        firstFrameId: sourceArtifact?.id,
        lastFrameId: lastFrameArtifact?.id,
      } : {
        mode: mode as 'text-to-image' | 'image-to-image',
        prompt: form.prompt.trim(),
        negativePrompt: form.negativePrompt.trim(),
        width,
        height,
        steps,
        seed: form.seed.trim() ? Number(form.seed) : null,
        // 上传竞态可能在文生图模式残留参考图状态；只有图生图才随请求发送。
        sourceArtifactId: mode === 'image-to-image' ? sourceArtifact?.id : undefined,
      };
      await createCreativeTask(payload);
      toast.success('创作任务已提交，将在后台执行');
      void statusQuery.refetch();
      void tasksQuery.refetch();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelCreativeTask(id);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
      toast.success('已请求取消任务');
    } catch (error) {
      toast.error('取消任务失败', error instanceof Error ? error.message : String(error));
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await retryCreativeTask(id);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
      toast.success('已创建重试任务');
    } catch (error) {
      toast.error('重试任务失败', error instanceof Error ? error.message : String(error));
    }
  };

  const handleReplay = (task: CreativeTaskResponse) => {
    const values = task.replay.inputs;
    setMode(task.replay.mode);
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
    setSourceArtifact(sourceId ? artifacts.find((item) => item.id === sourceId) ?? null : null);
    setSourcePreview(sourceId ? artifacts.find((item) => item.id === sourceId)?.url ?? null : null);
    setLastFrameArtifact(lastId ? artifacts.find((item) => item.id === lastId) ?? null : null);
    setLastFramePreview(lastId ? artifacts.find((item) => item.id === lastId)?.url ?? null : null);
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
      await queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
      // 任务卡的缩略图直接引用产物 URL，删除后同步失效任务缓存，
      // 否则最多 10s 内任务卡仍渲染已 404 的图片。
      void queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
      toast.success('作品已删除');
    } catch (error) {
      toast.error('删除失败', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#f4f0e7] px-4 py-6 text-[#18201d] sm:px-8 md:px-12">
      <div className="mx-auto max-w-7xl space-y-5">
        <PageHeader
          backHref="/"
          backLabel="返回门户首页"
          eyebrow="CREATIVE CENTER"
          title="创作中心"
          description="把提示词变成可复用的图片与视频素材。所有任务都通过 SthStart 公共生成核心执行并保存在本地媒体库。"
          actions={<Button size="sm" variant="outline" onClick={() => { void statusQuery.refetch(); void tasksQuery.refetch(); void artifactsQuery.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新</Button>}
        />
        {(pageError || serviceError) && (
          <Alert
            variant="danger"
            title={pageError ? '创作中心操作未完成' : '创作中心暂时无法完成操作'}
            onDismiss={pageError ? () => setPageError('') : undefined}
          >
            {pageError || (serviceError instanceof Error ? serviceError.message : String(serviceError))}
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 rounded-lg bg-[#f4f0e7] p-1" role="tablist" aria-label="生成模式">
              {[...IMAGE_TABS, ...videoTabs].map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => handleModeChange(value)}
                  className={`flex min-w-[104px] flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-xs font-semibold transition-colors ${mode === value ? 'bg-[#18201d] text-[#f4f0e7] shadow-sm' : 'text-[#68716d] hover:bg-[#fffdf8] hover:text-[#18201d]'}`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
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
                onSubmit={() => { void handleCreate(); }}
                onFirstFrameSelect={(file) => { void handleFrameUpload(file, 'first'); }}
                onFirstFrameRemove={() => { setSourceArtifact(null); setSourcePreview(null); }}
                onLastFrameSelect={(file) => { void handleFrameUpload(file, 'last'); }}
                onLastFrameRemove={() => { setLastFrameArtifact(null); setLastFramePreview(null); }}
              />
            ) : (
              <ImageGenerator
                form={form}
                mode={mode as 'text-to-image' | 'image-to-image'}
                binding={binding}
                sourceArtifact={sourceArtifact}
                sourcePreview={sourcePreview}
                uploading={uploading}
                submitting={submitting}
                onFormChange={updateForm}
                onSubmit={() => { void handleCreate(); }}
                onSourceSelect={(file) => { void handleFrameUpload(file, 'first'); }}
                onSourceRemove={() => { setSourceArtifact(null); setSourcePreview(null); }}
              />
            )}
          </div>
          <CreativeStatusCard status={statusQuery.data} onRefresh={() => void statusQuery.refetch()} />
        </div>
        <TaskList tasks={sortedTasks} artifacts={artifacts} isLoading={tasksQuery.isLoading} onCancel={handleCancel} onRetry={handleRetry} onReplay={handleReplay} />
        <MediaGallery
          artifacts={artifacts}
          total={artifactsTotal}
          isLoading={artifactsQuery.isLoading}
          hasMore={Boolean(artifactsQuery.hasNextPage)}
          isLoadingMore={artifactsQuery.isFetchingNextPage}
          onLoadMore={() => { void artifactsQuery.fetchNextPage(); }}
          onPin={handlePin}
          onDelete={handleDelete}
        />
      </div>
    </main>
  );
}
