'use client';

import React, { useState } from 'react';
import { Check, MoreHorizontal, PlaySquare } from 'lucide-react';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { isImeComposingEvent } from '@/app/lib/hooks/use-cjk-ime-guard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { SaveStatus } from '@/app/components/ui/save-status';
import type { Activity, ContentDocument } from '@sthstart/contracts';
import { StudioMenu, StudioMenuItem } from './studio-menu';

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
  onOpenRework: () => void;
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
  onOpenRework,
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
    if (e.nativeEvent?.isComposing || e.keyCode === 229 || isImeComposingEvent(e)) return;
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  return (
    <WorkspaceHeader
      title={title || '未命名活动'}
      backHref="/apps/activities"
      backLabel="活动列表"
      titleSlot={<Input
        variant="inline"
        aria-label="活动标题"
        value={titleDraft}
        onChange={event => setTitleDraft(event.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="未命名活动"
        className="h-9 min-h-0 w-full min-w-0 max-w-64 px-1 text-base font-semibold text-ink sm:text-sm"
      />}
      status={<span title={saveError || undefined}>
        <SaveStatus
          state={saveStatus}
          detail={saveStatus === 'conflict' ? '请在设置中处理' : undefined}
          className="text-xs"
        />
      </span>}
      centerSlot={<div className="hidden lg:flex"><PageTabs
        ariaLabel="工作台视图"
        variant="local"
        value={viewMode}
        onChange={value => onViewModeChange(value as StudioHeaderProps['viewMode'])}
        tabs={[
          { id: 'storyboard', label: '分镜漫剧' },
          { id: 'comic', label: '漫画工坊' },
          { id: 'materials', label: '素材制作' },
        ]}
      /></div>}
      actions={<>
        <Button size="sm" variant="primary" onClick={onOpenPlayback}><PlaySquare className="size-4" aria-hidden="true" />试演</Button>
        <StudioMenu
          label="更多工作台操作"
          summaryContent={<><MoreHorizontal className="size-4" aria-hidden="true" /><span className="hidden sm:inline">更多</span></>}
        >
          <div className="px-2.5 pb-1 pt-1.5 text-xs text-muted lg:hidden">工作台视图</div>
          {(['storyboard', 'comic', 'materials'] as const).map(mode => <StudioMenuItem
            key={mode}
            className="lg:hidden"
            onSelect={() => onViewModeChange(mode)}
          >
            <span className="flex w-full items-center justify-between">
              {mode === 'storyboard' ? '分镜漫剧' : mode === 'comic' ? '漫画工坊' : '素材制作'}
              {viewMode === mode && <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />}
            </span>
          </StudioMenuItem>)}
          <div className="my-1 h-px bg-border-subtle lg:hidden" />
          <StudioMenuItem onSelect={onOpenArt}>美术指导</StudioMenuItem>
          <StudioMenuItem onSelect={onBatchGenerate} disabled={isBatchGenerating || viewMode !== 'storyboard'}>{isBatchGenerating ? '正在排队…' : '为当前幕批量出图'}</StudioMenuItem>
          <StudioMenuItem onSelect={onOpenSettings}>活动设置</StudioMenuItem>
          <StudioMenuItem onSelect={onOpenExport}>导出交付</StudioMenuItem>
          <StudioMenuItem onSelect={onOpenRework}>内容变化与处理历史</StudioMenuItem>
        </StudioMenu>
      </>}
    />
  );
}
