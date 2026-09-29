import type { Metadata } from 'next';
import { StoryWorkspace } from '@/app/features/story/story-workspace';

export const metadata: Metadata = { title: '剧情工作室 — SthStart' };
export default async function StoryProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StoryWorkspace key={id} projectId={id} />;
}
