'use client';

import React from 'react';
import {
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Film,
} from 'lucide-react';
import type { ContentDocument } from '@sthstart/contracts';
import { ScrollFadeContainer } from '@/app/components/ui/scroll-fade-container';
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
      <aside className="z-10 flex h-full min-h-0 w-12 shrink-0 select-none flex-col bg-surface">
        {/* 44px 统一连续基线顶栏 */}
        <div className="h-11 border-b border-border-default bg-surface flex items-center justify-center shrink-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="h-7 w-7 rounded-control flex items-center justify-center text-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            title="展开剧情大纲"
            aria-label="展开剧情大纲"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>

        <ScrollFadeContainer orientation="vertical" fadeSize={12} className="flex-1 min-h-0 w-full py-2">
          <div className="flex flex-col gap-1.5 w-full items-center">
            {stages.map((stage, idx) => {
              const isSelected = stage.id === activeStageId;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => onSelectStage(stage.id)}
                  className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-accent text-fg-on-accent shadow-2xs'
                      : 'text-muted hover:text-ink hover:bg-surface-muted'
                  }`}
                  title={`第 ${idx + 1} 幕 · ${stage.title}`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </ScrollFadeContainer>

        <div className="p-2 border-t border-border-default/60 flex items-center justify-center shrink-0">
          <button
            type="button"
            onClick={onAddStage}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-accent hover:bg-surface-muted transition-colors cursor-pointer"
            title="添加新的一幕"
            aria-label="添加新的一幕"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="z-10 flex h-full min-h-0 w-56 shrink-0 select-none flex-col bg-surface lg:w-60">
      {/* 44px 统一连续基线顶栏 */}
      <div className="h-11 px-3 border-b border-border-default flex items-center justify-between shrink-0 bg-surface select-none">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Layers className="h-3.5 w-3.5 text-muted" />
          <span>剧情大纲</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAddStage}
            className="flex h-7 cursor-pointer items-center gap-1 rounded-control px-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink"
            title="新增一幕"
          >
            <Plus className="h-3 w-3" />
            <span>加幕</span>
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="h-7 w-7 rounded-control flex items-center justify-center text-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            title="收起侧栏"
            aria-label="收起侧栏"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 幕次与场次树形列表（非线性边缘消隐） */}
      <ScrollFadeContainer orientation="vertical" fadeSize={16} className="flex-1 min-h-0 px-2 py-1" data-autohide-scroll>
        {stages.map((stage, stageIdx) => {
          const isStageActive = stage.id === activeStageId;
          const scenes = getEffectiveStageScenes(stage, document.scenes);
          const { total: totalBeats, withMedia: mediaCount } = countStageBeats(scenes);
          const cleanTitle = stage.title.replace(/^第\s*[0-9一二三四五六七八九十]+\s*幕[·：:\s]*/, '') || stage.title;

          return (
            <div
              key={stage.id}
              className={`border-b border-border-subtle transition-colors last:border-b-0 ${
                isStageActive ? 'bg-surface-sunken/60' : 'hover:bg-surface-hover'
              }`}
            >
              {/* 幕标题条 */}
              <button
                type="button"
                onClick={() => onSelectStage(stage.id)}
                className="group flex w-full cursor-pointer items-center justify-between px-2 py-2.5 text-left focus-visible:outline focus-visible:outline-accent"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                    isStageActive ? 'bg-accent text-fg-on-accent' : 'bg-surface-muted text-muted'
                  }`}>
                    {stageIdx + 1}
                  </span>
                  <span className="max-w-[110px] truncate text-sm font-medium text-ink" title={stage.title}>
                    {cleanTitle}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted">
                  <span title={`本幕共 ${totalBeats} 镜，已配图 ${mediaCount}`}>
                    {mediaCount}/{totalBeats}图
                  </span>
                </div>
              </button>

              {/* 展开的场次列表（当本幕被激活时展示） */}
              {isStageActive && (
                <div className="space-y-0.5 pb-2 pl-4 pr-1">
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
                        className={`flex w-full cursor-pointer items-center justify-between rounded-control px-2 py-1.5 text-left text-sm transition-colors ${
                          isSceneActive
                            ? 'bg-surface font-medium text-ink'
                            : 'text-muted hover:bg-surface-hover hover:text-ink'
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
                    className="mt-1 flex w-full cursor-pointer items-center justify-center gap-1 rounded-control px-2 py-1.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink"
                  >
                    <Plus className="h-3 w-3" />
                    <span>加场</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </ScrollFadeContainer>
    </aside>
  );
}
