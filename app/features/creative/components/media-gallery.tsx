'use client';

import { ImagePlus } from 'lucide-react';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { EmptyState } from '@/app/components/ui/empty-state';
import { GalleryCard } from './gallery-card';

export function MediaGallery({
  artifacts,
  total,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onPin,
  onDelete,
}: {
  artifacts: ArtifactDescriptor[];
  total: number;
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onPin: (artifact: ArtifactDescriptor) => Promise<void>;
  onDelete: (artifact: ArtifactDescriptor) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border-subtle pb-3">
        <div>
          <h3 className="text-base font-semibold text-ink">媒体库</h3>
          <p className="text-xs text-muted">保存生成结果与参考素材，随时预览和复用。</p>
        </div>
        <span className="text-xs text-fg-subtle">{total} 个作品</span>
      </div>

      {isLoading && !artifacts.length ? (
        <div className="flex justify-center py-10 text-xs text-muted">正在读取媒体库…</div>
      ) : artifacts.length ? (
        <>
          <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
            {artifacts.map((artifact) => (
              <GalleryCard key={artifact.id} artifact={artifact} onPin={onPin} onDelete={onDelete} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button size="sm" variant="outline" loading={isLoadingMore} onClick={onLoadMore}>
                加载更多（已显示 {artifacts.length} / {total}）
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-8">
          <EmptyState
            className="min-h-[140px] py-4"
            icon={ImagePlus}
            title="媒体库还是空的"
            description="生成一张图片，或在图生图模式上传参考素材。"
          />
        </div>
      )}
    </div>
  );
}
