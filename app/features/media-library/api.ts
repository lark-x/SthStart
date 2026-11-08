import { getJson } from '@/app/lib/api-client';
import {
  MediaLibraryResponseSchema,
  type MediaLibraryItem,
  type MediaLibraryQuery,
  type MediaLibraryResponse,
} from '@sthstart/contracts';

export function buildMediaFileUrl(id: string): string {
  return `/api/admin/media-library/${encodeURIComponent(id)}/file`;
}

export function buildMediaThumbnailUrl(id: string): string {
  return `/api/admin/media-library/${encodeURIComponent(id)}/file`;
}

export async function fetchMediaLibrary(query?: MediaLibraryQuery, options?: { signal?: AbortSignal }): Promise<MediaLibraryResponse> {
  const params = new URLSearchParams();
  if (query?.q?.trim()) params.set('q', query.q.trim());
  if (query?.mediaKind && query.mediaKind !== 'all') params.set('mediaKind', query.mediaKind);
  if (query?.appId && query.appId !== 'all') params.set('appId', query.appId);
  if (query?.status && query.status !== 'all') params.set('status', query.status);
  if (query?.limit != null) params.set('limit', String(query.limit));
  if (query?.offset != null) params.set('offset', String(query.offset));

  const queryStr = params.toString();
  const endpoint = queryStr ? `media-library?${queryStr}` : 'media-library';

  const response = await getJson<MediaLibraryResponse>(endpoint, options, MediaLibraryResponseSchema);

  // 映射代理 URL
  const mappedItems: MediaLibraryItem[] = response.items.map((item) => ({
    ...item,
    fileUrl: buildMediaFileUrl(item.id),
    thumbnailUrl: item.thumbnailArtifactId ? buildMediaThumbnailUrl(item.thumbnailArtifactId) : null,
  }));

  return {
    ...response,
    items: mappedItems,
  };
}

