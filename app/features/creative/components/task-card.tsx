'use client';

import { Copy, FileAudio, RotateCcw, X } from 'lucide-react';
import type { CreativeTaskResponse } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { isActiveTask, taskModeLabel, formatDate, CREATIVE_STATUS_LABELS, CREATIVE_STATUS_VARIANTS } from '../types';

export function TaskCard({
  task,
  onCancel,
  onRetry,
  onReplay,
}: {
  task: CreativeTaskResponse;
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onReplay: (task: CreativeTaskResponse) => void;
}) {
  const canRetry = ['failed', 'abandoned', 'cancelled'].includes(task.status);
  return (
    <article className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={CREATIVE_STATUS_VARIANTS[task.status] ?? 'default'} dot>{CREATIVE_STATUS_LABELS[task.status] ?? task.status}</Badge>
            <span className="text-sm font-semibold text-muted">{taskModeLabel(task)}</span>
            <span className="text-sm text-fg-subtle">种子 {task.actualSeed ?? '随机'}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink">{String(task.replay.inputs.prompt ?? '未记录提示词')}</p>
          <p className="mt-1 text-sm text-fg-subtle">{formatDate(task.createdAt)} · 工作流 v{task.workflowVersion}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isActiveTask(task.status) && (
            <Button size="sm" variant="danger-ghost" onClick={() => void onCancel(task.id)}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />取消
            </Button>
          )}
          {canRetry && (
            <Button size="sm" variant="outline" onClick={() => void onRetry(task.id)}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />重试
            </Button>
          )}
          {/* 复用参数不再检查素材是否在已加载分页中：handleReplay 对缺失素材
              会按 id 构造预览兜底，按已加载分页判断会误报并错误禁用按钮。 */}
          <Button size="sm" variant="ghost" onClick={() => onReplay(task)}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />复用参数
          </Button>
        </div>
      </div>
      {Boolean(task.errorMessage) && <p className="mt-3 rounded border border-danger/25 bg-danger/8 px-3 py-2 text-sm leading-relaxed text-danger-fg">{task.errorMessage}</p>}
      {task.progress && isActiveTask(task.status) && (
        <div className="mt-3" aria-label="生成进度">
          <div className="mb-1 flex items-center justify-between gap-2 text-sm text-muted"><span>{task.progress.message || task.progress.stage}</span><span>{typeof task.progress.value === 'number' ? `${Math.round(task.progress.value * 100)}%` : '处理中'}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${typeof task.progress.value === 'number' ? Math.max(4, task.progress.value * 100) : 24}%` }} /></div>
        </div>
      )}
      {task.artifacts.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {task.artifacts.map((artifact) => (
            <a key={artifact.artifactId} href={artifact.url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded border border-border-subtle bg-paper" aria-label={`打开生成结果 ${artifact.outputName}`}>
              {artifact.mediaKind === 'video' || artifact.contentType?.startsWith('video/') ? (
                <img src={artifact.thumbnailArtifactId ? `/api/admin/creative/artifacts/${encodeURIComponent(artifact.thumbnailArtifactId)}` : `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}thumbnail=true`} alt={`生成结果 ${artifact.outputName}`} className="h-full w-full object-cover" />
              ) : artifact.mediaKind === 'audio' || artifact.contentType?.startsWith('audio/') ? (
                <div className="flex h-full items-center justify-center text-accent-dark"><FileAudio className="h-9 w-9" aria-label="音频结果" /></div>
              ) : (
                <img src={artifact.url} alt={`生成结果 ${artifact.outputName}`} className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
              )}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
