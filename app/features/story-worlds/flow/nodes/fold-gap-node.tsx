import React, { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { FoldHorizontal, Clock } from 'lucide-react';
import type { FoldGapNodeData } from '../types';

export const FoldGapNode = memo(function FoldGapNode({ data }: NodeProps) {
  const nodeData = data as unknown as FoldGapNodeData;
  const { gap, onToggleFold } = nodeData;

  const hours = (gap.gapMinutes / 60).toFixed(1);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFold) onToggleFold(gap.id);
  };

  return (
    <div
      role="status"
      aria-label={`空白折叠时段：第 ${gap.startTick} 至 ${gap.endTick} 分钟无事件发生，实际间隔 ${gap.gapMinutes} 分钟（约 ${hours} 小时）`}
      onClick={handleClick}
      className="story-flow-fold-gap select-none transition-all flex flex-col items-center justify-center pointer-events-auto"
      style={{
        width: 100,
        padding: '8px 6px',
        borderRadius: 'var(--radius-control)',
        backgroundColor: 'var(--surface-sunken)',
        border: '1px dashed var(--border-strong)',
        color: 'var(--fg-muted)',
        boxShadow: 'inset 0 1px 2px color-mix(in srgb, var(--fg-default) 3%, transparent)',
      }}
    >
      <div className="flex items-center gap-1 text-xs font-semibold text-fg-default mb-0.5">
        <FoldHorizontal className="w-3.5 h-3.5 text-accent" />
        <span>空闲折叠</span>
      </div>

      <div className="flex items-center gap-0.5 text-xs font-mono text-fg-muted mb-0.5">
        <Clock className="w-2.5 h-2.5 text-fg-subtle" />
        <span>+{gap.gapMinutes}m</span>
      </div>

      <div
        className="text-xs text-center text-fg-subtle leading-tight px-1 py-0.5 rounded"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg-app) 80%, var(--surface))',
        }}
        title={`从第 ${gap.startTick} 分钟至第 ${gap.endTick} 分钟，无角色活动`}
      >
        实际约 {hours} 小时
      </div>
    </div>
  );
});
