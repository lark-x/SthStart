'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import type { PlaybackAction } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Input } from '@/app/components/ui/input';
import { ACTION_LABELS, formatTime } from '../model';

export interface PlaybackTimelineInspectorProps {
  actions: PlaybackAction[];
  currentTimeMs: number;
  disabled?: boolean;
  onUpdateActionDuration: (index: number, newDurationMs: number) => void;
}

export function PlaybackTimelineInspector({
  actions,
  currentTimeMs,
  disabled,
  onUpdateActionDuration,
}: PlaybackTimelineInspectorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">
          回放动作序列 ({actions.length})
        </span>
        <span className="text-sm text-muted">按时间顺序单向执行</span>
      </div>

      {/* 外层右栏已经独立滚动，这里不再叠加第二层 max-height，避免出现嵌套滚动条。 */}
      <div className="rounded-panel bg-surface border border-border-default p-3 space-y-2">
        {actions.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="当前尚无回放动作序列"
            description="点击顶部“自动生成编排”，系统将计算最适阅读节奏与镜头切换。"
            className="min-h-48"
          />
        ) : (
          actions.map((act, index) => {
            const isActive =
              currentTimeMs >= act.atMs && currentTimeMs < act.atMs + act.durationMs;

            return (
              <div
                key={act.id || index}
                className={`p-2.5 rounded-lg border text-sm transition-all ${
                  isActive
                    ? 'border-accent bg-accent/5 shadow-xs ring-1 ring-accent'
                    : 'border-border-subtle bg-surface-raised'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-sm font-mono">
                      #{index + 1}
                    </Badge>
                    <span className="font-semibold text-ink font-mono">
                      {ACTION_LABELS[act.type] || act.type}
                    </span>
                    {act.view && (
                      <Badge variant="outline" className="text-sm bg-surface-muted">
                        {act.view === 'chat' ? '群聊' : '朋友圈'}
                      </Badge>
                    )}
                    {act.targetType && (
                      <span className="text-sm text-muted">
                        目标: {act.targetType} ({act.targetId?.slice(0, 8)})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted font-mono">
                      {formatTime(act.atMs)}
                    </span>
                    <div className="flex items-center gap-1">
                      <div className="w-20">
                        <Input
                        type="number"
                        value={act.durationMs}
                        onChange={(e) =>
                          onUpdateActionDuration(index, Number(e.target.value))
                        }
                        step={200}
                        min={200}
                        disabled={disabled}
                        aria-label={`动作 ${index + 1} 时长`}
                        className="h-7 min-h-7 text-sm text-right font-mono"
                        />
                      </div>
                      <span className="text-sm text-muted">ms</span>
                    </div>
                  </div>
                </div>

                {act.kind && (
                  <div className="text-sm text-muted mt-1">
                    {act.kind === 'video' ? '视频' : '图片'} · 镜头 {act.slotId}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
