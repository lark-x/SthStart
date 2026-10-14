'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Layers,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Film,
} from 'lucide-react';
import type { ActivityScene, ContentDocument, StageDefinition } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { getEffectiveStageScenes, countStageBeats } from '../../scene-beat-utils';

interface StudioOutlineRailProps {
  document: ContentDocument;
  activeStageId: string;
  activeSceneId: string | null;
  onSelectStage: (stageId: string) => void;
  onSelectScene: (stageId: string, sceneId: string) => void;
  onAddStage: () => void;
  onAddScene: (stageId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function StudioOutlineRail({
  document,
  activeStageId,
  activeSceneId,
  onSelectStage,
  onSelectScene,
  onAddStage,
  onAddScene,
  collapsed,
  onToggleCollapse,
}: StudioOutlineRailProps) {
  const stages = document.stages || [];

  if (collapsed) {
    return (
      <aside className="w-12 border-r border-border-default bg-surface flex flex-col items-center py-2.5 shrink-0 select-none z-10">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-surface-muted transition-colors mb-2 cursor-pointer"
          title="展开剧情大纲"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>

        <div className="flex-1 flex flex-col gap-1.5 w-full items-center overflow-y-auto">
          {stages.map((stage, idx) => {
            const isSelected = stage.id === activeStageId;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => onSelectStage(stage.id)}
                className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-accent text-white shadow-2xs'
                    : 'text-muted hover:text-ink hover:bg-surface-muted'
                }`}
                title={`第 ${idx + 1} 幕 · ${stage.title}`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onAddStage}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-accent hover:bg-surface-muted transition-colors mt-2 cursor-pointer"
          title="添加新的一幕"
        >
          <Plus className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-56 lg:w-60 border-r border-border-default bg-surface flex flex-col shrink-0 select-none z-10 h-full min-h-0">
      {/* 侧栏顶栏 */}
      <div className="h-10 px-3 border-b border-border-default flex items-center justify-between shrink-0 bg-surface-muted/30">
        <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-accent" />
          <span>剧情大纲</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAddStage}
            className="h-6 px-1.5 rounded text-[11px] font-semibold text-accent hover:bg-accent/10 transition-colors flex items-center gap-0.5 cursor-pointer"
            title="新增一幕"
          >
            <Plus className="h-3 w-3" />
            <span>加幕</span>
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="h-6 w-6 rounded flex items-center justify-center text-muted hover:text-ink hover:bg-surface-muted transition-colors cursor-pointer"
            title="收起侧栏"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 幕次与场次树形列表（独立滚动） */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {stages.map((stage, stageIdx) => {
          const isStageActive = stage.id === activeStageId;
          const scenes = getEffectiveStageScenes(stage, document.scenes);
          const { total: totalBeats, withMedia: mediaCount } = countStageBeats(scenes);
          const cleanTitle = stage.title.replace(/^第\s*[0-9一二三四五六七八九十]+\s*幕[·：:\s]*/, '') || stage.title;

          return (
            <div
              key={stage.id}
              className={`rounded-xl border transition-all ${
                isStageActive
                  ? 'border-border-default bg-surface-raised/50 shadow-2xs'
                  : 'border-transparent hover:border-border-subtle hover:bg-surface-muted/40'
              }`}
            >
              {/* 幕标题条 */}
              <div
                onClick={() => onSelectStage(stage.id)}
                className="p-2 flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                    isStageActive ? 'bg-accent text-white' : 'bg-surface-muted text-muted'
                  }`}>
                    {stageIdx + 1}
                  </span>
                  <span className="text-xs font-bold text-ink truncate max-w-[110px]" title={stage.title}>
                    {cleanTitle}
                  </span>
                </div>

                <div className="flex items-center gap-1 text-[10px] font-mono text-muted shrink-0">
                  <span title={`本幕共 ${totalBeats} 镜，已配图 ${mediaCount}`}>
                    {mediaCount}/{totalBeats}图
                  </span>
                </div>
              </div>

              {/* 展开的场次列表（当本幕被激活时展示） */}
              {isStageActive && (
                <div className="px-2 pb-2 pt-0.5 space-y-1">
                  {scenes.map((scene, sceneIdx) => {
                    const isSceneActive = scene.id === activeSceneId;
                    const beatCount = scene.beats?.length || 0;
                    const cleanSceneTitle = scene.title.replace(/^(第\s*[一二三四五六七八九十0-9]+\s*场[：:\s]*)/, '') || scene.title;

                    return (
                      <button
                        key={scene.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectScene(stage.id, scene.id);
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all flex items-center justify-between cursor-pointer ${
                          isSceneActive
                            ? 'bg-accent/10 font-bold text-accent'
                            : 'text-muted hover:text-ink hover:bg-surface-muted'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Film className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate max-w-[100px]" title={scene.title}>
                            {cleanSceneTitle || `第 ${sceneIdx + 1} 场`}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono opacity-80">
                          {beatCount}镜
                        </span>
                      </button>
                    );
                  })}

                  {/* 加场按钮 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddScene(stage.id);
                    }}
                    className="w-full py-1 px-2 rounded-lg border border-dashed border-border-default text-[11px] text-muted hover:text-accent hover:border-accent/40 transition-colors flex items-center justify-center gap-1 cursor-pointer mt-1"
                  >
                    <Plus className="h-3 w-3" />
                    <span>加场</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
