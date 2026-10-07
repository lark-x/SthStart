import { Type } from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StudioStoryboardRequestSchema, StudioJobSchema, StudioJobPageSchema, StudioJobListQuerySchema,
  StudioStoryboardApplySchema, StudioRefineRequestSchema, StudioRefineApplySchema, StudioJobControlSchema, type StudioStoryboardRequest, type StudioJobListQuery,
  type StudioStoryboardApply, type StudioRefineRequest, type StudioRefineApply, type StudioJobControl,
  StudioBatchRequestSchema,StudioBatchStartSchema,StudioItemPageSchema,StudioItemListQuerySchema,
  StudioBatchRetrySchema,StudioPrepareContextSchema,StudioVersionContextSchema,StudioJobResumeSchema,
  StudioHealthRequestSchema,StudioHealthResultSchema,type StudioHealthRequest,
  type StudioBatchRequest,type StudioBatchStart,type StudioItemListQuery,type StudioBatchRetry,type StudioPrepareContext,type StudioJobResume } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import type { ServiceConfig } from '../config.js';
import { StudioStore } from './studio-store.js';
import { freezeStudioStoryboard, processStudioStoryboard } from './studio-storyboard.js';
import { applyStudioStoryboard } from './studio-apply.js';
import { freezeStudioRefine,processStudioRefine,applyStudioRefine } from './studio-refine.js';
import { createStudioRefineRender,processStudioSingleRender } from './studio-single-render.js';
import { createStudioBatch,prepareStudioBatch,processStudioBatch,startStudioBatch,listStudioItems,retryStudioBatch } from './studio-batches.js';
import {prepareStudioContext} from './studio-context.js';
import { ActivityStore } from './store.js';
import { ComicStore } from './comic-store.js';
import { getImageConfigDraft } from './image-configs.js';
import {recoverStudioJobs,resumeStudioJob,reconcileStudioJob} from './studio-recovery.js';
import {inspectStudioHealth} from './studio-health.js';
import {StudioTextFallbackSelectionSchema,StudioTextFallbackRequestSchema,StudioTextFallbackOptionsSchema,StudioTextFallbackPreviewSchema,
  type StudioTextFallbackSelection,type StudioTextFallbackRequest} from '@sthstart/contracts';
import {listStudioTextFallbackOptions,previewStudioTextFallback,createStudioTextFallback} from './studio-text-fallback.js';
import {listStudioImageFallbackOptions,previewStudioImageFallback,createStudioImageFallback} from './studio-image-fallback.js';
import {StudioImageFallbackOptionsSchema,StudioImageFallbackPreviewSchema,StudioImageFallbackSelectionSchema,StudioImageFallbackRequestSchema,
  type StudioImageFallbackOptions,type StudioImageFallbackPreview,type StudioImageFallbackRequest,type StudioImageFallbackSelection} from '@sthstart/contracts';
import {HiresPreviewRequestSchema,HiresSubmitRequestSchema,HiresPreviewResponseSchema,
  type HiresPreviewRequest,type HiresSubmitRequest} from '@sthstart/contracts';
import {createStudioHires,previewStudioHires} from './studio-hires.js';
import {assertStudioVersions} from './studio-storyboard.js';
import {processStudioHires} from './studio-hires-runner.js';

