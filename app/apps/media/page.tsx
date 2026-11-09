import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { MediaLibraryView } from '@/app/features/media-library';

export const metadata: Metadata = {
  title: '全局媒体库 — SthStart',
  description: '汇集各业务产物、显示真实可用状态与来源引用，支持项目采用与原图预览。',
};

export default function MediaLibraryPage() {
  return (
    <PageContainer width="wide" className="space-y-4">
      <PageHeader compact
        title="全局媒体库"
      />
      <Suspense fallback={<div className="py-12 text-center text-sm text-muted">正在加载全局媒体素材…</div>}>
        <MediaLibraryView />
      </Suspense>
    </PageContainer>
  );
}
