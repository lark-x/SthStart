import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import { savePlaybackRevision, generateAutoPlayback } from '../api/playback';
import type { PlaybackDocument } from '@sthstart/contracts';

export function useSavePlaybackRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      contentRevisionId,
      mediaRevisionId,
      document,
    }: {
      id: string;
      contentRevisionId: string;
      mediaRevisionId: string;
      document: PlaybackDocument;
    }) => savePlaybackRevision(id, contentRevisionId, mediaRevisionId, document),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: activityKeys.playbackRevision(variables.id, '') });
    },
  });
}

export function useGenerateAutoPlayback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      options,
    }: {
      id: string;
      options?: {
        contentRevisionId?: string;
        mediaRevisionId?: string;
        viewerActorId?: string;
        speed?: number;
        autoPlay?: boolean;
        mode?: 'by_stage' | 'story_order' | 'chat_only' | 'moments_only';
        expandMedia?: boolean;
        deviceLayout?: 'phone' | 'desktop';
      };
    }) => generateAutoPlayback(id, options),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: activityKeys.detail(variables.id) });
    },
  });
}
