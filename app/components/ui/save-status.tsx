'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, Check, CircleDashed, Loader2, PencilLine } from 'lucide-react';
import { cn } from '../../lib/cn';

export type SaveStatusState = 'idle' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export interface SaveStatusProps {
  state: SaveStatusState;
  /** 冲突等需要补充说明时展示。 */
  detail?: string;
  className?: string;
}

const STATE_META: Record<SaveStatusState, { label: string; className: string } | null> = {
  idle: { label: '未修改', className: 'text-muted' },
  saved: { label: '已保存', className: 'text-success-fg' },
  unsaved: { label: '未保存', className: 'text-muted' },
  saving: { label: '保存中…', className: 'text-muted' },
  error: { label: '保存失败', className: 'text-danger-fg' },
  conflict: { label: '版本冲突', className: 'text-warning-fg' },
};

function StatusIcon({ state }: { state: SaveStatusState }) {
  const className = 'h-3.5 w-3.5 flex-shrink-0';
  switch (state) {
    case 'saved':
      return <Check className={className} aria-hidden="true" />;
    case 'unsaved':
      return <PencilLine className={className} aria-hidden="true" />;
    case 'saving':
      return <Loader2 className={cn(className, 'animate-spin')} aria-hidden="true" />;
    case 'error':
      return <AlertCircle className={className} aria-hidden="true" />;
    case 'conflict':
      return <AlertTriangle className={className} aria-hidden="true" />;
    default:
      return <CircleDashed className={className} aria-hidden="true" />;
  }
}

/**
 * 共享保存状态表达（§7.2）：未修改/未保存/保存中/已保存/失败/冲突。
 * 只提供一致的视觉表达，不重写保存机制；状态由 feature 层的保存逻辑驱动。
 */
export function SaveStatus({ state, detail, className }: SaveStatusProps) {
  const meta = STATE_META[state];
  if (!meta) return null;

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium leading-none', meta.className, className)}
      aria-live="polite"
    >
      <StatusIcon state={state} />
      <span>{meta.label}</span>
      {detail && state === 'conflict' && (
        <span className="text-muted font-normal">· {detail}</span>
      )}
    </span>
  );
}
