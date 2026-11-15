import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WorldAuthoringPage } from '@/app/features/story-worlds/authoring/world-authoring-page';

export const metadata: Metadata = {
  title: '编辑世界 — SthStart',
  description: '调整世界设定与分支方向；有活动运行的分支只保存世界字段。',
};

export default async function EditStoryWorldPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  return (
    <Suspense fallback={<div className="px-4 py-12 text-center text-sm text-muted">正在加载世界配置…</div>}>
      <WorldAuthoringPage worldId={decodeURIComponent(worldId)} />
    </Suspense>
  );
}
