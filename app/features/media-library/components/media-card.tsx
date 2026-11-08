'use client';

import React, { useState } from 'react';
import {
  FileAudio,
  FileVideo,
  FileText,
  AlertTriangle,
  ExternalLink,
  Layers,
} from 'lucide-react';
import type { MediaLibraryItem } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { formatByteSize, formatDateTime } from '../types';
import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';

export interface MediaCardProps {
  item: MediaLibraryItem;
  onPreview: (item: MediaLibraryItem) => void;
  onChooseArtifact?: (item: MediaLibraryItem) => void;
}

export function MediaCard({ item, onPreview, onChooseArtifact }: MediaCardProps) {
  const [loadError, setLoadError] = useState(false);

  const isMissing = item.fileStatus === 'missing';
  const isQuarantined = item.fileStatus === 'quarantined';
  const isUnusable = isMissing || isQuarantined;
  const isImage = item.mediaKind === 'image';
  const isVideo = item.mediaKind === 'video';
  const isAudio = item.mediaKind === 'audio';

  const previewSrc = item.thumbnailUrl || item.fileUrl;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-panel border border-border-subtle bg-surface text-left transition-all duration-[var(--motion-fast)] hover:border-border hover:shadow-sm">
      {/* 媒体缩略图区域：独立 button 触发预览，避免外层 article 滥用 role=button 导致嵌套交互竞争 */}
      <button
        type="button"
        onClick={() => onPreview(item)}
        aria-label={`预览 ${item.originalName || item.id}`}
        className="relative aspect-[4/3] w-full overflow-hidden border-b border-border-subtle bg-surface-sunken flex items-center justify-center cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {isMissing ? (
          <div className="flex flex-col items-center gap-1.5 p-3 text-center text-warning-fg">
            <AlertTriangle className="h-6 w-6 stroke-[1.5]" />
            <span className="text-[11px] font-medium">源文件缺失</span>
          </div>
        ) : isQuarantined ? (
          <div className="flex flex-col items-center gap-1.5 p-3 text-center text-danger-fg">
            <AlertTriangle className="h-6 w-6 stroke-[1.5]" />
            <span className="text-[11px] font-medium">文件已隔离</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-1.5 p-3 text-center text-muted">
            <AlertTriangle className="h-6 w-6 stroke-[1.5]" />
            <span className="text-[11px]">缩略图加载失败</span>
          </div>
        ) : isImage ? (
          <img
            src={previewSrc}
            alt={item.originalName || '媒体图片'}
            loading="lazy"
            onError={() => setLoadError(true)}
            className="h-full w-full object-contain transition-transform duration-[var(--motion-fast)] group-hover:scale-[1.02]"
          />
        ) : isVideo ? (
          item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt={item.originalName || '视频封面'}
              loading="lazy"
              onError={() => setLoadError(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-muted">
              <FileVideo className="h-8 w-8" />
              <span className="text-[11px]">视频产物</span>
            </div>
          )
        ) : isAudio ? (
          <div className="flex flex-col items-center gap-1.5 text-muted">
            <FileAudio className="h-8 w-8" />
            <span className="text-[11px]">音频素材</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-muted">
            <FileText className="h-8 w-8" />
            <span className="text-[11px]">文件产物</span>
          </div>
        )}

        {/* 状态徽标 */}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {isMissing ? (
            <Badge variant="warning" className="px-1.5 py-0.5 text-[10px] font-semibold">
              缺失
            </Badge>
          ) : isQuarantined ? (
            <Badge variant="error" className="px-1.5 py-0.5 text-[10px] font-semibold">
              隔离
            </Badge>
          ) : (
            <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur-xs">
              {item.mediaKind.toUpperCase()}
            </span>
          )}
        </div>

        {/* 引用计数徽标 */}
        {item.referenceSummary.totalCount > 0 && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur-xs">
            <Layers className="h-3 w-3" />
            <span>{item.referenceSummary.totalCount} 引用</span>
          </div>
        )}
      </button>

      {/* 卡片下半部：名称、来源应用与元数据 */}
      <div className="flex flex-1 flex-col justify-between p-3.5 space-y-3">
        <div className="space-y-1 min-w-0">
          <button
            type="button"
            onClick={() => onPreview(item)}
            className="truncate text-sm font-semibold text-ink group-hover:text-accent hover:underline text-left cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent block w-full"
            title={item.originalName || `素材 ${item.id}`}
          >
            {item.originalName || `素材 ${item.id.slice(0, 8)}`}
          </button>
          <div className="flex items-center justify-between text-xs text-muted">
            <a
              href={item.appHref}
              className="inline-flex items-center gap-1 font-medium hover:text-ink hover:underline focus-visible:outline focus-visible:outline-accent"
              title={`前往 ${item.appName}`}
            >
              <span>{item.appName}</span>
              <ExternalLink className="h-2.5 w-2.5 opacity-60" />
            </a>
            <span>{formatByteSize(item.byteSize)}</span>
          </div>
        </div>

        {/* 尺寸 / 格式 / 时间 */}
        <div className="flex items-center justify-between text-[11px] text-muted border-t border-border-subtle/60 pt-2">
          <span>
            {item.width && item.height
              ? `${item.width} × ${item.height}`
              : item.contentType || '文件'}
          </span>
          <span>{formatDateTime(item.createdAt).split(' ')[0]}</span>
        </div>

        {/* 快捷操作区：非 ready (missing/quarantined) 严格禁用 */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-subtle/40">
          <AdoptIntoProject source={{ kind: 'artifact', id: item.id }} disabled={isUnusable} />

          {onChooseArtifact && (
            <button
              type="button"
              disabled={isUnusable}
              onClick={() => onChooseArtifact(item)}
              className="shrink-0 rounded-control border border-border-subtle bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-subtle disabled:opacity-50 disabled:pointer-events-none"
            >
              选用
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
