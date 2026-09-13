'use client';

import { ImagePlus } from 'lucide-react';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
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
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="mt-1">媒体库</CardTitle>
            <CardDescription>保存生成结果与参考素材，随时预览和复用。</CardDescription>
          </div>
          <span className="text-sm text-fg-subtle">{total} 个作品</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !artifacts.length ? (
          <div className="flex justify-center py-10 text-sm text-muted">正在读取媒体库…</div>
        ) : artifacts.length ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{artifacts.map((artifact) => <GalleryCard key={artifact.id} artifact={artifact} onPin={onPin} onDelete={onDelete} />)}</div>
            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button size="sm" variant="outline" loading={isLoadingMore} onClick={onLoadMore}>
                  加载更多（已显示 {artifacts.length} / {total}）
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState className="min-h-[140px] py-4" icon={ImagePlus} title="媒体库还是空的" description="生成一张图片，或在图生图模式上传参考素材。" />
        )}
      </CardContent>
    </Card>
  );
}
