import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import * as c from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { PublicationStore, publicationError } from './store.js';
import {fingerprint} from './store.js';
import {utteranceFingerprint} from './store.js';
import { PublicationWorker } from './worker.js';
import { PublicationHarness } from './harness.js';
import { registerPublicationHarnessRoutes } from './harness-routes.js';
import { streamUploadArtifact } from '../artifacts.js';
import { Readable } from 'node:stream';
import {Buffer} from 'node:buffer';
import {listActivityImageWorkflowOptions} from '../activities/image-render-common.js';
import {listPresets} from '../generation/configuration-store.js';

const Params=Type.Object({activityId:Type.String(),shotId:Type.Optional(Type.String()),utteranceId:Type.Optional(Type.String()),runId:Type.Optional(Type.String())});
const ProjectParams=Type.Object({projectId:Type.String()});
const nothing=Type.Object({}, {additionalProperties:false});
export function registerPublicationRoutes(app:FastifyInstance,config:ServiceConfig,database:ServiceDatabase,secrets:SecretStore,fetcher:typeof fetch=fetch) {
  const store=new PublicationStore(database,config.artifactDirectory), worker=new PublicationWorker(store,config,secrets,fetcher);
  type Req=FastifyRequest<{Params:{activityId:string;shotId?:string;utteranceId?:string;runId?:string;projectId:string};Body:unknown;Querystring:Record<string,string>}>;
  const root='/api/v1/admin/activities/:activityId/publication';
  const add=(method:'GET'|'POST'|'PUT'|'DELETE',url:string,body:TSchema|undefined,response:TSchema|undefined,handler:(request:Req)=>unknown|Promise<unknown>,isProject=false,status=200)=>{
    app.route({method,url,schema:{...(isProject?{params:ProjectParams}:url.includes(':activityId')?{params:Params}:{}),...(body?{body}:{}),...(response?{response:{[status]:response}}:{})},
      preHandler:async(request,reply)=>{if(config.adminToken&&!authenticateAdmin(config.adminToken,request)) return reply.code(401).send({error:'unauthorized',message:'需要管理员权限。'});},
      handler:async(request,reply)=>{try{const result=await handler(request as Req);return reply.code(status).header('cache-control','no-store').send(result);}catch(error){const e=error as Error&{code?:string;statusCode?:number};return reply.code(e.statusCode??400).send({error:e.code??'publication_error',message:e.message});}}});
  };
  add('POST','/api/v1/admin/story/projects/:projectId/publications',c.CreatePublicationSchema,c.PublicationDraftSchema,r=>store.create(r.params.projectId,(r.body as Static<typeof c.CreatePublicationSchema>).entryRevisionIds),true,201);
  add('GET',root,undefined,c.PublicationDraftSchema,r=>store.requireDraft(r.params.activityId));
  add('GET',`${root}/image-options`,undefined,c.PublicationImageOptionsSchema,r=>{
    store.requireDraft(r.params.activityId);
    return {items:listActivityImageWorkflowOptions(database),presets:listPresets(database,{appId:'activities'}).filter(p=>p.enabled&&p.purpose.startsWith('activity_')).map(p=>({id:p.id,name:p.name,revision:p.revision,workflowId:p.workflowId,workflowVersion:p.workflowVersion,isDefault:p.isDefault}))};
  });
  add('GET',`${root}/state`,undefined,c.PublicationWorkspaceStateSchema,r=>({draft:store.requireDraft(r.params.activityId),approval:store.latestApproval(r.params.activityId)}));
  add('POST',`${root}/preview`,c.PublicationPreviewRequestSchema,c.PublicationPreviewSchema,async r=>{
    const b=r.body as Static<typeof c.PublicationPreviewRequestSchema>,draft=store.assertVersion(r.params.activityId,b.expectedDraftVersion),prepared=await worker.configuration(draft.document,b,false);
    return {configHash:fingerprint(prepared),speech:prepared.speech,shots:prepared.images.map(p=>({shotId:p.shotId,workflowId:p.workflowId,workflowVersion:p.workflowVersion,presetId:p.presetId,models:p.models,positivePrompt:p.positivePrompt,negativePrompt:p.negativePrompt,parameters:p.inputs,loras:p.loras,referenceArtifactIds:p.inputArtifacts.map(i=>i.artifactId)}))};
  });
  add('PUT',root,c.SavePublicationSchema,c.PublicationDraftSchema,r=>{const b=r.body as Static<typeof c.SavePublicationSchema>;return store.save(r.params.activityId,b.expectedDraftVersion,b.document);});
  add('POST',`${root}/approvals`,c.PublicationApprovalRequestSchema,c.PublicationApprovalSchema,r=>worker.approve(r.params.activityId,r.body as c.PublicationApprovalRequest),false,201);
  add('POST',`${root}/runs`,c.PublicationRunRequestSchema,c.PublicationRunSchema,r=>{const b=r.body as Static<typeof c.PublicationRunRequestSchema>;return worker.start(r.params.activityId,b.approvalId,b.idempotencyKey);},false,202);
  add('GET',`${root}/runs`,undefined,c.PublicationRunListSchema,r=>({items:store.listRuns(r.params.activityId)}));
  add('GET',`${root}/runs/:runId`,undefined,c.PublicationRunSchema,r=>store.run(r.params.activityId,r.params.runId!));
  add('POST',`${root}/runs/:runId/stop`,nothing,c.PublicationRunSchema,r=>worker.stop(r.params.activityId,r.params.runId!));
  add('GET',`${root}/shots/:shotId/history`,undefined,c.PublicationHistorySchema,r=>store.history(r.params.activityId,r.params.shotId!));
  add('POST',`${root}/shots/:shotId/select-image`,c.PublicationSelectImageSchema,c.PublicationDraftSchema,r=>{const b=r.body as Static<typeof c.PublicationSelectImageSchema>;return store.selectImage(r.params.activityId,b.expectedDraftVersion,r.params.shotId!,b.artifactId,b.allowStaleSource);});
  add('POST',`${root}/shots/:shotId/retries`,c.PublicationRetrySchema,c.PublicationTaskSchema,r=>{const b=r.body as Static<typeof c.PublicationRetrySchema>;return worker.retryShot(r.params.activityId,r.params.shotId!,b.runId,b.idempotencyKey);},false,202);
  add('GET',`${root}/utterances/:utteranceId/history`,undefined,c.PublicationAudioHistorySchema,r=>store.audioHistory(r.params.activityId,r.params.utteranceId!));
  add('POST',`${root}/utterances/:utteranceId/audio`,c.PublicationAudioRequestSchema,c.PublicationDraftSchema,r=>{const b=r.body as Static<typeof c.PublicationAudioRequestSchema>;
    const item=store.audioHistory(r.params.activityId,r.params.utteranceId!).items.find(i=>i.artifactId===b.artifactId);
    if(!item)throw publicationError('publication_artifact_forbidden','音频不属于此句的历史。',403);
    if(item.staleSource&&!b.allowStaleSource)throw publicationError('publication_source_changed','对白或声音已变化，请确认仍使用此旧音频。',409);
    return store.selectAudio(r.params.activityId,b.expectedDraftVersion,r.params.utteranceId!,b.artifactId);});
  add('GET',`${root}/media`,undefined,c.PublicationMediaSchema,r=>{
    const doc=store.requireDraft(r.params.activityId).document, ids=[...new Set(doc.shots.flatMap(s=>[...(s.selectedImage?[s.selectedImage.artifactId]:[]),...s.utterances.flatMap(u=>u.selectedAudioArtifactId?[u.selectedAudioArtifactId]:[])]))];
    return {items:ids.map(id=>{const row=database.connection.prepare('SELECT media_type,duration_ms FROM artifacts WHERE id=?').get(id);let available=false;try{store.artifact(id,row?.media_type==='image'?'image':'audio');available=true;}catch{}return {artifactId:id,kind:String(row?.media_type??'file'),durationMs:row?.duration_ms==null?null:Number(row.duration_ms),available};})};
  });
  add('POST',`${root}/exports`,c.PublicationExportRequestSchema,c.PublicationTaskSchema,r=>{const b=r.body as Static<typeof c.PublicationExportRequestSchema>;return worker.export(r.params.activityId,b.expectedDraftVersion,b.makeVideo,b.idempotencyKey);},false,202);
  const speechRoot='/api/v1/admin/publication/speech-profiles';
  add('GET',speechRoot,undefined,c.SpeechProfileListSchema,()=>({items:store.speechProfiles()}));
  add('GET','/api/v1/admin/publication/speech-models',undefined,c.PublicationSpeechModelsSchema,async()=>{
    const rows=database.connection.prepare(`SELECT m.id,m.name,m.model_id,c.id AS connection_id,c.base_url,c.credential_account
      FROM model_profiles m JOIN service_connections c ON c.id=m.connection_id
      WHERE m.enabled=1 AND c.enabled=1 AND c.kind='openai-compatible-text' AND lower(m.model_id) LIKE '%tts%' ORDER BY m.name`).all();
    return {items:await Promise.all(rows.map(async row=>({modelProfileId:String(row.id),connectionId:String(row.connection_id),name:String(row.name),
      model:String(row.model_id),baseUrl:String(row.base_url),hasCredential:row.credential_account?Boolean((await secrets.get(String(row.credential_account),`STHSTART_SECRET_${String(row.connection_id).toUpperCase().replace(/[^A-Z0-9]/g,'_')}`)).value):false})))};
  });
  add('PUT',speechRoot,c.SaveSpeechProfileSchema,c.SpeechProfileSchema,r=>{const b=r.body as Static<typeof c.SaveSpeechProfileSchema>;return store.saveSpeechProfile(b.expectedRevision,b.profile);});
  const grantRoot='/api/v1/admin/story/projects/:projectId/publication-grant';
  add('GET',grantRoot,undefined,c.PublicationGrantStatusSchema,r=>store.grantStatus(r.params.projectId),true);
  add('POST',grantRoot,nothing,c.PublicationGrantSchema,r=>store.grant(r.params.projectId),true,201);
  add('DELETE',grantRoot,undefined,undefined,r=>{store.revoke(r.params.projectId);return {ok:true};},true);

  // Binary upload is encapsulated in a plugin so its parser cannot alter unrelated routes.
  app.register(async scope=>{
    const audioTypes=['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a'];
    // The full Service already has streaming parsers. Override only in this encapsulated scope.
    for(const type of audioTypes) if(scope.hasContentTypeParser(type)) scope.removeContentTypeParser(type);
    scope.addContentTypeParser(audioTypes,{parseAs:'buffer',bodyLimit:config.artifactAudioMaxBytes},(_request,body,done)=>done(null,body));
    scope.post<{Params:{activityId:string;utteranceId:string}}> (`${root}/utterances/:utteranceId/upload`,{bodyLimit:config.artifactAudioMaxBytes,schema:{response:{201:c.PublicationAudioUploadResponseSchema}}},async(request,reply)=>{
      if(config.adminToken&&!authenticateAdmin(config.adminToken,request)) return reply.code(401).send({error:'unauthorized'});
      try{
        const draft=store.requireDraft(request.params.activityId);
        if(!draft.document.shots.some(s=>s.utterances.some(u=>u.id===request.params.utteranceId))) throw publicationError('publication_utterance_missing','对白不存在。',404);
        const type=String(request.headers['content-type']).split(';')[0],extension=type.includes('wav')?'wav':type.includes('mp4')||type.includes('m4a')?'m4a':'mp3';
        if(!Buffer.isBuffer(request.body)) throw publicationError('publication_audio_invalid','仅接受 WAV、MP3、M4A 音频文件。');
        const artifact=await streamUploadArtifact(config,database,{appId:'activities',stream:Readable.from([request.body as Uint8Array]),contentType:type,originalName:`recording.${extension}`,
          refType:'publication_upload',refId:`publication:${request.params.activityId}:${request.params.utteranceId}`,metadata:{publicationActivityId:request.params.activityId,sourceFingerprint:utteranceFingerprint(draft.document,request.params.utteranceId)}});
        const stored=store.artifact(artifact.id,'audio');
        if(!stored.has_audio||!Number(stored.duration_ms)||Number(stored.duration_ms)>300000){
          database.connection.prepare("UPDATE artifacts SET file_status='quarantined' WHERE id=?").run(artifact.id);
          database.connection.prepare('DELETE FROM artifact_references WHERE artifact_id=? AND ref_type=? AND ref_id=?').run(artifact.id,'publication_upload',`publication:${request.params.activityId}:${request.params.utteranceId}`);
          throw publicationError('publication_audio_invalid','文件没有可解码音轨、无有效时长或超过5分钟。');
        }
        return reply.code(201).send({artifactId:artifact.id,durationMs:Number(stored.duration_ms)});
      }catch(error){const e=error as Error&{code?:string;statusCode?:number};return reply.code(e.statusCode??400).send({error:e.code??'publication_audio_failed',message:e.message});}
    });
  });

  const bridge='/api/v1/publication-bridge/projects/:projectId';
  app.register(async scope=>{
    scope.addHook('onRequest',async(request,reply)=>{
      if(request.headers.origin) return reply.code(403).send({error:'publication_bridge_browser_forbidden',message:'制作桥接只接受本机 MCP 客户端，不接受跨源浏览器调用。'});
    });
    scope.addHook('preHandler',async(request,reply)=>{
      const projectId=(request.params as {projectId:string}).projectId,token=/^Bearer (.+)$/.exec(request.headers.authorization??'')?.[1]??'';
      reply.header('cache-control','no-store');
      if(!store.authorize(projectId,token)) return reply.code(401).send({error:'publication_bridge_unauthorized',message:'制作项目凭据无效、已撤销或不属于此项目。'});
    });
    scope.setErrorHandler((error, _request, reply)=>{const e=error as Error&{statusCode?:number;code?:string;currentVersion?:number};reply.code(e.statusCode??400).send({error:e.code??'publication_bridge_error',message:e.message,retryable:false,...(e.currentVersion?{currentVersion:e.currentVersion}:{})});});
    registerPublicationHarnessRoutes(scope,new PublicationHarness(store,worker));
    const owned=(projectId:string,activityId:string)=>{const draft=store.requireDraft(activityId);if(draft.document.source.storyProjectId!==projectId) throw publicationError('publication_bridge_unauthorized','不能访问其他项目制作资料。',401);return draft;};
    scope.get<{Params:{projectId:string};Querystring:Static<typeof c.PublicationSourceQuerySchema>}>(`${bridge}/sources`,{schema:{params:ProjectParams,querystring:c.PublicationSourceQuerySchema,response:{200:c.PublicationSourceTextSchema}}},async r=>{
      const draft=owned(r.params.projectId,r.query.activityId),source=store.sourceBundle(r.params.projectId,draft.document.source.entryRevisionIds);
      const selected=source.revisions.find(v=>v.id===(r.query.entryRevisionId??source.revisions[0].id));if(!selected) throw publicationError('publication_source_invalid','章节版本不在制作来源中。');
      const body='body' in selected.snapshot?selected.snapshot.body:'',offset=r.query.offset??0,limit=r.query.limit??20000,end=Math.min(offset+limit,body.length);
      return {sourceHash:source.sourceHash,entryRevisionIds:draft.document.source.entryRevisionIds,entryRevisionId:selected.id,title:'title' in selected.snapshot?selected.snapshot.title:'',body:body.slice(offset,end),totalLength:body.length,offset,nextOffset:end<body.length?end:null};
    });
    scope.get<{Params:{projectId:string;activityId:string}}>(`${bridge}/publications/:activityId`,{schema:{response:{200:c.PublicationWorkspaceStateSchema}}},async r=>({draft:owned(r.params.projectId,r.params.activityId),approval:store.latestApproval(r.params.activityId)}));
    scope.post<{Params:{projectId:string};Body:Static<typeof c.PublicationPlanRequestSchema>}>(`${bridge}/plans`,{bodyLimit:512000,schema:{body:c.PublicationPlanRequestSchema,response:{200:c.PublicationDraftSchema}}},async r=>{owned(r.params.projectId,r.body.activityId);return store.save(r.body.activityId,r.body.expectedDraftVersion,r.body.document);});
    scope.post<{Params:{projectId:string;activityId:string};Body:Static<typeof c.PublicationRunRequestSchema>}>(`${bridge}/publications/:activityId/runs`,{schema:{body:c.PublicationRunRequestSchema,response:{202:c.PublicationRunSchema}}},async(r,reply)=>{owned(r.params.projectId,r.params.activityId);return reply.code(202).send(await worker.start(r.params.activityId,r.body.approvalId,r.body.idempotencyKey));});
    scope.get<{Params:{projectId:string;activityId:string;runId:string}}>(`${bridge}/publications/:activityId/runs/:runId`,{schema:{response:{200:c.PublicationRunSchema}}},async r=>{owned(r.params.projectId,r.params.activityId);return store.run(r.params.activityId,r.params.runId);});
    scope.post<{Params:{projectId:string;activityId:string;runId:string}}>(`${bridge}/publications/:activityId/runs/:runId/stop`,{schema:{body:nothing,response:{200:c.PublicationRunSchema}}},async r=>{owned(r.params.projectId,r.params.activityId);return worker.stop(r.params.activityId,r.params.runId);});
    scope.post<{Params:{projectId:string;activityId:string;shotId:string};Body:Static<typeof c.PublicationRetrySchema>}>(`${bridge}/publications/:activityId/shots/:shotId/retries`,{schema:{body:c.PublicationRetrySchema,response:{202:c.PublicationTaskSchema}}},async(r,reply)=>{owned(r.params.projectId,r.params.activityId);return reply.code(202).send(worker.retryShot(r.params.activityId,r.params.shotId,r.body.runId,r.body.idempotencyKey));});
    scope.post<{Params:{projectId:string;activityId:string;shotId:string};Body:Static<typeof c.PublicationSelectImageSchema>}>(`${bridge}/publications/:activityId/shots/:shotId/select-image`,{schema:{body:c.PublicationSelectImageSchema,response:{200:c.PublicationDraftSchema}}},async r=>{owned(r.params.projectId,r.params.activityId);return store.selectImage(r.params.activityId,r.body.expectedDraftVersion,r.params.shotId,r.body.artifactId,r.body.allowStaleSource);});
  });
  app.addHook('onReady',async()=>worker.startScheduler());
  app.addHook('onClose',async()=>worker.close());
  return {store,worker};
}
