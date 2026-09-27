'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Sparkles,
  User,
  Quote,
  CheckCircle2,
  X,
  Volume2,
  Film,
  Camera,
} from 'lucide-react';
import type { ActivityScene, SceneBeat, ActorSnapshot } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';

interface ScenePreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scene: ActivityScene | null;
  actors: ActorSnapshot[];
}

export function ScenePreviewDrawer({
  open,
  onOpenChange,
  scene,
  actors,
}: ScenePreviewDrawerProps) {
  const [currentBeatIndex, setCurrentBeatIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const beats = scene?.beats || [];
  const currentBeat: SceneBeat | undefined = beats[currentBeatIndex];

  // Map actor lookup
  const actorMap = new Map(actors.map((a) => [a.id, a]));
  const currentActor = currentBeat?.characterId ? actorMap.get(currentBeat.characterId) : undefined;
  const isNarrator = currentBeat?.characterId === 'narrator' || !currentBeat?.characterId;

  // Reset index when scene changes or opens
  useEffect(() => {
    if (open) {
      setCurrentBeatIndex(0);
      setIsPlaying(false);
    }
  }, [open, scene?.id]);

  // Auto playback timer
  useEffect(() => {
    if (!isPlaying) return;
    if (beats.length === 0) return;

    const timer = setTimeout(() => {
      if (currentBeatIndex < beats.length - 1) {
        setCurrentBeatIndex((prev) => prev + 1);
      } else {
        setIsPlaying(false);
      }
    }, 3500);

    return () => clearTimeout(timer);
  }, [isPlaying, currentBeatIndex, beats.length]);

  if (!scene) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`场次快速试演 · ${scene.title || '未命名场次'}`}
      description="以舞台分镜形式演播本场次的时空背景、角色登场、动作推进与台词心理。"
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-xs">
            {beats.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setCurrentBeatIndex(idx);
                  setIsPlaying(false);
                }}
                className={`h-2 rounded-full transition-all cursor-pointer ${
                  idx === currentBeatIndex
                    ? 'w-6 bg-accent'
                    : idx < currentBeatIndex
                    ? 'w-2 bg-accent/40'
                    : 'w-2 bg-border-default hover:bg-border-hover'
                }`}
                title={`跳转到第 ${idx + 1} 步`}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentBeatIndex(0);
                setIsPlaying(false);
              }}
              disabled={currentBeatIndex === 0}
              className="h-8 px-2.5 text-xs"
              title="重头开始"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentBeatIndex((prev) => Math.max(0, prev - 1));
                setIsPlaying(false);
              }}
              disabled={currentBeatIndex === 0}
              className="h-8 px-2.5 text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-0.5" />
              <span>上一步</span>
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => setIsPlaying(!isPlaying)}
              className="h-8 px-3 text-xs font-semibold"
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5 mr-1" />
                  <span>暂停</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-1" />
                  <span>{currentBeatIndex >= beats.length - 1 ? '重播' : '自动播放'}</span>
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentBeatIndex((prev) => Math.min(beats.length - 1, prev + 1));
                setIsPlaying(false);
              }}
              disabled={currentBeatIndex >= beats.length - 1}
              className="h-8 px-2.5 text-xs"
            >
              <span>下一步</span>
              <ChevronRight className="h-4 w-4 ml-0.5" />
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {/* 时空氛围头部卡片 */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-surface-muted/60 border border-border-subtle text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-medium text-ink">
              <Clock className="h-3.5 w-3.5 text-accent" />
              <span>{scene.timeText || '未定时间'}</span>
            </div>
            <div className="flex items-center gap-1.5 font-medium text-ink">
              <MapPin className="h-3.5 w-3.5 text-accent" />
              <span>{scene.locationText || '未定地点'}</span>
            </div>
          </div>
          {scene.environment && (
            <div className="text-muted text-[11px] italic truncate max-w-sm" title={scene.environment}>
              🌫️ {scene.environment}
            </div>
          )}
        </div>

        {/* 舞台演播核心视窗 */}
        {beats.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted border border-dashed border-border-default rounded-xl">
            本场次暂无动作分镜卡片，请先在场次中添加或由 AI 编写动作。
          </div>
        ) : (
          <div className="relative min-h-[300px] rounded-xl border border-border-default bg-gradient-to-b from-surface via-surface to-surface-muted/30 p-6 flex flex-col justify-between overflow-hidden shadow-xs">
            {/* 步骤计数 */}
            <div className="flex items-center justify-between text-xs text-muted mb-4 pb-2 border-b border-border-subtle">
              <span className="font-semibold text-accent">
                动作 {currentBeatIndex + 1} / {beats.length}
              </span>
              <span className="text-[11px]">
                {isNarrator ? '旁白叙事' : currentActor?.displayName || '在场角色'}
              </span>
            </div>

            {/* 演播内容区 */}
            <div className="space-y-4 my-auto">
              {/* 核心舞台画面 / 外部生成的视频或图片 */}
              {currentBeat?.mediaUrl && (
                <div className="relative w-full rounded-xl overflow-hidden border border-border-default bg-black/90 aspect-video shadow-md flex items-center justify-center">
                  {currentBeat.mediaType === 'video' ? (
                    <video
                      key={currentBeat.mediaUrl}
                      src={currentBeat.mediaUrl}
                      controls
                      autoPlay
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="relative w-full h-full">
                      <Image
                        src={currentBeat.mediaUrl}
                        alt={currentBeat.action}
                        fill
                        unoptimized
                        className="object-contain"
                      />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-semibold flex items-center gap-1 backdrop-blur-xs pointer-events-none">
                    {currentBeat.mediaType === 'video' ? (
                      <>
                        <Film className="h-3 w-3 text-accent" />
                        <span>ComfyUI 视频演出</span>
                      </>
                    ) : (
                      <>
                        <Camera className="h-3 w-3 text-accent" />
                        <span>分镜画面</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* 角色登场与状态 */}
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12 rounded-full overflow-hidden border-2 border-accent/40 bg-surface-muted shrink-0 shadow-sm">
                  {currentActor?.avatarUrl ? (
                    <Image
                      src={currentActor.avatarUrl}
                      alt={currentActor.displayName}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-bold text-muted">
                      {isNarrator ? '旁' : currentActor?.displayName?.slice(0, 1) || '角'}
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="text-base font-bold text-ink">
                    {isNarrator ? '旁白 / 场景交代' : currentActor?.displayName || '未命名角色'}
                  </h4>
                  {currentActor?.activityRole && (
                    <p className="text-xs text-muted mt-0.5">{currentActor.activityRole}</p>
                  )}
                </div>
              </div>

              {/* 核心动作与行为 (Action/What) - 醒目大字 */}
              <div className="p-4 rounded-xl bg-surface border border-border-default shadow-xs space-y-1">
                <div className="text-[11px] font-bold text-accent uppercase tracking-wider">
                  主体动作 / 发生事件
                </div>
                <p className="text-sm sm:text-base font-semibold text-ink leading-relaxed">
                  {currentBeat?.action || '（无动作描述）'}
                </p>
              </div>

              {/* 角色台词或独白 (Dialogue) - 引用气泡 */}
              {currentBeat?.dialogue && (
                <div className="relative pl-4 pr-3 py-3 rounded-lg bg-accent/5 border-l-4 border-accent text-xs sm:text-sm text-ink space-y-1">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-accent">
                    <Quote className="h-3 w-3" />
                    <span>台词 / 独白</span>
                  </div>
                  <p className="italic leading-relaxed text-ink/90">
                    “{currentBeat.dialogue}”
                  </p>
                </div>
              )}

              {/* 剧情结果 / 产生的线索 (Outcome) */}
              {currentBeat?.outcome && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>结果/事实：{currentBeat.outcome}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
