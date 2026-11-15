import { useQuery } from '@tanstack/react-query';
import { activityKeys } from '../shared/query-keys';
import { fetchPlaybackRevision } from '../api/playback';

export function useActivityPlaybackRevision(id?: string, playbackRevisionId?: string) {
  return useQuery({
    queryKey: activityKeys.playbackRevision(id ?? '', playbackRevisionId ?? ''),
    queryFn: () => fetchPlaybackRevision(id!, playbackRevisionId!),
    enabled: Boolean(id && playbackRevisionId),
    staleTime: 60_000,
  });
}
