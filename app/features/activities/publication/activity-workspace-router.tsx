'use client';
import {useActivity} from '../queries';
import {ActivityStudioWorkspace} from '../components/activity-studio-workspace';
import {PublicationWorkspace} from './publication-workspace';
export function ActivityWorkspaceRouter({activityId}:{activityId:string}) {
  const query=useActivity(activityId);
  if(query.isPending) return <div className="p-6" role="status">正在载入作品…</div>;
  if(query.data?.activity.type==='publication') return <PublicationWorkspace activityId={activityId}/>;
  return <ActivityStudioWorkspace activityId={activityId}/>;
}
