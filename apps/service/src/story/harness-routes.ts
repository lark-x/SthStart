import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { StoryProposalDiscoveryQuerySchema,StoryRevisionQuerySchema,StoryBridgeEntryQuerySchema,StoryProposalKindSchema,StoryProposalDiscoverySchema,StoryRevisionDiscoverySchema,StoryRevisionChunkSchema } from '@sthstart/contracts';
import { StoryStore,StoryError } from './store.js';

export function registerStoryHarnessRoutes(app:FastifyInstance,store:StoryStore,check:(r:FastifyRequest,reply:FastifyReply,id:string)=>boolean) {
  const root='/api/v1/story-bridge/projects/:projectId',entry=`${root}/entries/:kind/:id`,id=Type.String({pattern:'^[A-Za-z0-9_-]{1,160}$'});
  const add=(url:string,query: any,response:any,handler:(r:any)=>unknown)=>app.get(url,{schema:{params:Type.Object(Object.fromEntries([...url.matchAll(/:([A-Za-z]+)/g)].map(m=>[m[1],m[1]==='kind'?StoryProposalKindSchema:id]))),querystring:query,response:{200:response}}},async(r,reply:FastifyReply)=>{
    if(r.headers.origin)return reply.code(403).send({error:'story_bridge_browser_request_denied',message:'桥接不接受浏览器来源。'});
    if(!check(r,reply,(r.params as any).projectId))return;
    try{return handler(r);}catch(e){if(e instanceof StoryError)return reply.code(e.statusCode).send({error:e.code,message:e.message,retryable:false});throw e;}
  });
  add(`${root}/proposals`,StoryProposalDiscoveryQuerySchema,StoryProposalDiscoverySchema,r=>store.proposalPage(r.params.projectId,r.query));
  add(`${entry}/revisions`,StoryRevisionQuerySchema,StoryRevisionDiscoverySchema,r=>store.revisionPage(r.params.projectId,r.params.kind,r.params.id,r.query.cursor,r.query.limit));
  add(`${entry}/revisions/:revisionId`,StoryBridgeEntryQuerySchema,StoryRevisionChunkSchema,r=>{
    const {projectId,kind,id,revisionId}=r.params,rev=store.getEntryRevision(projectId,revisionId);
    if(!rev||rev.entryKind!==kind||rev.entryId!==id)throw new StoryError('story_revision_not_found',404,'修订不属于指定条目。');
    const snapshot=rev.snapshot,body='body' in snapshot?snapshot.body:snapshot.notes,title='title' in snapshot?snapshot.title:snapshot.name;
    const offset=r.query.offset??0,chunk=body.slice(offset,offset+Math.min(r.query.limit??20000,20000));
    return {kind,id,revisionId,revision:rev.revision,source:rev.source,title,body:chunk,totalLength:body.length,offset,truncated:offset+chunk.length<body.length};
  });
}
