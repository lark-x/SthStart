'use client';

import { postJson } from '@/app/lib/api-client';
import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Save,
  Sliders,
  Smartphone,
  Eye,
  Clock,
  Film,
} from 'lucide-react';
import type {
  Activity,
  ActorSnapshot,
  ContentDocument,
  PlaybackDocument,
  PlaybackRevision,
} from '@sthstart/contracts';
import {
  useGenerateAutoPlayback,
  useSavePlaybackRevision,
} from '../mutations';
import { Select } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Input } from '@/app/components/ui/input';
import { SplitPanes } from '@/app/components/shared/split-panes';

const actionLabels: Record<string, string> = { open_view: '切换视图', scroll_to: '滚动记录', open_media: '展开媒体', close_media: '关闭媒体', reveal_message: '显示消息', reveal_comments: '显示评论', typing: '正在输入', wait: '停留阅读', stage_card: '阶段说明' };

interface PlaybackWorkstationProps {
  activity: Activity;
  document: ContentDocument;
  currentPlaybackRevision?: PlaybackRevision | null;
  actors: ActorSnapshot[];
  disabled?: boolean;
}

export function PlaybackWorkstation({
  activity,
  document,
  currentPlaybackRevision,
  actors,
  disabled,
}: PlaybackWorkstationProps) {
  const [playbackDoc, setPlaybackDoc] = useState<PlaybackDocument | null>(
    currentPlaybackRevision?.document || null
  );
  const [viewerActorId, setViewerActorId] = useState<string>(
    currentPlaybackRevision?.document?.viewerActorId || actors[0]?.id || ''
  );
  const [speed, setSpeed] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const autoPlaybackMutation = useGenerateAutoPlayback();
  const savePlaybackMutation = useSavePlaybackRevision();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  useEffect(() => {
    if (!playbackDoc) return;
    let active = true;
    const timer = setTimeout(() => {
      postJson<{ html: string }>(`/api/admin/activities/${encodeURIComponent(activity.id)}/playback-preview`, { playback: { ...playbackDoc, viewerActorId } })
        .then(result => { if (active) setPreviewHtml(result.html); })
        .catch(error => { if (active) { setPreviewHtml(''); setErrorMsg(String(error)); } });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [activity.id, playbackDoc, viewerActorId]);

  // The host owns live-preview transport; exported composition media remain framework-owned.
  const syncPreview = () => {
    const win = iframeRef.current?.contentWindow as (Window & { __timelines?: { main?: { seek: (seconds: number) => void } } }) | null;
    if (!win?.__timelines?.main) return false;
    const seconds = currentTimeMs / 1000;
    win.__timelines.main.seek(seconds);
    const doc = iframeRef.current?.contentDocument;
    doc?.querySelectorAll<HTMLElement>('.clip').forEach(el => {
      const start = Number(el.dataset.start || 0), duration = Number(el.dataset.duration || 0);
      const active = seconds >= start && seconds < start + duration;
      el.style.visibility = active ? 'visible' : 'hidden';
      if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
        const media = el as HTMLMediaElement;
        const target = Math.max(0, seconds - start + Number(el.dataset.mediaStart || 0));
        media.volume = Number(el.dataset.volume ?? 1);
        media.playbackRate = speed;
        if (active && Math.abs(media.currentTime - target) > (isPlaying ? 0.25 : 0.01)) media.currentTime = target;
        if (active && isPlaying) void media.play().catch(() => {});
        else media.pause();
      }
    });
  };
  useEffect(() => {
    let frame = 0;
    const sync = () => { if (syncPreview() === false) frame = requestAnimationFrame(sync); };
    if (previewHtml) sync();
    return () => cancelAnimationFrame(frame);
  }, [currentTimeMs, isPlaying, speed, previewHtml]);

  // Playback timer ref
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const totalDurationMs = playbackDoc?.totalDurationMs || 30000;
  const actions = playbackDoc?.actions || [];

  // Play/pause scrubber loop
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

  // Current active action
  const currentAction = actions.find(
    (a) => currentTimeMs >= a.atMs && currentTimeMs < a.atMs + a.durationMs
  );

  const handleGenerateAuto = async () => {
    setErrorMsg(null);
    try {
      const result = await autoPlaybackMutation.mutateAsync({
        id: activity.id,
        options: {
          contentRevisionId: activity.currentContentRevisionId || '',
          mediaRevisionId: activity.currentMediaRevisionId || '',
          viewerActorId,
          speed,
        },
      });
      setPlaybackDoc(result.playbackDocument);
      setCurrentTimeMs(0);
      setIsPlaying(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '自动编排回放失败');
    }
  };

  const handleSavePlayback = async () => {
    if (!playbackDoc) return;
    setErrorMsg(null);
    setSaveSuccess(false);
    try {
      await savePlaybackMutation.mutateAsync({
        id: activity.id,
        contentRevisionId: activity.currentContentRevisionId || '',
        mediaRevisionId: activity.currentMediaRevisionId || '',
        document: {
          ...playbackDoc,
          viewerActorId,
        },
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存回放版本失败');
    }
  };

  const handleUpdateActionDuration = (index: number, newDurationMs: number) => {
    if (!playbackDoc) return;
    const list = [...playbackDoc.actions];
    list[index] = { ...list[index], durationMs: newDurationMs };

    // Recalculate starts
    let runningTime = 0;
    const recalculated = list.map((act) => {
      const updated = { ...act, atMs: runningTime };
      runningTime += act.durationMs;
      return updated;
    });

    setPlaybackDoc({
      ...playbackDoc,
      actions: recalculated,
      totalDurationMs: runningTime,
    });
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-[var(--radius-panel)] bg-surface border border-border-default">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-accent" />
            回放编排与设备模拟预览
          </h3>
          <p className="text-sm text-muted">
            编排拟真手机视角的文字阅读、图片放大、视频播放与朋友圈穿插，生成可直接在外部渲染的 HyperFrames 动作序列。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleGenerateAuto}
            disabled={disabled || autoPlaybackMutation.isPending}
            className="text-sm flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            {autoPlaybackMutation.isPending ? '计算编排中…' : '自动生成编排'}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSavePlayback}
            disabled={disabled || !playbackDoc || savePlaybackMutation.isPending}
            className="text-sm bg-accent hover:bg-accent-dark text-white flex items-center gap-1.5 shadow-xs"
          >
            <Save className="h-3.5 w-3.5" />
            {savePlaybackMutation.isPending ? '保存中…' : '保存回放版本'}
          </Button>
        </div>
      </div>

      {errorMsg && (
        <Alert variant="danger" title="回放编排提示">
          {errorMsg}
        </Alert>
      )}

      {saveSuccess && (
        <Alert variant="info" title="已成功保存">
          回放脚本版本已成功落库，可在导出面板中下载完整可渲染工程。
        </Alert>
      )}

      {/* Settings Row: Viewer Persona & Speed */}
      <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-surface border border-border-subtle">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold text-ink">观众视角：</span>
          <div className="w-36">
            <Select
              value={viewerActorId}
              onChange={(e) => setViewerActorId(e.target.value)}
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

        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold text-ink">播放倍速：</span>
          <div className="flex items-center gap-1">
            {[0.5, 1, 1.25, 1.5, 2].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-sm font-mono font-medium transition-colors ${
                  speed === s
                    ? 'bg-accent text-white'
                    : 'bg-surface-raised text-ink hover:bg-surface-hover border border-border-default'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto text-sm text-muted font-mono">
          总时长: {formatTime(totalDurationMs)} ({actions.length} 个动作)
        </div>
      </div>

      {/* Main Grid: Device Simulator & Actions Timeline（两栏各自滚动，§4.4） */}
      <SplitPanes
        className="lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        from="lg"
        labels={{ left: '设备模拟预览', right: '回放动作序列' }}
        left={
        /* Phone Mockup Preview (5 cols) */
        <div className="flex flex-col items-center">
          <div className="w-[300px] h-[580px] bg-stone-900 rounded-[36px] p-3 shadow-2xl border-4 border-stone-800 flex flex-col relative overflow-hidden">
            {/* Phone notch */}
            <div className="w-28 h-4 bg-stone-800 rounded-full mx-auto mb-2 flex-shrink-0" />

            <div className="flex-1 rounded-[24px] overflow-hidden relative bg-surface-muted">
              {previewHtml ? <iframe ref={iframeRef} title="活动真实回放预览" srcDoc={previewHtml}
                sandbox="allow-scripts allow-same-origin" onLoad={() => { setTimeout(syncPreview, 100); }}
                style={{ border: 0, width: playbackDoc?.output.width || 1080, height: playbackDoc?.output.height || 1920,
                  transform: `scale(${268 / (playbackDoc?.output.width || 1080)})`, transformOrigin: 'top left' }} />
                : <p className="p-4 text-sm">请先生成或保存回放脚本，预览将显示对应版本的真实媒体。</p>}
            </div>

            {/* Bottom bar indicator */}
            <div className="w-20 h-1 bg-stone-700 rounded-full mx-auto mt-2 flex-shrink-0" />
          </div>

          {/* Scrubber Bar */}
          <div className="w-[300px] mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm font-mono text-muted">
              <span>{formatTime(currentTimeMs)}</span>
              <span>{formatTime(totalDurationMs)}</span>
            </div>

            <input
              type="range"
              min={0}
              max={totalDurationMs}
              value={currentTimeMs}
              onChange={(e) => {
                setCurrentTimeMs(Number(e.target.value));
                setIsPlaying(false);
              }}
              className="w-full accent-accent cursor-pointer"
            />

            <div className="flex items-center justify-center gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCurrentTimeMs(0);
                  setIsPlaying(false);
                }}
                className="h-8 w-8 p-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={() => setIsPlaying(!isPlaying)}
                className="h-8 px-4 text-sm bg-accent hover:bg-accent-dark text-white flex items-center gap-1.5 shadow-xs"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isPlaying ? '暂停' : '播放'}
              </Button>
            </div>
          </div>
        </div>
        }
        right={
        /* Actions Timeline Inspector (7 cols) */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">回放动作序列 ({actions.length})</span>
            <span className="text-sm text-muted">按时间顺序单向执行</span>
          </div>

          {/* 外层右栏已经独立滚动，这里不再叠加第二层 max-height，避免出现嵌套滚动条。 */}
          <div className="rounded-[var(--radius-panel)] bg-surface border border-border-default p-3 space-y-2">
            {actions.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted space-y-2">
                <Clock className="h-8 w-8 mx-auto text-fg-subtle opacity-60" />
                <p>当前尚无回放动作序列</p>
                <p className="text-sm">点击顶部“自动生成编排”，系统将计算最适阅读节奏与镜头切换。</p>
              </div>
            ) : (
              actions.map((act, index) => {
                const isActive = currentTimeMs >= act.atMs && currentTimeMs < act.atMs + act.durationMs;

                return (
                  <div
                    key={act.id || index}
                    className={`p-2.5 rounded-lg border text-sm transition-all ${
                      isActive
                        ? 'border-accent bg-accent/5 shadow-xs ring-1 ring-accent'
                        : 'border-border-subtle bg-surface-raised'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-sm font-mono">
                          #{index + 1}
                        </Badge>
                        <span className="font-semibold text-ink font-mono">{actionLabels[act.type] || act.type}</span>
                        {act.view && (
                          <Badge variant="outline" className="text-sm bg-surface-muted">
                            {act.view === 'chat' ? '群聊' : '朋友圈'}
                          </Badge>
                        )}
                        {act.targetType && (
                          <span className="text-sm text-muted">
                            目标: {act.targetType} ({act.targetId?.slice(0, 8)})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-muted font-mono">
                          {formatTime(act.atMs)}
                        </span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={act.durationMs}
                            onChange={(e) => handleUpdateActionDuration(index, Number(e.target.value))}
                            step={200}
                            min={200}
                            disabled={disabled}
                            className="h-6 w-20 text-sm text-right font-mono bg-surface"
                          />
                          <span className="text-sm text-muted">ms</span>
                        </div>
                      </div>
                    </div>

                    {act.kind && (
                      <div className="text-sm text-muted mt-1">
                        {act.kind === 'video' ? '视频' : '图片'} · 镜头 {act.slotId}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        }
      />
    </div>
  );
}
