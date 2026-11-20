'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Skeleton } from '@/app/components/ui/skeleton';

interface NoteEditorStateProps {
  standalone: boolean;
  listActions?: React.ReactNode;
}

/** 服务端笔记加载失败且本机没有副本时的停用态，避免空白编辑器覆盖原文。 */
export function NoteEditorUnavailable({ standalone, listActions, onRetry }: NoteEditorStateProps & { onRetry: () => void }) {
  const MainTag = standalone ? 'main' : 'div';
  return (
    <MainTag className="notebook-editor-page notebook-editor-shell w-full bg-surface text-ink">
      {standalone && <h1 className="sr-only">创作笔记编辑器</h1>}
      <div className="flex items-center gap-2 px-4 py-2">{listActions}</div>
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-lg font-semibold text-ink">笔记打开失败</p>
        <p className="max-w-sm text-sm text-muted">
          无法从服务端加载这篇笔记，本机也没有离线副本。为避免覆盖原内容，编辑器已停用。
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onRetry}>
            重试
          </Button>
          <Link
            href="/apps/notebook"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回笔记列表</span>
          </Link>
        </div>
      </div>
    </MainTag>
  );
}

export function NoteEditorLoading({ standalone, listActions }: NoteEditorStateProps) {
  const MainTag = standalone ? 'main' : 'div';
  return (
    <MainTag className="notebook-editor-page notebook-editor-shell w-full bg-surface text-ink">
      {standalone && <h1 className="sr-only">创作笔记编辑器</h1>}
      <header className="notebook-editor-header sticky top-0 z-20 flex items-center justify-between gap-4 px-5 sm:px-8 py-2 bg-surface/95 backdrop-blur-md border-b border-border-subtle">
        {listActions}
        {standalone ? (
          <Link
            href="/apps/notebook"
            className="notebook-back-link inline-flex min-h-8.5 items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回笔记列表</span>
          </Link>
        ) : (
          <span className="notebook-save-status text-sm text-muted" aria-live="polite">
            正在打开笔记…
          </span>
        )}
        <span className="h-8 w-16" aria-hidden="true" />
      </header>
      <div className="notebook-editor-frame max-w-4xl mx-auto px-5 sm:px-8 py-6 space-y-4">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    </MainTag>
  );
}
