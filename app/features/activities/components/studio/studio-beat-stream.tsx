'use client';

import React from 'react';
import {
  Clock,
  Film,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  ActivityScene,
  ActorSnapshot,
  SceneBeat,
  StageDefinition,
} from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { ScrollFadeContainer } from '@/app/components/ui/scroll-fade-container';
import { isImeComposingEvent } from '@/app/lib/hooks/use-cjk-ime-guard';
import { StudioBeatCard } from './studio-beat-card';
import { StudioMenu, StudioMenuItem } from './studio-menu';

interface StudioBeatStreamProps {
  stage: StageDefinition;
  scene: ActivityScene | null;
  actors: ActorSnapshot[];
  selectedBeatId: string | null;
  onSelectBeat: (beatId: string) => void;
  onUpdateBeat: (beatId: string, patch: Partial<SceneBeat>) => void;
  onAddBeat: (insertIndex?: number) => void;
  onDeleteBeat: (beatId: string) => void;
  onUpdateScene: (patch: Partial<ActivityScene>) => void;
  onDeleteScene: (sceneId: string) => void;
  onQuickGenerateBeat: (beat: SceneBeat) => void;
  generatingBeatIds?: Set<string>;
}

export function StudioBeatStream({
  scene,
  actors,
  selectedBeatId,
  onSelectBeat,
  onUpdateBeat,
  onAddBeat,
  onDeleteBeat,
  onUpdateScene,
  onDeleteScene,
  onQuickGenerateBeat,
  generatingBeatIds = new Set(),
}: StudioBeatStreamProps) {
  if (!scene) {
    return (
      <div className="flex flex-1 items-center justify-center bg-paper p-8">
        <div className="max-w-sm space-y-2 text-center">
          <Film className="mx-auto h-8 w-8 text-muted/50" />
          <h3 className="text-sm font-semibold text-ink">本幕暂无场次</h3>
          <p className="text-sm leading-6 text-muted">
            在左侧大纲中选择或新建场次，即可开始编排分镜。
          </p>
        </div>
      </div>
    );
  }

  const beats = scene.beats || [];
  const cleanTitle = scene.title.replace(/^(第\s*[一二三四五六七八九十0-9]+\s*场[：:\s]*)/, '') || scene.title;

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposingEvent(event)) return;
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper">
      {/* 场次工具条：单一主动作 + 上下文菜单 */}
      <div className="flex h-11 shrink-0 select-none items-center justify-between gap-2 border-b border-border-subtle bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            aria-label="场次标题"
            value={cleanTitle}
            onChange={(e) => onUpdateScene({ title: e.target.value })}
            onKeyDown={handleTitleKeyDown}
            placeholder="场次标题"
            className="h-8 w-full min-w-0 max-w-56 truncate border-0 border-b border-transparent bg-transparent px-0 text-base font-semibold text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted/60 hover:border-border-subtle focus:border-accent md:text-sm"
            title="点击修改场次标题"
          />

          {scene.locationText && (
            <span className="hidden min-w-0 items-center gap-1 truncate text-xs text-muted sm:inline-flex">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{scene.locationText}</span>
            </span>
          )}

          {scene.timeText && (
            <span className="hidden shrink-0 items-center gap-1 text-xs text-muted md:inline-flex">
              <Clock className="h-3 w-3" />
              <span>{scene.timeText}</span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onAddBeat()} className="h-8">
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加分镜
          </Button>
          <StudioMenu label="场次操作">
            <StudioMenuItem danger onSelect={() => onDeleteScene(scene.id)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              删除此场次
            </StudioMenuItem>
          </StudioMenu>
        </div>
      </div>

      {/* 连续分镜流：行间分隔线代替独立卡片 */}
      <ScrollFadeContainer orientation="vertical" fadeSize={16} className="min-h-0 flex-1" data-autohide-scroll>
        <div className="mx-auto w-full max-w-3xl px-2 py-2 sm:px-4">
          {beats.length === 0 ? (
            <div className="space-y-2 px-4 py-16 text-center">
              <p className="text-sm text-muted">本场次还没有分镜镜头</p>
              <Button size="sm" variant="ghost" onClick={() => onAddBeat()}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                添加第 1 个分镜
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {beats.map((beat, idx) => (
                <StudioBeatCard
                  key={beat.id}
                  index={idx}
                  beat={beat}
                  actors={actors}
                  isSelected={selectedBeatId === beat.id}
                  onSelect={() => onSelectBeat(beat.id)}
                  onUpdate={(patch) => onUpdateBeat(beat.id, patch)}
                  onDelete={() => onDeleteBeat(beat.id)}
                  onInsertBelow={() => onAddBeat(idx + 1)}
                  onQuickGenerate={() => onQuickGenerateBeat(beat)}
                  isGenerating={generatingBeatIds.has(beat.id)}
                />
              ))}
            </div>
          )}

          {beats.length > 0 && (
            <button
              type="button"
              onClick={() => onAddBeat()}
              className="flex w-full items-center justify-center gap-1.5 py-3 text-sm text-muted transition-colors hover:text-ink"
            >
              <Plus className="h-3.5 w-3.5" />
              在末尾添加镜头
            </button>
          )}
        </div>
      </ScrollFadeContainer>
    </div>
  );
}
