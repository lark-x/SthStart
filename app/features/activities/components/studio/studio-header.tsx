'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  LoaderCircle,
  PlaySquare,
  Settings2,
  Sparkles,
  AlertCircle,
  Film,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import type { Activity, ContentDocument } from '@sthstart/contracts';

interface StudioHeaderProps {
  activity: Activity;
  document: ContentDocument;
  saveStatus: 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
  saveError: string | null;
  viewMode: 'storyboard' | 'comic' | 'materials';
  onViewModeChange: (mode: 'storyboard' | 'comic' | 'materials') => void;
  onUpdateTitle: (newTitle: string) => void;
  onOpenPlayback: () => void;
  onBatchGenerate: () => void;
  isBatchGenerating?: boolean;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onOpenArt: () => void;
}

export function StudioHeader({
  activity,
  document,
  saveStatus,
  saveError,
  viewMode,
  onViewModeChange,
  onUpdateTitle,
  onOpenPlayback,
  onBatchGenerate,
  isBatchGenerating = false,
  onOpenSettings,
  onOpenExport,
  onOpenArt,
}: StudioHeaderProps) {
  const title = document.activity.title || activity.title || '';
  const [sourceTitle, setSourceTitle] = useState(title);
  const [titleDraft, setTitleDraft] = useState(title);
  if (sourceTitle !== title) { setSourceTitle(title); setTitleDraft(title); }

  const handleBlur = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== document.activity.title) {
      onUpdateTitle(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  return (
    <header className="h-12 border-b border-border-default bg-surface px-3 flex items-center justify-between shrink-0 select-none z-20">
      {/* 左侧：返回、标题行内编辑与状态 */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Link
          href="/apps/activities"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-surface-muted transition-colors shrink-0"
          title="返回活动列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        {/* 标题行内输入框 */}
        <div className="flex items-center gap-2 min-w-0">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="未命名活动"
            className="h-7 w-24 sm:w-40 lg:w-56 min-w-0 truncate rounded px-1.5 text-sm font-bold text-ink bg-transparent border border-transparent hover:border-border-default focus:border-accent focus:bg-surface-raised outline-none transition-all"
            title="点击修改活动标题"
          />

          {document.activity.theme && (
            <span className="hidden xl:inline-block text-xs text-muted truncate max-w-[120px]">
              · {document.activity.theme}
            </span>
          )}
        </div>

        {/* 自动保存状态指示 */}
        <div className="hidden sm:flex items-center gap-1.5 pl-1.5 text-[11px] shrink-0">
          {saveStatus === 'saving' && (
            <span className="inline-flex items-center gap-1 text-muted">
              <LoaderCircle className="h-3 w-3 animate-spin text-accent" />
              <span>保存中</span>
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
              <CheckCircle2 className="h-3 w-3" />
              <span>已保存</span>
            </span>
          )}
          {saveStatus === 'unsaved' && (
            <span className="inline-flex items-center gap-1 text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>有未存修改</span>
            </span>
          )}
          {saveStatus === 'conflict' && (
            <span className="inline-flex items-center gap-1 text-red-600 font-medium" title={saveError || '保存冲突'}>
              <AlertCircle className="h-3 w-3" />
              <span>草稿冲突</span>
            </span>
          )}
        </div>
      </div>

      {/* 中间：视图模式切换（分镜漫剧 vs 漫画排版） */}
      <select aria-label="桌面工作台视图" className="hidden md:block xl:hidden rounded border border-border-control bg-surface px-2 py-1 text-xs" value={viewMode} onChange={event => onViewModeChange(event.target.value as StudioHeaderProps['viewMode'])}><option value="storyboard">分镜漫剧</option><option value="comic">漫画工坊</option><option value="materials">素材制作</option></select>
      <div className="hidden xl:inline-flex items-center whitespace-nowrap rounded-lg bg-surface-muted p-0.5 text-xs font-semibold">
        <button
          type="button"
          onClick={() => onViewModeChange('storyboard')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
            viewMode === 'storyboard'
              ? 'bg-surface text-ink font-bold shadow-2xs'
              : 'text-muted hover:text-ink'
          }`}
        >
          <Film className="h-3.5 w-3.5" />
          <span>分镜漫剧</span>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('comic')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
            viewMode === 'comic'
              ? 'bg-surface text-ink font-bold shadow-2xs'
              : 'text-muted hover:text-ink'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>漫画工坊</span>
        </button>
        <button type="button" onClick={() => onViewModeChange('materials')} className={`rounded-md px-3 py-1 ${viewMode === 'materials' ? 'bg-surface text-ink shadow-2xs' : 'text-muted hover:text-ink'}`}>素材制作</button>
      </div>

      {/* 右侧：核心动作组 */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="outline" onClick={onOpenArt} className="h-8 px-2 text-xs">美术</Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onBatchGenerate}
          disabled={isBatchGenerating}
          className="hidden 2xl:inline-flex h-8 px-2.5 text-xs text-accent border-accent/30 hover:bg-accent/10 font-semibold cursor-pointer"
          title="为当前幕所有尚未配图的镜头排队生图"
        >
          {isBatchGenerating ? (
            <LoaderCircle className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          <span className="hidden sm:inline">一键全幕出图</span>
          <span className="sm:hidden">出图</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={onOpenPlayback}
          className="h-8 px-2.5 text-xs font-semibold cursor-pointer"
          title="连贯预览演播"
        >
          <PlaySquare className="h-3.5 w-3.5 mr-1 text-ink" />
          <span className="hidden sm:inline">连贯试演</span>
          <span className="sm:hidden">试演</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={onOpenSettings}
          className="h-8 px-2 text-xs font-medium cursor-pointer"
          title="活动设置与画风预设"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline ml-1">设置</span>
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenExport}
          className="hidden lg:inline-flex h-8 px-2 text-xs font-medium text-muted hover:text-ink cursor-pointer"
          title="导出交付与画廊"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden lg:inline ml-1">导出</span>
        </Button>
      </div>
    </header>
  );
}
