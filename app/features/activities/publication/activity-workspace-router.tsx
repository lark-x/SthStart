'use client';
import {useActivity} from '../queries';
import {ActivityStudioWorkspace} from '../components/activity-studio-workspace';
import {PublicationWorkspace} from './publication-workspace';
import {Button} from '@/app/components/ui/button';
import {WorkspaceHeader} from '@/app/components/shared/workspace-header';
export function ActivityWorkspaceRouter({activityId}:{activityId:string}) {
  const query=useActivity(activityId);
  if(query.isPending) return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
    <WorkspaceHeader title="活动工作室" backHref="/apps/activities" backLabel="制作项目" />
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted" role="status">正在载入作品…</div>
  </div>;
  if(!query.data) return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper text-ink">
    <WorkspaceHeader title="活动工作室" backHref="/apps/activities" backLabel="制作项目" actions={<Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>重新加载作品</Button>} />
    <div className="flex flex-1 items-center justify-center p-6"><p role="alert" className="text-sm text-danger-fg">无法读取作品：{query.error?.message ?? '作品不存在'}</p></div>
  </div>;
  if(query.data?.activity.type==='publication') return <PublicationWorkspace activityId={activityId}/>;
  return <ActivityStudioWorkspace activityId={activityId}/>;
}
