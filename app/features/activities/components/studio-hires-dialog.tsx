'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import type { HiresPreviewResponse, StudioJob, StudioTarget, StudioVersionContext } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { canSubmitHires, hiresBlockedReason, hiresIdempotencyKey } from '../lib/hires-request';
import { createStudioHires, fetchStudioVersions, previewStudioHires } from '../studio-api';

/**
 * 放大细化弹窗（计划 §15.2）。
 *
 * - 打开弹窗本身不提交草稿、不创建任务、不调用模型；只有点击“预览”才读取配置。
 * - 预览返回的 seed 与 planHash 必须原样回传；不一致由服务端返回 hires_plan_changed。
 * - 幂等键在打开时生成一次并保持不变，浏览器响应丢失时用同一个键重发，不新建任务。
 * - 失败留在当前浮层，保留原图、参数与请求键。
 */

const MAX_SIZE_OPTIONS = [1536, 2000, 2048];
const DENOISE_DEFAULT = 0.2;

export function StudioHiresDialog({ activityId, target, sourceArtifactId, sourceImageUrl, sourceLabel, open, onOpenChange, beforePreview, onCreated }: {
  activityId: string;
  target: StudioTarget;
  sourceArtifactId: string | null;
  sourceImageUrl?: string | null;
  sourceLabel?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 调用前必须冲刷所有已挂载的草稿队列；返回 false 表示未就绪。 */
  beforePreview(): Promise<boolean>;
  onCreated(job: StudioJob): void;
}) {
  const [maxSize, setMaxSize] = useState(2000);
  const [denoise, setDenoise] = useState(DENOISE_DEFAULT);
  const [preview, setPreview] = useState<HiresPreviewResponse | null>(null);
  const [versions, setVersions] = useState<StudioVersionContext | null>(null);
  /** 幂等键在本次弹窗会话内生成一次并保持不变：响应丢失时用同一个键重发，不新建任务。 */
  const idempotencyKey = useRef('');
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** 预览失败原因：进入“不可提交”的原因区，与提交失败区分开。 */
  const [previewError, setPreviewError] = useState('');
  /** 提交失败原因：留在当前浮层，保留原图、参数与请求键。 */
  const [error, setError] = useState('');

  /** 关闭即清空本地状态与请求键；打开时不做任何请求，也不创建任务。 */
  const close = () => {
    setPreview(null);
    setVersions(null);
    setError('');
    setPreviewError('');
    idempotencyKey.current = '';
    onOpenChange(false);
  };

  const busy = previewing || submitting;

  const requestKey = () => {
    if (!idempotencyKey.current) {
      idempotencyKey.current = hiresIdempotencyKey(sourceArtifactId ?? 'none', () =>
        globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    }
    return idempotencyKey.current;
  };

  const runPreview = async () => {
    if (!sourceArtifactId || busy) return;
    setPreviewing(true);
    setError('');
    setPreviewError('');
    try {
      if (!await beforePreview()) throw new Error('活动内容尚未保存，请先处理保存状态。原图与参数仍保留。');
      const context = await fetchStudioVersions(activityId);
      const response = await previewStudioHires(activityId, { versions: context, target, sourceArtifactId, maxSize, denoise });
      setVersions(context);
      setPreview(response);
    } catch (reason) {
      // 409／缺快照／非本目标等具体原因原样展示，不折叠成通用失败。
      setPreviewError(reason instanceof Error ? reason.message : '预览失败，参数已保留。');
    } finally { setPreviewing(false); }
  };

  const submit = async () => {
    if (!preview || !versions || !sourceArtifactId || busy) return;
    setSubmitting(true);
    setError('');
    try {
      // 计划 §6.4：提交前同样 flush 当前编辑器队列（此前只有预览前做）。
      // 保存失败或冲突时留在弹窗、**不发送细化请求**，原图与参数保留。
      if (!await beforePreview()) throw new Error('活动内容尚未保存，请先处理保存状态。原图与参数仍保留。');
      const job = await createStudioHires(activityId, {
        versions, target, sourceArtifactId, maxSize, denoise,
        seed: preview.seed, planHash: preview.planHash, idempotencyKey: requestKey(),
      });
      onCreated(job);
      close();
    } catch (reason) {
      // 保留原图、参数与请求键：用户可直接重试，重试沿用同一个幂等键。
      setError(reason instanceof Error ? reason.message : '细化任务提交失败，参数已保留。');
    } finally { setSubmitting(false); }
  };

  // 不可用时给出具体原因（来源缺失、服务端 issues、或预览请求失败），不只灰掉按钮。
  const blockedReason = hiresBlockedReason({ hasSource: Boolean(sourceArtifactId), preview, failure: previewError || null });

  return (
    <ResponsiveEditOverlay open={open} onOpenChange={(next) => { if (busy) return; if (next) onOpenChange(true); else close(); }} title="放大细化"
      description="沿用原图的实际模型、采样参数与提示词，只放大并小幅重绘；结果是不透明新图，不会覆盖原图。"
      footer={<>
        <Button variant="outline" disabled={busy} onClick={close}>取消</Button>
        <Button variant="outline" loading={previewing} disabled={!sourceArtifactId || busy} onClick={() => void runPreview()}>{preview ? '重新预览' : '预览'}</Button>
        <Button loading={submitting} disabled={!canSubmitHires(preview) || busy} onClick={() => void submit()}>
          {submitting ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}开始细化
        </Button>
      </>}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-4">
          <div className="w-full max-w-[240px] space-y-1.5">
            <span className="text-sm font-medium text-ink">原图</span>
            <div className="overflow-hidden rounded-[var(--radius-control)] border border-border-default bg-surface-muted">
              {sourceImageUrl
                ? <img src={sourceImageUrl} alt={sourceLabel ? `${sourceLabel} 原图` : '待细化的原图'} className="h-auto w-full object-contain" />
                : <p className="px-3 py-6 text-center text-xs text-muted">原图预览不可用，仍可继续细化。</p>}
            </div>
            {sourceLabel && <p className="break-words text-xs text-muted">{sourceLabel}</p>}
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink">最长边</span>
              <select aria-label="细化最长边" className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 text-sm text-ink"
                value={maxSize} onChange={(event) => { setMaxSize(Number(event.target.value)); setPreview(null); setPreviewError(''); }}>
                {MAX_SIZE_OPTIONS.map((value) => <option key={value} value={value}>{value} 像素</option>)}
              </select>
              <span className="block text-xs text-muted">实际输出按原图比例计算并向下取 8 的倍数；所选尺寸不大于原图最长边时会被拒绝。</span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink">重绘幅度</span>
              <input aria-label="细化重绘幅度" type="number" min={0.05} max={0.35} step={0.05} value={denoise}
                onChange={(event) => { setDenoise(Number(event.target.value)); setPreview(null); setPreviewError(''); }}
                className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 text-sm text-ink" />
              <span className="block text-xs text-muted">建议 0.2；越高越偏离原图，范围 0.05–0.35。</span>
            </label>
            {preview && <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
              <dt>原图尺寸</dt><dd className="text-ink">{preview.sourceWidth} × {preview.sourceHeight}</dd>
              <dt>预计输出</dt><dd className="text-ink">{preview.outputWidth} × {preview.outputHeight}</dd>
              <dt>细化工作流</dt><dd className="break-words text-ink">{preview.workflowId} v{preview.workflowVersion}</dd>
              <dt>引擎</dt><dd className="break-words text-ink">{preview.engineId}</dd>
              <dt>seed</dt><dd className="text-ink">{preview.seed}</dd>
            </dl>}
          </div>
        </div>

        {blockedReason && <Alert variant="warning" title="当前无法开始细化">{blockedReason}</Alert>}
        {preview?.transparencyHint && <Alert variant="info" title="透明图处理">{preview.transparencyHint}</Alert>}
        {preview?.sourceChanged && <Alert variant="warning" title="来源描述已变化">原图基于更早的描述生成；本次沿用原图实际参数，不会自动采纳新描述，也不写回草稿。</Alert>}

        {preview && <details className="rounded-[var(--radius-control)] border border-border-subtle p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">高级：实际继承的配置（只读）</summary>
          <dl className="mt-3 space-y-2 text-xs">
            <div><dt className="font-medium text-ink">加载器</dt><dd className="break-words text-muted">UNET {preview.loaders.unetName ?? '未声明'} · CLIP {preview.loaders.clipName ?? '未声明'} · VAE {preview.loaders.vaeName ?? '未声明'}</dd></div>
            <div><dt className="font-medium text-ink">采样</dt><dd className="text-muted">{preview.sampler.steps} 步 · CFG {preview.sampler.cfg} · {preview.sampler.samplerName} · {preview.sampler.scheduler} · denoise {preview.sampler.denoise}</dd></div>
            <div><dt className="font-medium text-ink">LoRA</dt><dd className="break-words text-muted">{preview.loras.length ? preview.loras.map((lora) => `${lora.model} (${lora.strength})${lora.enabled ? '' : ' · 已停用'}`).join('、') : '原图未使用 LoRA'}</dd></div>
            <div><dt className="font-medium text-ink">正向提示词</dt><dd className="whitespace-pre-wrap break-words text-muted">{preview.positivePrompt || '（空）'}</dd></div>
            <div><dt className="font-medium text-ink">反向提示词</dt><dd className="whitespace-pre-wrap break-words text-muted">{preview.negativePrompt || '（空）'}</dd></div>
          </dl>
        </details>}

        {error && <Alert variant="danger" title="细化未提交">{error}</Alert>}
      </div>
    </ResponsiveEditOverlay>
  );
}
