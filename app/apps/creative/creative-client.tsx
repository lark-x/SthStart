'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleDashed,
  Clock3,
  Copy,
  ExternalLink,
  ImagePlus,
  Loader2,
  Maximize2,
  Pin,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ArtifactDescriptor, CreativeStatusResponse, CreativeTaskResponse } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Input } from '@/app/components/ui/input';
import { PageHeader } from '@/app/components/shared/page-header';
import { Textarea } from '@/app/components/ui/textarea';
import { creativeKeys } from '@/app/lib/query-keys';
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

type CreativeMode = CreativeTaskInput['mode'];

type FormState = {
  prompt: string;
  negativePrompt: string;
  width: string;
  height: string;
  steps: string;
  seed: string;
};

const EMPTY_FORM: FormState = {
  prompt: '',
  negativePrompt: '',
  width: '1024',
  height: '1024',
  steps: '20',
  seed: '',
};

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  submitting: '提交中',
  accepted: '已接收',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  abandoned: '已放弃',
};

const STATUS_VARIANTS: Record<string, 'default' | 'running' | 'online' | 'error' | 'warning' | 'stopped'> = {
  queued: 'default',
  submitting: 'running',
  accepted: 'running',
  running: 'running',
  succeeded: 'online',
  failed: 'error',
  cancelled: 'stopped',
  abandoned: 'warning',
};

function activeTask(status: string) {
  return ['queued', 'submitting', 'accepted', 'running'].includes(status);
}

