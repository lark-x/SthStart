'use client';

import React, { useState } from 'react';
import {
  Plus,
  Clapperboard,
  CheckCircle2,
  Clock,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  MapPin,
} from 'lucide-react';
import type { ActivityScene, StageDefinition } from '@sthstart/contracts';
import { countStageBeats, getEffectiveStageScenes } from '../scene-beat-utils';

interface StageRailNavProps {
  stages: StageDefinition[];
  scenes: ActivityScene[];
  activeStageId?: string;
  onSelectStage: (stageId: string) => void;
  onAddStage?: () => void;
  className?: string;
}

export function StageRailNav({
  stages,
  scenes,
  activeStageId,
  onSelectStage,
  onAddStage,
  className,
}: StageRailNavProps) {
  // 双模状态：展开为 210px 剧本大纲，或折叠为 56px 胶卷导轨
  const [isExpanded, setIsExpanded] = useState(true);
  const [hoveredStageId, setHoveredStageId] = useState<string | null>(null);

  // 清洗阶段标题机械前缀
  const cleanStageTitle = (title: string) => {
    return title.replace(/^(?:(?:第\s*[一二三四五六七八九十0-9]+\s*(?:幕|阶段)|阶段\s*[一二三四五六七八九十0-9]+)\s*(?:[·：:-]\s*)?)+/, '').trim() || title;
  };

  return (
    <nav
      aria-label="场次导轨导航"
      className={`hidden xl:flex h-full min-h-0 shrink-0 overflow-hidden border-r border-border-default bg-surface/95 backdrop-blur-sm flex-col justify-between transition-all duration-200 select-none z-20 ${className || ''} ${
        isExpanded ? 'w-52 p-3' : 'w-14 py-3 items-center'
      }`}
    >
      {/* 顶部标题与折叠切换 */}
      <div className={`shrink-0 ${isExpanded ? 'space-y-2' : 'flex flex-col items-center'}`}>
        {isExpanded ? (
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <Clapperboard className="h-4 w-4 text-accent" />
              <span>剧本分幕</span>
              <span className="text-[10px] text-muted font-mono font-bold bg-surface-muted px-1.5 py-0.2 rounded">
                {stages.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="p-1 rounded text-muted hover:text-ink hover:bg-surface-muted cursor-pointer transition-colors"
              title="折叠为紧凑导轨"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="mb-2 flex items-center justify-center h-8 w-8 rounded-lg bg-surface-muted text-muted hover:text-accent border border-border-default/60 shadow-2xs cursor-pointer transition-colors"
              title="展开剧本大纲 (210px)"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            <div className="h-px w-6 bg-border-default/60 mb-2" />
          </>
        )}
      </div>

      {/* 场次列表 */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto no-scrollbar py-1 space-y-1.5 ${
          isExpanded ? 'w-full' : 'w-full flex flex-col items-center overflow-x-visible'
        }`}
      >
        {stages.map((stage, idx) => {
          const isActive = activeStageId === stage.id;
          const isHovered = hoveredStageId === stage.id;
          const displayIdx = String(idx + 1).padStart(2, '0');

          // 计算媒体就绪情况
          const { total: totalBeats, withMedia: mediaBeats } = countStageBeats(getEffectiveStageScenes(stage, scenes));
          const hasAllMedia = totalBeats > 0 && mediaBeats === totalBeats;
          const hasPartialMedia = mediaBeats > 0 && mediaBeats < totalBeats;

          // 展开模式视图
          if (isExpanded) {
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => onSelectStage(stage.id)}
                className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer space-y-1 ${
                  isActive
                    ? 'border-accent bg-accent/10 shadow-2xs ring-1 ring-accent/30'
                    : 'border-border-subtle bg-surface hover:bg-surface-muted/60 hover:border-border-default'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={`font-mono text-[11px] font-bold px-1.5 py-0.2 rounded ${
                      isActive ? 'bg-accent text-white' : 'bg-surface-muted text-muted'
                    }`}
                  >
                    第 {idx + 1} 幕
                  </span>
                      <span className="text-xs text-muted font-mono flex items-center gap-1">
                        {hasAllMedia ? (
                          <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>配图齐全</span>
                          </span>
                        ) : (
                          <span>{mediaBeats === 0 && totalBeats === 0 ? '分镜 0' : `配图 ${mediaBeats}/${totalBeats} 镜`}</span>
                        )}
                  </span>
                </div>

                <div className="font-semibold text-xs text-ink truncate leading-tight">
                  {cleanStageTitle(stage.title)}
                </div>

                {stage.location && (
                  <div className="text-[10px] text-muted flex items-center gap-1 truncate pt-0.5">
                    <MapPin className="h-2.5 w-2.5 shrink-0 text-accent/70" />
                    <span className="truncate">{stage.location}</span>
                  </div>
                )}
              </button>
            );
          }

          // 紧凑折叠模式视图
          return (
            <div
              key={stage.id}
              className="relative flex items-center justify-center w-full"
              onMouseEnter={() => setHoveredStageId(stage.id)}
              onMouseLeave={() => setHoveredStageId(null)}
            >
              <button
                type="button"
                onClick={() => onSelectStage(stage.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`relative flex flex-col items-center justify-center h-10 w-10 rounded-xl font-mono text-xs font-bold transition-all shadow-2xs cursor-pointer ${
                  isActive
                    ? 'bg-accent text-white shadow-md scale-105'
                    : 'bg-surface hover:bg-surface-muted text-ink/80 hover:text-ink border border-border-default/80 hover:border-accent/40'
                }`}
                title={`第 ${idx + 1} 幕：${stage.title}`}
              >
                <span>{displayIdx}</span>

                {/* 媒体就绪状态灯 */}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-surface ${
                    hasAllMedia
                      ? 'bg-emerald-500'
                      : hasPartialMedia
                      ? 'bg-sky-500'
                      : totalBeats > 0
                      ? 'bg-amber-400'
                      : 'bg-border-default'
                  }`}
                />
              </button>

              {/* 悬停滑出的时空浮层 */}
              {isHovered && (
                <div
                  role="tooltip"
                  className="absolute left-full ml-2.5 top-0 z-50 w-64 rounded-xl border border-border-default bg-surface/95 backdrop-blur-md p-3 shadow-xl animate-in fade-in zoom-in-95 pointer-events-none"
                >
                  <div className="flex items-center justify-between text-xs text-fg-subtle mb-1">
                    <span className="font-mono font-bold text-accent">第 {displayIdx} 幕</span>
                    <span className="flex items-center gap-1">
                      {hasAllMedia
                        ? <span className="flex items-center gap-0.5 text-emerald-600 font-medium"><CheckCircle2 className="h-3 w-3" />配图齐全 · {mediaBeats}/{totalBeats} 镜</span>
                        : <span className="flex items-center gap-0.5 text-muted"><Clock className="h-3 w-3" />{mediaBeats === 0 && totalBeats === 0 ? '分镜 0' : `配图 ${mediaBeats}/${totalBeats} 镜`}</span>}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-ink truncate mb-1.5">
                    {cleanStageTitle(stage.title)}
                  </h4>

                  <div className="text-[11px] text-muted space-y-0.5 border-t border-border-default/50 pt-1.5">
                    {stage.location && (
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-fg-subtle">地点:</span>
                        <span className="text-ink font-medium">{stage.location}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部新增幕按钮 */}
      {onAddStage && (
        <div className={`pt-2 border-t border-border-default/60 shrink-0 ${isExpanded ? 'w-full' : 'flex justify-center'}`}>
          {isExpanded ? (
            <button
              type="button"
              onClick={onAddStage}
              className="w-full py-2 px-2.5 rounded-xl border border-dashed border-border-default hover:border-accent hover:bg-accent/5 text-muted hover:text-accent text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增下一幕</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onAddStage}
              className="flex items-center justify-center h-9 w-9 rounded-xl border border-dashed border-border-default text-muted hover:text-accent hover:border-accent hover:bg-accent/5 transition-colors cursor-pointer"
              title="新增下一幕"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
