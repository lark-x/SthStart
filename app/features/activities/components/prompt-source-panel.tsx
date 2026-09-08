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
import { resolveImageSource } from '../api';

interface PromptSourcePanelProps {
  activityId: string;
  blocks: PromptBlock[];
  sourceRefs: SourceRef[];
  onLocateSource?: (entityKind: string, entityId: string, fieldPath: string) => void;
  onToggleLock?: (blockId: string) => void;
}

const KIND_COLORS: Record<string, string> = {
  identity: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  appearance: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/50',
  outfit: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  scene: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
  action: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  composition: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  style: 'bg-pink-900/40 text-pink-300 border-pink-700/50',
  negative: 'bg-red-900/40 text-red-300 border-red-700/50',
  supplement: 'bg-gray-800/40 text-gray-300 border-gray-700/50',
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
      <div className="p-4 text-center text-sm text-slate-400 border border-dashed border-slate-800 rounded-lg">
        尚未生成提示词分块，请点击“准备配方”
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm font-semibold text-slate-400 px-1">
        <span>提示词分块与源头溯源 ({blocks.length})</span>
        <span className="text-sm text-slate-500">点击分块可查看来源设定并跳转定位</span>
      </div>

      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
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
              className={`rounded-lg border bg-slate-900/60 transition-all ${
                isExpanded ? 'border-sky-500/50 shadow-sm' : 'border-slate-800 hover:border-slate-700'
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
                    <p className="text-sm text-slate-200 font-mono break-words leading-relaxed">
                      {b.renderedText}
                    </p>
                    {b.originalText && b.originalText !== b.renderedText && (
                      <p className="text-sm text-slate-400 mt-1 line-through opacity-70">
                        原文: {b.originalText}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                  {onToggleLock && (
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-200 p-1 rounded"
                      title={b.locked ? '已锁定，AI改写不可变更' : '未锁定'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLock(b.id);
                      }}
                    >
                      {b.locked ? (
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5 opacity-50" />
                      )}
                    </button>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-800/80 bg-slate-950/40 text-sm space-y-2">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <span>来源模式: {b.origin === 'source' ? '源头注入' : b.origin === 'manual' ? '手动覆盖' : 'AI派生'}</span>
                    <span>·</span>
                    <span>精度: {b.mappingPrecision}</span>
                  </div>

                  {refs.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-sm font-medium text-slate-300 flex items-center gap-1">
                        <LinkIcon className="w-3 h-3 text-sky-400" />
                        关联设定源头:
                      </div>
                      {refs.map((r) => {
                        const check = sourceCheckResults[r.id];
                        const isChecking = sourceCheckLoading === r.id;

                        return (
                          <div
                            key={r.id}
                            className="bg-slate-900 border border-slate-800 rounded p-2 flex flex-col gap-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sky-300">
                                {r.labelSnapshot}
                              </span>
                              <div className="flex items-center gap-1">
                                {onLocateSource && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-sm px-2 text-sky-400 hover:text-sky-300 hover:bg-sky-950/40"
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

                            <div className="text-sm text-slate-400 font-mono">
                              字段路径: <span className="text-slate-300">{r.fieldPath}</span>
                            </div>

                            <div className="text-sm bg-slate-950/80 p-1.5 rounded border border-slate-800/60 text-slate-300 font-mono break-all">
                              快照值: {JSON.stringify(r.valueSnapshot)}
                            </div>

                            <div className="flex items-center justify-between pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-sm px-2 text-slate-300"
                                disabled={isChecking}
                                onClick={() => handleInspectSource(r.id)}
                              >
                                {isChecking ? '比对中...' : '检查源头是否修改'}
                              </Button>

                              {check && (
                                <div className="flex items-center gap-1 text-sm">
                                  {check.hasChanged ? (
                                    <span className="text-amber-400 flex items-center gap-0.5">
                                      <AlertTriangle className="w-3 h-3" />
                                      已与源头发生漂移 (需更新配方)
                                    </span>
                                  ) : (
                                    <span className="text-emerald-400">与当前设定完全一致</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 italic">
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
