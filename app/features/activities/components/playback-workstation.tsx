'use client';

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
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-[4px_14px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)]">
        <div>
          <h3 className="text-sm font-semibold text-[#18201d] flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-[#e45d35]" />
            回放编排与设备模拟预览
          </h3>
          <p className="text-xs text-[#68716d]">
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
            className="text-xs flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#e45d35]" />
            {autoPlaybackMutation.isPending ? '计算编排中…' : '自动生成编排'}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSavePlayback}
            disabled={disabled || !playbackDoc || savePlaybackMutation.isPending}
            className="text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
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
      <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-[#faf8f2] border border-[rgb(24_32_29/10%)]">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[#68716d]" />
          <span className="text-xs font-semibold text-[#18201d]">观众视角：</span>
          <div className="w-36">
            <Select
              value={viewerActorId}
              onChange={(e) => setViewerActorId(e.target.value)}
              disabled={disabled}
              className="h-8 text-xs bg-white min-h-0"
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
          <Sliders className="h-4 w-4 text-[#68716d]" />
          <span className="text-xs font-semibold text-[#18201d]">播放倍速：</span>
          <div className="flex items-center gap-1">
            {[0.5, 1, 1.25, 1.5, 2].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                  speed === s
                    ? 'bg-[#e45d35] text-white'
                    : 'bg-white text-stone-700 hover:bg-stone-200 border border-stone-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto text-xs text-[#68716d] font-mono">
          总时长: {formatTime(totalDurationMs)} ({actions.length} 个动作)
        </div>
      </div>

      {/* Main Grid: Device Simulator & Actions Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Phone Mockup Preview (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-[300px] h-[580px] bg-stone-900 rounded-[36px] p-3 shadow-2xl border-4 border-stone-800 flex flex-col relative overflow-hidden">
            {/* Phone notch */}
            <div className="w-28 h-4 bg-stone-800 rounded-full mx-auto mb-2 flex-shrink-0" />

            {/* Screen Content */}
            <div className="flex-1 bg-[#ede7dc] rounded-[24px] overflow-hidden flex flex-col relative">
              {/* Screen Top Bar */}
              <div className="h-10 bg-[#dfd6c8] px-3 flex items-center justify-between border-b border-stone-300 text-xs font-semibold text-stone-800 flex-shrink-0">
                <span className="truncate max-w-[160px]">{activity.title}</span>
                <Badge variant="outline" className="text-[9px] bg-stone-200 border-0">
                  {currentAction?.type || 'idle'}
                </Badge>
              </div>

              {/* Chat messages / Moments view */}
              <div className="flex-1 p-3 overflow-y-auto space-y-2 text-xs">
                {(document.messages || []).slice(0, 8).map((msg) => {
                  const isViewer = msg.speakerActorId === viewerActorId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isViewer ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`p-2 rounded-[4px_10px_4px_4px] text-[11px] max-w-[85%] ${
                          isViewer ? 'bg-[#e45d35] text-white' : 'bg-white text-stone-900 shadow-2xs'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Simulated active popup (if open_media) */}
              {currentAction?.type === 'open_media' && (
                <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-4 text-white text-center z-10 animate-fade-in">
                  <Film className="h-10 w-10 mb-2 text-[#e45d35]" />
                  <div className="text-xs font-semibold">{currentAction.kind === 'video' ? '视频播放中' : '照片查看中'}</div>
                  <div className="text-[10px] text-stone-400 mt-1 font-mono">槽位: {currentAction.slotId}</div>
                  <div className="text-[9px] text-stone-500 mt-2">点击动作序列可调节展开时长</div>
                </div>
              )}
            </div>

            {/* Bottom bar indicator */}
            <div className="w-20 h-1 bg-stone-700 rounded-full mx-auto mt-2 flex-shrink-0" />
          </div>

          {/* Scrubber Bar */}
          <div className="w-[300px] mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono text-[#68716d]">
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
              className="w-full accent-[#e45d35] cursor-pointer"
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
                className="h-8 px-4 text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isPlaying ? '暂停' : '播放'}
              </Button>
            </div>
          </div>
        </div>

        {/* Actions Timeline Inspector (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#18201d]">回放动作序列 ({actions.length})</span>
            <span className="text-[11px] text-[#68716d]">按时间顺序单向执行</span>
          </div>

          <div className="rounded-[4px_14px_4px_4px] bg-[#faf8f2] border border-[rgb(24_32_29/14%)] p-3 max-h-[560px] overflow-y-auto space-y-2">
            {actions.length === 0 ? (
              <div className="py-16 text-center text-xs text-[#68716d] space-y-2">
                <Clock className="h-8 w-8 mx-auto text-stone-400 opacity-60" />
                <p>当前尚无回放动作序列</p>
                <p className="text-[11px]">点击顶部“自动生成编排”，系统将计算最适阅读节奏与镜头切换。</p>
              </div>
            ) : (
              actions.map((act, index) => {
                const isActive = currentTimeMs >= act.atMs && currentTimeMs < act.atMs + act.durationMs;

                return (
                  <div
                    key={act.id || index}
                    className={`p-2.5 rounded-lg border text-xs transition-all ${
                      isActive
                        ? 'border-[#e45d35] bg-[#e45d35]/5 shadow-xs ring-1 ring-[#e45d35]'
                        : 'border-stone-200/80 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          #{index + 1}
                        </Badge>
                        <span className="font-semibold text-[#18201d] font-mono">{act.type}</span>
                        {act.view && (
                          <Badge variant="outline" className="text-[9px] bg-stone-100">
                            视图: {act.view}
                          </Badge>
                        )}
                        {act.targetType && (
                          <span className="text-[11px] text-[#68716d]">
                            目标: {act.targetType} ({act.targetId?.slice(0, 8)})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-stone-500 font-mono">
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
                            className="h-6 w-20 text-[11px] text-right font-mono bg-stone-50"
                          />
                          <span className="text-[10px] text-stone-500">ms</span>
                        </div>
                      </div>
                    </div>

                    {act.kind && (
                      <div className="text-[11px] text-[#68716d] mt-1">
                        媒体类型: {act.kind} | 槽位: {act.slotId}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
