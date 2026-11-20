import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CollectionLayout } from '@/app/components/shared/page-archetypes';
import { MediaWorkspace } from '@/app/workspaces/media/media-workspace';

export const metadata: Metadata = {
  title: '媒体库 — SthStart',
  description: '汇集各业务产物、显示真实可用状态与来源引用，支持作品收录与原图预览。',
};

export default function MediaLibraryPage() {
  return (
    <CollectionLayout title="媒体库">
      <Suspense fallback={<div className="py-12 text-center text-sm text-muted">正在加载全局媒体素材…</div>}>
        <MediaWorkspace />
      </Suspense>
    </CollectionLayout>
  );
}
