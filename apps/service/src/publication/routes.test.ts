import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerPublicationRoutes} from './routes.js';
import {publicationFixture,addPublicationTestWorkflow,publicationObjectInfo} from './fixtures.js';
import {readConfig} from '../config.js';
import {SecretStore} from '../security.js';
import {createService} from '../server.js';
const token='publication-test-admin-token-1234567890',headers={'x-sthstart-admin-token':token};
test('admin production APIs and scoped bridge prohibit approval, foreign canon, admin impersonation and revoked keys',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-routes-')),f=publicationFixture(dir),app=Fastify({logger:false});
  addPublicationTestWorkflow(f.db);
  const {worker}=registerPublicationRoutes(app,{...readConfig({STHSTART_ADMIN_TOKEN:token}),artifactDirectory:dir},f.db,new SecretStore({}),async()=>Response.json(publicationObjectInfo()));
  try{
    await app.ready();
    const root=`/api/v1/admin/activities/${f.draft.activityId}/publication`,bridge=`/api/v1/publication-bridge/projects/${f.project.id}`;
    assert.equal((await app.inject({url:root})).statusCode,401);
    const draft=await app.inject({url:root,headers});assert.equal(draft.statusCode,200,draft.body);
    const profile=await app.inject({url:'/api/v1/admin/publication/speech-profiles',headers});assert.equal(profile.statusCode,200,profile.body);
    const speechModelsUrl='/api/v1/admin/publication/speech-models';
    assert.equal((await app.inject({url:speechModelsUrl})).statusCode,401);
    const time=new Date().toISOString();
    f.db.connection.prepare(`INSERT INTO service_connections(id,name,kind,base_url,credential_account,created_at,updated_at) VALUES ('configured-speech','语音','openai-compatible-text','https://speech.invalid/v1','test:speech',?,?)`).run(time,time);
    f.db.connection.prepare(`INSERT INTO model_profiles(id,connection_id,name,model_id,created_at,updated_at) VALUES ('configured-speech-model','configured-speech','语音','stepaudio-2.5-tts',?,?),('chat-model','configured-speech','聊天','step-5-preview',?,?)`).run(time,time,time,time);
    const sources=await app.inject({url:speechModelsUrl,headers});assert.equal(sources.statusCode,200,sources.body);
    assert.equal(sources.json().items.length,1);assert.equal(sources.json().items[0].model,'stepaudio-2.5-tts');
    assert.equal(sources.json().items[0].hasCredential,false);assert.ok(!sources.body.includes('credential_account'));
    f.db.connection.prepare("UPDATE service_connections SET enabled=0 WHERE id='configured-speech'").run();
    assert.equal((await app.inject({url:speechModelsUrl,headers})).json().items.length,0);
    const grant=await app.inject({method:'POST',url:`/api/v1/admin/story/projects/${f.project.id}/publication-grant`,headers,payload:{}});assert.equal(grant.statusCode,201,grant.body);
    const auth={authorization:`Bearer ${grant.json().token}`};
    assert.equal((await app.inject({url:`${bridge}/publications/${f.draft.activityId}`,headers:{authorization:`Bearer ${token}`}})).statusCode,401);
    assert.equal((await app.inject({url:`${bridge}/publications/${f.draft.activityId}`,headers:auth})).statusCode,200);
    assert.equal((await app.inject({url:`${bridge}/publications/${f.draft.activityId}`,headers:{...auth,origin:'https://untrusted.invalid'}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:`${bridge}/publications/${f.draft.activityId}/approvals`,headers:auth,payload:{}})).statusCode,404);
    const other=f.story.createProject({title:'其他项目'});
    assert.equal((await app.inject({url:`/api/v1/publication-bridge/projects/${other.id}/publications/${f.draft.activityId}`,headers:auth})).statusCode,401);
    const read=await app.inject({url:`${bridge}/sources?activityId=${f.draft.activityId}&limit=4`,headers:auth});assert.equal(read.statusCode,200,read.body);assert.equal(read.json().body.length,4);assert.equal(read.json().nextOffset,4);
    const change={...f.document,title:'制作改名'};
    const proposal=await app.inject({method:'POST',url:`${bridge}/plans`,headers:auth,payload:{activityId:f.draft.activityId,expectedDraftVersion:2,document:change}});assert.equal(proposal.statusCode,200,proposal.body);
    assert.equal(f.story.getProject(f.project.id)?.title,f.project.title);
    assert.equal((await app.inject({method:'POST',url:`${bridge}/plans`,headers:auth,payload:{activityId:f.draft.activityId,expectedDraftVersion:2,document:change}})).statusCode,409);
    f.store.revoke(f.project.id);assert.equal((await app.inject({url:`${bridge}/publications/${f.draft.activityId}`,headers:auth})).statusCode,401);
  }finally{await worker.close();await app.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('full Service keeps legacy streaming parsers while publication audio uploads stay buffered and scoped',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sthstart-publication-registration-')),f=publicationFixture(dir);
  const config=readConfig({STHSTART_ADMIN_TOKEN:token,STHSTART_ARTIFACT_DIR:dir,STHSTART_LOG_DIR:join(dir,'logs')});
  const {app}=await createService({config,database:f.db,secrets:new SecretStore({}),fetcher:async()=>new Response('',{status:404})});
  try{
    await app.ready();
    assert.equal(app.hasContentTypeParser('audio/wav'),true);
    const response=await app.inject({method:'POST',url:`/api/v1/admin/activities/${f.draft.activityId}/publication/utterances/utterance-0/upload`,headers:{...headers,'content-type':'audio/wav'},payload:Buffer.from('not an actual audio file')});
    assert.equal(response.statusCode,400,response.body);
    assert.match(response.json().message,/音频|时长|解码/);
    assert.equal(f.store.requireDraft(f.draft.activityId).document.shots[0].utterances[0].selectedAudioArtifactId,null);
    assert.equal(f.store.audioHistory(f.draft.activityId,'utterance-0').items.length,0);
  }finally{await app.close();f.db.close();await rm(dir,{recursive:true,force:true});}
});
