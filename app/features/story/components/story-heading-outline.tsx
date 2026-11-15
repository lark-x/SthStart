'use client';

import { Button } from '@/app/components/ui/button';
import { canvasWidthClass, type CanvasWidth } from '../model/story-editor-preferences';
import type { HeadingEntry } from '../model/story-editor-text';

export function StoryHeadingOutline({ headings, canvasWidth, onJump }: {
  headings: HeadingEntry[];
  canvasWidth: CanvasWidth;
  onJump: (line: number) => void;
}) {
  if (!headings.length) return null;
  return (
    <details
      className={`mb-4 mx-auto w-full rounded-control border border-border-default bg-surface/60 px-3 py-2 transition-all ${canvasWidthClass(canvasWidth)}`}
    >
    <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">章节目录（{headings.length}）</summary>
    <div className="mt-2 space-y-1">
      {headings.map((heading) => (
        <Button
          key={`${heading.line}-${heading.text}`}
          type="button"
          size="sm"
          variant="ghost"
          className="h-auto min-h-0 w-full justify-start rounded-none px-0 py-0.5 text-left text-xs font-normal text-muted hover:bg-transparent hover:text-ink sm:min-h-0 [&_.ui-mantine-button-inner]:w-full [&_.ui-mantine-button-inner]:justify-start [&_.ui-mantine-button-label]:block [&_.ui-mantine-button-label]:w-full [&_.ui-mantine-button-label]:truncate"
          style={{ paddingLeft: `${(heading.depth - 1) * 12}px` }}
          onClick={() => onJump(heading.line)}
        >
          {heading.text}
        </Button>
      ))}
      </div>
    </details>
  );
}
