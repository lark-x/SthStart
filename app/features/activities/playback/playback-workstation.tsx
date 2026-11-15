'use client';

import React, { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { normalizeCreationProfile } from '@sthstart/contracts';
import type { PlaybackDocument } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { SplitPanes } from '@/app/components/shared/split-panes';
import { ComicWorkstation } from '../comic/comic-workstation';
import { useGenerateAutoPlayback, useSavePlaybackRevision } from '@/app/features/activities/mutations/playback';
import { useCreateActivityPreset } from '@/app/features/activities/mutations/activities';
import { useActivityPresets } from '@/app/features/activities/queries/activities';
import {
  computePlaybackRevisionState,
  recalculateActionDurations,
  type DeviceLayout,
  type PlaybackMode,
  type PlaybackWorkstationProps,
} from './model';
import { usePlaybackPlayer } from './use-playback-player';
import { PlaybackModeSwitcher } from './components/playback-mode-switcher';
import { PlaybackToolbar } from './components/playback-toolbar';
import { PlaybackPreviewScreen } from './components/playback-preview-screen';
import { PlaybackTimelineInspector } from './components/playback-timeline-inspector';

export function PlaybackWorkstation({
  activity,
  document,
  currentPlaybackRevision,
  mediaRevision,
  actors,
  disabled,
  hideModeSwitcher = false,
}: PlaybackWorkstationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const comicMode = searchParams.get('mode') === 'comic';

  const {
    mediaRevisionMatchesContent,
    hasSelectedMedia,
    playbackMediaRevisionId,
    currentPlaybackMatches,
    savedPlaybackIsStale,
  } = computePlaybackRevisionState(
    activity.currentContentRevisionId,
    currentPlaybackRevision,
    mediaRevision
  );

  const mediaRevisionIdMatchesCurrent = (revisionId?: string) => {
    if (hasSelectedMedia) return revisionId === mediaRevision?.id;
    return (
      revisionId === 'none' ||
      (mediaRevisionMatchesContent && revisionId === mediaRevision?.id)
    );
  };

  const [playbackDoc, setPlaybackDoc] = useState<PlaybackDocument | null>(() =>
    currentPlaybackMatches && currentPlaybackRevision?.document
      ? { ...currentPlaybackRevision.document, mediaRevisionId: playbackMediaRevisionId }
      : null
  );

  const [viewerActorId, setViewerActorId] = useState<string>(
    (currentPlaybackMatches ? currentPlaybackRevision?.document?.viewerActorId : undefined) ||
      actors[0]?.id ||
      ''
  );

  /*
   * 设备布局：手机 9:16 / 电脑 16:9。它同时决定生成时的画布比例与预览外壳，
   * 切换后只需重新编译预览，不必重新生成动作序列。
   */
  const [deviceLayout, setDeviceLayout] = useState<DeviceLayout>(() =>
    (currentPlaybackRevision?.document?.output?.width || 1080) >
    (currentPlaybackRevision?.document?.output?.height || 1920)
      ? 'desktop'
      : 'phone'
  );

  /*
   * 已保存的回放版本是异步读取的：浮层可能先于它打开。版本到达（或换成另一份）时，
   * 只要本地还没有自行编排的时间线，就采用它；已在编辑的时间线不会被覆盖。
   */
  const [syncedRevisionId, setSyncedRevisionId] = useState<string | null>(() =>
    currentPlaybackMatches ? currentPlaybackRevision?.id ?? null : null
  );
  if (
    currentPlaybackMatches &&
    currentPlaybackRevision &&
    currentPlaybackRevision.id !== syncedRevisionId
  ) {
    setSyncedRevisionId(currentPlaybackRevision.id);
    if (!playbackDoc) {
      setPlaybackDoc({
        ...currentPlaybackRevision.document,
        mediaRevisionId: playbackMediaRevisionId,
      });
      if (currentPlaybackRevision.document.viewerActorId) {
        setViewerActorId(currentPlaybackRevision.document.viewerActorId);
      }
      const output = currentPlaybackRevision.document.output;
      setDeviceLayout(
        (output?.width || 1080) > (output?.height || 1920) ? 'desktop' : 'phone'
      );
    }
  }

  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(
    () =>
      normalizeCreationProfile(
        (document.activity.creationProfile?.values || {}) as Record<string, unknown>
      ).playbackMode as PlaybackMode
  );
  const [expandMedia, setExpandMedia] = useState<boolean>(
    () =>
      normalizeCreationProfile(
        (document.activity.creationProfile?.values || {}) as Record<string, unknown>
      ).expandMedia
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const playbackRevisionIsStale = Boolean(
    playbackDoc &&
      (playbackDoc.contentRevisionId !== activity.currentContentRevisionId ||
        !mediaRevisionIdMatchesCurrent(playbackDoc.mediaRevisionId))
  );

  const { data: presetsData } = useActivityPresets('playback_preset');
  const createPresetMutation = useCreateActivityPreset();
  const playbackPresets = presetsData?.items || [];

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) return;
    const preset = playbackPresets.find((p) => p.id === presetId);
    if (preset?.payload) {
      const payload = preset.payload as Record<string, unknown>;
      if (typeof payload.speed === 'number') player.setSpeed(payload.speed);
      if (
        typeof payload.mode === 'string' &&
        ['by_stage', 'story_order', 'chat_only', 'moments_only'].includes(payload.mode)
      ) {
        setPlaybackMode(payload.mode as PlaybackMode);
      }
      if (typeof payload.expandMedia === 'boolean') setExpandMedia(payload.expandMedia);
      if (payload.deviceLayout === 'phone' || payload.deviceLayout === 'desktop') {
        setDeviceLayout(payload.deviceLayout);
      }
    }
  };

  const handleSavePlaybackPreset = async () => {
    const name = window.prompt(
      '请输入回放预设名称:',
      `回放偏好 (${playbackMode} · ${player.speed}x)`
    );
    if (!name?.trim()) return;
    try {
      const created = await createPresetMutation.mutateAsync({
        kind: 'playback_preset',
        name: name.trim(),
        payload: {
          speed: player.speed,
          mode: playbackMode,
          expandMedia,
          deviceLayout,
        },
      });
      setSelectedPresetId(created.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存回放预设失败');
    }
  };

  const autoPlaybackMutation = useGenerateAutoPlayback();
  const savePlaybackMutation = useSavePlaybackRevision();

  const player = usePlaybackPlayer({
    activityId: activity.id,
    playbackDoc,
    playbackRevisionIsStale,
    viewerActorId,
    deviceLayout,
  });

  const handleGenerateAuto = async () => {
    setErrorMsg(null);
    try {
      const result = await autoPlaybackMutation.mutateAsync({
        id: activity.id,
        options: {
          contentRevisionId: activity.currentContentRevisionId || '',
          mediaRevisionId: playbackMediaRevisionId,
          viewerActorId,
          speed: player.speed,
          mode: playbackMode,
          expandMedia,
        },
      });
      setPlaybackDoc(result.playbackDocument);
      player.resetScrubber();
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
        mediaRevisionId: playbackMediaRevisionId,
        document: {
          ...playbackDoc,
          mediaRevisionId: playbackMediaRevisionId,
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
    const { actions: recalculated, totalDurationMs: runningTime } =
      recalculateActionDurations(playbackDoc.actions, index, newDurationMs);

    setPlaybackDoc({
      ...playbackDoc,
      actions: recalculated,
      totalDurationMs: runningTime,
    });
  };

  if (comicMode) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PlaybackModeSwitcher comicMode />
        <div className="min-h-0 flex-1">
          <ComicWorkstation
            activity={activity}
            content={document}
            actors={actors}
            onBack={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.delete('mode');
              params.set('tab', 'playback');
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }}
          />
        </div>
      </div>
    );
  }

  const effectiveError = errorMsg || player.previewError;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!hideModeSwitcher && <PlaybackModeSwitcher comicMode={false} />}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
        <PlaybackToolbar
          disabled={disabled}
          isGenerating={autoPlaybackMutation.isPending}
          isSaving={savePlaybackMutation.isPending}
          saveDisabled={!playbackDoc || playbackRevisionIsStale}
          onGenerateAuto={handleGenerateAuto}
          onSavePlayback={handleSavePlayback}
          viewerActorId={viewerActorId}
          onViewerActorChange={setViewerActorId}
          actors={actors}
          deviceLayout={deviceLayout}
          onDeviceLayoutChange={setDeviceLayout}
          speed={player.speed}
          onSpeedChange={player.setSpeed}
          playbackMode={playbackMode}
          onPlaybackModeChange={setPlaybackMode}
          expandMedia={expandMedia}
          onExpandMediaChange={setExpandMedia}
          selectedPresetId={selectedPresetId}
          onSelectPreset={handleSelectPreset}
          onSavePreset={handleSavePlaybackPreset}
          presets={playbackPresets}
          totalDurationMs={player.totalDurationMs}
          actionsCount={player.actions.length}
        />

        {effectiveError && (
          <Alert variant="danger" title="回放编排提示">
            {effectiveError}
          </Alert>
        )}

        {!playbackDoc && (
          <Alert
            variant="warning"
            title={savedPlaybackIsStale ? '保存的回放版本已过期' : '当前内容尚无回放版本'}
          >
            {savedPlaybackIsStale
              ? '内容或媒体版本已变化，旧时间线不会用于当前预览。请重新编排后再播放或保存。'
              : '先自动编排当前内容，即可预览纯文本活动或包含媒体的活动。'}
          </Alert>
        )}

        {playbackRevisionIsStale && (
          <Alert variant="warning" title="回放版本与当前内容不匹配">
            请重新编排；旧时间线不会用于预览或导出。
          </Alert>
        )}

        {saveSuccess && (
          <Alert variant="info" title="已成功保存">
            回放脚本版本已成功落库，可在导出面板中下载完整可渲染工程。
          </Alert>
        )}

        {/* Main Grid: Device Simulator & Actions Timeline（两栏各自滚动，§4.4） */}
        <SplitPanes
          className="lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          from="lg"
          labels={{ left: '设备模拟预览', right: '回放动作序列' }}
          left={
            <PlaybackPreviewScreen
              deviceLayout={deviceLayout}
              previewBoxRef={player.previewBoxRef}
              iframeRef={player.iframeRef}
              previewHtml={player.previewHtml}
              previewHeight={player.previewHeight}
              canvasWidth={player.canvasWidth}
              canvasHeight={player.canvasHeight}
              previewScale={player.previewScale}
              syncPreview={player.syncPreview}
              currentTimeMs={player.currentTimeMs}
              totalDurationMs={player.totalDurationMs}
              isPlaying={player.isPlaying}
              disabledScrubber={!playbackDoc || playbackRevisionIsStale}
              onSeek={(ms) => {
                player.setCurrentTimeMs(ms);
                player.setIsPlaying(false);
              }}
              onReset={player.resetScrubber}
              onTogglePlay={player.togglePlay}
            />
          }
          right={
            <PlaybackTimelineInspector
              actions={player.actions}
              currentTimeMs={player.currentTimeMs}
              disabled={disabled}
              onUpdateActionDuration={handleUpdateActionDuration}
            />
          }
        />
      </div>
    </div>
  );
}
