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
      {isLoading && !artifacts.length ? (
        <div className="flex justify-center py-10 text-xs text-muted">正在读取媒体库…</div>
      ) : artifacts.length ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">
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
          <EmptyState
            className="min-h-64 shadow-none"
            icon={ImagePlus}
            title="媒体库还是空的"
            description="在左侧描述画面并生成，完成的图片与视频会保存在这里。也可以切换到图生图上传参考素材。"
          />
      )}
    </div>
  );
}
