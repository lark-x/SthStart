'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlaybackDocument } from '@sthstart/contracts';
import { postJson } from '@/app/lib/api-client';
import { getDeviceDimensions, type DeviceLayout } from './model';

export interface UsePlaybackPlayerOptions {
  activityId: string;
  playbackDoc: PlaybackDocument | null;
  playbackRevisionIsStale: boolean;
  viewerActorId: string;
  deviceLayout: DeviceLayout;
}

export function usePlaybackPlayer({
  activityId,
  playbackDoc,
  playbackRevisionIsStale,
  viewerActorId,
  deviceLayout,
}: UsePlaybackPlayerOptions) {
  const [speed, setSpeed] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewError, setPreviewError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [previewBoxWidth, setPreviewBoxWidth] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const totalDurationMs = playbackDoc?.totalDurationMs || 30000;
  const actions = playbackDoc?.actions || [];

  // 当前激活的动作
  const currentAction = actions.find(
    (a) => currentTimeMs >= a.atMs && currentTimeMs < a.atMs + a.durationMs
  );

  // 监听容器宽度实测
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setPreviewBoxWidth(box.width);
    });
    observer.observe(el);
    setPreviewBoxWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [playbackDoc, deviceLayout]);

  // 预览文档获取（防抖 200ms）
  useEffect(() => {
    if (!playbackDoc || playbackRevisionIsStale) {
      setPreviewHtml('');
      return;
    }
    let active = true;
    const dim = getDeviceDimensions(deviceLayout);
    const deviceDoc: PlaybackDocument = {
      ...playbackDoc,
      layout: { width: dim.layoutWidth, height: dim.layoutHeight },
      output: { ...playbackDoc.output, width: dim.outputWidth, height: dim.outputHeight },
    };

    const timer = setTimeout(() => {
      postJson<{ html: string }>(
        `/api/admin/activities/${encodeURIComponent(activityId)}/playback-preview`,
        { playback: { ...deviceDoc, viewerActorId } }
      )
        .then((result) => {
          if (active) {
            setPreviewHtml(result.html);
            setPreviewError(null);
          }
        })
        .catch((error) => {
          if (active) {
            setPreviewHtml('');
            setPreviewError(error instanceof Error ? error.message : String(error));
          }
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activityId, playbackDoc, playbackRevisionIsStale, viewerActorId, deviceLayout]);

  // 同步预览 Iframe 状态
  const syncPreview = useCallback(() => {
    const win = iframeRef.current?.contentWindow as
      | (Window & { __timelines?: { main?: { seek: (seconds: number) => void } } })
      | null;
    if (!win?.__timelines?.main) return false;
    const seconds = currentTimeMs / 1000;
    win.__timelines.main.seek(seconds);
    const doc = iframeRef.current?.contentDocument;
    doc?.querySelectorAll<HTMLElement>('.clip').forEach((el) => {
      const start = Number(el.dataset.start || 0);
      const duration = Number(el.dataset.duration || 0);
      const active = seconds >= start && seconds < start + duration;
      el.style.visibility = active ? 'visible' : 'hidden';
      if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
        const media = el as HTMLMediaElement;
        const target = Math.max(0, seconds - start + Number(el.dataset.mediaStart || 0));
        media.volume = Number(el.dataset.volume ?? 1);
        media.playbackRate = speed;
        if (active && Math.abs(media.currentTime - target) > (isPlaying ? 0.25 : 0.01)) {
          media.currentTime = target;
        }
        if (active && isPlaying) {
          void media.play().catch(() => {});
        } else {
          media.pause();
        }
      }
    });
    return true;
  }, [currentTimeMs, isPlaying, speed]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      if (syncPreview() === false) frame = requestAnimationFrame(sync);
    };
    if (previewHtml) sync();
    return () => cancelAnimationFrame(frame);
  }, [currentTimeMs, isPlaying, speed, previewHtml, syncPreview]);

  // 播放计时器循环
  useEffect(() => {
    if (isPlaying) {
      const stepMs = 100;
      timerRef.current = setInterval(() => {
        setCurrentTimeMs((prev) => {
          const next = prev + stepMs * speed;
          if (next >= totalDurationMs) {
            setIsPlaying(false);
            return totalDurationMs;
          }
          return next;
        });
      }, stepMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, speed, totalDurationMs]);

  const { canvasWidth, canvasHeight } = getDeviceDimensions(deviceLayout);
  const previewScale = previewBoxWidth > 0 ? previewBoxWidth / canvasWidth : 0;
  const previewHeight = Math.round(canvasHeight * previewScale);

  const resetScrubber = useCallback(() => {
    setCurrentTimeMs(0);
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  return {
    speed,
    setSpeed,
    isPlaying,
    setIsPlaying,
    togglePlay,
    currentTimeMs,
    setCurrentTimeMs,
    resetScrubber,
    previewHtml,
    previewError,
    iframeRef,
    previewBoxRef,
    previewBoxWidth,
    canvasWidth,
    canvasHeight,
    previewScale,
    previewHeight,
    totalDurationMs,
    actions,
    currentAction,
    syncPreview,
  };
}
