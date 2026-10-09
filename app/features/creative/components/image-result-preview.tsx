'use client';

import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { CreativeTaskResponse } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { CREATIVE_STATUS_LABELS, isActiveTask } from '../types';

export function ImageResultPreview({ tasks, onReplay }: { tasks: CreativeTaskResponse[]; onReplay(task: CreativeTaskResponse): void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const images = tasks.flatMap(task => task.artifacts.filter(item => item.mediaKind === 'image').map(artifact => ({ task, artifact })));
  const selected = images.find(item => item.artifact.artifactId === selectedId) ?? images[0];
  const active = tasks.find(task => isActiveTask(task.status));
  const hasNew = selected && images[0]?.artifact.artifactId !== selected.artifact.artifactId;
  return <section aria-label="当前图片预览" className="overflow-hidden rounded-[var(--radius-panel)] border border-border-subtle bg-surface">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle p-3">
      <h2 className="text-sm font-semibold text-ink">图片预览</h2>
      {active && <p role="status" className="text-xs text-muted">{CREATIVE_STATUS_LABELS[active.status] ?? '处理中'}{active.progress?.message ? ` · ${active.progress.message}` : ''}</p>}
      {hasNew && <Button size="sm" variant="outline" onClick={() => setSelectedId(images[0].artifact.artifactId)}>查看最新结果</Button>}
    </div>
    {selected ? <>
      <a href={selected.artifact.url} target="_blank" rel="noreferrer" aria-label="放大查看当前图片" className="flex min-h-56 items-center justify-center bg-paper p-3">
        <img src={selected.artifact.url} alt="当前生成结果" className="max-h-[55dvh] w-full object-contain" />
      </a>
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <p className="text-xs text-muted">种子 {selected.task.actualSeed ?? '未记录'} · 工作流 v{selected.task.workflowVersion}</p>
        <div className="flex gap-2"><a href={selected.artifact.url} download className="rounded-[var(--radius-control)] border border-border-subtle px-3 py-2 text-xs text-ink">下载图片</a><Button size="sm" variant="outline" onClick={() => onReplay(selected.task)}>复用参数</Button></div>
      </div>
      <div className="flex gap-2 overflow-x-auto border-t border-border-subtle p-3" aria-label="历史图片缩略图">
        {images.slice(0, 24).map(({ artifact }) => <button key={artifact.artifactId} type="button" aria-label={`预览图片 ${artifact.artifactId}`} aria-pressed={selected.artifact.artifactId === artifact.artifactId}
          className={`h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-control)] border-2 ${selected.artifact.artifactId === artifact.artifactId ? 'border-accent' : 'border-transparent'}`}
          onClick={() => setSelectedId(artifact.artifactId)}><img src={artifact.url} alt="" className="h-full w-full object-contain" loading="lazy" /></button>)}
      </div>
    </> : <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-muted"><ImagePlus className="h-8 w-8" aria-hidden="true" /><p className="text-sm">从一段画面描述开始</p><p className="text-xs">生成后的图片会完整显示在这里，可放大查看或复用参数。</p></div>}
  </section>;
}
