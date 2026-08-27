'use client';

import { ImagePlus } from 'lucide-react';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
import { EmptyState } from '@/app/components/ui/empty-state';
import { ExternalLink } from 'lucide-react';
import { GalleryCard } from './gallery-card';

export function MediaGallery({
  artifacts,
  total,
  isLoading,
  onPin,
  onDelete,
}: {
  artifacts: ArtifactDescriptor[];
  total: number;
  isLoading: boolean;
  onPin: (artifact: ArtifactDescriptor) => Promise<void>;
  onDelete: (artifact: ArtifactDescriptor) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">CENTRAL ARTIFACT LIBRARY</span>
            <CardTitle className="mt-1">媒体库</CardTitle>
            <CardDescription>生成结果与参考素材统一存储在 Artifact 2.0 中，可以固定、预览或删除。</CardDescription>
          </div>
          <span className="text-xs text-[#89908a]">{total} 个作品</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !artifacts.length ? (
          <div className="flex justify-center py-10 text-sm text-[#68716d]">正在读取媒体库…</div>
        ) : artifacts.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{artifacts.map((artifact) => <GalleryCard key={artifact.id} artifact={artifact} onPin={onPin} onDelete={onDelete} />)}</div>
        ) : (
          <EmptyState className="min-h-[220px]" icon={ImagePlus} title="媒体库还是空的" description="生成一张图片，或在图生图模式上传参考素材。" />
        )}
      </CardContent>
      <CardFooter><span className="text-[11px] text-[#89908a]">媒体文件不会复制到邻舍数据库。</span><a href="/settings/generation" className="inline-flex items-center gap-1 text-xs font-semibold text-[#b83b1b] hover:underline">管理生成工作流<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a></CardFooter>
    </Card>
  );
}