function taskModeLabel(task: CreativeTaskResponse) {
  return task.replay.mode === 'image-to-image' ? '图生图' : '文本生图';
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusCopy(binding: CreativeStatusResponse['modes']['textToImage']) {
  if (binding.ready) return `${binding.workflow?.name ?? '已配置'} · ${binding.engine?.name ?? 'ComfyUI'}`;
  if (binding.status === 'not_configured') return '尚未绑定生成工作流';
  if (binding.status === 'engine_unavailable') return '生成引擎不可用';
  if (binding.status === 'unsupported_engine') return '当前工作流引擎暂不支持';
  return '工作流版本不可用';
}

function statusVariant(binding: CreativeStatusResponse['modes']['textToImage']) {
  return binding.ready ? 'online' as const : binding.status === 'not_configured' ? 'warning' as const : 'error' as const;
}

function InputLabel({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-[#18201d]">
      <span>{children}</span>
      {hint && <span className="ml-1 font-normal text-[#89908a]">{hint}</span>}
    </label>
  );
}

function CreativeStatusCard({ status, onRefresh }: { status?: CreativeStatusResponse; onRefresh: () => void }) {
  const modes = status?.modes;
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">GENERATION ROUTING</span>
            <CardTitle className="mt-1">公共生成状态</CardTitle>
          </div>
          <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="刷新生成状态">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">刷新</span>
          </Button>
        </div>
        <CardDescription>创作中心只使用 SthStart 分配的工作流。模板、引擎与密钥不会出现在创作页面。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {modes ? (
          <>
            {([
              ['textToImage', '文本生图'],
              ['imageToImage', '图生图'],
            ] as const).map(([key, label]) => {
              const binding = modes[key];
              return (
                <div key={key} className="flex items-start justify-between gap-3 rounded-[3px_12px_3px_3px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <CircleDashed className={`mt-0.5 h-4 w-4 flex-none ${binding.ready ? 'text-[#4e9b6b]' : 'text-[#d0a731]'}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#18201d]">{label}</p>
                      <p className="mt-1 truncate text-[11px] text-[#68716d]">{statusCopy(binding)}</p>
                    </div>
                  </div>
                  <Badge variant={statusVariant(binding)} dot>{binding.ready ? '就绪' : '待配置'}</Badge>
                </div>
              );
            })}
            {(!modes.textToImage.ready || !modes.imageToImage.ready) && (
              <Alert variant="warning" title="生成工作流尚未完全配置">
                <span>请在管理页绑定对应的 ComfyUI 工作流版本后再开始生成。</span>{' '}
                <a href="/settings/generation" className="font-semibold underline underline-offset-2">进入生成配置</a>
              </Alert>
            )}
          </>
        ) : (
          <div className="flex min-h-[180px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-[#e45d35]" aria-label="正在读取生成状态" /></div>
        )}
      </CardContent>
    </Card>
  );
}

function TaskCard({
  task,
  artifacts,
  onCancel,
  onRetry,
  onReplay,
}: {
  task: CreativeTaskResponse;
  artifacts: ArtifactDescriptor[];
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onReplay: (task: CreativeTaskResponse) => void;
}) {
  const canRetry = ['failed', 'abandoned', 'cancelled'].includes(task.status);
  const taskArtifacts = task.artifacts.length ? task.artifacts : [];
  const sourceAvailable = task.replay.inputArtifactIds.length === 0 || task.replay.inputArtifactIds.every((id) => artifacts.some((item) => item.id === id));
  return (
    <article className="rounded-[3px_16px_3px_3px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANTS[task.status] ?? 'default'} dot>{STATUS_LABELS[task.status] ?? task.status}</Badge>
            <span className="text-[11px] font-semibold text-[#68716d]">{taskModeLabel(task)}</span>
            <span className="text-[11px] text-[#89908a]">种子 {task.actualSeed ?? '随机'}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#18201d]">{String(task.replay.inputs.prompt ?? '未记录提示词')}</p>
          <p className="mt-1 text-[11px] text-[#89908a]">{formatDate(task.createdAt)} · 工作流 v{task.workflowVersion}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {activeTask(task.status) && (
            <Button size="sm" variant="danger-ghost" onClick={() => void onCancel(task.id)}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />取消
            </Button>
          )}
          {canRetry && (
            <Button size="sm" variant="outline" onClick={() => void onRetry(task.id)}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />重试
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onReplay(task)} disabled={!sourceAvailable} title={!sourceAvailable ? '参考图片已不在媒体库中' : undefined}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />复用参数
          </Button>
        </div>
      </div>
      {task.errorMessage && <p className="mt-3 rounded border border-[#c9674a]/25 bg-[#c9674a]/8 px-3 py-2 text-xs leading-relaxed text-[#a84427]">{task.errorMessage}</p>}
      {taskArtifacts.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {taskArtifacts.map((artifact) => (
            <a key={artifact.artifactId} href={artifact.url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded border border-[rgb(24_32_29/12%)] bg-[#f4f0e7]" aria-label={`打开生成结果 ${artifact.outputName}`}>
              <img src={artifact.url} alt={`生成结果 ${artifact.outputName}`} className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
              <span className="absolute bottom-1 right-1 rounded bg-[#18201d]/75 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"><Maximize2 className="h-3 w-3" aria-hidden="true" /></span>
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function GalleryCard({ artifact, onPin, onDelete }: { artifact: ArtifactDescriptor; onPin: (artifact: ArtifactDescriptor) => Promise<void>; onDelete: (artifact: ArtifactDescriptor) => Promise<void> }) {
  return (
    <article className="group overflow-hidden rounded-[3px_14px_3px_3px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8]">
      <a href={artifact.url} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden bg-[#f4f0e7]" aria-label={`查看${artifact.originalName ?? '图片素材'}`}>
        <img src={artifact.url} alt={artifact.originalName ?? '创作素材'} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
        {artifact.pinned && <span className="absolute left-2 top-2 rounded-full bg-[#18201d]/75 p-1.5 text-[#f4f0e7]"><Pin className="h-3 w-3 fill-current" aria-hidden="true" /></span>}
      </a>
      <div className="flex items-center justify-between gap-2 p-2.5">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-[#18201d]">{artifact.originalName ?? '生成图片'}</p>
          <p className="mt-0.5 text-[10px] text-[#89908a]">{formatDate(artifact.createdAt)}</p>
        </div>
        <div className="flex flex-none items-center gap-0.5">
          <button type="button" onClick={() => void onPin(artifact)} className="rounded p-1.5 text-[#68716d] hover:bg-[#18201d]/6 hover:text-[#18201d]" aria-label={artifact.pinned ? '取消固定' : '固定图片'}>
            <Pin className={`h-3.5 w-3.5 ${artifact.pinned ? 'fill-current text-[#e45d35]' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void onDelete(artifact)} className="rounded p-1.5 text-[#68716d] hover:bg-[#c9674a]/10 hover:text-[#b83b1b]" aria-label="删除图片">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function CreativeClient() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const statusQuery = useCreativeStatus();
  const tasksQuery = useCreativeTasks();
  const artifactsQuery = useCreativeArtifacts();
  const [mode, setMode] = useState<CreativeMode>('text-to-image');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sourceArtifact, setSourceArtifact] = useState<ArtifactDescriptor | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState('');

  useEffect(() => () => {
    if (sourcePreview?.startsWith('blob:')) URL.revokeObjectURL(sourcePreview);
  }, [sourcePreview]);

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const artifacts = artifactsQuery.data?.items ?? [];
  const binding = statusQuery.data?.modes[mode === 'text-to-image' ? 'textToImage' : 'imageToImage'];
  const ready = Boolean(binding?.ready);
  const serviceError = statusQuery.error ?? tasksQuery.error ?? artifactsQuery.error;
  const sortedTasks = useMemo(() => tasks.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [tasks]);

  const updateForm = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const handleModeChange = (nextMode: CreativeMode) => {
    setMode(nextMode);
    setPageError('');
    if (nextMode === 'text-to-image') {
      setSourceArtifact(null);
      setSourcePreview(null);
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
      setPageError('只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setPageError('参考图片不能超过 12 MiB。');
      return;
    }
    setPageError('');
    setUploading(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const artifact = await uploadCreativeImage(file);
      setSourceArtifact(artifact);
      setSourcePreview(previewUrl);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
      toast.success('参考图片已加入媒体库');
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setPageError(error instanceof Error ? error.message : String(error));
      toast.error('参考图片上传失败', error instanceof Error ? error.message : String(error));
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
    if (mode === 'image-to-image' && !sourceArtifact) {
      setPageError('图生图需要先上传参考图片。');
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreativeTaskInput = {
        mode,
        prompt: form.prompt.trim(),
        negativePrompt: form.negativePrompt.trim(),
        width: Number(form.width),
        height: Number(form.height),
        steps: Number(form.steps),
        seed: form.seed.trim() ? Number(form.seed) : null,
        ...(sourceArtifact ? { sourceArtifactId: sourceArtifact.id } : {}),
      };
      await createCreativeTask(payload);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
      toast.success('生成任务已提交', '可以在下方查看进度。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPageError(message);
      toast.error('提交生成任务失败', message);
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
      seed: task.actualSeed == null ? '' : String(task.actualSeed),
    });
    const sourceId = task.replay.inputArtifactIds[0];
    setSourceArtifact(sourceId ? artifacts.find((item) => item.id === sourceId) ?? null : null);
    setSourcePreview(sourceId ? artifacts.find((item) => item.id === sourceId)?.url ?? null : null);
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
    if (!window.confirm(`确定删除“${artifact.originalName ?? '这张图片'}”吗？`)) return;
    try {
      await deleteCreativeArtifact(artifact.id);
      await queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
      toast.success('图片已删除');
    } catch (error) {
      toast.error('删除图片失败', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f0e7] px-4 py-8 text-[#18201d] sm:px-8 md:px-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          backHref="/"
          backLabel="返回门户首页"
          eyebrow="CREATIVE CENTER / IMAGE MVP"
          title="创作中心"
          description="把提示词变成可复用的图片素材。文本生图与图生图共用 SthStart 公共生成核心，任务、结果与参数都会留在本地媒体库。"
          actions={<Button size="sm" variant="outline" onClick={() => { void statusQuery.refetch(); void tasksQuery.refetch(); void artifactsQuery.refetch(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新</Button>}
        />

        {(pageError || serviceError) && (
          <Alert variant="danger" title="创作中心暂时无法完成操作" onDismiss={() => setPageError('')}>
            {pageError || (serviceError instanceof Error ? serviceError.message : String(serviceError))}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-[#b83b1b]"><Sparkles className="h-4 w-4" aria-hidden="true" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">MAKE AN IMAGE</span></div>
              <CardTitle>开始一次创作</CardTitle>
              <CardDescription>只填写创作参数；实际模型、工作流与引擎由管理端绑定并在服务端执行。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#f4f0e7] p-1" role="tablist" aria-label="生图模式">
                {([
                  ['text-to-image', '文本生图', Sparkles],
                  ['image-to-image', '图生图', ImagePlus],
                ] as const).map(([value, label, Icon]) => (
                  <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => handleModeChange(value)} className={`flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-xs font-semibold transition-colors ${mode === value ? 'bg-[#18201d] text-[#f4f0e7] shadow-sm' : 'text-[#68716d] hover:bg-[#fffdf8] hover:text-[#18201d]'}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                  </button>
                ))}
              </div>

              <div>
                <InputLabel htmlFor="creative-prompt">正向提示词</InputLabel>
                <Textarea id="creative-prompt" className="mt-1.5 min-h-[128px]" value={form.prompt} onChange={(event) => updateForm('prompt', event.target.value)} placeholder="描述主体、场景、光线与画面气质…" maxLength={10000} />
                <p className="mt-1 text-right text-[10px] text-[#89908a]">{form.prompt.length}/10000</p>
              </div>

              <div>
                <InputLabel htmlFor="creative-negative">反向提示词 <span className="font-normal text-[#89908a]">可选</span></InputLabel>
                <Textarea id="creative-negative" className="mt-1.5" rows={3} value={form.negativePrompt} onChange={(event) => updateForm('negativePrompt', event.target.value)} placeholder="不希望出现的内容，例如模糊、文字、水印…" maxLength={10000} />
              </div>

              {mode === 'image-to-image' && (
                <div className="rounded-[3px_14px_3px_3px] border border-dashed border-[rgb(24_32_29/24%)] bg-[#f4f0e7]/60 p-4">
                  <InputLabel htmlFor="creative-source">参考图片</InputLabel>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                    {sourcePreview ? <img src={sourcePreview} alt="参考图片预览" className="h-20 w-20 rounded object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded bg-[#18201d]/8 text-[#68716d]"><Upload className="h-5 w-5" aria-hidden="true" /></div>}
                    <div className="flex-1">
                      <label htmlFor="creative-source" className="inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-2 rounded border border-[rgb(24_32_29/18%)] bg-[#fffdf8] px-3 text-xs font-semibold text-[#18201d] hover:bg-[#18201d]/5">
                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                        {uploading ? '正在加入媒体库…' : sourceArtifact ? '更换参考图片' : '选择并上传图片'}
                        <input id="creative-source" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" disabled={uploading} onChange={(event) => { void handleUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} />
                      </label>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[#68716d]">图片会先安全保存到中央媒体库，再由服务端以受控文件名交给 ComfyUI；浏览器不会发送 Base64。</p>
                    </div>
                    {sourceArtifact && <button type="button" onClick={() => { setSourceArtifact(null); setSourcePreview(null); }} className="self-start rounded p-1.5 text-[#68716d] hover:bg-[#c9674a]/10 hover:text-[#b83b1b]" aria-label="移除参考图片"><X className="h-4 w-4" aria-hidden="true" /></button>}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><InputLabel htmlFor="creative-width">宽度</InputLabel><Input id="creative-width" className="mt-1.5" type="number" min={64} max={4096} step={1} value={form.width} onChange={(event) => updateForm('width', event.target.value)} /></div>
                <div><InputLabel htmlFor="creative-height">高度</InputLabel><Input id="creative-height" className="mt-1.5" type="number" min={64} max={4096} step={1} value={form.height} onChange={(event) => updateForm('height', event.target.value)} /></div>
                <div><InputLabel htmlFor="creative-steps">步数</InputLabel><Input id="creative-steps" className="mt-1.5" type="number" min={1} max={150} step={1} value={form.steps} onChange={(event) => updateForm('steps', event.target.value)} /></div>
                <div><InputLabel htmlFor="creative-seed">种子 <span className="font-normal text-[#89908a]">可选</span></InputLabel><Input id="creative-seed" className="mt-1.5" type="number" min={0} max={2147483647} step={1} value={form.seed} onChange={(event) => updateForm('seed', event.target.value)} placeholder="随机" /></div>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="flex-1 text-xs text-[#68716d]">{binding ? <><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${ready ? 'bg-[#4e9b6b]' : 'bg-[#d0a731]'}`} />{statusCopy(binding)}</> : '正在检查公共生成状态…'}</div>
              <Button variant="accent" size="lg" onClick={() => void handleCreate()} loading={submitting} disabled={!ready || uploading}><Sparkles className="h-4 w-4" aria-hidden="true" />开始生成</Button>
            </CardFooter>
          </Card>

          <CreativeStatusCard status={statusQuery.data} onRefresh={() => void statusQuery.refetch()} />
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">TASKS</span><CardTitle className="mt-1">生成任务</CardTitle><CardDescription>任务状态由公共生成核心持续更新；失败会保留明确错误，不会静默换模型。</CardDescription></div><span className="text-xs text-[#89908a]">共 {sortedTasks.length} 条</span></div>
          </CardHeader>
          <CardContent>
            {tasksQuery.isLoading && !tasksQuery.data ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[#e45d35]" /></div> : sortedTasks.length ? <div className="space-y-3">{sortedTasks.map((task) => <TaskCard key={task.id} task={task} artifacts={artifacts} onCancel={handleCancel} onRetry={handleRetry} onReplay={handleReplay} />)}</div> : <EmptyState className="min-h-[220px]" icon={Clock3} title="还没有生成任务" description="完成上方参数后，第一张图片会出现在这里。" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">CENTRAL ARTIFACT LIBRARY</span><CardTitle className="mt-1">图片媒体库</CardTitle><CardDescription>生成结果与参考素材统一存储在 Artifact 2.0 中，可以固定、预览或删除。</CardDescription></div><span className="text-xs text-[#89908a]">{artifactsQuery.data?.total ?? 0} 张图片</span></div>
          </CardHeader>
          <CardContent>{artifactsQuery.isLoading && !artifactsQuery.data ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[#e45d35]" /></div> : artifacts.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{artifacts.map((artifact) => <GalleryCard key={artifact.id} artifact={artifact} onPin={handlePin} onDelete={handleDelete} />)}</div> : <EmptyState className="min-h-[220px]" icon={ImagePlus} title="媒体库还是空的" description="生成一张图片，或在图生图模式上传参考素材。" />}</CardContent>
          <CardFooter><span className="text-[11px] text-[#89908a]">媒体文件不会复制到邻舍数据库。</span><a href="/settings/generation" className="inline-flex items-center gap-1 text-xs font-semibold text-[#b83b1b] hover:underline">管理生成工作流<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a></CardFooter>
        </Card>
      </div>
    </main>
  );
}
