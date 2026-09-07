import { createHash } from 'node:crypto';
import type {
  ContentDocument,
  MediaRevisionDocument,
  PlaybackAction,
  PlaybackDocument,
} from '@sthstart/contracts';

export interface AutoPlaybackOptions {
  viewerActorId?: string;
  speed?: number; // 0.5 to 2.0, default 1.0
  expandMedia?: boolean;
  stageCardDurationMs?: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function generateAutoPlayback(
  contentRevisionId: string,
  content: ContentDocument,
  mediaRevisionId: string,
  mediaRev: MediaRevisionDocument | null,
  options: AutoPlaybackOptions = {},
): PlaybackDocument {
  const viewerActorId = options.viewerActorId || content.actors[0]?.id || 'viewer';
  const speed = options.speed && options.speed > 0 ? options.speed : 1.0;
  const expandMedia = options.expandMedia !== false;
  const stageCardMs = options.stageCardDurationMs ?? 1500;

  const actions: PlaybackAction[] = [];
  let currentMs = 0;
  let actionIdx = 0;

  const addAction = (act: Omit<PlaybackAction, 'id'>) => {
    actionIdx += 1;
    actions.push({
      id: `act_${actionIdx}`,
      ...act,
    });
    currentMs += act.durationMs;
  };

  // Build slot to asset map from mediaRev
  const slotAssetMap = new Map<string, string>();
  if (mediaRev?.slotBindings) {
    for (const b of mediaRev.slotBindings) {
      if (b.assets && b.assets.length > 0) {
        slotAssetMap.set(b.slotId, b.assets[0].assetKey);
      }
    }
  }

  const slotMap = new Map(content.mediaSlots.map((s) => [s.id, s]));

  // Sort stages
  const stages = [...content.stages].sort((a, b) => a.order - b.order);

  for (const stage of stages) {
    // 1. Stage transition card
    addAction({
      type: 'stage_card',
      atMs: currentMs,
      durationMs: stageCardMs,
      stageId: stage.id,
      text: stage.title,
    });

    const stageMessages = content.messages
      .filter((m) => m.stageId === stage.id)
      .sort((a, b) => a.storyOrder - b.storyOrder);

    const stagePosts = content.posts
      .filter((p) => p.stageId === stage.id)
      .sort((a, b) => a.storyOrder - b.storyOrder);

    // 2. Chat messages in stage
    if (stageMessages.length > 0) {
      const convId = stageMessages[0].conversationId;
      addAction({
        type: 'open_view',
        atMs: currentMs,
        durationMs: 500,
        view: 'chat',
        conversationId: convId,
      });

      for (const msg of stageMessages) {
        const charCount = (msg.text || '').length;
        const readMs = clamp(Math.round((1200 + (charCount / 6) * 1000) / speed), 1500, 10000);

        addAction({
          type: 'reveal_message',
          atMs: currentMs,
          durationMs: readMs,
          view: 'chat',
          conversationId: msg.conversationId,
          visibleThroughOrder: msg.storyOrder,
          targetType: 'message',
          targetId: msg.id,
          actorId: msg.speakerActorId,
          text: msg.text,
        });

        // If message has media and expandMedia is enabled
        if (expandMedia && msg.mediaSlotIds && msg.mediaSlotIds.length > 0) {
          for (const slotId of msg.mediaSlotIds) {
            const slot = slotMap.get(slotId);
            const assetKey = slotAssetMap.get(slotId);
            if (slot && assetKey) {
              const modalDurationMs = slot.kind === 'video' ? 5000 : 3000;
              addAction({
                type: 'open_media',
                atMs: currentMs,
                durationMs: modalDurationMs,
                slotId,
                assetKey,
                kind: slot.kind,
                sourceInMs: 0,
                volume: 1.0,
              });

              addAction({
                type: 'close_media',
                atMs: currentMs,
                durationMs: 400,
              });
            }
          }
        }
      }
    }

    // 3. Moments posts in stage
    if (stagePosts.length > 0) {
      addAction({
        type: 'open_view',
        atMs: currentMs,
        durationMs: 600,
        view: 'moments',
      });

      for (const post of stagePosts) {
        const postMs = clamp(Math.round((1500 + (post.text.length / 5) * 1000) / speed), 2000, 8000);

        addAction({
          type: 'scroll_to',
          atMs: currentMs,
          durationMs: postMs,
          view: 'moments',
          targetType: 'post',
          targetId: post.id,
          throughOrder: post.storyOrder,
        });

        // Comments for this post
        const postComments = content.comments
          .filter((c) => c.postId === post.id)
          .sort((a, b) => a.storyOrder - b.storyOrder);

        if (postComments.length > 0) {
          addAction({
            type: 'reveal_comments',
            atMs: currentMs,
            durationMs: 1500,
            view: 'moments',
            postId: post.id,
            throughOrder: postComments[postComments.length - 1].storyOrder,
          });
        }

        // Expand post media if available
        if (expandMedia && post.mediaSlotIds && post.mediaSlotIds.length > 0) {
          for (const slotId of post.mediaSlotIds) {
            const slot = slotMap.get(slotId);
            const assetKey = slotAssetMap.get(slotId);
            if (slot && assetKey) {
              const modalMs = slot.kind === 'video' ? 5000 : 3000;
              addAction({
                type: 'open_media',
                atMs: currentMs,
                durationMs: modalMs,
                slotId,
                assetKey,
                kind: slot.kind,
              });
              addAction({
                type: 'close_media',
                atMs: currentMs,
                durationMs: 400,
              });
            }
          }
        }
      }
    }
  }

  // Final hold
  addAction({
    type: 'hold',
    atMs: currentMs,
    durationMs: 1500,
  });

  return {
    schemaVersion: 1,
    contentRevisionId,
    mediaRevisionId,
    template: {
      id: 'phone-v1',
      version: '1.0.0',
    },
    viewerActorId,
    layout: {
      width: 1080,
      height: 1920,
    },
    output: {
      width: 1080,
      height: 1920,
      fps: 30,
    },
    totalDurationMs: currentMs,
    actions,
  };
}

export function validatePlaybackDocument(
  doc: PlaybackDocument,
  content: ContentDocument,
  mediaRev: MediaRevisionDocument | null,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (doc.schemaVersion !== 1) {
    errors.push(`unsupported_schema_version: ${doc.schemaVersion}`);
  }

  const actorIds = new Set(content.actors.map((a) => a.id));
  if (!actorIds.has(doc.viewerActorId)) {
    errors.push(`viewer_actor_not_found: ${doc.viewerActorId}`);
  }

  const messageIds = new Set(content.messages.map((m) => m.id));
  const postIds = new Set(content.posts.map((p) => p.id));
  const slotIds = new Set(content.mediaSlots.map((s) => s.id));

  for (const act of doc.actions) {
    if (act.targetType === 'message' && act.targetId && !messageIds.has(act.targetId)) {
      errors.push(`playback_target_missing: message ${act.targetId}`);
    }
    if (act.targetType === 'post' && act.targetId && !postIds.has(act.targetId)) {
      errors.push(`playback_target_missing: post ${act.targetId}`);
    }
    if (act.slotId && !slotIds.has(act.slotId)) {
      errors.push(`slot_not_found: ${act.slotId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
