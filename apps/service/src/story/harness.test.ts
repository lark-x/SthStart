import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {ServiceDatabase} from '../database.js';
import {StoryStore} from './store.js';
import {registerStoryHarnessRoutes} from './harness-routes.js';
test('Story history is scoped, paginated and chunked; proposal summaries preserve stale state and baseline labels',async()=>{
  const db=new ServiceDatabase(':memory:'),store=new StoryStore(db),app=Fastify({logger:false});
  const project=store.createProject({title:'历史测试'}),doc=store.createDocument(project.id,{kind:'chapter',title:'章节',body:'旧'.repeat(21000)}),grant=store.createBridgeGrant(project.id);
  registerStoryHarnessRoutes(app,store,(r,reply,id)=>{
    if(!store.authorizeBridge(id,String(r.headers.authorization).replace('Bearer ',''))){reply.code(401).send({error:'unauthorized'});return false;}return true;
  });
  try{
    const p=store.createNativeProposal(project.id,{operation:'update',kind:'chapter',targetId:doc.id,baseRevision:1,proposedTitle:'建议',proposedBody:'待审',reason:'修改'}).proposal;
    store.updateDocument(project.id,doc.id,{expectedRevision:1,title:'新版本',body:'新正文'});
    db.connection.prepare("UPDATE story_entry_revisions SET source='baseline' WHERE project_id=? AND entry_id=? AND revision=1").run(project.id,doc.id);
    const root=`/api/v1/story-bridge/projects/${project.id}`,headers={authorization:`Bearer ${grant.token}`};
    const proposals=await app.inject({url:`${root}/proposals?status=pending&targetId=${doc.id}`,headers});assert.equal(proposals.statusCode,200,proposals.body);assert.equal(proposals.json().items[0].id,p.id);assert.equal(proposals.json().items[0].stale,true);assert.ok(!proposals.body.includes('proposedBody'));
    const list=await app.inject({url:`${root}/entries/chapter/${doc.id}/revisions?limit=1`,headers});assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items[0].revision,2);assert.ok(!list.body.includes('snapshot'));
    const next=await app.inject({url:`${root}/entries/chapter/${doc.id}/revisions?limit=1&cursor=${list.json().nextCursor}`,headers});assert.equal(next.json().items[0].revision,1);
    const old=next.json().items[0];assert.equal(old.source,'baseline');
    const chunk=await app.inject({url:`${root}/entries/chapter/${doc.id}/revisions/${old.id}`,headers});assert.equal(chunk.json().body.length,20000);assert.equal(chunk.json().truncated,true);
    const tail=await app.inject({url:`${root}/entries/chapter/${doc.id}/revisions/${old.id}?offset=20000`,headers});assert.equal(tail.json().body.length,1000);assert.equal(tail.json().truncated,false);
    const foreign=store.createProject({title:'其他'}),other=store.createDocument(foreign.id,{kind:'chapter',title:'别章',body:'不允许读'}),rev=store.listEntryRevisions(foreign.id,'chapter',other.id)[0];
    assert.equal((await app.inject({url:`${root}/entries/chapter/${doc.id}/revisions/${rev.id}`,headers})).statusCode,404);
    assert.equal((await app.inject({url:`${root}/entries/world/${doc.id}/revisions/${old.id}`,headers})).statusCode,404);
    const accepted=store.createNativeProposal(project.id,{operation:'update',kind:'chapter',targetId:doc.id,baseRevision:2,proposedTitle:'采纳',proposedBody:'采纳正文',reason:'测试'}).proposal;
    store.decideProposal(project.id,accepted.id,'accepted');
    const acceptedList=await app.inject({url:`${root}/proposals?status=accepted`,headers});assert.equal(acceptedList.json().items[0].stale,false);assert.equal(acceptedList.json().items[0].id,accepted.id);
    const rejected=store.createNativeProposal(project.id,{operation:'create',kind:'chapter',targetId:null,baseRevision:null,proposedTitle:'拒绝',proposedBody:'未采纳',reason:'测试'}).proposal;store.decideProposal(project.id,rejected.id,'rejected');
    const rejectedList=await app.inject({url:`${root}/proposals?status=rejected`,headers});assert.equal(rejectedList.json().items[0].stale,false);assert.equal(rejectedList.json().items[0].id,rejected.id);
    assert.equal((await app.inject({url:`${root}/proposals`,headers:{...headers,origin:'https://foreign.invalid'}})).statusCode,403);
    store.revokeBridgeGrant(project.id);assert.equal((await app.inject({url:`${root}/proposals`,headers})).statusCode,401);
  }finally{await app.close();db.close();}
});
