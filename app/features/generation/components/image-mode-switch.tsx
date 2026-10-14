'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/app/components/ui/button';

export function useImageAdvancedMode(context: string) {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    try {
      // This preference is browser state; drafts and parameters live outside the mode switch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdvanced(localStorage.getItem(`sthstart:image-mode:${context}`) === 'advanced');
    } catch { /* Storage is optional. */ }
  }, [context]);
  const change = (next: boolean) => {
    setAdvanced(next);
    try { localStorage.setItem(`sthstart:image-mode:${context}`, next ? 'advanced' : 'simple'); } catch { /* In-memory mode still works. */ }
  };
  return [advanced, change] as const;
}

export function ImageModeSwitch({ advanced, onChange, modifiedCount = 0, changes = [], onRestore, disabled = false }: {
  advanced: boolean; onChange(value: boolean): void; modifiedCount?: number; changes?: string[]; onRestore?(): void; disabled?: boolean;
}) {
  return <div className="space-y-2">
    <div role="group" aria-label="生图设置模式" className="inline-flex gap-1 rounded-[var(--radius-control)] bg-surface-muted p-1">
      <Button type="button" size="sm" disabled={disabled} variant={!advanced ? 'accent' : 'ghost'} aria-pressed={!advanced} onClick={() => onChange(false)}>简单模式</Button>
      <Button type="button" size="sm" disabled={disabled} variant={advanced ? 'accent' : 'ghost'} aria-pressed={advanced} onClick={() => onChange(true)}>专业模式</Button>
    </div>
    {!advanced && (changes.length || modifiedCount) > 0 && <div className="space-y-2 rounded-[var(--radius-control)] bg-surface-muted p-3 text-xs text-muted" aria-label="生效的专业修改">
      <p>已自定义 {changes.length || modifiedCount} 项专业设置，仍用于本次生成。</p>
      {changes.length > 0 && <p className="break-words">{changes.join(' · ')}</p>}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled} className="text-accent underline" onClick={() => onChange(true)}>查看设置</button>
        {onRestore && <button type="button" disabled={disabled} className="text-accent underline" onClick={onRestore}>恢复专业默认</button>}</div>
    </div>}
  </div>;
}
