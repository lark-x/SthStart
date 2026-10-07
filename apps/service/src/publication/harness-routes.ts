import type { FastifyInstance } from 'fastify';
import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as c from '@sthstart/contracts';
import { PublicationHarness } from './harness.js';

const id=Type.String({pattern:'^[A-Za-z0-9_-]{1,160}$'});
/** Register inside the existing authenticated publication bridge scope. */
export function registerPublicationHarnessRoutes(app:FastifyInstance,h:PublicationHarness) {
  const root='/api/v1/publication-bridge/projects/:projectId',base=`${root}/publications/:activityId`;
  const add=(method:'GET'|'POST',url:string,handler:(r:any)=>unknown,body?:TSchema,querystring?:TSchema,response?:TSchema)=>{
    const names=[...url.matchAll(/:([A-Za-z]+)/g)].map(m=>m[1]);
    app.route({method,url,bodyLimit:512000,preValidation:async(request,reply)=>{
      if(body&&!Value.Check(body,request.body))return reply.code(400).send({error:'publication_request_invalid',message:'请求包含非法字段或参数。',retryable:false});
    },schema:{params:Type.Object(Object.fromEntries(names.map(n=>[n,id]))),...(body?{body}:{}),...(querystring?{querystring}:{}),...(response?{response:{200:response}}:{})},handler:async request=>{
      const r=request as any;if(r.params.activityId)h.owned(r.params.projectId,r.params.activityId);return handler(r);
    }});
  };
  add('GET',`${root}/publications`,r=>h.publications(r.params.projectId,r.query),undefined,c.PublicationDiscoveryQuerySchema,c.PublicationDiscoverySchema);
  add('GET',`${base}/runs`,r=>h.runs(r.params.activityId,r.query),undefined,c.PublicationRunsQuerySchema,c.PublicationRunDiscoverySchema);
  add('GET',`${base}/shots/:shotId/history`,r=>h.images(r.params.activityId,r.params.shotId,r.query),undefined,c.HarnessPageQuerySchema,c.PublicationImageDiscoverySchema);
  add('GET',`${base}/utterances/:utteranceId/history`,r=>h.audio(r.params.activityId,r.params.utteranceId,r.query),undefined,c.HarnessPageQuerySchema,c.PublicationAudioDiscoverySchema);
  add('GET',`${base}/media`,r=>h.media(r.params.activityId,r.query),undefined,c.HarnessPageQuerySchema,c.PublicationMediaDiscoverySchema);
  add('GET',`${base}/artifacts/:artifactId`,r=>h.readArtifact(r.params.activityId,r.params.artifactId,r.query.mode),undefined,c.PublicationArtifactQuerySchema,c.PublicationArtifactSchema);
  add('GET',`${base}/options`,r=>h.options(r.params.activityId,r.query.category,r.query),undefined,c.PublicationOptionsQuerySchema,c.PublicationOptionsSchema);
  add('POST',`${base}/validate`,r=>h.validate(r.params.activityId,r.body.document),c.PublicationValidationRequestSchema,undefined,c.PublicationValidationSchema);
  add('POST',`${base}/preview`,r=>h.preview(r.params.activityId,r.body),c.PublicationPreflightRequestSchema,undefined,c.PublicationPreflightSchema);
  add('POST',`${base}/patch`,r=>h.patch(r.params.activityId,r.body),c.PublicationPatchRequestSchema,undefined,c.PublicationPatchResponseSchema);
  add('POST',`${base}/utterances/:utteranceId/select-audio`,r=>h.selectAudio(r.params.activityId,r.params.utteranceId,r.body),Type.Object({...c.PublicationAudioRequestSchema.properties,allowStaleSource:Type.Boolean()},{additionalProperties:false}),undefined,c.PublicationDraftSchema);
  add('POST',`${base}/utterances/:utteranceId/retries`,r=>h.worker.retryUtterance(r.params.activityId,r.params.utteranceId,r.body.runId,r.body.idempotencyKey),c.PublicationRetrySchema,undefined,c.PublicationTaskSchema);
  add('POST',`${base}/exports`,r=>h.worker.export(r.params.activityId,r.body.expectedDraftVersion,r.body.makeVideo,r.body.idempotencyKey),c.PublicationExportRequestSchema,undefined,c.PublicationTaskSchema);
  add('GET',`${base}/tasks/:taskId`,r=>h.task(r.params.activityId,r.params.taskId),undefined,undefined,c.PublicationTaskSchema);
}
