import type {
  Activity,
  ActorSnapshot,
  ContentDocument,
  PlaybackAction,
  PlaybackDocument,
  PlaybackRevision,
  MediaRevision,
} from '@sthstart/contracts';

export const ACTION_LABELS: Record<string, string> = {
  open_view: '切换视图',
  scroll_to: '滚动记录',
  open_media: '展开媒体',
  close_media: '关闭媒体',
  reveal_message: '显示消息',
  reveal_comments: '显示评论',
  typing: '正在输入',
  wait: '停留阅读',
  stage_card: '阶段说明',
};

// 单向兼容已有小写导入
export const actionLabels = ACTION_LABELS;

export type DeviceLayout = 'phone' | 'desktop';
export type PlaybackMode = 'by_stage' | 'story_order' | 'chat_only' | 'moments_only';

export interface DeviceDimensions {
  canvasWidth: number;
  canvasHeight: number;
  layoutWidth: number;
  layoutHeight: number;
  outputWidth: number;
  outputHeight: number;
}

/**
 * 设备尺寸与画布比例：
 * 手机 9:16 (1080x1920) / 电脑 16:9 (1920x1080)
 */
export function getDeviceDimensions(deviceLayout: DeviceLayout): DeviceDimensions {
  if (deviceLayout === 'desktop') {
    return {
      canvasWidth: 1920,
      canvasHeight: 1080,
      layoutWidth: 1280,
      layoutHeight: 720,
      outputWidth: 1920,
      outputHeight: 1080,
    };
  }
  return {
    canvasWidth: 1080,
    canvasHeight: 1920,
    layoutWidth: 360,
    layoutHeight: 640,
    outputWidth: 1080,
    outputHeight: 1920,
  };
}

/**
 * 根据设备布局生成设备覆盖文档（动作序列本身与设备无关）
 */
export function buildDevicePlaybackDoc(
  playbackDoc: PlaybackDocument,
  deviceLayout: DeviceLayout
): PlaybackDocument {
  const dim = getDeviceDimensions(deviceLayout);
  return {
    ...playbackDoc,
    layout: { width: dim.layoutWidth, height: dim.layoutHeight },
    output: { ...playbackDoc.output, width: dim.outputWidth, height: dim.outputHeight },
  };
}

/**
 * 格式化毫秒为 mm:ss
 */
export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 重算动作序列时长与开始时间
 */
export function recalculateActionDurations(
  actions: PlaybackAction[],
  index: number,
  newDurationMs: number
): { actions: PlaybackAction[]; totalDurationMs: number } {
  const list = [...actions];
  const target = list[index];
  if (!target) {
    return {
      actions,
      totalDurationMs: actions.reduce((sum, a) => sum + (a.durationMs || 0), 0),
    };
  }

  list[index] = { ...target, durationMs: newDurationMs };

  let runningTime = 0;
  const recalculated = list.map((act) => {
    const updated = { ...act, atMs: runningTime };
    runningTime += act.durationMs;
    return updated;
  });

  return {
    actions: recalculated,
    totalDurationMs: runningTime,
  };
}

export interface PlaybackRevisionMatchResult {
  mediaRevisionMatchesContent: boolean;
  hasSelectedMedia: boolean;
  playbackMediaRevisionId: string;
  currentPlaybackMatches: boolean;
  savedPlaybackIsStale: boolean;
}

/**
 * 计算回放版本与当前正文/媒体的匹配与过期状态
 */
export function computePlaybackRevisionState(
  currentContentRevisionId: string | null | undefined,
  currentPlaybackRevision: PlaybackRevision | null | undefined,
  mediaRevision: MediaRevision | null | undefined
): PlaybackRevisionMatchResult {
  const mediaRevisionMatchesContent =
    Boolean(mediaRevision && mediaRevision.contentRevisionId === currentContentRevisionId);
  const hasSelectedMedia = Boolean(
    mediaRevisionMatchesContent &&
      mediaRevision?.slotBindings.some((binding) => binding.assets.length > 0)
  );
  const playbackMediaRevisionId = hasSelectedMedia && mediaRevision ? mediaRevision.id : 'none';

  const mediaRevisionIdMatchesCurrent = (revisionId?: string) => {
    if (hasSelectedMedia) return revisionId === mediaRevision?.id;
    return (
      revisionId === 'none' ||
      (mediaRevisionMatchesContent && revisionId === mediaRevision?.id)
    );
  };

  const currentPlaybackMatches = Boolean(
    currentPlaybackRevision &&
      currentPlaybackRevision.contentRevisionId === currentContentRevisionId &&
      currentPlaybackRevision.document.contentRevisionId === currentContentRevisionId &&
      mediaRevisionIdMatchesCurrent(currentPlaybackRevision.mediaRevisionId)
  );

  const savedPlaybackIsStale = Boolean(currentPlaybackRevision && !currentPlaybackMatches);

  return {
    mediaRevisionMatchesContent,
    hasSelectedMedia,
    playbackMediaRevisionId,
    currentPlaybackMatches,
    savedPlaybackIsStale,
  };
}

/**
 * 校验当前加载的回放文档是否已与最新正文/媒体版本脱节
 */
export function isPlaybackDocStale(
  playbackDoc: PlaybackDocument | null,
  currentContentRevisionId: string | null | undefined,
  hasSelectedMedia: boolean,
  mediaRevision: MediaRevision | null | undefined,
  mediaRevisionMatchesContent: boolean
): boolean {
  if (!playbackDoc) return false;
  const mediaRevisionIdMatchesCurrent = (revisionId?: string) => {
    if (hasSelectedMedia) return revisionId === mediaRevision?.id;
    return (
      revisionId === 'none' ||
      (mediaRevisionMatchesContent && revisionId === mediaRevision?.id)
    );
  };
  return Boolean(
    playbackDoc.contentRevisionId !== currentContentRevisionId ||
      !mediaRevisionIdMatchesCurrent(playbackDoc.mediaRevisionId)
  );
}

export interface PlaybackWorkstationProps {
  activity: Activity;
  document: ContentDocument;
  currentPlaybackRevision?: PlaybackRevision | null;
  mediaRevision?: MediaRevision | null;
  actors: ActorSnapshot[];
  disabled?: boolean;
  hideModeSwitcher?: boolean;
}
