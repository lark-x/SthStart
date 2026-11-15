'use client';

import { Bold, ClipboardPaste, Code2, Heading2, Italic, List, Quote, Type } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { canvasWidthClass, type CanvasWidth } from '../model/story-editor-preferences';

export function StoryEntryFormatBar({
  canvasWidth, expanded, onExpand, onInsert, onFormatIndentation, onAdoptClipboard,
}: {
  canvasWidth: CanvasWidth;
  expanded: boolean;
  onExpand: () => void;
  onInsert: (prefix: string, suffix?: string) => void;
  onFormatIndentation: () => void;
  onAdoptClipboard: () => void;
}) {
  return <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 w-full mx-auto transition-all ${canvasWidthClass(canvasWidth)}`}>
    {expanded ? (
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="排版工具">
        <Button size="icon" variant="ghost" aria-label="插入二级标题" title="二级标题" onClick={() => onInsert('## ')}><Heading2 className="size-4" aria-hidden="true" /></Button>
        <Button size="icon" variant="ghost" aria-label="加粗所选文字" title="粗体" onClick={() => onInsert('**', '**')}><Bold className="size-4" aria-hidden="true" /></Button>
        <Button size="icon" variant="ghost" aria-label="设为斜体" title="斜体" onClick={() => onInsert('*', '*')}><Italic className="size-4" aria-hidden="true" /></Button>
        <Button size="icon" variant="ghost" aria-label="插入引用" title="引用" onClick={() => onInsert('> ')}><Quote className="size-4" aria-hidden="true" /></Button>
        <Button size="icon" variant="ghost" aria-label="插入列表项" title="列表项" onClick={() => onInsert('- ')}><List className="size-4" aria-hidden="true" /></Button>
        <Button size="icon" variant="ghost" aria-label="插入代码块" title="代码块" onClick={() => onInsert('```\n', '\n```')}><Code2 className="size-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" title="一键全书段首空两格" onClick={onFormatIndentation} className="text-xs">
          段首空两格
        </Button>
        <Button size="sm" variant="ghost" title="一键将剪贴板中的草稿采纳到正文" onClick={onAdoptClipboard} className="text-xs gap-1 font-medium">
          <ClipboardPaste className="size-3.5" aria-hidden="true" />
          <span>采纳草稿</span>
        </Button>
      </div>
    ) : (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onExpand}
        className="h-auto min-h-0 rounded px-2 py-1 text-xs font-normal text-muted hover:text-ink sm:min-h-0 [&_.ui-mantine-button-label]:gap-1.5"
      >
        <Type className="size-3.5" aria-hidden="true" />
        <span>排版工具</span>
      </Button>
    )}
    <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
      <span>输入 <code className="rounded bg-surface-sunken px-1">@</code> 快速录入角色对白</span>
    </div>
  </div>;
}
