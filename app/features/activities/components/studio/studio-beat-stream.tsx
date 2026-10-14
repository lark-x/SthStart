'use client';

import React, { useState } from 'react';
import {
  Clock,
  Film,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  ActivityScene,
  ActorSnapshot,
  ContentDocument,
  SceneBeat,
  StageDefinition,
} from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { StudioBeatCard } from './studio-beat-card';

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
  stage,
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
      <div className="flex-1 flex items-center justify-center p-8 bg-paper">
        <div className="max-w-sm text-center space-y-3">
          <Film className="h-10 w-10 mx-auto text-muted/60" />
          <h3 className="text-sm font-bold text-ink">本幕暂无场次</h3>
          <p className="text-xs text-muted leading-relaxed">
            请在左侧大纲导轨点击“加场”，或在上方新建场次开始编排分镜。
          </p>
        </div>
      </div>
    );
  }

  const beats = scene.beats || [];
  const cleanTitle = scene.title.replace(/^(第\s*[一二三四五六七八九十0-9]+\s*场[：:\s]*)/, '') || scene.title;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper overflow-hidden">
      {/* 场次时空顶栏 */}
      <div className="h-11 px-4 border-b border-border-default bg-surface flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-1.5 py-0.5 rounded bg-accent text-white font-mono text-[10px] font-bold shrink-0">
            场次
          </span>
          <input
            value={cleanTitle}
            onChange={(e) => onUpdateScene({ title: e.target.value })}
            placeholder="场次标题..."
            className="h-6 font-bold text-xs text-ink truncate bg-transparent border border-transparent hover:border-border-default focus:border-accent focus:bg-surface-raised rounded px-1 outline-none transition-all"
            title="点击修改场次标题"
          />

          {scene.locationText && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted truncate max-w-[120px]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span>{scene.locationText}</span>
            </span>
          )}

          {scene.timeText && (
            <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-muted shrink-0">
              <Clock className="h-3 w-3" />
              <span>{scene.timeText}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddBeat()}
            className="h-7 px-2 text-xs font-semibold"
          >
            <Plus className="h-3 w-3 mr-1" />
            <span>添加分镜</span>
          </Button>

          <button
            type="button"
            onClick={() => onDeleteScene(scene.id)}
            className="h-7 w-7 rounded flex items-center justify-center text-muted hover:text-red-600 hover:bg-red-500/10 transition-colors"
            title="删除此场次"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 分镜卡片滚动流（独立局部滚动，高度锁定） */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {beats.length === 0 ? (
          <div className="py-16 text-center rounded-2xl border border-dashed border-border-default space-y-3 bg-surface/40">
            <p className="text-xs text-muted">本场次还没有分镜镜头</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAddBeat()}
              className="text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              <span>添加第 1 个分镜</span>
            </Button>
          </div>
        ) : (
          beats.map((beat, idx) => (
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
          ))
        )}

        {/* 底部快速加镜条 */}
        {beats.length > 0 && (
          <button
            type="button"
            onClick={() => onAddBeat()}
            className="w-full py-2.5 rounded-xl border border-dashed border-border-default text-xs text-muted hover:text-accent hover:border-accent/40 hover:bg-surface transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>在末尾添加新镜头 (Beat)</span>
          </button>
        )}
      </div>
    </div>
  );
}
