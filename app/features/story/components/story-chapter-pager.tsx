'use client';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { StoryDocument } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';

export function StoryChapterPager({
  position, charCount, previous, next, onSwitchChapter, onCreateNextChapter,
}: {
  position: number;
  charCount: number;
  previous: StoryDocument | null;
  next: StoryDocument | null;
  onSwitchChapter?: (chapterId: string) => void;
  onCreateNextChapter?: () => void;
}) {
  if (!previous && !next && !onCreateNextChapter) return null;
  return <div className="mt-10 pt-6 border-t border-border-default/40 flex flex-wrap items-center justify-between gap-3 text-xs">
    {previous ? (
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSwitchChapter?.(previous.id)}
        className="max-w-full gap-1.5 text-muted"
      >
        <ChevronLeft className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">上一章：{previous.title}</span>
      </Button>
    ) : <div />}

    <span className="text-xs text-muted font-mono">第 {position + 1} 章 · {charCount} 字</span>

    {next ? (
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSwitchChapter?.(next.id)}
        className="max-w-full gap-1.5 text-muted"
      >
        <span className="truncate">下一章：{next.title}</span>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
      </Button>
    ) : onCreateNextChapter ? (
      <Button
        size="sm"
        variant="outline"
        onClick={onCreateNextChapter}
        className="gap-1.5 text-accent"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        <span>写下一章</span>
      </Button>
    ) : <div />}
  </div>;
}
