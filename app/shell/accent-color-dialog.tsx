'use client';

import { useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { ACCENT_PRESETS as COLORS, deriveCustomAccent, normalizeAccentColor } from '@/app/lib/theme-preference';
import { useTheme } from '@/app/providers/ui-provider';

export function AccentColorDialog({ onClose }: { onClose: () => void }) {
  const { accentColor, colorMode, setAccentColor } = useTheme();
  const [draft, setDraft] = useState(accentColor ?? COLORS[0][1]);
  const fieldId = useId();
  const hexRef = useRef<HTMLInputElement>(null);
  const hex = normalizeAccentColor(draft);
  const preview = hex ? deriveCustomAccent(hex, colorMode === 'dark') : 'var(--accent)';
  const apply = (color: string | null) => {
    setAccentColor(color);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      initialFocusRef={hexRef}
      title="自定义主题色"
      description="调整按钮、选中项和焦点的强调色。皮肤底色不变，设置保存在当前浏览器。"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto" disabled={!accentColor} onClick={() => apply(null)}>恢复默认</Button>
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button type="submit" form={fieldId} variant="primary" size="sm" disabled={!hex}>应用</Button>
        </>
      }
    >
      <form id={fieldId} className="space-y-4" onSubmit={event => { event.preventDefault(); if (hex) apply(hex); }}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="预设颜色">
          {COLORS.map(([name, color]) => (
            <Button
              key={color}
              type="button"
              size="icon"
              variant="outline"
              className="size-11 sm:size-10 sm:min-h-10 rounded-control border-border-default bg-surface-raised p-0 enabled:hover:bg-surface-hover"
              aria-label={name}
              title={name}
              aria-pressed={color === hex}
              onClick={() => setDraft(color)}
            >
              <span className="grid size-6 place-items-center rounded-full text-on-media" style={{ backgroundColor: deriveCustomAccent(color, false) }}>
                {color === hex && <Check size={14} aria-hidden="true" />}
              </span>
            </Button>
          ))}
        </div>
        <label className="block text-sm font-medium text-ink" htmlFor={fieldId + '-hex'}>颜色代码</label>
        <div className="flex gap-2 [&_.ui-mantine-input-wrapper]:min-w-0 [&_.ui-mantine-input-wrapper]:flex-1">
          <input
            type="color"
            className="size-10 shrink-0 cursor-pointer rounded-control border border-border-control bg-surface-raised p-1"
            aria-label="打开取色器"
            value={hex ?? accentColor ?? COLORS[0][1]}
            onChange={event => setDraft(event.target.value)}
          />
          <Input
            ref={hexRef}
            id={fieldId + '-hex'}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!hex}
            aria-describedby={fieldId + '-help'}
            className="h-10 font-mono text-sm"
          />
        </div>
        <p id={fieldId + '-help'} className="text-xs text-muted">
          {hex ? '预览会随浅色或深色皮肤调整，确保文字易读。' : `请输入六位颜色代码，例如 ${COLORS[0][1]}。`}
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-border-subtle bg-surface-sunken p-3 text-sm" aria-label="效果预览" role="group">
          <span className="mr-auto text-muted">效果预览</span>
          <span className="rounded-control px-2.5 py-1.5 font-medium" style={{ backgroundColor: preview, color: 'var(--fg-on-accent)' }}>主要按钮</span>
          <span className="rounded-control px-2.5 py-1.5 font-medium" style={{ backgroundColor: `color-mix(in srgb, ${preview} 14%, transparent)`, color: 'var(--fg-default)', boxShadow: `inset 0 -2px ${preview}` }}>已选中</span>
        </div>
      </form>
    </Dialog>
  );
}
