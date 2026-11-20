'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  Link as LinkIcon,
  Lock,
  Unlock,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { PromptBlock, SourceRef } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { resolveImageSource } from '@/app/features/activities/api/images';

interface PromptSourcePanelProps {
  activityId: string;
  blocks: PromptBlock[];
  sourceRefs: SourceRef[];
  onLocateSource?: (entityKind: string, entityId: string, fieldPath: string) => void;
  onToggleLock?: (blockId: string) => void;
}

const KIND_COLORS: Record<string, string> = {
  identity: 'bg-tone-violet-soft text-tone-violet-fg border-tone-violet/30',
  appearance: 'bg-info-bg text-info-fg border-info-border',
  outfit: 'bg-info-bg text-info-fg border-info-border',
  scene: 'bg-success-bg text-success-fg border-success-border',
  action: 'bg-warning-bg text-warning-fg border-warning-border',
  composition: 'bg-warning-bg text-warning-fg border-warning-border',
  style: 'bg-tone-pink-soft text-tone-pink-fg border-tone-pink/30',
  negative: 'bg-danger-bg text-danger-fg border-danger-border',
  supplement: 'bg-surface-muted text-fg-default border-border-subtle',
};

const KIND_LABELS: Record<string, string> = {
  identity: '身份',
  appearance: '外貌',
  outfit: '服装',
  scene: '场景',
  action: '动作',
  composition: '构图',
  style: '风格',
  negative: '负向',
  supplement: '补充',
};

export function PromptSourcePanel({
  activityId,
  blocks,
  sourceRefs,
  onLocateSource,
  onToggleLock,
}: PromptSourcePanelProps) {
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [sourceCheckLoading, setSourceCheckLoading] = useState<string | null>(null);
  const [sourceCheckResults, setSourceCheckResults] = useState<
    Record<string, { currentValue: unknown; hasChanged: boolean }>
  >({});

  const sourceRefMap = new Map(sourceRefs.map((r) => [r.id, r]));

  const handleInspectSource = async (refId: string) => {
    try {
      setSourceCheckLoading(refId);
      const res = await resolveImageSource(activityId, refId);
      setSourceCheckResults((prev) => ({
        ...prev,
        [refId]: { currentValue: res.currentValue, hasChanged: res.hasChanged },
      }));
    } catch (err) {
      console.error('Failed to resolve source:', err);
    } finally {
      setSourceCheckLoading(null);
    }
  };

  if (!blocks || blocks.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-fg-muted border border-dashed border-border-subtle rounded-lg">
        尚未生成提示词分块，请点击“准备配方”
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm font-semibold text-fg-muted px-1">
        <span>提示词分块与源头溯源 ({blocks.length})</span>
        <span className="text-sm text-fg-subtle">点击分块可查看来源设定并跳转定位</span>
      </div>

      <div className="space-y-2 max-h-105 overflow-y-auto pr-1">
        {blocks.map((b) => {
          const isExpanded = expandedBlockId === b.id;
          const colorClass = KIND_COLORS[b.kind] || KIND_COLORS.supplement;
          const label = KIND_LABELS[b.kind] || b.kind;
          const refs = (b.sourceRefIds || [])
            .map((id) => sourceRefMap.get(id))
            .filter((r): r is SourceRef => Boolean(r));

          return (
            <div
              key={b.id}
              className={`rounded-lg border bg-surface transition-all ${
                isExpanded ? 'border-info-border shadow-sm' : 'border-border-subtle hover:border-border-subtle'
              }`}
            >
              <div
                className="flex items-start justify-between p-2.5 cursor-pointer select-none"
                onClick={() => setExpandedBlockId(isExpanded ? null : b.id)}
              >
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium border ${colorClass}`}
                  >
                    {label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg-default font-mono break-words leading-relaxed">
                      {b.renderedText}
                    </p>
                    {b.originalText && b.originalText !== b.renderedText && (
                      <p className="text-sm text-fg-muted mt-1 line-through opacity-70">
                        原文: {b.originalText}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                  {onToggleLock && (
                    <IconButton
                      icon={b.locked ? Lock : Unlock}
                      label={b.locked ? '已锁定，AI改写不可变更' : '未锁定'}
                      variant="ghost"
                      size="icon"
                      className="h-7 min-h-7 w-7 text-fg-muted hover:bg-surface-muted hover:text-fg-default"
                      iconClassName={b.locked ? 'h-3.5 w-3.5 text-warning-fg' : 'h-3.5 w-3.5 opacity-50'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLock(b.id);
                      }}
                    />
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-fg-muted" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-fg-muted" />
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-border-subtle bg-surface-sunken text-sm space-y-2">
                  <div className="flex items-center gap-2 text-sm text-fg-muted">
                    <span>来源模式: {b.origin === 'source' ? '源头注入' : b.origin === 'manual' ? '手动覆盖' : 'AI派生'}</span>
                    <span>·</span>
                    <span>精度: {b.mappingPrecision}</span>
                  </div>

                  {refs.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-sm font-medium text-fg-default flex items-center gap-1">
                        <LinkIcon className="w-3 h-3 text-info-fg" />
                        关联设定源头:
                      </div>
                      {refs.map((r) => {
                        const check = sourceCheckResults[r.id];
                        const isChecking = sourceCheckLoading === r.id;

                        return (
                          <div
                            key={r.id}
                            className="bg-surface border border-border-subtle rounded p-2 flex flex-col gap-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-info-fg">
                                {r.labelSnapshot}
                              </span>
                              <div className="flex items-center gap-1">
                                {onLocateSource && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-sm px-2 text-info-fg hover:text-info-fg hover:bg-info-bg"
                                    onClick={() =>
                                      onLocateSource(r.entityKind, r.entityId, r.fieldPath)
                                    }
                                  >
                                    <ExternalLink className="w-3 h-3 mr-1" />
                                    定位源头字段
                                  </Button>
                                )}
                              </div>
                            </div>

                            <div className="text-sm text-fg-muted font-mono">
                              字段路径: <span className="text-fg-default">{r.fieldPath}</span>
                            </div>

                            <div className="text-sm bg-surface-sunken p-1.5 rounded border border-border-subtle text-fg-default font-mono break-all">
                              快照值: {JSON.stringify(r.valueSnapshot)}
                            </div>

                            <div className="flex items-center justify-between pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-sm px-2 text-fg-default"
                                disabled={isChecking}
                                onClick={() => handleInspectSource(r.id)}
                              >
                                {isChecking ? '比对中...' : '检查源头是否修改'}
                              </Button>

                              {check && (
                                <div className="flex items-center gap-1 text-sm">
                                  {check.hasChanged ? (
                                    <span className="text-warning-fg flex items-center gap-0.5">
                                      <AlertTriangle className="w-3 h-3" />
                                      已与源头发生漂移 (需更新配方)
                                    </span>
                                  ) : (
                                    <span className="text-success-fg">与当前设定完全一致</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-fg-subtle italic">
                      无直接引用的结构化字段 (手动补充或预设提示词)
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
