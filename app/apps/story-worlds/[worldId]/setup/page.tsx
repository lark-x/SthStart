import { Suspense } from 'react';
import { WorldAuthoringPage } from '@/app/features/story-worlds/authoring/world-authoring-page';

export const metadata = { title: '补全设定 — SthStart' };

export default async function WorldSetupPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await params;
  return (
    <Suspense fallback={<p className="p-4 text-muted">正在加载世界设定…</p>}>
      <WorldAuthoringPage worldId={worldId} pending />
    </Suspense>
  );
}
