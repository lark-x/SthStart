import { readFile, stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { Value } from '@sinclair/typebox/value';
import { PublicationDocumentSchema, type HarnessPageQuery, type PublicationDocument, type PublicationPatchRequest } from '@sthstart/contracts';
import { PublicationStore, contentFingerprint, fingerprint, publicationError, shotFingerprint, utteranceFingerprint } from './store.js';
import { PublicationWorker } from './worker.js';
import { imagePlan, compilePublicationImagePrompt } from './images.js';
import { listActivityImageWorkflowOptions } from '../activities/image-render-common.js';
import { listPresets } from '../generation/configuration-store.js';
import { checkVideoDependencies } from './runtime-preflight.js';

type Row = Record<string, any>;
// rowid is a creation-order cursor: newly created records cannot shift the next page.
function page<T>(rows: Row[], query: HarnessPageQuery, map: (row: Row) => T) {
  const limit = query.limit ?? 20, selected = rows.slice(0, limit);
  return { items: selected.map(map), nextCursor: rows.length > limit ? Number(selected.at(-1)!.cursor) : null };
}
const boundary = (q: HarnessPageQuery) => q.cursor ?? Number.MAX_SAFE_INTEGER;

export class PublicationHarness {
  constructor(readonly store: PublicationStore, readonly worker: PublicationWorker) {}
  owned(projectId: string, activityId: string) {
    const draft = this.store.requireDraft(activityId);
    if (draft.document.source.storyProjectId !== projectId) throw publicationError('publication_artifact_forbidden', '作品不属于此项目。', 403);
    return draft;
  }
  publications(projectId: string, q: HarnessPageQuery & { query?: string }) {
    const rows = this.store.db.connection.prepare(`SELECT rowid AS cursor,* FROM publication_drafts WHERE project_id=? AND rowid<?
      AND instr(lower(json_extract(document_json,'$.title')),lower(?))>0 ORDER BY rowid DESC LIMIT ?`).all(projectId,boundary(q),q.query??'',(q.limit??20)+1);
    return page(rows,q,r=>{
      const draft=this.store.requireDraft(String(r.activity_id));
      const latest=this.store.db.connection.prepare('SELECT id,status FROM publication_runs WHERE activity_id=? ORDER BY rowid DESC LIMIT 1').get(draft.activityId);
      return { activityId:draft.activityId,title:draft.document.title,draftVersion:draft.draftVersion,updatedAt:draft.updatedAt,
        latestRun:latest?{id:String(latest.id),status:String(latest.status)}:null,
        nextAction:latest&&['running','queued','unknown','interrupted'].includes(String(latest.status))?'inspect_run':draft.document.shots.length<6?'prepare_plan':'preview_approval' };
    });
  }
  runs(activityId:string,q:HarnessPageQuery&{status?:string}) {
    this.store.requireDraft(activityId);
    const rows=this.store.db.connection.prepare(`SELECT rowid AS cursor,* FROM publication_runs WHERE activity_id=? AND rowid<? AND (?='' OR status=?) ORDER BY rowid DESC LIMIT ?`).all(activityId,boundary(q),q.status??'',q.status??'',(q.limit??20)+1);
    return page(rows,q,r=>({id:String(r.id),approvalId:String(r.approval_id),status:String(r.status),imagesUsed:Number(r.images_used),speechCharactersUsed:Number(r.speech_used),createdAt:String(r.created_at),updatedAt:String(r.updated_at)}));
  }
  task(activityId:string,id:string) {
    const task=this.store.task(id);this.store.run(activityId,task.runId);return task;
  }
  images(activityId:string,shotId:string,q:HarnessPageQuery) {
    const doc=this.store.requireDraft(activityId).document,shot=doc.shots.find(s=>s.id===shotId);
    if(!shot)throw publicationError('publication_shot_missing','镜头不存在。',404);
    const candidates=this.store.db.connection.prepare(`SELECT a.rowid AS cursor,a.id,max(t.rowid) AS newest,t.id AS task_id,t.input_json,t.call_id,t.created_at
      FROM publication_tasks t JOIN publication_runs r ON r.id=t.run_id JOIN json_each(t.output_json) j JOIN artifacts a ON a.id=j.value
      WHERE r.activity_id=? AND t.kind='image' AND t.target_id=? AND a.rowid<? GROUP BY a.id ORDER BY a.rowid DESC LIMIT ?`).all(activityId,shotId,boundary(q),(q.limit??20)+1);
    return page(candidates,q,r=>({artifactId:String(r.id),taskId:String(r.task_id),shotId,current:shot.selectedImage?.artifactId===r.id,available:this.available(activityId,String(r.id)),
      staleSource:JSON.parse(String(r.input_json)).sourceFingerprint!==shotFingerprint(doc,shotId),callId:r.call_id?String(r.call_id):null,createdAt:String(r.created_at)}));
  }
  audio(activityId:string,utteranceId:string,q:HarnessPageQuery) {
    const history=this.store.audioHistory(activityId,utteranceId).items;
    const rows=this.store.db.connection.prepare(`SELECT rowid AS cursor,id FROM artifacts WHERE rowid<? AND id IN (
      SELECT j.value FROM publication_tasks t JOIN publication_runs r ON r.id=t.run_id JOIN json_each(t.output_json) j WHERE r.activity_id=? AND t.kind='speech' AND t.target_id=?
      UNION SELECT artifact_id FROM artifact_references WHERE app_id='activities' AND ref_type='publication_upload' AND ref_id=?) ORDER BY rowid DESC LIMIT ?`).all(boundary(q),activityId,utteranceId,`publication:${activityId}:${utteranceId}`,(q.limit??20)+1);
    return page(rows,q,r=>history.find(h=>h.artifactId===r.id)!);
  }
  available(activityId:string,id:string) { try{this.artifact(activityId,id);return true;}catch{return false;} }
  artifact(activityId:string,id:string) {
    this.store.canSelect(activityId,id);
    const row=this.store.db.connection.prepare('SELECT media_type FROM artifacts WHERE id=?').get(id);
    const kind=row?.media_type;
    if(!['image','audio','video','binary'].includes(String(kind)))throw publicationError('publication_artifact_missing','产物不存在。',404);
    return this.store.artifact(id,kind==='binary'?'file':kind as 'image'|'audio'|'video');
  }
  media(activityId:string,q:HarnessPageQuery) {
    this.store.requireDraft(activityId);
    const prefix=`publication:${activityId}:`;
    const rows=this.store.db.connection.prepare(`SELECT a.rowid AS cursor,a.* FROM artifacts a WHERE a.rowid<? AND EXISTS(
      SELECT 1 FROM artifact_references r WHERE r.artifact_id=a.id AND r.app_id='activities'
      AND r.ref_type IN ('publication_history','publication_upload','publication_draft','publication_revision')
      AND (r.ref_id=? OR substr(r.ref_id,1,length(?))=?)) ORDER BY a.rowid DESC LIMIT ?`).all(boundary(q),`publication:${activityId}`,prefix,prefix,(q.limit??20)+1);
    return page(rows,q,r=>({artifactId:String(r.id),kind:String(r.media_type),durationMs:r.duration_ms==null?null:Number(r.duration_ms),available:this.available(activityId,String(r.id))}));
  }
  async readArtifact(activityId:string,id:string,mode='metadata') {
    const row=this.artifact(activityId,id),size=(await stat(row.path)).size;
    const result:{artifactId:string;kind:string;sizeBytes:number;durationMs:number|null;width:number|null;height:number|null;workspacePath:string;preview?:{type:'image'|'audio';mimeType:string;data:string;transformed:boolean};previewUnavailable?:string}={
      artifactId:id,kind:String(row.media_type),sizeBytes:size,durationMs:row.duration_ms==null?null:Number(row.duration_ms),width:row.width==null?null:Number(row.width),height:row.height==null?null:Number(row.height),workspacePath:`/apps/activities/${activityId}` };
    if(mode!=='preview')return result;
    if(size>16*1024*1024){result.previewUnavailable='文件超过16MiB，请在作品页查看。';return result;}
    if(row.media_type==='image') {
      if(Number(row.width)*Number(row.height)>40_000_000){result.previewUnavailable='原图像素过多，请在作品页查看。';return result;}
      const {createCanvas,loadImage}=await import('@napi-rs/canvas');
      const img=await loadImage(await readFile(row.path));
      if(img.width*img.height>40_000_000)throw publicationError('publication_preview_too_large','图片像素超过预览上限。',413);
      const scale=Math.min(1,1024/Math.max(img.width,img.height)),canvas=createCanvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale)));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const bytes=canvas.toBuffer('image/jpeg',80);
      if(bytes.length>2*1024*1024)throw publicationError('publication_preview_too_large','预览超过2MiB。',413);
      result.preview={type:'image',mimeType:'image/jpeg',data:Buffer.from(bytes).toString('base64'),transformed:true};
    }else if(row.media_type==='audio'&&size<=2*1024*1024&&Number(row.duration_ms)>0&&Number(row.duration_ms)<=30_000) {
      result.preview={type:'audio',mimeType:String(row.content_type??'audio/mpeg'),data:Buffer.from(await readFile(row.path)).toString('base64'),transformed:false};
    }else result.previewUnavailable='音频预览最多30秒/2MiB；视频和发布包请在作品页查看。';
    return result;
  }
  options(activityId:string,category='all',q:HarnessPageQuery={}) {
    const doc=this.store.requireDraft(activityId).document;
    const result:Record<string,unknown>={};
    if(category==='all'||category==='images') {
      result.workflows=listActivityImageWorkflowOptions(this.store.db);
      result.presets=listPresets(this.store.db,{appId:'activities'}).filter(p=>p.enabled&&p.purpose.startsWith('activity_')).map(p=>({id:p.id,name:p.name,revision:p.revision,workflowId:p.workflowId,workflowVersion:p.workflowVersion}));
    }
    if(category==='all'||category==='speech')result.speechProfiles=this.store.speechProfiles().map(p=>({id:p.id,revision:p.revision,name:p.name,model:p.model,voices:p.voices,defaultVoice:p.defaultVoice,speed:p.speed,providerVerified:false}));
    if(category==='all'||category==='assets'){const assets=this.media(activityId,q);result.referenceAssets=assets.items.filter(a=>a.kind==='image');result.referenceAssetsNextCursor=assets.nextCursor;}
    if(category==='all'||category==='loras')result.loras=[...doc.actors.flatMap(a=>a.loras),...doc.shots.flatMap(s=>s.renderSettings.loraOverrides??[])].filter(l=>!/[\\/]|^[A-Za-z]:/.test(l.model)).map(l=>({...l,availability:'requires_preflight'}));
    return result;
  }
  validate(activityId:string,doc:PublicationDocument) {
    const current=this.store.requireDraft(activityId),issues:Array<{code:string;message:string;path:string;targetId?:string}>=[];
    if(!Value.Check(PublicationDocumentSchema,doc))return {valid:false,executable:false,issues:[...Value.Errors(PublicationDocumentSchema,doc)].slice(0,40).map(e=>({code:'publication_document_invalid',message:e.message,path:e.path}))};
    try{this.store.validate(doc,current.document.source.storyProjectId);if(fingerprint(doc.source)!==fingerprint(current.document.source))throw publicationError('publication_source_changed','制作来源已冻结。',409);
      const references:Array<[string,'image'|'audio']>=[...doc.actors.flatMap(a=>a.referenceArtifactId?[[a.referenceArtifactId,'image'] as [string,'image']]:[]),...doc.shots.flatMap(s=>[
        ...(s.selectedImage?[[s.selectedImage.artifactId,'image'] as [string,'image']]:[]),
        ...s.utterances.flatMap(u=>u.selectedAudioArtifactId?[[u.selectedAudioArtifactId,'audio'] as [string,'audio']]:[]),
        ...(s.renderSettings.referenceAssetKey?[[s.renderSettings.referenceAssetKey,'image'] as [string,'image']]:[]),
      ])];
      for(const [id,kind] of references){this.store.canSelect(activityId,id);this.store.artifact(id,kind);}
    }catch(e){const error=e as Error&{code?:string};issues.push({code:error.code??'publication_document_invalid',message:error.message,path:'/document'});}
    const valid=issues.length===0;
    if(doc.shots.length<6||doc.shots.length>12)issues.push({code:'publication_shot_count',message:'可执行方案需要6–12镜头；草稿允许未完成。',path:'/shots'});
    doc.shots.forEach((s,i)=>{try{compilePublicationImagePrompt(doc,s);imagePlan(this.store.db,doc,s);}catch(e){const error=e as Error&{code?:string};issues.push({code:error.code??'publication_configuration_invalid',message:error.message,path:`/shots/${i}`,targetId:s.id});}});
    return {valid,executable:valid&&issues.length===0,issues};
  }
  async preview(activityId:string,input:{expectedDraftVersion:number;speechProfileId:string|null;makeVideo:boolean;checkUpstream?:boolean}) {
    const draft=this.store.assertVersion(activityId,input.expectedDraftVersion),validation=this.validate(activityId,draft.document),approval=this.store.latestApproval(activityId);
    const dependencies=await checkVideoDependencies();
    let configHash:string|null=null,shots:unknown[]=[],configurationIssue:string|null=null;
    try {
      const prepared=await this.worker.configuration(draft.document,input,input.checkUpstream??false);
      configHash=fingerprint(prepared);shots=prepared.images.map(p=>({shotId:p.shotId,workflowId:p.workflowId,workflowVersion:p.workflowVersion,presetId:p.presetId,models:p.models,positivePrompt:p.positivePrompt,negativePrompt:p.negativePrompt,parameters:p.inputs,loras:p.loras,referenceArtifactIds:p.inputArtifacts.map(a=>a.artifactId)}));
    }catch(e){configurationIssue=(e as Error).message;}
    const approvalValid=Boolean(approval&&validation.executable&&configHash===approval.configHash&&contentFingerprint(draft.document)===contentFingerprint(this.store.revisionDocument(activityId,approval.revisionId)));
    return {draftVersion:draft.draftVersion,validation,configHash,shots,dependencies,configurationIssue,providerVerified:false,imagesVerified:Boolean(input.checkUpstream&&configHash),
      imageCount:draft.document.shots.filter(s=>!s.selectedImage).length,speechCharacters:input.makeVideo?draft.document.shots.flatMap(s=>s.utterances).filter(u=>!u.selectedAudioArtifactId).reduce((n,u)=>n+u.text.length,0):0,
      approvalId:approval?.id??null,approvalValid,approvalReason:approvalValid?'current':!approval?'missing':configHash!==approval.configHash?'configuration_changed':'content_changed',
      executable:validation.executable&&!configurationIssue&&(!input.makeVideo||dependencies.ok)};
  }
  patch(activityId:string,input:PublicationPatchRequest) {
    const before=this.store.assertVersion(activityId,input.expectedDraftVersion),doc=structuredClone(before.document);
    for(const op of input.operations) {
      if(Object.keys(op.changes).length===0)throw publicationError('publication_patch_empty','每项修改至少提供一个字段。');
      const target=op.kind==='publication'?doc:op.kind==='actor'?doc.actors.find(a=>a.id===op.id):op.kind==='shot'?doc.shots.find(s=>s.id===op.id):doc.shots.flatMap(s=>s.utterances).find(u=>u.id===op.id);
      if(!target)throw publicationError('publication_patch_target_missing','修改目标不存在，整批未保存。',404);
      Object.assign(target,op.changes);
    }
    const draft=this.store.save(activityId,input.expectedDraftVersion,doc);
    return {draft,changedTargets:input.operations.map(o=>o.kind==='publication'?'publication':o.id),
      invalidatedImages:before.document.shots.filter(s=>s.selectedImage&&!draft.document.shots.find(n=>n.id===s.id)?.selectedImage).map(s=>s.id),
      invalidatedAudio:before.document.shots.flatMap(s=>s.utterances).filter(u=>u.selectedAudioArtifactId&&!draft.document.shots.flatMap(s=>s.utterances).find(n=>n.id===u.id)?.selectedAudioArtifactId).map(u=>u.id),
      approvalRequiresReview:contentFingerprint(before.document)!==contentFingerprint(draft.document)};
  }
  selectAudio(activityId:string,utteranceId:string,input:{expectedDraftVersion:number;artifactId:string;allowStaleSource:boolean}) {
    this.store.assertVersion(activityId,input.expectedDraftVersion);
    const candidate=this.store.audioHistory(activityId,utteranceId).items.find(a=>a.artifactId===input.artifactId);
    if(!candidate)throw publicationError('publication_artifact_forbidden','音频不属于此句历史。',403);
    if(candidate.staleSource&&!input.allowStaleSource)throw publicationError('publication_source_changed','请确认使用旧对白或声音的音频。',409);
    return this.store.selectAudio(activityId,input.expectedDraftVersion,utteranceId,input.artifactId);
  }
}
