'use client';
import {useActivity} from '../queries';
import {ActivityStudioWorkspace} from '../components/activity-studio-workspace';
import {PublicationWorkspace} from './publication-workspace';
import {Button} from '@/app/components/ui/button';
export function ActivityWorkspaceRouter({activityId}:{activityId:string}) {
  const query=useActivity(activityId);
  if(query.isPending) return <div className="p-6" role="status">正在载入作品…</div>;
  if(!query.data) return <div className="space-y-3 p-6"><p role="alert">无法读取作品：{query.error?.message ?? '作品不存在'}</p><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>重新加载作品</Button></div>;
  if(query.data?.activity.type==='publication') return <PublicationWorkspace activityId={activityId}/>;
  return <ActivityStudioWorkspace activityId={activityId}/>;
}
