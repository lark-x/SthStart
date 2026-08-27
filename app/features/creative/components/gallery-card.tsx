'use client';

import { FileAudio, Pin, Trash2 } from 'lucide-react';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import { formatDate } from '../types';

export function GalleryCard({ artifact, onPin, onDelete }: { artifact: ArtifactDescriptor; onPin: (artifact: ArtifactDescriptor) => Promise<void>; onDelete: (artifact: ArtifactDescriptor) => Promise<void> }) {
  const isVideo = artifact.mediaType === 'video' || artifact.contentType?.startsWith('video/');
  const isAudio = artifact.mediaType === 'audio' || artifact.contentType?.startsWith('audio/');
  const thumbnailUrl = artifact.thumbnailArtifactId
    ? `/api/admin/creative/artifacts/${encodeURIComponent(artifact.thumbnailArtifactId)}`
    : `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}thumbnail=true`;
  return (
    <article className="group overflow-hidden rounded-[3px_14px_3px_3px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8]">
      <a href={artifact.url} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden bg-[#f4f0e7]" aria-label={`查看${artifact.originalName ?? '创作素材'}`}>
        {isVideo ? (
          <img src={thumbnailUrl} alt={artifact.originalName ?? '创作素材'} loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
        ) : isAudio ? (
          <div className="flex h-full w-full items-center justify-center text-[#b83b1b]"><FileAudio className="h-10 w-10" aria-label="音频素材" /></div>
        ) : (
          <img src={artifact.url} alt={artifact.originalName ?? '创作素材'} loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
        )}
        {artifact.pinned && <span className="absolute left-2 top-2 rounded-full bg-[#18201d]/75 p-1.5 text-[#f4f0e7]"><Pin className="h-3 w-3 fill-current" aria-hidden="true" /></span>}
      </a>
      <div className="flex items-center justify-between gap-2 p-2.5">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-[#18201d]">{artifact.originalName ?? (isVideo ? '生成视频' : isAudio ? '生成音频' : '生成图片')}</p>
          <p className="mt-0.5 text-[10px] text-[#89908a]">{formatDate(artifact.createdAt)}</p>
        </div>
        <div className="flex flex-none items-center gap-0.5">
          <button type="button" onClick={() => void onPin(artifact)} className="rounded p-1.5 text-[#68716d] hover:bg-[#18201d]/6 hover:text-[#18201d] active:bg-[#18201d]/12" aria-label={artifact.pinned ? '取消固定' : isVideo ? '固定视频' : '固定图片'}>
            <Pin className={`h-3.5 w-3.5 ${artifact.pinned ? 'fill-current text-[#e45d35]' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void onDelete(artifact)} className="rounded p-1.5 text-[#68716d] hover:bg-[#c9674a]/10 hover:text-[#b83b1b] active:bg-[#c9674a]/14" aria-label={isVideo ? '删除视频' : '删除图片'}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
