'use client';

import React, { useState } from 'react';
import {
  Plus,
  Clapperboard,
  CheckCircle2,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  MapPin,
} from 'lucide-react';
import type { ActivityScene, StageDefinition } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
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
            <div className="flex items-center gap-1.5 font-semibold text-xs text-ink">
              <Clapperboard className="h-4 w-4 text-accent" />
              <span>剧本分幕</span>
              <span className="text-xs text-muted font-mono font-semibold bg-surface-muted px-1.5 py-0.2 rounded">
                {stages.length}
              </span>
            </div>
            <IconButton
              icon={PanelLeftClose}
              label="折叠为紧凑导轨"
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(false)}
              className="h-7 min-h-7 w-7 rounded text-muted hover:bg-surface-muted hover:text-ink"
              iconClassName="h-3.5 w-3.5"
            />
          </div>
        ) : (
          <>
            <IconButton
              icon={PanelLeftOpen}
              label="展开剧本大纲 (210px)"
              variant="outline"
              size="icon"
              onClick={() => setIsExpanded(true)}
              className="mb-2 h-8 min-h-8 w-8 rounded-lg border-border-default/60 bg-surface-muted text-muted shadow-2xs hover:text-accent"
            />
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
              <Button
                key={stage.id}
                type="button"
                variant="ghost"
                onClick={() => onSelectStage(stage.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`h-auto min-h-0 w-full justify-start whitespace-normal rounded-xl border p-2.5 text-left font-normal [&_.ui-mantine-button-inner]:w-full [&_.ui-mantine-button-label]:block [&_.ui-mantine-button-label]:w-full [&_.ui-mantine-button-label]:whitespace-normal ${
                  isActive
                    ? 'border-accent bg-accent/10 shadow-2xs ring-1 ring-accent/30 hover:bg-accent/10'
                    : 'border-border-subtle bg-surface hover:border-border-default hover:bg-surface-muted/60'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`font-mono text-xs font-semibold px-1.5 py-0.2 rounded ${
                        isActive ? 'bg-accent text-fg-on-accent' : 'bg-surface-muted text-muted'
                      }`}
                    >
                      第 {idx + 1} 幕
                    </span>
                    <span className="text-xs text-muted font-mono flex items-center gap-1">
                      {hasAllMedia ? (
                        <span className="text-success-fg font-semibold flex items-center gap-0.5">
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
                    <div className="text-xs text-muted flex items-center gap-1 truncate pt-0.5">
                      <MapPin className="h-2.5 w-2.5 shrink-0 text-accent/70" />
                      <span className="truncate">{stage.location}</span>
                    </div>
                  )}
                </div>
              </Button>
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onSelectStage(stage.id)}
                aria-current={isActive ? 'true' : undefined}
                className="ui-choice relative size-10 min-h-0 rounded-control bg-surface p-0 text-sm font-semibold tabular-nums text-muted hover:bg-surface-hover [&_.ui-mantine-button-label]:overflow-visible"
                title={`第 ${idx + 1} 幕：${stage.title}`}
              >
                <span>{displayIdx}</span>

                {/* 媒体就绪状态灯 */}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-surface ${
                    hasAllMedia
                      ? 'bg-success-solid'
                      : hasPartialMedia
                      ? 'bg-info-solid'
                      : totalBeats > 0
                      ? 'bg-warning-solid'
                      : 'bg-border-default'
                  }`}
                />
              </Button>

              {/* 悬停滑出的时空浮层 */}
              {isHovered && (
                <div
                  role="tooltip"
                  className="absolute left-full ml-2.5 top-0 z-50 w-64 rounded-xl border border-border-default bg-surface/95 backdrop-blur-md p-3 shadow-xl animate-in fade-in zoom-in-95 pointer-events-none"
                >
                  <div className="flex items-center justify-between text-xs text-fg-subtle mb-1">
                    <span className="font-mono font-semibold text-accent">第 {displayIdx} 幕</span>
                    <span className="flex items-center gap-1">
                      {hasAllMedia
                        ? <span className="flex items-center gap-0.5 text-success-fg font-medium"><CheckCircle2 className="h-3 w-3" />配图齐全 · {mediaBeats}/{totalBeats} 镜</span>
                        : <span className="flex items-center gap-0.5 text-muted"><Clock className="h-3 w-3" />{mediaBeats === 0 && totalBeats === 0 ? '分镜 0' : `配图 ${mediaBeats}/${totalBeats} 镜`}</span>}
                    </span>
                  </div>

                  <h4 className="text-sm font-semibold text-ink truncate mb-1.5">
                    {cleanStageTitle(stage.title)}
                  </h4>

                  <div className="text-xs text-muted space-y-0.5 border-t border-border-default/50 pt-1.5">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddStage}
              className="h-auto min-h-0 w-full justify-center gap-1.5 rounded-xl border-dashed px-2.5 py-2 text-xs font-semibold text-muted hover:border-accent hover:bg-accent/5 hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增下一幕</span>
            </Button>
          ) : (
            <IconButton
              icon={Plus}
              label="新增下一幕"
              variant="outline"
              size="icon"
              onClick={onAddStage}
              className="h-9 min-h-9 w-9 rounded-xl border-dashed text-muted hover:border-accent hover:bg-accent/5 hover:text-accent"
            />
          )}
        </div>
      )}
    </nav>
  );
}
