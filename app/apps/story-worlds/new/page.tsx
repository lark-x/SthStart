import { Suspense } from 'react';
import type { Metadata } from 'next';
import { NewWorldPage } from '@/app/features/story-worlds/authoring/new-world-page';

export const metadata: Metadata = {
  title: '新建世界 — SthStart',
  description: '填写名称即可创建故事世界。',
};

export default function NewStoryWorldPage() {
  return (
    <Suspense fallback={<div className="px-4 py-12 text-center text-sm text-muted">正在加载世界配置…</div>}>
      <NewWorldPage />
    </Suspense>
  );
}
