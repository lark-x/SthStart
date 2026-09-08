'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { ImpactPreview } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';

interface ImageImpactReviewProps {
  impact: ImpactPreview | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
}

export function ImageImpactReview({
  impact,
  isOpen,
  onClose,
  onConfirm,
}: ImageImpactReviewProps) {
  if (!impact) return null;

  const affectedCount = impact.affectedSlots.length;
  const reviewNeededCount = impact.affectedSlots.filter((s) => s.needsReview).length;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="设定变更对画面镜头的影响评估"
    >
      <div className="space-y-4 max-w-xl text-slate-200">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>变更的源头字段:</span>
            <code className="text-sm bg-slate-800 text-sky-300 px-1.5 py-0.5 rounded">
              {impact.changedEntityKind}.{impact.fieldPath}
            </code>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm pt-1">
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <span className="text-slate-500 block mb-1">变更前:</span>
              <span className="font-mono text-slate-300 break-all">
                {typeof impact.oldValue === 'object'
                  ? JSON.stringify(impact.oldValue)
                  : String(impact.oldValue || '空')}
              </span>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <span className="text-slate-500 block mb-1">变更后:</span>
              <span className="font-mono text-emerald-400 break-all">
                {typeof impact.newValue === 'object'
                  ? JSON.stringify(impact.newValue)
                  : String(impact.newValue || '空')}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>受影响的媒体镜头 ({affectedCount})</span>
            {reviewNeededCount > 0 && (
              <span className="text-amber-400 font-medium">
                {reviewNeededCount} 个镜头需要重新审核或重新生成
              </span>
            )}
          </div>

          {affectedCount === 0 ? (
            <div className="p-4 text-center text-sm text-slate-400 bg-slate-900/50 rounded border border-slate-800">
              当前没有已绑定的镜头依赖该字段，修改不会影响已生成的画面。
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {impact.affectedSlots.map((slot) => (
                <div
                  key={slot.slotId}
                  className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-200">
                      镜头 ID: <code className="text-sky-300">{slot.slotId}</code>
                    </span>
                    <div className="flex items-center gap-1.5">
                      {slot.needsReview && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          需复核
                        </span>
                      )}
                      {slot.hasActiveAttempt && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-medium bg-sky-950/80 text-sky-300 border border-sky-800/60">
                          生图中
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-slate-400">{slot.reason}</p>

                  <div className="text-sm text-slate-500 font-mono flex items-center gap-2 pt-1 border-t border-slate-800/50">
                    <span>原值哈希: {slot.oldValueHash?.slice(0, 8)}...</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span>新值哈希: {slot.newValueHash?.slice(0, 8)}...</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
          {onConfirm && (
            <Button
              size="sm"
              className="bg-sky-600 hover:bg-sky-500 text-white"
              onClick={() => {
                onConfirm();
                onClose();
              }}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              确认修改并保存
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
