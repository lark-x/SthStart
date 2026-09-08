import type { ContentDocument, PlaybackDocument } from '@sthstart/contracts';
import type { StateAtTimeResult } from './types.js';

/**
 * Legacy approximate diagnostic state; does not measure DOM layout.
 * @deprecated Do not use for rendering or preview. The compiled HyperFrames
 * timeline is authoritative, including measured scroll positions and media clips.
 */
export function stateAtTime(
  playback: PlaybackDocument,
  content: ContentDocument,
  tMs: number
): StateAtTimeResult {
  const clampedTime = Math.max(0, Math.min(tMs, playback.totalDurationMs));

  let view: 'chat' | 'moments' = 'chat';
  let conversationId: string | undefined = content.conversations[0]?.id;
  let visibleThroughOrder = 0;
  let scrollY = 0;
  let activeMediaModal: StateAtTimeResult['activeMediaModal'] = null;
  let stageCardText: string | null = null;

  // Actions sorted by atMs
  const actions = [...playback.actions].sort((a, b) => a.atMs - b.atMs);

  for (const action of actions) {
    if (action.atMs > clampedTime) break;

    const progress = action.durationMs > 0
      ? Math.min(1, Math.max(0, (clampedTime - action.atMs) / action.durationMs))
      : 1;

    switch (action.type) {
      case 'open_view':
        if (action.view) view = action.view;
        if (action.conversationId) conversationId = action.conversationId;
        if (typeof action.visibleThroughOrder === 'number') {
          visibleThroughOrder = Math.max(visibleThroughOrder, action.visibleThroughOrder);
        }
        break;

      case 'scroll_to':
        // Smooth scroll interpolation (simple ease in/out)
        // For demonstration, map targets to relative offsets
        if (action.targetType === 'message' && action.targetId) {
          const msgIdx = content.messages.findIndex((m) => m.id === action.targetId);
          const targetY = msgIdx >= 0 ? msgIdx * 180 : 0;
          scrollY = scrollY + (targetY - scrollY) * progress;
        } else if (action.targetType === 'post' && action.targetId) {
          const postIdx = content.posts.findIndex((p) => p.id === action.targetId);
          const targetY = postIdx >= 0 ? postIdx * 240 : 0;
          scrollY = scrollY + (targetY - scrollY) * progress;
        }
        break;

      case 'open_media':
        if (action.slotId && action.assetKey) {
          const inWindow = clampedTime >= action.atMs && clampedTime < action.atMs + action.durationMs;
          if (inWindow) {
            activeMediaModal = {
              slotId: action.slotId,
              assetKey: action.assetKey,
              kind: action.kind || 'image',
              sourceInMs: action.sourceInMs || 0,
              volume: action.volume ?? 1,
            };
          }
        }
        break;

      case 'close_media':
        if (clampedTime >= action.atMs) {
          activeMediaModal = null;
        }
        break;

      case 'stage_card':
        if (action.text && clampedTime >= action.atMs && clampedTime < action.atMs + action.durationMs) {
          stageCardText = action.text;
        } else {
          stageCardText = null;
        }
        break;

      case 'reveal_message':
        if (typeof action.visibleThroughOrder === 'number') {
          visibleThroughOrder = Math.max(visibleThroughOrder, action.visibleThroughOrder);
        }
        break;

      default:
        break;
    }
  }

  const conv = content.conversations.find((c) => c.id === conversationId);
  const navTitle = view === 'moments'
    ? '朋友圈'
    : conv ? `${conv.title} (${conv.memberActorIds.length})` : '群聊';

  return {
    tMs: clampedTime,
    view,
    conversationId,
    scrollY,
    visibleThroughOrder,
    activeMediaModal,
    stageCardText,
    navTitle,
  };
}
