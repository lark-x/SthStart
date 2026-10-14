'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Camera,
  ChevronDown,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sliders,
  Sparkles,
  Sun,
  Smile,
  Maximize2,
} from 'lucide-react';
import type { ActorSnapshot, SceneBeat, StageDefinition } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';

interface StudioDirectorPanelProps {
  beat: SceneBeat | null;
  stage: StageDefinition;
  actors: ActorSnapshot[];
  onUpdateBeat: (patch: Partial<SceneBeat>) => void;
  onGenerate: () => void;
  isGenerating?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const SHOT_SIZES = [
  { value: 'closeup', label: '特写' },
  { value: 'medium', label: '中景' },
  { value: 'wide', label: '全景' },
  { value: 'full_body', label: '全身' },
] as const;

const ANGLES = [
  { value: 'eye_level', label: '平视' },
  { value: 'high', label: '俯拍' },
  { value: 'low', label: '仰拍' },
] as const;

const LIGHTINGS = [
  { value: 'natural', label: '自然光' },
  { value: 'warm', label: '暖阳' },
  { value: 'rim', label: '轮廓光' },
  { value: 'low_key', label: '暗调' },
] as const;

const MOODS = [
  { value: 'calm', label: '平静' },
  { value: 'joyful', label: '欢快' },
  { value: 'tense', label: '紧张' },
  { value: 'melancholy', label: '忧郁' },
] as const;

export function StudioDirectorPanel({
  beat,
  stage,
  actors,
  onUpdateBeat,
  onGenerate,
  isGenerating = false,
  collapsed,
  onToggleCollapse,
}: StudioDirectorPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (collapsed) {
    return (
      <aside className="w-10 border-l border-border-default bg-surface flex flex-col items-center py-2.5 shrink-0 select-none z-10">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-surface-muted transition-colors cursor-pointer"
          title="展开镜头属性与导演面板"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  const directorSettings = beat?.renderSettings?.director || {};

  const handleUpdateDirector = (field: string, val: string) => {
    if (!beat) return;
    const current = beat.renderSettings || {};
    const dir = current.director || {};
    const nextDir = {
      ...dir,
      [field]: (dir as Record<string, unknown>)[field] === val ? undefined : val,
    };
    onUpdateBeat({
      renderSettings: {
        ...current,
        director: nextDir,
      },
    });
  };

  return (
    <aside className="w-72 lg:w-80 border-l border-border-default bg-surface flex flex-col shrink-0 select-none z-10 h-full min-h-0">
      {/* 顶部标题栏 */}
      <div className="h-10 px-3 border-b border-border-default flex items-center justify-between shrink-0 bg-surface-muted/30">
        <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-accent" />
          <span>镜头导演属性</span>
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="h-6 w-6 rounded flex items-center justify-center text-muted hover:text-ink hover:bg-surface-muted transition-colors cursor-pointer"
          title="收起右栏"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {!beat ? (
          <div className="py-12 text-center text-xs text-muted space-y-2">
            <p>在中间列表点击选择一个镜头</p>
            <p className="text-[11px] text-muted/80">
              在此调整景别、光影与情绪，并即刻生成高质量画面。
            </p>
          </div>
        ) : (
          <>
            {/* 画面大图预览卡片 */}
            {beat.mediaUrl ? (
              <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-border-default bg-black/5 shadow-2xs group">
                <Image
                  src={beat.mediaUrl}
                  alt={beat.action || '分镜画面'}
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border-default p-4 text-center bg-surface-muted/30 space-y-1.5">
                <Sparkles className="h-5 w-5 mx-auto text-accent/70" />
                <p className="text-xs text-ink font-semibold">此镜头尚未生成画面</p>
                <p className="text-[11px] text-muted">
                  设置下方的景别与氛围后，点击“生成画面”。
                </p>
              </div>
            )}

            {/* 即时生成 CTA */}
            <Button
              onClick={onGenerate}
              disabled={isGenerating}
              className="w-full text-xs font-semibold h-8"
            >
              {isGenerating ? (
                <LoaderCircle className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              <span>{isGenerating ? '正在绘制中...' : beat.mediaUrl ? '重新绘制当前镜头' : '生成此镜头画面'}</span>
            </Button>

            {/* 导演标签组：景别 */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                <Maximize2 className="h-3 w-3" />
                <span>镜头景别</span>
              </label>
              <div className="grid grid-cols-4 gap-1">
                {SHOT_SIZES.map((item) => {
                  const active = directorSettings.shotSize === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleUpdateDirector('shotSize', item.value)}
                      className={`h-7 rounded-md text-xs font-medium transition-all cursor-pointer ${
                        active
                          ? 'bg-accent text-white font-bold shadow-2xs'
                          : 'bg-surface-muted text-muted hover:text-ink hover:bg-surface-muted/80'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 导演标签组：视角 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                <Camera className="h-3 w-3" />
                <span>拍摄角度</span>
              </label>
              <div className="grid grid-cols-3 gap-1">
                {ANGLES.map((item) => {
                  const active = directorSettings.angle === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleUpdateDirector('angle', item.value)}
                      className={`h-7 rounded-md text-xs font-medium transition-all cursor-pointer ${
                        active
                          ? 'bg-accent text-white font-bold shadow-2xs'
                          : 'bg-surface-muted text-muted hover:text-ink hover:bg-surface-muted/80'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 导演标签组：光影 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                <Sun className="h-3 w-3" />
                <span>光影氛围</span>
              </label>
              <div className="grid grid-cols-4 gap-1">
                {LIGHTINGS.map((item) => {
                  const active = directorSettings.lighting === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleUpdateDirector('lighting', item.value)}
                      className={`h-7 rounded-md text-xs font-medium transition-all cursor-pointer ${
                        active
                          ? 'bg-accent text-white font-bold shadow-2xs'
                          : 'bg-surface-muted text-muted hover:text-ink hover:bg-surface-muted/80'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 导演标签组：情绪 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                <Smile className="h-3 w-3" />
                <span>情绪基调</span>
              </label>
              <div className="grid grid-cols-4 gap-1">
                {MOODS.map((item) => {
                  const active = directorSettings.mood === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleUpdateDirector('mood', item.value)}
                      className={`h-7 rounded-md text-xs font-medium transition-all cursor-pointer ${
                        active
                          ? 'bg-accent text-white font-bold shadow-2xs'
                          : 'bg-surface-muted text-muted hover:text-ink hover:bg-surface-muted/80'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 高级提示词调优（折叠） */}
            <div className="pt-2 border-t border-border-default/60">
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="w-full flex items-center justify-between text-xs text-muted hover:text-ink font-semibold py-1 cursor-pointer"
              >
                <span className="flex items-center gap-1">
                  <Sliders className="h-3 w-3" />
                  <span>高级视觉微调（可选）</span>
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              </button>

              {advancedOpen && (
                <div className="mt-2 space-y-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] text-muted mb-1">补充画面提示词</label>
                    <textarea
                      rows={2}
                      value={beat.renderSettings?.customPrompt || ''}
                      onChange={(e) => {
                        const current = beat.renderSettings || {};
                        onUpdateBeat({
                          renderSettings: { ...current, customPrompt: e.target.value },
                        });
                      }}
                      placeholder="如：雨滴落在窗户上、樱花飘落..."
                      className="w-full resize-none rounded bg-surface-muted p-2 text-xs text-ink placeholder:text-muted/60 border border-transparent focus:border-accent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted mb-1">负面提示词覆写</label>
                    <input
                      value={beat.renderSettings?.negativePrompt || ''}
                      onChange={(e) => {
                        const current = beat.renderSettings || {};
                        onUpdateBeat({
                          renderSettings: { ...current, negativePrompt: e.target.value },
                        });
                      }}
                      placeholder="默认使用活动全局负面词..."
                      className="w-full rounded bg-surface-muted px-2 py-1 text-xs text-ink placeholder:text-muted/60 border border-transparent focus:border-accent outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
