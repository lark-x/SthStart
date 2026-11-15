'use client';

import React from 'react';
import {
  Smartphone,
  Sparkles,
  Save,
  Eye,
  Monitor,
  Sliders,
  Film,
  Bookmark,
} from 'lucide-react';
import type { ActorSnapshot } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Select } from '@/app/components/ui/select';
import { formatTime, type DeviceLayout, type PlaybackMode } from '../model';

export interface PlaybackPresetItem {
  id: string;
  name: string;
}

export interface PlaybackToolbarProps {
  disabled?: boolean;
  isGenerating?: boolean;
  isSaving?: boolean;
  saveDisabled?: boolean;
  onGenerateAuto: () => void;
  onSavePlayback: () => void;
  viewerActorId: string;
  onViewerActorChange: (actorId: string) => void;
  actors: ActorSnapshot[];
  deviceLayout: DeviceLayout;
  onDeviceLayoutChange: (layout: DeviceLayout) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  playbackMode: PlaybackMode;
  onPlaybackModeChange: (mode: PlaybackMode) => void;
  expandMedia: boolean;
  onExpandMediaChange: (expand: boolean) => void;
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  onSavePreset: () => void;
  presets: PlaybackPresetItem[];
  totalDurationMs: number;
  actionsCount: number;
}

export function PlaybackToolbar({
  disabled,
  isGenerating,
  isSaving,
  saveDisabled,
  onGenerateAuto,
  onSavePlayback,
  viewerActorId,
  onViewerActorChange,
  actors,
  deviceLayout,
  onDeviceLayoutChange,
  speed,
  onSpeedChange,
  playbackMode,
  onPlaybackModeChange,
  expandMedia,
  onExpandMediaChange,
  selectedPresetId,
  onSelectPreset,
  onSavePreset,
  presets,
  totalDurationMs,
  actionsCount,
}: PlaybackToolbarProps) {
  return (
    <div className="space-y-3 p-3 rounded-panel bg-surface border border-border-default">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-accent" />
          回放编排与设备模拟预览
        </h3>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onGenerateAuto}
            disabled={disabled || isGenerating}
            className="text-sm flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            {isGenerating ? '计算编排中…' : '自动生成编排'}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onSavePlayback}
            disabled={disabled || saveDisabled || isSaving}
            className="text-sm bg-accent hover:bg-accent-dark text-fg-on-accent flex items-center gap-1.5 shadow-xs"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? '保存中…' : '保存回放版本'}
          </Button>
        </div>
      </div>

      {/* Settings Row: Viewer Persona, Device Layout & Speed */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-3">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold text-ink">观众视角：</span>
          <div className="w-36">
            <Select
              value={viewerActorId}
              onChange={(e) => onViewerActorChange(e.target.value)}
              disabled={disabled}
              className="h-8 text-sm bg-surface-raised min-h-0"
            >
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.displayName}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* 设备布局：手机 / 电脑，决定预览外壳与生成时的画布比例 */}
        <div className="flex items-center gap-2" role="group" aria-label="设备布局">
          <Monitor className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold text-ink">设备布局：</span>
          <div className="inline-flex items-center gap-0.5 rounded-control bg-surface-muted p-0.5">
            {(
              [
                { id: 'phone' as const, label: '手机' },
                { id: 'desktop' as const, label: '电脑' },
              ] as const
            ).map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={deviceLayout === option.id ? 'secondary' : 'ghost'}
                onClick={() => onDeviceLayoutChange(option.id)}
                disabled={disabled}
                aria-pressed={deviceLayout === option.id}
                data-selected={deviceLayout === option.id || undefined}
                className="ui-choice h-8 min-h-8 px-2.5 text-sm"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="播放倍速">
          <Sliders className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold text-ink">播放倍速：</span>
          <div className="flex items-center gap-1">
            {[0.5, 1, 1.25, 1.5, 2].map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={speed === s ? 'accent' : 'outline'}
                onClick={() => onSpeedChange(s)}
                aria-pressed={speed === s}
                className="h-8 min-h-8 px-2 font-mono text-sm"
              >
                {s}x
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold text-ink">编排模式：</span>
          <Select
            value={playbackMode}
            onChange={(e) => onPlaybackModeChange(e.target.value as PlaybackMode)}
            disabled={disabled}
            aria-label="编排模式"
            className="h-8 min-h-8 w-auto text-xs"
          >
            <option value="by_stage">按阶段 (聊天→动态)</option>
            <option value="story_order">故事顺序混排</option>
            <option value="chat_only">仅看聊天</option>
            <option value="moments_only">仅看动态</option>
          </Select>
        </div>

        <Checkbox
          label="展开配图/视频"
          checked={expandMedia}
          onChange={(e) => onExpandMediaChange(e.target.checked)}
          disabled={disabled}
          className="text-xs"
        />

        <div className="flex items-center gap-1.5">
          <Bookmark className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold text-ink">回放预设：</span>
          <Select
            value={selectedPresetId}
            onChange={(e) => onSelectPreset(e.target.value)}
            disabled={disabled}
            aria-label="回放预设"
            className="h-8 min-h-8 w-auto max-w-[140px] text-xs"
          >
            <option value="">默认配置</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onSavePreset}
            className="ml-1 h-8 min-h-8 px-2 text-xs text-accent"
            title="另存为回放预设"
          >
            另存
          </Button>
        </div>

        <div className="ml-auto text-sm text-muted font-mono">
          总时长: {formatTime(totalDurationMs)} ({actionsCount} 个动作)
        </div>
      </div>
    </div>
  );
}
