'use client';

import React, { type RefObject } from 'react';
import { RotateCcw, Play, Pause } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { EmptyState } from '@/app/components/ui/empty-state';
import { IconButton } from '@/app/components/ui/icon-button';
import { formatTime, type DeviceLayout } from '../model';

export interface PlaybackPreviewScreenProps {
  deviceLayout: DeviceLayout;
  previewBoxRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  previewHtml: string;
  previewHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  previewScale: number;
  syncPreview: () => boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  isPlaying: boolean;
  disabledScrubber?: boolean;
  onSeek: (ms: number) => void;
  onReset: () => void;
  onTogglePlay: () => void;
}

export function PlaybackPreviewScreen({
  deviceLayout,
  previewBoxRef,
  iframeRef,
  previewHtml,
  previewHeight,
  canvasWidth,
  canvasHeight,
  previewScale,
  syncPreview,
  currentTimeMs,
  totalDurationMs,
  isPlaying,
  disabledScrubber,
  onSeek,
  onReset,
  onTogglePlay,
}: PlaybackPreviewScreenProps) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-full flex justify-center">
        {deviceLayout === 'phone' ? (
          <div className="w-full max-w-[320px] bg-stone-900 rounded-[36px] p-2.5 shadow-2xl border-4 border-stone-800 flex flex-col relative overflow-hidden">
            {/* Phone notch */}
            <div className="w-24 h-3.5 bg-stone-800 rounded-full mx-auto mb-1.5 flex-shrink-0" />

            {/* 实测的就是 iframe 的显示宽度：外壳有内边距与边框，量外壳会偏大。 */}
            <div
              ref={previewBoxRef}
              className="rounded-[24px] overflow-hidden relative bg-surface-muted"
              style={{ height: previewHeight || undefined }}
            >
              {previewHtml ? (
                <iframe
                  ref={iframeRef}
                  title="活动真实回放预览"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-same-origin"
                  onLoad={() => {
                    setTimeout(syncPreview, 100);
                  }}
                  style={{
                    border: 0,
                    width: canvasWidth,
                    height: canvasHeight,
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left',
                  }}
                />
              ) : (
                <EmptyState
                  title="还没有可播放的回放"
                  description="请先生成或保存回放脚本，预览将显示对应版本的真实媒体。"
                  className="min-h-full px-4 py-6"
                />
              )}
            </div>

            {/* Bottom bar indicator */}
            <div className="w-20 h-1 bg-stone-700 rounded-full mx-auto mt-1.5 flex-shrink-0" />
          </div>
        ) : (
          <div
            ref={previewBoxRef}
            className="w-full rounded-panel overflow-hidden border border-border-default bg-surface-muted"
            style={{ height: previewHeight || 240 }}
          >
            {previewHtml ? (
              <iframe
                ref={iframeRef}
                title="活动真实回放预览"
                srcDoc={previewHtml}
                sandbox="allow-scripts allow-same-origin"
                onLoad={() => {
                  setTimeout(syncPreview, 100);
                }}
                style={{
                  border: 0,
                  width: canvasWidth,
                  height: canvasHeight,
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                }}
              />
            ) : (
              <EmptyState
                title="还没有可播放的回放"
                description="请先生成或保存回放脚本，预览将显示对应版本的真实媒体。"
                className="min-h-full px-4 py-6"
              />
            )}
          </div>
        )}
      </div>

      {/* Scrubber Bar */}
      <div className="w-full mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-sm font-mono text-muted">
          <span>{formatTime(currentTimeMs)}</span>
          <span>{formatTime(totalDurationMs)}</span>
        </div>

        <input
          type="range"
          min={0}
          max={totalDurationMs}
          value={currentTimeMs}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={disabledScrubber}
          className="w-full accent-accent cursor-pointer"
        />

        <div className="flex items-center justify-center gap-3 pt-1">
          <IconButton
            icon={RotateCcw}
            label="回到开头"
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={disabledScrubber}
            iconClassName="h-3.5 w-3.5"
            className="h-8 w-8 p-0"
          />

          <Button
            type="button"
            size="sm"
            onClick={onTogglePlay}
            disabled={disabledScrubber}
            variant="accent"
            className="h-8 px-4 text-sm"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isPlaying ? '暂停' : '播放'}
          </Button>
        </div>
      </div>
    </div>
  );
}
