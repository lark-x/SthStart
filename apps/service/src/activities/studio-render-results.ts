import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { getGenerationTask } from '../generation/task-store.js';
import { createArtifactReference,resolveArtifactStoragePath } from '../artifacts.js';
import { syncBeatRenderCandidateFromTask } from '../ai-call-trace.js';
import { ComicStore } from './comic-store.js';
import { syncComicRenderJob } from './comic-renders.js';
import { syncAttemptOutputs } from './image-attempts.js';

/** Reconcile one durable association only. Never calls a model, submits a graph or selects a picture.
 * Native history sync owns its transaction, so it must run before the item transaction. */
export function collectStudioRenderResult(database:ServiceDatabase,config:ServiceConfig,activityId:string,jobId:string,itemId:string){
  const row=database.connection.prepare('SELECT * FROM activity_studio_job_items WHERE job_id=? AND id=?').get(jobId,itemId);
  if(!row?.generation_task_id)return null;
  const task=getGenerationTask(database,String(row.generation_task_id),'activities');
  let state=String(row.state),errorCode:string|null=null,errorMessage:string|null=null;
  let artifactIds:string[]=[],unavailableArtifactIds:string[]=[],readableIds:string[]=[];
  if(!task){state='unknown';errorCode='studio_generation_task_missing';errorMessage='关联生成任务不存在；没有重新提交，请查看原日志。';}
  else if(['succeeded','completed'].includes(task.status)){
    artifactIds=task.artifacts.filter(image=>image.mediaKind==='image').map(image=>image.artifactId);
    readableIds=artifactIds.filter(id=>resolveArtifactStoragePath(database,id,config.artifactDirectory));
    unavailableArtifactIds=artifactIds.filter(id=>!readableIds.includes(id));
    // Repair native histories before exposing the images to existing selection endpoints.
    if(row.candidate_id)syncBeatRenderCandidateFromTask(database,task.id,'succeeded');
    else if(row.native_job_id){
      const target=JSON.parse(String(row.target_json));
      if(target.kind==='comic_panel'){
        const store=new ComicStore(database),native=store.getComicJob(activityId,String(row.native_job_id));
        if(native)syncComicRenderJob(database,config,store,native);
      }else if(target.kind==='media_slot')syncAttemptOutputs(database,activityId,String(row.native_job_id));
    }
    state=readableIds.length?'succeeded':'failed';
    if(!readableIds.length){errorCode='studio_artifact_unavailable';errorMessage='任务已结束，但没有可读取的图片。历史引用保留，未写入画面。';}
  }else if(task.upstreamMayContinue){state='unknown';errorCode='studio_upstream_unknown';errorMessage='上游仍可能执行；先核对原任务，不会自动重投。';}
  else if(['failed','abandoned','cancelled'].includes(task.status)){
    state='failed';errorCode=task.errorCode??'studio_render_failed';errorMessage=task.errorMessage??'绘制失败。';
  }else state='submitted';
  const result=artifactIds.length?JSON.stringify({artifactIds,unavailableArtifactIds}):row.result_json;
  // Avoid a revision/trace storm during polling. Native history repair is independently idempotent.
  if(row.state!==state||row.error_code!==errorCode||row.error_message!==errorMessage||(row.result_json??null)!==(result??null))database.transaction(()=>{
    for(const artifactId of artifactIds)createArtifactReference(database,{artifactId,appId:'activities',refType:'activity_studio_render',refId:`studio-render:${jobId}`});
    database.connection.prepare('UPDATE activity_studio_job_items SET state=?,result_json=?,error_code=?,error_message=?,updated_at=? WHERE job_id=? AND id=? AND generation_task_id=?')
      .run(state,result??null,errorCode,errorMessage,nowIso(),jobId,itemId,String(row.generation_task_id));
    database.connection.prepare('UPDATE activity_studio_jobs SET revision=revision+1,updated_at=? WHERE id=? AND activity_id=?').run(nowIso(),jobId,activityId);
  });
  return {state,artifactIds,readableIds,unavailableArtifactIds,task};
}
