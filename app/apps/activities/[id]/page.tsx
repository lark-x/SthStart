import type { Metadata } from 'next';
import { ActivityStudioWorkspace } from '@/app/features/activities/components/activity-studio-workspace';

export const metadata: Metadata = {
  title: '活动工作室 — SthStart',
  description: '独立活动创作平台，编排多阶段情节与拟真设备回放。',
};

export default async function ActivityWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ActivityStudioWorkspace key={id} activityId={id} />;
}
