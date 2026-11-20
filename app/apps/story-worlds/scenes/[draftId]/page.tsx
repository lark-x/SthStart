import { SceneDraftWorkspace } from '@/app/features/story-scene-drafts/workspace';

export const metadata = { title: '一幕故事 — SthStart' };

export default async function Page({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <SceneDraftWorkspace key={draftId} draftId={draftId} />;
}
