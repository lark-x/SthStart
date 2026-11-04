'use client';

import { FileAudio, Pin, Trash2 } from 'lucide-react';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import { formatDate } from '../types';

export function GalleryCard({
  artifact,
  onPin,
  onDelete,
}: {
  artifact: ArtifactDescriptor;
  onPin: (artifact: ArtifactDescriptor) => Promise<void>;
  onDelete: (artifact: ArtifactDescriptor) => Promise<void>;
}) {
  const isVideo = artifact.mediaType === 'video' || artifact.contentType?.startsWith('video/');
  const isAudio = artifact.mediaType === 'audio' || artifact.contentType?.startsWith('audio/');
  const thumbnailUrl = artifact.thumbnailArtifactId
    ? `/api/admin/creative/artifacts/${encodeURIComponent(artifact.thumbnailArtifactId)}`
    : `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}thumbnail=true`;

  return (
    <article className="group flex items-center justify-between gap-3 p-3 transition-colors hover:bg-surface-elevated">
      <div className="flex items-center gap-3 min-w-0">
        <a
          href={artifact.url}
          target="_blank"
          rel="noreferrer"
          className="relative flex-none h-14 w-14 overflow-hidden rounded-[var(--radius-control)] border border-border-subtle bg-paper"
          aria-label={`查看${artifact.originalName ?? '创作素材'}`}
        >
          {isVideo ? (
            <img
              src={thumbnailUrl}
              alt={artifact.originalName ?? '创作素材'}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : isAudio ? (
            <div className="flex h-full w-full items-center justify-center text-muted">
              <FileAudio className="h-6 w-6" aria-label="音频素材" />
            </div>
          ) : (
            <img
              src={artifact.url}
              alt={artifact.originalName ?? '创作素材'}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          )}
          {artifact.pinned && (
            <span className="absolute left-1 top-1 rounded-full bg-ink/75 p-0.5 text-paper">
              <Pin className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
            </span>
          )}
        </a>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">
              {artifact.originalName ?? (isVideo ? '生成视频' : isAudio ? '生成音频' : '生成图片')}
            </p>
            {artifact.pinned && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-surface-sunken text-fg-subtle border border-border-subtle">
                已固定
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <span>{formatDate(artifact.createdAt)}</span>
            {artifact.contentType && <span>· {artifact.contentType}</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-none items-center gap-1">
        <button
          type="button"
          onClick={() => void onPin(artifact)}
          className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-surface-sunken hover:text-ink active:bg-surface-sunken/80 transition-colors ${
            artifact.pinned ? 'text-accent' : ''
          }`}
          aria-label={artifact.pinned ? '取消固定' : isVideo ? '固定视频' : '固定图片'}
          title={artifact.pinned ? '取消固定' : '固定到媒体库顶部'}
        >
          <Pin className={`h-3.5 w-3.5 ${artifact.pinned ? 'fill-current text-accent' : ''}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void onDelete(artifact)}
          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-danger/10 hover:text-danger active:bg-danger/15 transition-colors"
          aria-label={isVideo ? '删除视频' : '删除图片'}
          title="删除素材"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
