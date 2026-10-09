'use client';

import { Button } from '@/app/components/ui/button';
import { Textarea } from '@/app/components/ui/textarea';

/** Business descriptions stay in the owning editor; this controls only execution overrides. */
export function ImagePromptOverride({ advanced, finalPositivePrompt, promptOptimization, effectiveAI = true,
  finalSupported, sourcePrompt = '', onChange, disabled }: {
  advanced: boolean; finalPositivePrompt?: string; promptOptimization?: boolean; effectiveAI?: boolean;
  finalSupported: boolean; sourcePrompt?: string; disabled?: boolean;
  onChange(patch: { finalPositivePrompt?: string; promptOptimization?: boolean }): void;
}) {
  const manual = finalPositivePrompt !== undefined;
  return <div className="space-y-2 rounded-[var(--radius-control)] bg-surface-muted p-3">
    <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-1" disabled={disabled || manual}
      checked={!manual && (promptOptimization ?? effectiveAI)} onChange={event => onChange({ promptOptimization: event.target.checked })} />
      <span>AI 生成专业提示词<span className="block text-xs text-muted">{manual ? '已使用手动最终提示词，不调用 AI，也不追加风格或触发词。' : '保留角色、动作与构图，整理为适合工作流的描述。'}</span></span>
    </label>
    {advanced && (manual ? <div className="space-y-2">
      <label className="block text-sm font-medium text-ink">手动最终正面提示词<Textarea className="mt-1.5" rows={5} maxLength={20000} disabled={disabled} value={finalPositivePrompt} onChange={event => onChange({ finalPositivePrompt: event.target.value })} /></label>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ finalPositivePrompt: undefined })}>恢复自动组装</Button>
    </div> : finalSupported ? <Button type="button" size="sm" variant="outline" disabled={disabled || !sourcePrompt.trim()} onClick={() => onChange({ finalPositivePrompt: sourcePrompt })}>以当前描述为基础编辑最终提示词</Button>
      : <p className="text-xs text-muted">当前工作流可能在图内追加文本；确认最终提示词直接绑定后，才能完整覆盖。</p>)}
  </div>;
}
