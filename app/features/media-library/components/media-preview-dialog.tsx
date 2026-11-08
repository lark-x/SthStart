'use client';

import React, { useRef } from 'react';
import { X, ExternalLink, Download, AlertTriangle, HardDrive, CheckCircle2 } from 'lucide-react';
import type { MediaLibraryItem } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { useOverlayAccessibility } from '@/app/components/ui/overlay';
import { formatByteSize, formatDateTime } from '../types';
import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';

export interface MediaPreviewDialogProps {
  item: MediaLibraryItem | null;
  isOpen: boolean;
  onClose: () => void;
  onChooseArtifact?: (item: MediaLibraryItem) => void;
}

export function MediaPreviewDialog({
  item,
  isOpen,
  onClose,
  onChooseArtifact,
}: MediaPreviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useOverlayAccessibility({
    open: isOpen,
    onRequestClose: onClose,
    containerRef: dialogRef,
  });

  if (!isOpen || !item) return null;

  const isMissing = item.fileStatus === 'missing';
  const isQuarantined = item.fileStatus === 'quarantined';
  const isUnusable = isMissing || isQuarantined;
  const isImage = item.mediaKind === 'image';
  const isVideo = item.mediaKind === 'video';
  const isAudio = item.mediaKind === 'audio';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-panel border border-border-subtle bg-surface shadow-2xl focus:outline-none"
        tabIndex={-1}
      >
        {/* 顶部标题与关闭 */}
        <header className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3 bg-surface-subtle">
          <div className="flex items-center gap-2 min-w-0">
            <h2 id="media-preview-title" className="truncate text-base font-semibold text-ink">
              {item.originalName || `媒体素材 ${item.id.slice(0, 8)}`}
            </h2>
            {isMissing ? (
              <Badge variant="warning" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> 磁盘文件缺失
              </Badge>
            ) : isQuarantined ? (
              <Badge variant="error" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> 已隔离
              </Badge>
            ) : (
              <Badge variant="online" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> 可用
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭预览"
            className="rounded-control p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-accent cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* 主体：左侧预览原图/音视频，右侧详细元数据与操作 */}
        <div className="flex flex-1 flex-col md:flex-row min-h-0 overflow-y-auto">
          {/* 媒体展示区：非 ready (missing/quarantined) 严格禁止发起实体预览请求 */}
          <div className="flex flex-1 items-center justify-center border-b md:border-b-0 md:border-r border-border-subtle bg-surface-sunken p-4 min-h-[260px] md:min-h-[400px]">
            {isMissing ? (
              <div className="flex flex-col items-center gap-3 text-center text-muted p-6">
                <AlertTriangle className="h-10 w-10 text-warning-fg" />
                <p className="text-sm font-medium text-ink">源文件缺失或不可访问</p>
                <p className="text-xs max-w-xs text-muted">
                  该产物元数据已登记，但在磁盘存储根目录未检测到对应实体文件。禁止打开或下载。
                </p>
              </div>
            ) : isQuarantined ? (
              <div className="flex flex-col items-center gap-3 text-center text-muted p-6">
                <AlertTriangle className="h-10 w-10 text-danger-fg" />
                <p className="text-sm font-medium text-ink">产物已被安全隔离</p>
                <p className="text-xs max-w-xs text-muted">
                  该文件已被标记为隔离状态，实体内容已封禁，禁止媒体预览、下载或跨项目采用。
                </p>
              </div>
            ) : isImage ? (
              <img
                src={item.fileUrl}
                alt={item.originalName || '完整原图预览'}
                className="max-h-[60vh] max-w-full rounded object-contain"
              />
            ) : isVideo ? (
              <video
                controls
                src={item.fileUrl}
                className="max-h-[60vh] max-w-full rounded bg-black"
              >
                您的浏览器不支持视频播放。
              </video>
            ) : isAudio ? (
              <div className="w-full max-w-md p-6 flex flex-col items-center gap-4">
                <audio controls src={item.fileUrl} className="w-full" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted">
                <HardDrive className="h-12 w-12" />
                <p className="text-sm">二进制文件产物</p>
              </div>
            )}
          </div>

          {/* 右侧信息侧栏 */}
          <div className="w-full md:w-80 shrink-0 p-5 space-y-5 bg-surface text-xs text-ink">
            {/* 来源信息 */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted uppercase tracking-wider">来源业务</span>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-ink">{item.appName}</span>
                <a
                  href={item.appHref}
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline focus-visible:outline focus-visible:outline-accent"
                >
                  前往应用 <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            {/* 文件属性 */}
            <div className="space-y-2 border-t border-border-subtle pt-4">
              <span className="text-[11px] font-medium text-muted uppercase tracking-wider">技术元数据</span>
              <div className="grid grid-cols-2 gap-2 text-muted">
                <div>
                  <span className="block text-[10px]">媒体类型</span>
                  <span className="text-ink font-medium">{item.mediaType || item.contentType || '未知'}</span>
                </div>
                <div>
                  <span className="block text-[10px]">大小</span>
                  <span className="text-ink font-medium">{formatByteSize(item.byteSize)}</span>
                </div>
                {item.width && item.height ? (
                  <div>
                    <span className="block text-[10px]">分辨率</span>
                    <span className="text-ink font-medium">{item.width} × {item.height}</span>
                  </div>
                ) : null}
                {item.durationMs ? (
                  <div>
                    <span className="block text-[10px]">时长</span>
                    <span className="text-ink font-medium">{(item.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                ) : null}
                <div>
                  <span className="block text-[10px]">创建时间</span>
                  <span className="text-ink font-medium">{formatDateTime(item.createdAt)}</span>
                </div>
                <div>
                  <span className="block text-[10px]">SHA-256</span>
                  <span className="text-ink font-mono text-[10px] truncate block" title={item.sha256 || ''}>
                    {item.sha256 ? item.sha256.slice(0, 10) + '…' : '无'}
                  </span>
                </div>
              </div>
            </div>

            {/* 引用摘要 */}
            <div className="space-y-2 border-t border-border-subtle pt-4">
              <span className="text-[11px] font-medium text-muted uppercase tracking-wider flex items-center justify-between">
                <span>引用摘要</span>
                <span className="rounded bg-surface-sunken px-1.5 py-0.2 text-[10px] text-muted">
                  共 {item.referenceSummary.totalCount} 处引用
                </span>
              </span>
              {item.references.length > 0 ? (
                <ul className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {item.references.map((ref, idx) => (
                    <li
                      key={ref.id || idx}
                      className="rounded bg-surface-subtle p-1.5 text-[11px] text-muted border border-border-subtle/50"
                    >
                      <div className="font-medium text-ink">{ref.appName || ref.appId}</div>
                      <div className="truncate text-[10px] text-muted">
                        {ref.refType} · {ref.refId}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted">暂无跨应用登记引用</p>
              )}
            </div>

            {/* 操作区：非 ready (missing/quarantined) 严格禁用 */}
            <div className="space-y-2.5 border-t border-border-subtle pt-4">
              {onChooseArtifact && (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={isUnusable}
                  onClick={() => onChooseArtifact(item)}
                >
                  选择该素材
                </Button>
              )}

              <AdoptIntoProject source={{ kind: 'artifact', id: item.id }} disabled={isUnusable} />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={isUnusable}
                  onClick={() => {
                    if (isUnusable) return;
                    window.open(item.fileUrl, '_blank');
                  }}
                  title={isUnusable ? '文件不可用或已隔离，无法打开' : '在新标签页中打开原图/源文件'}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>打开原文件</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={isUnusable}
                  onClick={() => {
                    if (isUnusable) return;
                    const a = document.createElement('a');
                    a.href = item.fileUrl;
                    a.download = item.originalName || `artifact-${item.id}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }}
                  title={isUnusable ? '文件不可用或已隔离，无法下载' : '下载源文件'}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>下载</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
