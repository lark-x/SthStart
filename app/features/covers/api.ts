import { adminFetch, ApiClientError, getJson, putJson, validateResponse } from '@/app/lib/api-client';
import {
  COVER_IMAGE_CONTENT_TYPES,
  COVER_IMAGE_MAX_BYTES,
  CoverUploadResponseSchema,
  EntityCoverSchema,
  type CoverEntityType,
  type CoverUploadResponse,
  type EntityCover,
} from '@sthstart/contracts';
import { buildMediaFileUrl } from '@/app/features/media-library/api';

/** 封面图片地址：封面只保存媒体 ID，文件统一由媒体库代理读取。 */
export function coverImageUrl(artifactId: string | null | undefined): string | null {
  return artifactId ? buildMediaFileUrl(artifactId) : null;
}

/** 本地校验与服务端规则一致，提前给出可读提示；服务端仍会再次校验。 */
export function validateCoverFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!COVER_IMAGE_CONTENT_TYPES.includes(file.type)) return '封面只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。';
  if (file.size < 1) return '图片文件为空。';
  if (file.size > COVER_IMAGE_MAX_BYTES) return '封面图片不能超过 12 MiB。';
  return null;
}

export async function uploadCoverImage(file: File): Promise<CoverUploadResponse> {
  const invalid = validateCoverFile(file);
  if (invalid) throw new ApiClientError(invalid, { status: 400, code: 'cover_artifact_invalid' });
  const response = await adminFetch('covers/uploads', {
    method: 'POST',
    headers: {
      'content-type': file.type,
      'x-artifact-original-name': encodeURIComponent(file.name),
      accept: 'application/json',
    },
    body: file,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : `封面上传失败（HTTP ${response.status}）。`;
    throw new ApiClientError(message, { status: response.status, code: typeof payload?.error === 'string' ? payload.error : undefined });
  }
  return validateResponse<CoverUploadResponse>(payload, CoverUploadResponseSchema, 'covers/uploads');
}

export function fetchEntityCover(entityType: CoverEntityType, entityId: string): Promise<EntityCover> {
  return getJson<EntityCover>(`covers/${entityType}/${encodeURIComponent(entityId)}`, undefined, EntityCoverSchema);
}

/** `artifactId: null` 为显式移除封面。 */
export function setEntityCover(entityType: CoverEntityType, entityId: string, artifactId: string | null): Promise<EntityCover> {
  return putJson<EntityCover, { artifactId: string | null }>(
    `covers/${entityType}/${encodeURIComponent(entityId)}`, { artifactId }, undefined, EntityCoverSchema,
  );
}
