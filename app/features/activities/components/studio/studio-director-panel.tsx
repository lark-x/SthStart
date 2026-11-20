'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Camera,
  ChevronDown,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Sliders,
  Sparkles,
  Sun,
  Smile,
  Maximize2,
} from 'lucide-react';
import type { ActorSnapshot, SceneBeat, StageDefinition } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';

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

const DIRECTOR_GROUPS = [
  { field: 'shotSize', label: '镜头景别', icon: Maximize2, cols: 'grid-cols-4', options: SHOT_SIZES },
  { field: 'angle', label: '拍摄角度', icon: Camera, cols: 'grid-cols-3', options: ANGLES },
  { field: 'lighting', label: '光影氛围', icon: Sun, cols: 'grid-cols-4', options: LIGHTINGS },
  { field: 'mood', label: '情绪基调', icon: Smile, cols: 'grid-cols-4', options: MOODS },
] as const;

export function StudioDirectorPanel({
  beat,
  onUpdateBeat,
  onGenerate,
  isGenerating = false,
  collapsed,
  onToggleCollapse,
}: StudioDirectorPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (collapsed) {
    return (
      <aside className="w-12 border-l border-border-default bg-surface flex flex-col shrink-0 select-none z-10 h-full min-h-0">
        <div className="h-11 border-b border-border-default bg-surface flex items-center justify-center shrink-0">
          <IconButton
            icon={PanelRightOpen}
            label="展开镜头属性与导演面板"
            variant="ghost"
            onClick={onToggleCollapse}
            size="sm"
            className="h-7 min-h-7 w-7 p-0"
          />
        </div>
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
      {/* 44px 统一连续基线顶栏 */}
      <div className="h-11 px-3 border-b border-border-default flex items-center justify-between shrink-0 bg-surface">
        <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-accent" />
          <span>镜头导演属性</span>
        </span>
        <IconButton
          icon={PanelRightClose}
          label="收起右栏"
          variant="ghost"
          onClick={onToggleCollapse}
          size="sm"
          className="h-7 min-h-7 w-7 p-0"
        />
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {!beat ? (
          <div className="py-12 text-center text-xs text-muted space-y-2">
            <p>在中间列表点击选择一个镜头</p>
            <p className="text-xs text-muted/80">
              在此调整景别、光影与情绪，并即刻生成高质量画面。
            </p>
          </div>
        ) : (
          <>
            {/* 画面大图预览卡片 */}
            {beat.mediaUrl ? (
              <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-border-default bg-media-backdrop/5 shadow-2xs group">
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
                <p className="text-xs text-muted">
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

            {DIRECTOR_GROUPS.map((group) => {
              const Icon = group.icon;
              return (
                <div key={group.field} className={`space-y-1.5 ${group.field === 'shotSize' ? 'pt-1' : ''}`}>
                  <label className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1">
                    <Icon className="h-3 w-3" />
                    <span>{group.label}</span>
                  </label>
                  <div className={`grid ${group.cols} gap-1`}>
                    {group.options.map((item) => {
                      const active = (directorSettings as Record<string, unknown>)[group.field] === item.value;
                      return (
                        <Button
                          key={item.value}
                          type="button"
                          size="sm"
                          variant={active ? 'accent' : 'ghost'}
                          aria-pressed={active}
                          onClick={() => handleUpdateDirector(group.field, item.value)}
                          className={`h-7 min-h-0 rounded-md px-1.5 text-xs ${
                            active
                              ? 'font-semibold shadow-2xs'
                              : 'bg-surface-muted font-medium text-muted hover:bg-surface-muted/80 hover:text-ink'
                          }`}
                        >
                          {item.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* 高级提示词调优（折叠） */}
            <div className="pt-2 border-t border-border-default/60">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                aria-expanded={advancedOpen}
                className="h-auto w-full min-h-0 justify-between px-0 py-1 text-xs font-semibold"
              >
                <span className="flex items-center gap-1">
                  <Sliders className="h-3 w-3" />
                  <span>高级视觉微调（可选）</span>
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              </Button>

              {advancedOpen && (
                <div className="mt-2 space-y-2.5 text-xs">
                  <div>
                    <label className="block text-xs text-muted mb-1">补充画面提示词</label>
                    <Textarea
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
                    <label className="block text-xs text-muted mb-1">负面提示词覆写</label>
                    <Input
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
