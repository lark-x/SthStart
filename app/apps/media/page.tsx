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
    <PageContainer width="wide" className="py-6 space-y-6">
      <PageHeader
        title="全局媒体库"
        description="汇集各创作业务生成的图像、视频、音频与素材产物，显示真实存储状态与多方引用，支持原图预览与采用至项目。"
      />
      <Suspense fallback={<div className="py-12 text-center text-sm text-muted">正在加载全局媒体素材…</div>}>
        <MediaLibraryView />
      </Suspense>
    </PageContainer>
  );
}
