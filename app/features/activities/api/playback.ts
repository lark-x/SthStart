import { getJson, postJson } from '@/app/lib/api-client';
import type { PlaybackDocument, PlaybackRevision } from '@sthstart/contracts';

export async function fetchPlaybackRevision(id: string, playbackRevisionId: string): Promise<PlaybackRevision> {
  return getJson(`/api/admin/activities/${encodeURIComponent(id)}/playback-revisions/${encodeURIComponent(playbackRevisionId)}`);
}

export async function savePlaybackRevision(
  id: string,
  contentRevisionId: string,
  mediaRevisionId: string,
  document: PlaybackDocument
): Promise<PlaybackRevision> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/playback-revisions`, {
    contentRevisionId,
    mediaRevisionId,
    document,
  });
}

export async function generateAutoPlayback(
  id: string,
  options?: {
    contentRevisionId?: string;
    mediaRevisionId?: string;
    viewerActorId?: string;
    speed?: number;
    autoPlay?: boolean;
    mode?: 'by_stage' | 'story_order' | 'chat_only' | 'moments_only';
    expandMedia?: boolean;
    deviceLayout?: 'phone' | 'desktop';
  }
): Promise<{ playbackDocument: PlaybackDocument; savedRevisionId?: string }> {
  return postJson(`/api/admin/activities/${encodeURIComponent(id)}/playback/generate`, options || {});
}
