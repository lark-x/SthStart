import * as c from '@sthstart/contracts';
import type { Static } from '@sinclair/typebox';
import { getJson,postJson,putJson,deleteJson,validateResponse,ApiClientError } from '@/app/lib/api-client';
import {adminFetch} from '@/app/lib/admin-fetch';
const root=(id:string)=>`activities/${encodeURIComponent(id)}/publication`;
export const publicationFile=(id:string)=>`/api/admin/artifacts/${encodeURIComponent(id)}/file`;
export const publicationApi={
  create:(projectId:string,entryRevisionIds:string[])=>postJson<c.PublicationDraft>(`story/projects/${encodeURIComponent(projectId)}/publications`,{entryRevisionIds},undefined,c.PublicationDraftSchema),
  draft:(id:string)=>getJson<c.PublicationDraft>(root(id),undefined,c.PublicationDraftSchema),
  state:(id:string)=>getJson<Static<typeof c.PublicationWorkspaceStateSchema>>(`${root(id)}/state`,undefined,c.PublicationWorkspaceStateSchema),
  save:(id:string,expectedDraftVersion:number,document:c.PublicationDocument)=>putJson<c.PublicationDraft>(root(id),{expectedDraftVersion,document},undefined,c.PublicationDraftSchema),
  preview:(id:string,expectedDraftVersion:number,speechProfileId:string|null,makeVideo:boolean)=>postJson<c.PublicationPreview>(`${root(id)}/preview`,{expectedDraftVersion,speechProfileId,makeVideo},undefined,c.PublicationPreviewSchema),
  approve:(id:string,input:c.PublicationApprovalRequest)=>postJson<c.PublicationApproval>(`${root(id)}/approvals`,input,undefined,c.PublicationApprovalSchema),
  start:(id:string,approvalId:string,idempotencyKey:string)=>postJson<c.PublicationRun>(`${root(id)}/runs`,{approvalId,idempotencyKey},undefined,c.PublicationRunSchema),
  runs:(id:string)=>getJson<{items:c.PublicationRun[]}>(`${root(id)}/runs`,undefined,c.PublicationRunListSchema),
  stop:(id:string,runId:string)=>postJson<c.PublicationRun>(`${root(id)}/runs/${encodeURIComponent(runId)}/stop`,{},undefined,c.PublicationRunSchema),
  history:(id:string,shotId:string)=>getJson<c.PublicationHistory>(`${root(id)}/shots/${encodeURIComponent(shotId)}/history`,undefined,c.PublicationHistorySchema),
  select:(id:string,shotId:string,expectedDraftVersion:number,artifactId:string,allowStaleSource=false)=>postJson<c.PublicationDraft>(`${root(id)}/shots/${encodeURIComponent(shotId)}/select-image`,{expectedDraftVersion,artifactId,allowStaleSource},undefined,c.PublicationDraftSchema),
  retry:(id:string,shotId:string,runId:string,idempotencyKey:string)=>postJson<c.PublicationTask>(`${root(id)}/shots/${encodeURIComponent(shotId)}/retries`,{runId,idempotencyKey},undefined,c.PublicationTaskSchema),
  audio:(id:string,utteranceId:string,expectedDraftVersion:number,artifactId:string,allowStaleSource=false)=>postJson<c.PublicationDraft>(`${root(id)}/utterances/${encodeURIComponent(utteranceId)}/audio`,{expectedDraftVersion,artifactId,allowStaleSource},undefined,c.PublicationDraftSchema),
  audioHistory:(id:string,utteranceId:string)=>getJson<c.PublicationAudioHistory>(`${root(id)}/utterances/${encodeURIComponent(utteranceId)}/history`,undefined,c.PublicationAudioHistorySchema),
  media:(id:string)=>getJson<c.PublicationMedia>(`${root(id)}/media`,undefined,c.PublicationMediaSchema),
  options:(id:string)=>getJson<Static<typeof c.PublicationImageOptionsSchema>>(`${root(id)}/image-options`,undefined,c.PublicationImageOptionsSchema),
  exports:(id:string,expectedDraftVersion:number,makeVideo:boolean,idempotencyKey:string)=>postJson<c.PublicationTask>(`${root(id)}/exports`,{expectedDraftVersion,makeVideo,idempotencyKey},undefined,c.PublicationTaskSchema),
  profiles:()=>getJson<{items:c.SpeechProfile[]}>('publication/speech-profiles',undefined,c.SpeechProfileListSchema),
  speechModels:()=>getJson<c.PublicationSpeechModels>('publication/speech-models',undefined,c.PublicationSpeechModelsSchema),
  saveProfile:(expectedRevision:number,profile:c.SpeechProfile)=>putJson<c.SpeechProfile>('publication/speech-profiles',{expectedRevision,profile},undefined,c.SpeechProfileSchema),
  grantStatus:(projectId:string)=>getJson<Static<typeof c.PublicationGrantStatusSchema>>(`story/projects/${encodeURIComponent(projectId)}/publication-grant`,undefined,c.PublicationGrantStatusSchema),
  grant:(projectId:string)=>postJson<Static<typeof c.PublicationGrantSchema>>(`story/projects/${encodeURIComponent(projectId)}/publication-grant`,{},undefined,c.PublicationGrantSchema),
  revoke:(projectId:string)=>deleteJson(`story/projects/${encodeURIComponent(projectId)}/publication-grant`),
  uploadAudio:async(id:string,utteranceId:string,file:File)=>{
    const ext=file.name.split('.').pop()?.toLowerCase();
    const types:Record<string,string>={wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4'};
    if(!ext||!types[ext]) throw new Error('请选择 WAV、MP3 或 M4A 文件。');
    const response=await adminFetch(`${root(id)}/utterances/${encodeURIComponent(utteranceId)}/upload`,{method:'POST',headers:{'content-type':types[ext]},body:file});
    const body:unknown=await response.json();if(!response.ok){const error=body as {message?:string;error?:string};throw new ApiClientError(error.message??'音频上传失败。',{status:response.status,code:error.error});}
    return validateResponse<Static<typeof c.PublicationAudioUploadResponseSchema>>(body,c.PublicationAudioUploadResponseSchema,response.url);
  },
};
