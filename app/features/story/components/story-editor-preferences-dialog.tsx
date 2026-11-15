'use client';

import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Switch } from '@/app/components/ui/switch';
import {
  fontFamilies, themeNames,
  type CanvasWidth, type FontChoice, type PaperTheme,
} from '../model/story-editor-preferences';

export function StoryEditorPreferencesDialog({
  open, onOpenChange, theme, onThemeChange, font, onFontChange,
  canvasWidth, onCanvasWidthChange, indent2em, onIndent2emChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: PaperTheme;
  onThemeChange: (theme: PaperTheme) => void;
  font: FontChoice;
  onFontChange: (font: FontChoice) => void;
  canvasWidth: CanvasWidth;
  onCanvasWidthChange: (width: CanvasWidth) => void;
  indent2em: boolean;
  onIndent2emChange: (value: boolean) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange} title="排版与底色偏好" size="sm">
    {/* 纸感底色 */}
    <div className="mb-3">
      <label className="text-sm font-medium text-muted block mb-1.5">纸感底色</label>
      <div className="grid grid-cols-2 gap-1.5">
        {(['interface', 'parchment', 'pure', 'midnight', 'sage'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={theme === value}
            onClick={() => onThemeChange(value)}
            className={`min-h-11 justify-start rounded border px-2 py-1.5 text-sm text-left [&_.ui-mantine-button-inner]:w-full [&_.ui-mantine-button-inner]:justify-start [&_.ui-mantine-button-label]:gap-2 ${
              theme === value
                ? 'border-accent bg-accent/10 font-medium text-accent shadow-sm hover:bg-accent/10 hover:text-accent'
                : 'border-border-default/80 bg-surface-muted/50 text-ink hover:bg-surface-hover'
            }`}
          >
            <span
              className="story-reading-paper size-3.5 rounded-full border border-border-subtle shrink-0"
              data-reading-theme={value}
              style={{ backgroundColor: 'var(--story-paper)' }}
            />
            <span className="truncate">{themeNames[value]}</span>
          </Button>
        ))}
      </div>
    </div>

    {/* 字体家族 */}
    <div className="mb-3">
      <label className="text-sm font-medium text-muted block mb-1.5">正文字体</label>
      <div className="grid grid-cols-3 gap-1">
        {(['serif', 'kai', 'sans'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={font === value}
            onClick={() => onFontChange(value)}
            className={`min-h-11 rounded border px-2 py-1 text-sm text-center ${
              font === value
                ? 'border-accent bg-accent/10 font-semibold text-accent hover:bg-accent/10 hover:text-accent'
                : 'border-border-default/80 bg-surface-muted/50 text-muted hover:text-ink'
            }`}
          >
            {fontFamilies[value].name.replace('思源', '')}
          </Button>
        ))}
      </div>
    </div>

    {/* 画布宽度 */}
    <div className="mb-3">
      <label className="text-sm font-medium text-muted block mb-1.5">写作画布宽度</label>
      <div className="grid grid-cols-3 gap-1">
        {([
          ['wide', '宽屏 (1024)'],
          ['comfortable', '舒适 (768)'],
          ['full', '全宽 (100%)'],
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={canvasWidth === value}
            onClick={() => onCanvasWidthChange(value)}
            className={`min-h-11 rounded border px-1.5 py-1 text-sm text-center ${
              canvasWidth === value
                ? 'border-accent bg-accent/10 font-semibold text-accent hover:bg-accent/10 hover:text-accent'
                : 'border-border-default/80 bg-surface-muted/50 text-muted hover:text-ink'
            }`}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>

    {/* 段首缩进 */}
    <div className="border-t border-border-default/60 pt-2">
      <Switch
        label="段首空两格"
        description="正文段落缩进 2em"
        checked={indent2em}
        onChange={(event) => onIndent2emChange(event.target.checked)}
      />
    </div>
  </Dialog>;
}