export function registerStudioRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore,
  checkAdmin: (request: FastifyRequest,reply: FastifyReply) => boolean, fetcher: typeof fetch = fetch) {
  const store = new StudioStore(database), running = new Map<string,{ controller: AbortController; promise: Promise<void> }>();
  let closing = false;
  const authorized = (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminToken) { reply.code(503).send({ error: 'admin_not_configured',message: '请先配置管理员访问凭据。' }); return false; }
    return checkAdmin(request,reply);
  };
  const base = '/api/v1/admin/activities/:id/studio-jobs';
  const hiresBase = '/api/v1/admin/activities/:id/studio/hires';
  const params = Type.Object({ id: Type.String({ minLength: 1 }),jobId: Type.String({ minLength: 1 }) });
  const failure = (reply: FastifyReply,error: unknown) => {
    const value = error as { code?: string; statusCode?: number; message?: string };
    return reply.code(value.statusCode ?? 500).send({ error: value.code ?? 'studio_operation_failed',
      message: value.code ? value.message : '智能制作操作失败，输入和已保存任务仍保留。' });
  };
  const schedule = (activityId: string, jobId: string) => {
    if (closing || running.has(jobId)) return;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => {
      if (closing) return;
      const options = { database,config,secrets,activityId,jobId,fetcher,signal:controller.signal };
      const job=store.get(activityId,jobId);
      if(job?.readOnly)return;
      // 细化必须在原有 batch/single 分支之前判断，否则新任务会误走 processStudioSingleRender。
      if(job?.input.operation==='hires')return processStudioHires(options);
      if(job?.kind==='render_batch')return job.input.batch===true ? (job.input.started===true?processStudioBatch(options):prepareStudioBatch(options)) : processStudioSingleRender(options);
      return job?.kind==='refine' ? processStudioRefine(options) : processStudioStoryboard(options);
    })
      .catch(error => app.log.error({ err: error,jobId },'Studio storyboard processing failed'))
      .finally(() => { running.delete(jobId);
        const current=store.get(activityId,jobId);
        if(!closing&&!current?.readOnly&&current?.status==='queued'&&current.kind==='render_batch'&&current.input.batch===true&&current.input.started===true)schedule(activityId,jobId);
      });
    running.set(jobId,{ controller,promise });
  };
  app.post<{Params:{id:string};Body:StudioHealthRequest}>(`${base}/health`,{schema:{body:StudioHealthRequestSchema,response:{200:StudioHealthResultSchema}},preValidation:async(request,reply)=>{
    if(!authorized(request,reply))return;
    if(!Value.Check(StudioHealthRequestSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'健康检查只接受活动内的目标标识，不接受路径、地址或工作流图。'});
  }},async(request,reply)=>{
    if(!authorized(request,reply))return;
    reply.header('cache-control','no-store');
    try{return await inspectStudioHealth({database,config,secrets,activityId:request.params.id,request:request.body,fetcher});}catch(error){return failure(reply,error);}
  });
  app.post<{ Params: { id: string }; Body: StudioStoryboardRequest | StudioRefineRequest | StudioBatchRequest }>(base,{ schema: { body: Type.Union([StudioStoryboardRequestSchema,StudioRefineRequestSchema,StudioBatchRequestSchema]),response: { 202: StudioJobSchema } },
    preValidation: async (request,reply) => {
      if (!authorized(request,reply)) return;
      const body = request.body as StudioStoryboardRequest | undefined;
      if (body?.input?.source?.kind === 'text' && typeof body.input.source.text === 'string' && body.input.source.text.length > 12000)
        return reply.code(400).send({ error: 'studio_input_too_large',message: '正文超过 12,000 字符，请自行划分片段；系统不会截断正文。' });
    } },async (request,reply) => {
    if (!authorized(request,reply)) return;
    try {
      const body=request.body;
      const created = body.kind==='render_batch' ? {job:createStudioBatch(database,config,request.params.id,body)} : store.create({ activityId: request.params.id,kind:body.kind,idempotencyKey:body.idempotencyKey,request:body,
        freeze: () => ({ ...(body.kind==='refine' ? freezeStudioRefine(database,request.params.id,body) : freezeStudioStoryboard(database,request.params.id,body)) }) });
      if (created.job.status === 'queued') schedule(request.params.id,created.job.id);
      return reply.code(202).send(created.job);
    } catch (error) { return failure(reply,error); }
  });
  app.get<{ Params: { id: string }; Querystring: StudioJobListQuery }>(base,{ schema: { querystring: StudioJobListQuerySchema,response: { 200: StudioJobPageSchema } } },async (request,reply) => {
    if (!authorized(request,reply)) return;
    if (!database.connection.prepare('SELECT 1 FROM activities WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'activity_not_found',message: '活动不存在。' });
    try { return store.list(request.params.id,request.query); } catch (error) { return failure(reply,error); }
  });
  app.post<{Params:{id:string};Body:StudioPrepareContext}>(`${base}/prepare-context`,{schema:{body:StudioPrepareContextSchema,response:{200:StudioVersionContextSchema}}},async(request,reply)=>{
    if(!authorized(request,reply))return;
    try{return prepareStudioContext(database,request.params.id,request.body.expected);}catch(error){return failure(reply,error);}
  });
  app.post<{Params:{id:string};Body:HiresPreviewRequest}>(`${hiresBase}/preview`,
    {schema:{body:HiresPreviewRequestSchema,response:{200:HiresPreviewResponseSchema}},preValidation:async(request,reply)=>{
      if(!authorized(request,reply))return;
      // 未知字段、服务器路径、任意 URL、输入文件名或配置快照一律拒绝。
      if(!Value.Check(HiresPreviewRequestSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'细化预览只接受活动内的目标标识、来源图片标识、尺寸、重绘幅度与种子。'});
    }},async(request,reply)=>{
      if(!authorized(request,reply))return;reply.header('cache-control','no-store');
      try{
        // 计划 §6.2：预览也验证请求版本。校验放在**请求边界**（这里）而不是 `previewStudioHires()`：
        // 规划函数必须保持可返回「来源描述已变化」这类警告，而硬拒绝版本会把它挡掉。
        assertStudioVersions(database,request.params.id,request.body.versions);
        return previewStudioHires({database,config,activityId:request.params.id,request:request.body}).preview;
      }
      catch(error){return failure(reply,error);}
    });
  app.post<{Params:{id:string};Body:HiresSubmitRequest}>(hiresBase,
    {schema:{body:HiresSubmitRequestSchema,response:{202:StudioJobSchema}},preValidation:async(request,reply)=>{
      if(!authorized(request,reply))return;
      if(!Value.Check(HiresSubmitRequestSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'细化提交必须回传预览种子与已审阅计划标识，不接受路径、地址或工作流参数。'});
    }},async(request,reply)=>{
      if(!authorized(request,reply))return;reply.header('cache-control','no-store');
      try{const job=createStudioHires(database,config,request.params.id,request.body);
        if(job.status==='queued')schedule(request.params.id,job.id);
        return reply.code(202).send(job);
      }catch(error){return failure(reply,error);}
    });
  app.get<{ Params: { id: string; jobId: string } }>(`${base}/:jobId`,{ schema: { params,response: { 200: StudioJobSchema } } },async (request,reply) => {
    if (!authorized(request,reply)) return;
    const job = store.get(request.params.id,request.params.jobId);
    return job ?? reply.code(404).send({ error: 'studio_job_not_found',message: '任务不属于此活动。' });
  });
  app.get<{Params:{id:string;jobId:string};Querystring:StudioItemListQuery}>(`${base}/:jobId/items`,
    {schema:{params,querystring:StudioItemListQuerySchema,response:{200:StudioItemPageSchema}}},async(request,reply)=>{
      if(!authorized(request,reply))return;
      try{return listStudioItems(database,request.params.id,request.params.jobId,request.query.cursor,request.query.limit);}
      catch(error){return failure(reply,error);}
    });
  app.post<{Params:{id:string;jobId:string};Body:StudioBatchStart}>(`${base}/:jobId/start`,
    {schema:{params,body:StudioBatchStartSchema,response:{202:StudioJobSchema}}},async(request,reply)=>{
      if(!authorized(request,reply))return;
      try{const job=startStudioBatch(database,config,request.params.id,request.params.jobId,request.body);
        if(job.status==='queued')schedule(request.params.id,job.id);
        return reply.code(202).send(job);
      }catch(error){return failure(reply,error);}
    });
  app.post<{Params:{id:string;jobId:string};Body:StudioBatchRetry}>(`${base}/:jobId/retry`,
    {schema:{params,body:StudioBatchRetrySchema,response:{202:StudioJobSchema}}},async(request,reply)=>{
      if(!authorized(request,reply))return;
      try{const job=retryStudioBatch(database,config,request.params.id,request.params.jobId,request.body);
        if(job.status==='queued')schedule(request.params.id,job.id);
        return reply.code(202).send(job);
      }catch(error){return failure(reply,error);}
    });
  app.get<{Params:{id:string;jobId:string}}>(`${base}/:jobId/text-fallback-options`,{schema:{params,response:{200:StudioTextFallbackOptionsSchema}}},async(request,reply)=>{
    if(!authorized(request,reply))return;reply.header('cache-control','no-store');
    try{return await listStudioTextFallbackOptions(database,secrets,request.params.id,request.params.jobId);}catch(error){return failure(reply,error);}
  });
  app.post<{Params:{id:string;jobId:string};Body:StudioTextFallbackSelection}>(`${base}/:jobId/text-fallback-preview`,{schema:{params,body:StudioTextFallbackSelectionSchema,response:{200:StudioTextFallbackPreviewSchema}},
    preValidation:async(request,reply)=>{if(!authorized(request,reply))return;
      if(!Value.Check(StudioTextFallbackSelectionSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'备用预览只接受已有文本模型配置 ID。'});}},async(request,reply)=>{
      if(!authorized(request,reply))return;reply.header('cache-control','no-store');
      try{return await previewStudioTextFallback(database,secrets,request.params.id,request.params.jobId,request.body);}catch(error){return failure(reply,error);}
    });
  app.post<{Params:{id:string;jobId:string};Body:StudioTextFallbackRequest}>(`${base}/:jobId/text-fallback`,{schema:{params,body:StudioTextFallbackRequestSchema,response:{202:StudioJobSchema}},
    preValidation:async(request,reply)=>{if(!authorized(request,reply))return;
      if(!Value.Check(StudioTextFallbackRequestSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'备用确认需要已有模型配置和已经审阅的计划，不接受任意地址、密钥或提示词。'});}},async(request,reply)=>{
      if(!authorized(request,reply))return;reply.header('cache-control','no-store');
      try{const job=await createStudioTextFallback(database,secrets,request.params.id,request.params.jobId,request.body);if(job.status==='queued')schedule(request.params.id,job.id);return reply.code(202).send(job);}
      catch(error){return failure(reply,error);}
    });
  app.get<{Params:{id:string;jobId:string}}>(`${base}/:jobId/image-fallback-options`,{schema:{params,response:{200:StudioImageFallbackOptionsSchema}}},async(request,reply)=>{
    if(!authorized(request,reply))return;reply.header('cache-control','no-store');
    try{return listStudioImageFallbackOptions(database,request.params.id,request.params.jobId);}catch(error){return failure(reply,error);}
  });
  app.post<{Params:{id:string;jobId:string};Body:StudioImageFallbackSelection}>(`${base}/:jobId/image-fallback-preview`,{schema:{params,body:StudioImageFallbackSelectionSchema,response:{200:StudioImageFallbackPreviewSchema}},
    preValidation:async(request,reply)=>{if(!authorized(request,reply))return;
      if(!Value.Check(StudioImageFallbackSelectionSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'图片备用预览只接受已有图片预设 ID。'});}},async(request,reply)=>{
      if(!authorized(request,reply))return;reply.header('cache-control','no-store');
      try{return previewStudioImageFallback(database,config,request.params.id,request.params.jobId,request.body);}catch(error){return failure(reply,error);}
    });
  app.post<{Params:{id:string;jobId:string};Body:StudioImageFallbackRequest}>(`${base}/:jobId/image-fallback`,{schema:{params,body:StudioImageFallbackRequestSchema,response:{202:StudioJobSchema}},
    preValidation:async(request,reply)=>{if(!authorized(request,reply))return;
      if(!Value.Check(StudioImageFallbackRequestSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'图片备用确认需要已有预设和已经审阅的计划，不接受任意地址、密钥或提示词。'});}},async(request,reply)=>{
      if(!authorized(request,reply))return;reply.header('cache-control','no-store');
      try{const job=createStudioImageFallback(database,config,request.params.id,request.params.jobId,request.body);if(job.status==='queued')schedule(request.params.id,job.id);return reply.code(202).send(job);}
      catch(error){return failure(reply,error);}
    });
  app.post<{Params:{id:string;jobId:string};Body:StudioJobResume}>(`${base}/:jobId/resume`,
    {schema:{params,body:StudioJobResumeSchema,response:{202:StudioJobSchema}},preValidation:async(request,reply)=>{
      if(!authorized(request,reply))return;
      if(!Value.Check(StudioJobResumeSchema,request.body))return reply.code(400).send({error:'studio_invalid_request',message:'恢复请求只能包含任务修订号、已确认计划标识和明确选择的条目。'});
    }},async(request,reply)=>{
      if(!authorized(request,reply))return;
      try{const job=resumeStudioJob(database,config,request.params.id,request.params.jobId,request.body);
        if(job.status==='queued')schedule(request.params.id,job.id);
        return reply.code(202).send(job);
      }catch(error){return failure(reply,error);}
    });
  app.post<{Params:{id:string;jobId:string}}>(`${base}/:jobId/reconcile`,
    {schema:{params,body:Type.Object({},{additionalProperties:false}),response:{200:StudioJobSchema}},preValidation:async(request,reply)=>{
      if(!authorized(request,reply))return;
      if(!request.body||typeof request.body!=='object'||Array.isArray(request.body)||Object.keys(request.body).length)return reply.code(400).send({error:'studio_invalid_request',message:'核对仅使用已有任务关联，不接受强制重投、路径或工作流参数。'});
    }},async(request,reply)=>{
      if(!authorized(request,reply))return;
      try{return await reconcileStudioJob({database,config,secrets,activityId:request.params.id,jobId:request.params.jobId,fetcher,activeJobIds:new Set(running.keys())});}
      catch(error){return failure(reply,error);}
    });
  app.post<{ Params: { id: string; jobId: string }; Body: StudioStoryboardApply | StudioRefineApply }>(`${base}/:jobId/apply`,{ schema: { params,body: Type.Union([StudioStoryboardApplySchema,StudioRefineApplySchema]),response: { 200: StudioJobSchema } } },async (request,reply) => {
    if (!authorized(request,reply)) return;
    try {
      const job=store.get(request.params.id,request.params.jobId);
      const applied=job?.kind==='refine' ? applyStudioRefine(database,request.params.id,request.params.jobId,request.body as StudioRefineApply,
        (target,parent)=>createStudioRefineRender(database,config,target,parent)) : applyStudioStoryboard(database,request.params.id,request.params.jobId,request.body as StudioStoryboardApply,
          (targets,parent,placement)=>{
            const activities=new ActivityStore(database),activity=activities.getActivity(parent.activityId)!,draft=activities.getDraft(parent.activityId)!,image=getImageConfigDraft(database,parent.activityId),comic=new ComicStore(database).getComicDraft(parent.activityId);
            return createStudioBatch(database,config,parent.activityId,{kind:'render_batch',idempotencyKey:`apply-render:${parent.id}`,
              versions:{headVersion:activity.headVersion,contentDraftVersion:draft.draftVersion,contentRevisionId:activity.currentContentRevisionId,
                imageConfigDraftVersion:image.draftVersion,imageConfigRevisionId:image.baseRevisionId,...(comic?{comicDraftVersion:comic.draftVersion}:{})},
              input:{targets,candidateCount:1,placement}},{withinTransaction:true,parent,approved:true});
          });
      if (applied.appliedResult?.childJobId) schedule(request.params.id,applied.appliedResult.childJobId);
      return applied;
    } catch (error) { return failure(reply,error); }
  });
  app.post<{ Params: { id: string; jobId: string }; Body: StudioJobControl }>(`${base}/:jobId/stop`,{ schema: { params,body: StudioJobControlSchema,response: { 200: StudioJobSchema } } },async (request,reply) => {
    if (!authorized(request,reply)) return;
    try { const job = store.stop(request.params.id,request.params.jobId,request.body.expectedJobRevision);
      // 细化与原生绘制都只中止本地跟踪；已提交的上游任务继续核对保留结果。
      if(job.kind!=='render_batch'||job.input.operation==='hires')running.get(job.id)?.controller.abort();
      return job; }
    catch (error) { return failure(reply,error); }
  });
  const recoverExpired = () => {try{recoverStudioJobs(database,config,{activeJobIds:new Set(running.keys())});}
    catch(error){if(!closing)app.log.error({err:error},'Studio recovery failed without resubmission');}};
  recoverStudioJobs(database,config,{startup:true});
  const recoveryTimer = setInterval(recoverExpired,30_000); recoveryTimer.unref();
  app.addHook('onClose',async () => {
    closing = true; clearInterval(recoveryTimer);
    for (const item of running.values()) item.controller.abort();
    await Promise.all([...running.values()].map(item => item.promise));
  });
}
