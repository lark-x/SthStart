'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Play, X } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { adminFetch } from '@/app/lib/admin-fetch';
import { createTestRun, fetchTestRunDetail, fetchTestRuns } from '../api';
import type { DraftPayload, GenerationTestRunDetail, GenerationTestRunSummary } from '../types';

/**
 * 同页试运行（规划 §9）：保存并试生成 → 真实任务 → 显示真实工作流版本、
 * 输入参数、实际 seed 与耗时；结果支持下载与另存预设；不伪造进度与结果。
 */

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中', submitting: '提交中', accepted: '已接收', running: '生成中',
  succeeded: '已完成', failed: '失败', cancelled: '已取消', abandoned: '已放弃',
};

const STATUS_VARIANTS: Record<string, 'online' | 'running' | 'error' | 'warning' | 'default'> = {
  succeeded: 'online', running: 'running', accepted: 'running', submitting: 'running',
  failed: 'error', abandoned: 'warning', cancelled: 'default', queued: 'default',
};

function artifactUrl(serviceUrl: string) {
  return serviceUrl.replace(/^\/api\/v1\//, '/api/admin/');
}

function formatDuration(detail: GenerationTestRunDetail): string | null {
  const started = detail.createdAt ? Date.parse(detail.createdAt) : NaN;
  const finished = detail.finishedAt ? Date.parse(detail.finishedAt) : NaN;
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return null;
  const seconds = (finished - started) / 1000;
  return seconds >= 100 ? `${Math.round(seconds)} 秒` : `${seconds.toFixed(1)} 秒`;
}

export function TestRunPanel({
  workflowId,
  workflowName,
  draft,
  basicFieldKeys,
  defaultValues,
  onClose,
  onBeforeRun,
  onSaveAsPreset,
}: {
  workflowId: string;
  workflowName: string;
  draft: DraftPayload;
  /** basic 字段契约（键与类型），随编辑器配置变化。 */
  basicFieldKeys: Array<{ key: string; label: string; type: string; enumValues?: string[]; defaultValue?: unknown }>;
  /** 无默认值提示用的当前草稿默认。 */
  defaultValues: Record<string, unknown>;
  onClose?: () => void;
  /** 「保存并试生成」先经工作区固化草稿版本（内容未变则复用），返回实际用于运行的版本号。 */
  onBeforeRun?: () => Promise<number | null>;
  onSaveAsPreset?: (values: Record<string, unknown>, workflowVersion: number) => void;
}) {
  // 只保存本次显式覆盖值；工作流默认值由保存后的版本提供。
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [seed, setSeed] = useState('');
  const [media, setMedia] = useState<Record<string, { artifactId: string; name: string }>>({});
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<GenerationTestRunSummary[]>([]);
  const [detail, setDetail] = useState<GenerationTestRunDetail | null>(null);
  const pendingRequestRef = useRef<{ signature: string; key: string } | null>(null);
  const mountedRef = useRef(true);
  const detailIdRef = useRef<string | null>(null);
  const mediaSlots = Object.keys(draft.inputCapabilities ?? {});

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetchTestRuns(workflowId);
      if (!mountedRef.current) return;
      setRuns(response.items);
      const activeId = detailIdRef.current;
      if (activeId) {
        const fresh = await fetchTestRunDetail(activeId);
        if (mountedRef.current && detailIdRef.current === activeId) setDetail(fresh);
      }
    } catch { /* 列表加载失败不阻塞主流程 */ }
  }, [workflowId]);

  useEffect(() => {
    // 历史测试列表来自管理 API（外部系统）；挂载与轮询共用同一加载器。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const hasActiveRuns = runs.some((run) => ['queued', 'submitting', 'accepted', 'running'].includes(run.status))
    || Boolean(detail && ['queued', 'submitting', 'accepted', 'running'].includes(detail.status));
  useEffect(() => {
    if (!hasActiveRuns) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await loadRuns();
      if (!stopped) timer = setTimeout(() => { void poll(); }, 2000);
    };
    timer = setTimeout(() => { void poll(); }, 2000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [hasActiveRuns, loadRuns]);

  const openDetail = async (taskId: string) => {
    try {
      detailIdRef.current = taskId;
      const d = await fetchTestRunDetail(taskId);
      if (!mountedRef.current || detailIdRef.current !== taskId) return;
      setDetail(d);
      void loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const uploadMedia = async (slotKey: string, file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const response = await adminFetch('creative/uploads', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-artifact-original-name': encodeURIComponent(file.name),
          accept: 'application/json',
        },
        body: file,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(typeof payload?.message === 'string' ? payload.message : `HTTP ${response.status}`);
      setMedia((current) => ({ ...current, [slotKey]: { artifactId: String(payload?.id ?? ''), name: file.name } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const version = await onBeforeRun?.();
      if (version == null) {
        setError('草稿保存或版本固化未完成，未提交试运行；请先解决版本冲突或保存失败。');
        return;
      }
      const inputArtifacts = Object.entries(media).filter(([key]) => mediaSlots.includes(key)).map(([inputKey, item]) => ({ artifactId: item.artifactId, inputKey }));
      const request = {
        version,
        values: Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== undefined && basicFieldKeys.some((field) => field.key === key))),
        inputArtifacts,
        seed: seed.trim() ? Number(seed) : null,
      };
      const signature = JSON.stringify(request);
      if (pendingRequestRef.current?.signature !== signature) {
        pendingRequestRef.current = { signature, key: `test-run-${crypto.randomUUID()}` };
      }
      const task = await createTestRun(workflowId, {
        ...request,
        idempotencyKey: pendingRequestRef.current.key,
      });
      pendingRequestRef.current = null;
      detailIdRef.current = task.id;
      setDetail(task);
      void loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="test-run-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">试运行 · {workflowName}</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="关闭试运行" className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-border-default text-muted lg:hidden">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {error && <Alert variant="danger" title="试运行未完成" onDismiss={() => setError('')}>{error}</Alert>}

      <div className="space-y-2">
        {basicFieldKeys.map((field) => (
          <div key={field.key}>
            <label htmlFor={`test-${field.key}`} className="mb-1 block text-sm font-medium text-ink">{field.label}</label>
            {field.type === 'enum' && field.enumValues?.length ? (
              <Select id={`test-${field.key}`} value={String(values[field.key] ?? field.defaultValue ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>
                {field.enumValues.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            ) : field.type === 'boolean' ? (
              <input id={`test-${field.key}`} type="checkbox" checked={Boolean(values[field.key] ?? defaultValues[field.key] ?? false)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.checked }))} />
            ) : field.type === 'integer' || field.type === 'number' ? (
              <Input id={`test-${field.key}`} type="number" value={String(values[field.key] ?? defaultValues[field.key] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value === '' ? undefined : Number(event.target.value) }))} />
            ) : field.type === 'long-text' ? (
              <textarea id={`test-${field.key}`} className="min-h-20 w-full rounded-[var(--radius-control)] border border-border-default bg-surface p-2 text-sm" value={String(values[field.key] ?? defaultValues[field.key] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
            ) : (
              <Input id={`test-${field.key}`} value={String(values[field.key] ?? defaultValues[field.key] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
            )}
          </div>
        ))}
        <div>
          <label htmlFor="test-seed" className="mb-1 block text-sm font-medium text-ink">种子（留空随机）</label>
          <Input id="test-seed" type="number" value={seed} onChange={(event) => setSeed(event.target.value)} />
        </div>
        {mediaSlots.map((slotKey) => (
          <div key={slotKey}>
            <label htmlFor={`test-media-${slotKey}`} className="mb-1 block text-sm font-medium text-ink">媒体槽位 {slotKey}</label>
            <div className="flex items-center gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-border-default px-3 text-sm">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                {media[slotKey]?.name ?? '选择文件'}
                <input type="file" className="sr-only" accept="image/*" onChange={(event) => { void uploadMedia(slotKey, event.target.files?.[0]); event.target.value = ''; }} />
              </label>
              {media[slotKey] && (
                <Button type="button" size="sm" variant="outline" onClick={() => setMedia((current) => { const next = { ...current }; delete next[slotKey]; return next; })}>移除</Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button variant="primary" onClick={() => { void submit(); }} loading={submitting || uploading}>
        <Play className="h-3.5 w-3.5" aria-hidden="true" />保存并试生成
      </Button>
      <p className="text-sm text-muted">先保存为不可变工作流版本，再创建真实任务；保存版本不会自动开放到创作中心。</p>

      {detail && (
        <section className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3" data-testid="test-run-detail">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={STATUS_VARIANTS[detail.status] ?? 'default'}>{STATUS_LABELS[detail.status] ?? detail.status}</Badge>
            <span className="text-sm text-muted">v{detail.workflowVersion} · seed {detail.actualSeed ?? '—'}{formatDuration(detail) ? ` · ${formatDuration(detail)}` : ''}</span>
          </div>
          {detail.errorMessage && <p className="mt-2 text-sm text-danger-fg" role="alert">{detail.errorMessage}</p>}
          {detail.progress?.stage && ['queued', 'submitting', 'accepted', 'running'].includes(detail.status) && (
            <p className="mt-2 text-sm text-muted">阶段：{detail.progress.stage}</p>
          )}
          {detail.artifacts.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {detail.artifacts.map((artifact) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={artifact.artifactId} src={artifactUrl(artifact.url)} alt={`试运行产物 ${artifact.outputName}`} className="w-full rounded-[var(--radius-control)] border border-border-subtle" />
              ))}
            </div>
          )}
          {detail.status === 'succeeded' && (
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.artifacts.map((artifact) => (
                <a key={artifact.artifactId} href={artifactUrl(artifact.url)} download className="text-sm font-semibold text-accent hover:underline">下载产物</a>
              ))}
              {onSaveAsPreset && (
                <Button type="button" size="sm" variant="outline" onClick={() => onSaveAsPreset(detail.requestInputs, detail.workflowVersion)}>另存为预设</Button>
              )}
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-muted">实际使用参数（来自任务快照）</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded-[var(--radius-control)] bg-ink/4 p-2 font-mono text-xs">{JSON.stringify(detail.requestInputs, null, 2)}</pre>
          </details>
        </section>
      )}

      <section className="min-h-0 flex-1 overflow-y-auto">
        <h3 className="text-sm font-semibold text-ink">历史测试</h3>
        {runs.length === 0 && <p className="mt-1 text-sm text-fg-subtle">还没有测试记录；页面关闭不会取消后端任务，重新打开可找回历史。</p>}
        <ul className="mt-1 space-y-1">
          {runs.map((run) => (
            <li key={run.id}>
              <button type="button" onClick={() => { void openDetail(run.id); }} className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-subtle bg-surface px-2.5 py-2 text-left text-sm hover:bg-ink/4">
                <span className="min-w-0 truncate">
                  <Badge variant={STATUS_VARIANTS[run.status] ?? 'default'}>{STATUS_LABELS[run.status] ?? run.status}</Badge>
                  <span className="ml-2 text-muted">v{run.workflowVersion}</span>
                </span>
                <span className="flex-shrink-0 text-fg-subtle">{run.artifactCount > 0 ? `${run.artifactCount} 个产物 · ` : ''}{new Date(run.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
