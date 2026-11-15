'use client';

import { useState } from 'react';
import { Film, Save, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import type { CanvasWidth, FontChoice, PaperTheme, ViewMode } from '../model/story-editor-preferences';
import { StoryEditorPreferencesDialog } from './story-editor-preferences-dialog';

export function StoryEntryToolbar({
  label, revision, statusLabel, statusDanger, charCount, readMinutes,
  mode, onModeChange, isReflection, saveDisabled, onSave,
  theme, onThemeChange, font, onFontChange, indent2em, onIndent2emChange,
  canvasWidth, onCanvasWidthChange, zenMode, onToggleZen, onOpenDerivatives,
}: {
  label: string;
  revision: number;
  statusLabel: string;
  statusDanger: boolean;
  charCount: number;
  readMinutes: number;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  isReflection: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  theme: PaperTheme;
  onThemeChange: (theme: PaperTheme) => void;
  font: FontChoice;
  onFontChange: (font: FontChoice) => void;
  indent2em: boolean;
  onIndent2emChange: (value: boolean) => void;
  canvasWidth: CanvasWidth;
  onCanvasWidthChange: (width: CanvasWidth) => void;
  zenMode?: boolean;
  onToggleZen?: () => void;
  onOpenDerivatives?: () => void;
}) {
  const [showPreferences, setShowPreferences] = useState(false);

  return <div className="story-editor-toolbar flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-1 sm:px-4">
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="hidden shrink-0 font-medium text-muted sm:inline">{label} · v{revision}</span>
      <span className={`max-w-16 truncate sm:max-w-none ${statusDanger ? 'text-danger-fg' : 'text-muted'}`} role="status">
        {statusLabel}
      </span>
      <span className="hidden shrink-0 text-muted sm:inline">· {charCount.toLocaleString('zh-CN')} 字 · {readMinutes} 分钟</span>
    </div>

    <div className="flex min-w-0 items-center gap-1 sm:gap-2">
      <StoryEditorPreferencesDialog
        open={showPreferences}
        onOpenChange={setShowPreferences}
        theme={theme} onThemeChange={onThemeChange}
        font={font} onFontChange={onFontChange}
        indent2em={indent2em} onIndent2emChange={onIndent2emChange}
        canvasWidth={canvasWidth} onCanvasWidthChange={onCanvasWidthChange}
      />

      {/* 视图模式切换 */}
      <div className="flex rounded-control border border-border-default p-0.5 bg-surface" role="group" aria-label="编辑器视图">
        {(isReflection
          ? [['source', '源码'], ['split', '分屏'], ['preview', '预览']] as const
          : [['source', '源码'], ['split', '分屏'], ['preview', '预览'], ['script', '剧本流']] as const
        ).map(([value, text]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            className="ui-choice h-auto min-h-0 rounded-control px-1.5 py-1.5 text-sm font-normal text-muted hover:bg-surface-hover sm:min-h-0"
          >
            {text}
          </Button>
        ))}
      </div>

      {/* 编辑器溢出菜单：排版偏好、专注模式与衍生产物 */}
      <RowActionsMenu
        label="更多编辑器操作"
        items={[
          {
            label: '排版与底色偏好',
            icon: <SlidersHorizontal className="size-4 text-muted" aria-hidden="true" />,
            onSelect: () => setShowPreferences(true),
          },
          ...(onToggleZen ? [{
            label: zenMode ? '退出专注模式' : '专注写作模式',
            icon: <Sparkles className="size-4 text-muted" aria-hidden="true" />,
            onSelect: onToggleZen,
          }] : []),
          ...(onOpenDerivatives ? [{
            label: '衍生产物与导出',
            icon: <Film className="size-4 text-muted" aria-hidden="true" />,
            onSelect: onOpenDerivatives,
          }] : []),
          {
            label: '保存当前修订',
            icon: <Save className="size-4 text-muted" aria-hidden="true" />,
            onSelect: onSave,
            hidden: saveDisabled,
          },
        ]}
      />

      <Button size="sm" variant="primary" className="px-2 sm:px-3" onClick={onSave} disabled={saveDisabled}>
        <Save className="size-4" />保存
      </Button>
    </div>
  </div>;
}
