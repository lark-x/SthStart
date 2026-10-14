'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  Calendar,
  Compass,
  Laptop,
  Layers,
  MapPin,
  MessageSquare,
  Sparkles,
  Users,
  Copy,
  Check,
} from 'lucide-react';
import type { Activity, ContentDocument, StageDefinition } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { getEffectiveStageScenes } from '../../scene-beat-utils';

interface StudioMobileViewProps {
  activity: Activity;
  document: ContentDocument;
  onOpenPlayback?: () => void;
}

export function StudioMobileView({
  activity,
  document,
  onOpenPlayback,
}: StudioMobileViewProps) {
  const [activeStageId, setActiveStageId] = useState<string>(
    document.stages[0]?.id || ''
  );
  const [copied, setCopied] = useState(false);

  const activeStage = document.stages.find((s) => s.id === activeStageId) || document.stages[0];
  const stageScenes = activeStage ? getEffectiveStageScenes(activeStage, document.scenes) : [];
  const actors = document.actors || [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-paper text-ink pb-12">
      {/* 顶部紧凑导航 */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-default bg-surface/95 px-4 py-2.5 backdrop-blur-sm">
        <Link
          href="/apps/activities"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>活动列表</span>
        </Link>
        <span className="text-xs font-bold text-ink truncate max-w-[180px]">
          {document.activity.title || activity.title || '活动'}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopyLink}
          className="h-7 px-2 text-xs"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="ml-1">{copied ? '已复制' : '分享'}</span>
        </Button>
      </header>

      {/* 电脑端沉浸创作提示 Banner */}
      <div className="mx-4 mt-3 rounded-xl border border-accent/20 bg-accent/5 p-3 flex items-start gap-2.5 shadow-2xs">
        <Laptop className="h-4 w-4 text-accent shrink-0 mt-0.5" />
        <div className="text-xs space-y-0.5 min-w-0">
          <p className="font-semibold text-ink">当前处于移动端速览模式</p>
          <p className="text-muted leading-relaxed text-[11px]">
            如需进行镜头拖拽编排、批量 AI 绘图、漫剧分格与高级演播，建议在电脑端（桌面大屏）打开体验。
          </p>
        </div>
      </div>

      {/* 活动基本元数据卡片 */}
      <section className="mx-4 mt-3 rounded-2xl border border-border-default bg-surface p-4 space-y-3 shadow-2xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {document.activity.type || activity.type || '视觉演出'}
            </Badge>
            {document.activity.theme && (
              <span className="text-xs text-muted font-medium">
                {document.activity.theme}
              </span>
            )}
          </div>
          <h1 className="text-base font-bold text-ink tracking-tight">
            {document.activity.title || activity.title}
          </h1>
          {document.activity.location && (
            <div className="flex items-center gap-1 text-xs text-muted pt-0.5">
              <MapPin className="h-3 w-3" />
              <span>{document.activity.location}</span>
            </div>
          )}
        </div>

        {/* 参与角色头像列表 */}
        {actors.length > 0 && (
          <div className="pt-2 border-t border-border-subtle/60 flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-[11px] font-medium text-muted shrink-0">登场角色:</span>
            {actors.map((actor) => (
              <div
                key={actor.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-muted px-2 py-0.5 shrink-0"
              >
                <div className="relative h-4 w-4 rounded-full overflow-hidden bg-muted/20 shrink-0">
                  {actor.avatarUrl ? (
                    <Image
                      src={actor.avatarUrl}
                      alt={actor.displayName}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[9px] font-bold">
                      {actor.displayName.slice(0, 1)}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-medium text-ink">
                  {actor.displayName}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 幕次选择横向标签栏 */}
      <nav className="mt-4 px-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {document.stages.map((stage, idx) => {
          const isSelected = stage.id === activeStage?.id;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setActiveStageId(stage.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isSelected
                  ? 'bg-accent text-white shadow-2xs'
                  : 'bg-surface border border-border-default text-muted hover:text-ink'
              }`}
            >
              第 {idx + 1} 幕 · {stage.title.replace(/^第\s*[0-9一二三四五六七八九十]+\s*幕[·：:\s]*/, '') || stage.title}
            </button>
          );
        })}
      </nav>

      {/* 当前幕的大纲目标 */}
      {activeStage && (
        <section className="mx-4 mt-3 space-y-3">
          {activeStage.instruction && (
            <div className="rounded-xl bg-surface-muted/60 p-3 text-xs border border-border-default/50 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">本幕目标</span>
              <p className="text-ink/90 leading-relaxed">{activeStage.instruction}</p>
            </div>
          )}

          {/* 场次与分镜只读阅读流 */}
          <div className="space-y-4">
            {stageScenes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-default p-6 text-center text-xs text-muted">
                本幕尚未配置场次与分镜
              </div>
            ) : (
              stageScenes.map((scene, sIdx) => (
                <div
                  key={scene.id}
                  className="rounded-2xl border border-border-default bg-surface p-3.5 space-y-3 shadow-2xs"
                >
                  {/* 场次标题 */}
                  <div className="flex items-center justify-between border-b border-border-subtle/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold font-mono text-accent">
                        第 {sIdx + 1} 场
                      </span>
                      <h3 className="text-xs font-bold text-ink truncate max-w-[180px]">
                        {scene.title}
                      </h3>
                    </div>
                    {scene.locationText && (
                      <span className="text-[11px] text-muted truncate max-w-[120px]">
                        {scene.locationText}
                      </span>
                    )}
                  </div>

                  {/* 分镜气泡流 */}
                  <div className="space-y-2.5">
                    {scene.beats.length === 0 ? (
                      <p className="text-[11px] text-muted italic">暂无分镜</p>
                    ) : (
                      scene.beats.map((beat, bIdx) => {
                        const actor = beat.characterId ? actorMap.get(beat.characterId) : undefined;
                        const isNarrator = !beat.characterId || beat.characterId === 'narrator';

                        return (
                          <div
                            key={beat.id}
                            className="rounded-xl bg-surface-muted/40 p-2.5 space-y-2 border border-border-subtle/40"
                          >
                            {/* 镜头角色与动作 */}
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[10px] font-mono text-muted">#{bIdx + 1}</span>
                                <span className={`font-bold text-[11px] ${isNarrator ? 'text-muted' : 'text-ink'}`}>
                                  {isNarrator ? '旁白' : actor?.displayName || beat.characterName || '角色'}
                                </span>
                              </div>
                              {beat.mediaUrl && (
                                <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-bold text-emerald-600">
                                  已配图
                                </span>
                              )}
                            </div>

                            {/* 动作描述 */}
                            {beat.action && (
                              <p className="text-[11px] text-muted leading-relaxed italic">
                                ({beat.action})
                              </p>
                            )}

                            {/* 对白台词 */}
                            {beat.dialogue && (
                              <div className="rounded-lg bg-surface p-2 text-xs text-ink font-medium leading-relaxed border border-border-subtle/50">
                                “{beat.dialogue}”
                              </div>
                            )}

                            {/* 镜头缩略图 (如果有) */}
                            {beat.mediaUrl && (
                              <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-border-default mt-1">
                                <Image
                                  src={beat.mediaUrl}
                                  alt={beat.action || '镜头画面'}
                                  fill
                                  unoptimized
                                  className="object-cover"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
