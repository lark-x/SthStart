import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {buildActivityDocument,type ComicDocument} from '@sthstart/contracts';
import {ServiceDatabase,nowIso} from './database.js';
import {readConfig} from './config.js';
import {SecretStore} from './security.js';
import {ActivityStore} from './activities/store.js';
import {StudioStore} from './activities/studio-store.js';
import {ComicStore} from './activities/comic-store.js';
import {createArtifactReference,resolveArtifactStoragePath,streamUploadArtifact} from './artifacts.js';
import {getImageConfigDraft,saveImageConfigDraft,commitImageConfigRevision} from './activities/image-configs.js';
import {buildActivityExportPackage} from './activities/exports.js';
import {stageActivityImport,commitActivityImport} from './activities/imports.js';
import {createZip,readZip} from './activities/zip.js';
import {readStudioArchive,remapStudioArchiveValue} from './activities/studio-archive.js';
import {listStudioItems,processStudioBatch,startStudioBatch} from './activities/studio-batches.js';
import {recoverStudioJobs,resumeStudioJob} from './activities/studio-recovery.js';
import {validateComicDocument} from './activities/comic-validation.js';
import {registerComicStoryboardRoutes,processComicStoryboardJob} from './activities/comic-storyboard.js';
import {createAiCallRecord} from './ai-call-trace.js';
import {createPortableBackup,verifyPortableBackup,restorePortableBackup} from './portable-backup.js';
import {reconcileGenerationTasks} from './generation/execution.js';
import Fastify from 'fastify';
import {installVisualTestWorkflow} from './activities/test-support/visual-workflow.js';

// All databases, files and calls in this test are isolated; no configured user service is used.
test('fallback provenance remaps owned job identities but never rewrites creative text or external configuration/call evidence',()=>{
  const ids=new Map([['old-job','copy-job'],['old-root','copy-root'],['profile','must-not-use']]);
  const value={fallback:{fallbackOf:'old-job',rootJobId:'old-root',profileId:'profile',priorCallId:'real-original-call',reason:'old-job'},
    call:{parameters:{fallbackOf:'old-job',fallbackRootJobId:'old-root'}},description:'old-root'};
  assert.deepEqual(remapStudioArchiveValue(value,ids),{fallback:{fallbackOf:'copy-job',rootJobId:'copy-root',profileId:'profile',priorCallId:'real-original-call',reason:'old-job'},
    call:{parameters:{fallbackOf:'copy-job',fallbackRootJobId:'copy-root'}},description:'old-root'});
});
async function fixture(t:test.TestContext,onDisk=false){
  const root=mkdtempSync(join(tmpdir(),'sthstart-studio-archive-'));
  const config=readConfig({STHSTART_DATABASE_PATH:join(root,'source.db'),STHSTART_NARRATIVE_DATABASE_PATH:join(root,'none.db'),STHSTART_ARTIFACT_DIR:join(root,'media')});
  const database=new ServiceDatabase(onDisk?config.databasePath:':memory:');
  t.after(()=>{try{database.close();}catch{/* Closed before restore. */}});
  const store=new ActivityStore(database),now=nowIso();
  database.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','isolated','hash','[]',1,?,?)").run(now,now);
  installVisualTestWorkflow(database);
  const document=buildActivityDocument({templateId:'blank',title:'归档测试',type:'测试',theme:'',location:'实验台',rules:'',actors:[]});
  document.actors=[{id:'actor-a',displayName:'角色甲',activityRole:'主角',outfitDescription:'实验服',persona:{},appearanceReferenceAssetKeys:[]}];
  document.stages[0].actorIds=['actor-a'];
  document.scenes=[{id:'scene-a',stageId:document.stages[0].id,title:'实验',timeText:'傍晚',locationText:'营地',beats:[{id:'beat-a',characterId:'actor-a',actorIds:['actor-a'],action:'beat-a',dialogue:'不应改写这句文字'}]}];
  const created=store.createActivity({title:document.activity.title,type:'测试',initialDocument:document}).activity;
  const activityId=created.id,oldContentId=created.currentContentRevisionId!;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  const image=await streamUploadArtifact(config,database,{stream:Readable.from(png),contentType:'image/png',contentLength:png.length,appId:'activities'});
  createArtifactReference(database,{artifactId:image.id,appId:'activities',refType:'activity_studio_render',refId:'original-image'});
  database.connection.prepare("INSERT INTO activity_assets(activity_id,asset_key,artifact_id,source,type,hash,created_at) VALUES (?,'reference-image',?,'upload','image',?,?)").run(activityId,image.id,image.sha256??'',now);
  const draft=store.getDraft(activityId)!;
  draft.document.scenes![0].beats[0].mediaUrl=`/api/admin/artifacts/${image.id}/file`;
  const saved=store.updateDraft(activityId,draft.draftVersion,draft.document);
  const content=store.commitDraft(activityId,created.headVersion,saved.draftVersion);
  let art=getImageConfigDraft(database,activityId);
  art=saveImageConfigDraft(database,activityId,art.draftVersion,{...art.document,globalStylePrompt:'已绑定的画风'});
  const boundConfig=commitImageConfigRevision(database,store,activityId,art.draftVersion,content.activity.headVersion).revision;
  // A newer unbound config must not replace the media revision's explicit binding.
  database.connection.prepare('INSERT INTO activity_image_config_revisions(id,activity_id,parent_id,document_json,hash,created_at) VALUES (?,?,?,?,?,?)')
    .run('unbound-config',activityId,boundConfig.id,JSON.stringify({...boundConfig.document,globalStylePrompt:'不能偷换成此画风'}),'unbound','2099-01-01');
  const current=store.getActivity(activityId)!,contentId=current.currentContentRevisionId!;
  const pending=store.getDraft(activityId)!;
  store.updateDraft(activityId,pending.draftVersion,{...pending.document,scenes:pending.document.scenes!.map(scene=>({...scene,title:'未提交的场次标题'}))});
  const comics=new ComicStore(database),cd=comics.createComicDraft(activityId,contentId);
  const comicJob=comics.createComicJob({activityId,kind:'render',panelId:'panel-a',idempotencyKey:'comic-render',traceId:'comic-trace',request:{panelId:'panel-a',sourceContentRevisionId:contentId}}).job;
  comics.updateComicJob(comicJob.id,{status:'succeeded'});
  database.connection.prepare('INSERT INTO activity_comic_job_outputs(job_id,artifact_id,sort_order,created_at) VALUES (?,?,0,?)').run(comicJob.id,image.id,now);
  const comic:ComicDocument={...cd.document,pages:[{id:'page-a',title:'一页',template:'single',panelIds:['panel-a']}],panels:[{id:'panel-a',source:{stageId:document.stages[0].id,sceneId:'scene-a',beatIds:['beat-a']},actorIds:['actor-a'],shotSize:'medium',visualDescription:'实验',composition:'主体在左',textSafeArea:'bottom',selectedImage:{artifactId:image.id,origin:'comic_render',renderJobId:comicJob.id,sourceFingerprint:'original-source'},crop:{focalX:0.3,focalY:0.6,zoom:1.5},bubbles:[{id:'bubble-a',kind:'speech',speakerActorId:'actor-a',text:'beat-a',rect:{x:0.1,y:0.7,width:0.5,height:0.2},tail:null,fontSize:32}],presentation:{camera:'none',impact:'none',holdMs:null},renderSettings:{}}]};
  const comicSaved=comics.saveComicDraft(activityId,cd.draftVersion,comic);
  const comicRevision=comics.createComicRevision(activityId,comicSaved.draftVersion);
  const proposal=comics.createComicJob({activityId,kind:'storyboard',idempotencyKey:'comic-proposal',traceId:'comic-proposal-trace',request:{sourceContentRevisionId:contentId}}).job;
  comics.updateComicJob(proposal.id,{status:'succeeded',result:{pages:comic.pages,panels:comic.panels}});
  const studio=new StudioStore(database);
  const job=studio.create({activityId,kind:'render_batch',idempotencyKey:'archive-job',request:{},freeze:()=>({batch:true,versions:{contentRevisionId:contentId,imageConfigRevisionId:boundConfig.id},plans:[{id:'item-ok'},{id:'item-unknown'}],referenceArtifactIds:[image.id]})}).job;
  database.connection.prepare("UPDATE activity_studio_jobs SET status='unknown' WHERE id=?").run(job.id);
  const taskId='original-task';
  database.connection.prepare(`INSERT INTO generation_tasks(id,app_id,purpose,engine_id,workflow_id,workflow_version,request_hash,request_params_json,workflow_snapshot_json,status,actual_seed,created_at,updated_at)
    VALUES (?,'activities','test','visual-engine','visual-flow',1,'original','{}',?,'submitting',42,?,?)`)
    .run(taskId,JSON.stringify({'1':{inputs:{api_key:'must-not-export',text:'实际提示词'}}}),now,now);
  const callId=createAiCallRecord(database,{applicationId:'activities',feature:'test',businessEvent:'activity.studio.batch',callType:'image',positivePrompt:'实际提示词',models:['synthetic-model'],generationTaskId:taskId});
  // Deliberately unsanitized old storage proves export sanitization, not just call insertion sanitization.
  database.connection.prepare('UPDATE ai_call_records SET request_snapshot_json=? WHERE id=?').run(JSON.stringify({Authorization:'Bearer must-not-export'}),callId);
  comics.updateComicJob(comicJob.id,{generationTaskId:taskId,callId});
  for(const [id,state,index]of [['item-ok','succeeded',0],['item-unknown','unknown',1]] as const){
    const target={kind:'beat',stageId:document.stages[0].id,sceneId:'scene-a',beatId:'beat-a'};
    database.connection.prepare(`INSERT INTO activity_studio_job_items(id,job_id,target_key,target_json,candidate_index,attempt_no,state,input_json,source_fingerprint,submission_key,generation_task_id,call_id,result_json,placement_state,created_at,updated_at)
      VALUES (?,?,?,?,?,1,?,'{"seed":42}','original-source',?,?,?,?, 'pending',?,?)`)
      .run(id,job.id,`beat:beat-a`,JSON.stringify(target),index,state,`submission-${id}`,taskId,callId,JSON.stringify({artifactIds:id==='item-ok'?[image.id]:[]}),now,now);
  }
  database.connection.prepare(`INSERT INTO activity_beat_render_candidates(id,activity_id,stage_id,scene_id,beat_id,source_fingerprint,draft_version,status,positive_prompt,negative_prompt,created_at,artifact_id,media_url)
    VALUES ('candidate-a',?,?,?,'beat-a','original-source',1,'completed','实际提示词','',?,?,?)`).run(activityId,document.stages[0].id,'scene-a',now,image.id,`/api/admin/artifacts/${image.id}/file`);
  database.connection.prepare('INSERT INTO activity_beat_render_candidate_outputs(candidate_id,artifact_id,sort_order,created_at) VALUES (?,?,0,?)').run('candidate-a',image.id,now);
  database.connection.prepare('UPDATE activity_beat_render_candidates SET task_id=?,call_id=? WHERE id=?').run(taskId,callId,'candidate-a');
  return {root,database,config,store,studio,comics,activityId,contentId,oldContentId,boundConfigId:boundConfig.id,imageId:image.id,jobId:job.id,comicJobId:comicJob.id,comicProposalId:proposal.id,comicRevisionId:comicRevision.id};
}

test('project copy retains scenes, frozen versions, comic layout, all history and remapped image references without queues',async t=>{
  const f=await fixture(t),zip=await buildActivityExportPackage(f.config,f.database,f.store,f.activityId,{format:'project'}),files=readZip(zip);
  const archive=readStudioArchive(f.database,files)!;
  assert.equal(archive.rows.activity_content_revisions.length,2);assert.equal(archive.rows.activity_studio_job_items.length,2);
  assert.ok(!files.get('data/studio-archive.json')!.toString().includes('must-not-export'));
  for(const id of ['item-ok',f.comicJobId,'candidate-a']){
    const evidence=archive.executions[id] as {generation:{actual_seed:number;workflow_id:string;workflow_snapshot_json:unknown};call:{models_json:string[];positive_prompt:string}};
    assert.equal(evidence.generation.actual_seed,42);assert.equal(evidence.generation.workflow_id,'visual-flow');assert.deepEqual(evidence.call.models_json,['synthetic-model']);assert.equal(evidence.call.positive_prompt,'实际提示词');
    assert.ok(evidence.generation.workflow_snapshot_json);assert.ok(!JSON.stringify(evidence).includes('must-not-export'));
  }
  const forged=JSON.parse(files.get('data/studio-archive.json')!.toString());forged.executions.extra={Authorization:'Bearer poison-import-secret',text:'保留实际响应'};
  const altered=new Map(files);altered.set('data/studio-archive.json',Buffer.from(JSON.stringify(forged)));
  assert.ok(!JSON.stringify(readStudioArchive(f.database,altered)).includes('poison-import-secret'));
  altered.set('data/studio-archive.json',Buffer.from('{broken'));assert.throws(()=>readStudioArchive(f.database,altered),{code:'invalid_studio_archive'});
  assert.equal(JSON.parse(files.get('data/media.json')!.toString()).imageConfigRevisionId,f.boundConfigId);
  const taskCount=f.database.connection.prepare('SELECT COUNT(*) n FROM generation_tasks').get()!.n,callCount=f.database.connection.prepare('SELECT COUNT(*) n FROM ai_call_records').get()!.n;
  const staged=await stageActivityImport(f.config,f.database,zip),copy=await commitActivityImport(f.config,f.database,f.store,staged.jobId),id=copy.activity.id;
  const selected=f.store.getContentRevision(id,copy.activity.currentContentRevisionId!)!.document,local=f.store.getDraft(id)!.document;
  assert.equal(selected.scenes!.length,1);assert.equal(local.scenes![0].title,'未提交的场次标题');assert.equal(selected.scenes![0].title,'实验');
  const beat=selected.scenes![0].beats[0];assert.notEqual(beat.id,'beat-a');assert.equal(beat.characterId,selected.actors[0].id);assert.deepEqual(beat.actorIds,[selected.actors[0].id]);assert.equal(beat.action,'beat-a');

  // A copied actor reference must point at the copy's asset key and file, so
  // character reference drawing keeps working in the new activity.
  const sourceDoc=JSON.parse(String(f.database.connection.prepare('SELECT document_json FROM activity_content_revisions WHERE id=?').get(f.contentId)!.document_json));
  sourceDoc.actors[0].appearanceReferenceAssetKeys=['reference-image'];
  f.database.connection.prepare('UPDATE activity_content_revisions SET document_json=? WHERE id=?').run(JSON.stringify(sourceDoc),f.contentId);
  const refZip=await buildActivityExportPackage(f.config,f.database,f.store,f.activityId,{format:'project'});
  const refStaged=await stageActivityImport(f.config,f.database,refZip),refCopy=await commitActivityImport(f.config,f.database,f.store,refStaged.jobId),refId=refCopy.activity.id;
  const refDoc=f.store.getContentRevision(refId,refCopy.activity.currentContentRevisionId!)!.document;
  const copiedReferenceKey=refDoc.actors[0].appearanceReferenceAssetKeys![0];
  const copiedReference=f.database.connection.prepare('SELECT artifact_id FROM activity_assets WHERE activity_id=? AND asset_key=?').get(refId,copiedReferenceKey)!;
  assert.ok(copiedReference);assert.notEqual(String(copiedReference.artifact_id),f.imageId);
  assert.ok(resolveArtifactStoragePath(f.database,String(copiedReference.artifact_id),f.config.artifactDirectory));
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM activity_assets WHERE activity_id=? AND asset_key=?').get(refId,copiedReferenceKey)!.n,1);
  const newImage=beat.mediaUrl!.split('/')[4];assert.notEqual(newImage,f.imageId);assert.ok(resolveArtifactStoragePath(f.database,newImage,f.config.artifactDirectory));
  const revisions=f.database.connection.prepare('SELECT id,parent_id FROM activity_content_revisions WHERE activity_id=?').all(id);assert.equal(revisions.length,2);assert.ok(revisions.some(row=>row.parent_id&&revisions.some(parent=>parent.id===row.parent_id)));
  const media=f.store.getMediaRevision(id,copy.activity.currentMediaRevisionId!)!;
  const bound=f.database.connection.prepare('SELECT document_json FROM activity_image_config_revisions WHERE id=?').get(media.imageConfigRevisionId!)!;
  assert.equal(JSON.parse(String(bound.document_json)).globalStylePrompt,'已绑定的画风');
  const comic=f.comics.getComicDraft(id)!;validateComicDocument(comic.document,selected);
  assert.deepEqual(comic.document.panels[0].crop,{focalX:0.3,focalY:0.6,zoom:1.5});assert.equal(comic.document.panels[0].bubbles[0].text,'beat-a');
  assert.equal(comic.document.panels[0].source.beatIds[0],beat.id);assert.equal(comic.document.panels[0].selectedImage!.artifactId,newImage);
  const native=f.comics.getComicJob(id,comic.document.panels[0].selectedImage!.renderJobId!)!;assert.ok(native);assert.equal(native.input.readOnly,true);assert.equal(f.comics.listComicRevisions(id).items.length,1);
  assert.equal(native.generationTaskId,null);assert.equal((native.input.importedExecution as any).generation.actual_seed,42);
  const importedMeta=JSON.parse(String(f.database.connection.prepare('SELECT model_metadata_json FROM activity_jobs WHERE id=?').get(staged.jobId)!.model_metadata_json));
  assert.ok(Object.values(importedMeta.importedStudioEvidence.executions).some((record:any)=>record.call?.positive_prompt==='实际提示词'));
  assert.ok(!JSON.stringify(importedMeta).includes('must-not-export'));
  const jobs=f.studio.list(id).items;assert.equal(jobs.length,1);assert.equal(jobs[0].readOnly,true);assert.equal(jobs[0].status,'interrupted');
  const frozen=jobs[0].input.versions as {contentRevisionId:string;imageConfigRevisionId:string};assert.equal(frozen.contentRevisionId,copy.activity.currentContentRevisionId);assert.equal(frozen.imageConfigRevisionId,media.imageConfigRevisionId);
  const items=listStudioItems(f.database,id,jobs[0].id).items;assert.equal(items[0].artifactIds[0],newImage);assert.equal(items[1].state,'interrupted');assert.equal(items[1].generationTaskId,null);assert.equal(items[0].callId,null);
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM generation_tasks').get()!.n,taskCount);assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM ai_call_records').get()!.n,callCount);
  assert.ok(f.database.connection.prepare("SELECT 1 FROM artifact_references WHERE artifact_id=? AND ref_type='activity_studio_archive'").get(newImage));
  assert.equal(f.studio.claim(id,jobs[0].id,'no'),false);assert.throws(()=>f.studio.stop(id,jobs[0].id,jobs[0].revision),{code:'studio_job_read_only'});
  assert.throws(()=>resumeStudioJob(f.database,f.config,id,jobs[0].id,{expectedJobRevision:jobs[0].revision,itemIds:[items[1].id]}),{code:'studio_job_read_only'});
  assert.throws(()=>startStudioBatch(f.database,f.config,id,jobs[0].id,{expectedJobRevision:jobs[0].revision,planHash:'old'}),{code:'studio_job_read_only'});
  const fetcher:typeof fetch=async()=>{throw new Error('Imported history must never make a request');};
  await processStudioBatch({database:f.database,config:f.config,secrets:new SecretStore({}),activityId:id,jobId:jobs[0].id,fetcher});recoverStudioJobs(f.database,f.config,{startup:true});
  await processComicStoryboardJob({database:f.database,config:f.config,secrets:new SecretStore({}),activityId:id,jobId:native.id,fetcher});
  // Even a successful imported storyboard cannot be applied through the legacy route.
  const importedProposal=f.comics.listComicJobs(id).items.find(job=>job.kind==='storyboard')!;
  const app=Fastify();registerComicStoryboardRoutes(app,f.config,f.database,new SecretStore({}),()=>true,fetcher);t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:`/api/v1/admin/activities/${id}/comic/storyboards/${importedProposal.id}/apply`,payload:{expectedDraftVersion:comic.draftVersion,mode:'append'}});
  assert.equal(response.statusCode,409);assert.equal(response.json().error,'comic_job_read_only');
  assert.deepEqual(f.database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('missing old file stays visible as unavailable history; no broken file is invented or downloaded',async t=>{
  const f=await fixture(t),path=resolveArtifactStoragePath(f.database,f.imageId,f.config.artifactDirectory)!;assert.ok(path.startsWith(f.root));unlinkSync(path);
  const zip=await buildActivityExportPackage(f.config,f.database,f.store,f.activityId,{format:'project'}),archive=readStudioArchive(f.database,readZip(zip))!;
  assert.equal(archive.artifacts[0].path,null);
  const staged=await stageActivityImport(f.config,f.database,zip),copy=await commitActivityImport(f.config,f.database,f.store,staged.jobId);
  const job=f.studio.list(copy.activity.id).items[0],item=listStudioItems(f.database,copy.activity.id,job.id).items[0];
  assert.equal(item.artifactIds.length,1);assert.deepEqual(item.unavailableArtifactIds,item.artifactIds);assert.equal(item.errorCode,'studio_artifact_unavailable');assert.equal(item.state,'failed');
  assert.equal(resolveArtifactStoragePath(f.database,item.artifactIds[0],f.config.artifactDirectory),null);
  assert.equal(f.comics.getComicDraft(copy.activity.id)!.document.panels[0].selectedImage!.artifactId,item.artifactIds[0]);
});

test('nested legacy scenes and material provenance retain their actual old content/config snapshots',async t=>{
  const f=await fixture(t),now=nowIso(),draft=f.store.getDraft(f.activityId)!;
  // Different legacy storage shape, with no top-level scenes in the new saved version.
  const doc=structuredClone(draft.document);doc.stages[0].scenes=doc.scenes;delete doc.scenes;
  const saved=f.store.updateDraft(f.activityId,draft.draftVersion,doc);f.store.commitDraft(f.activityId,f.store.getActivity(f.activityId)!.headVersion,saved.draftVersion);
  f.database.connection.prepare(`INSERT INTO activity_prompt_recipes(id,activity_id,content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,source_refs_json,blocks_json,references_json,recipe_hash,created_at)
    VALUES ('recipe-old',?,?,?,'slot-old','original',?,'[]','[]','recipe-hash',?)`).run(f.activityId,f.oldContentId,f.boundConfigId,JSON.stringify([{id:'ref-old',ownerKind:'content',ownerRevisionId:f.oldContentId,entityKind:'actor',entityId:'actor-a'}]),now);
  f.database.connection.prepare(`INSERT INTO activity_prompt_compilations(id,recipe_id,activity_id,compiler_version,template_id,template_version,channels_json,effective_params_json,execution_plan_hash,execution_plan_json,created_at)
    VALUES ('comp-old','recipe-old',?,'test','test','1','{}','{}','plan',?,?)`).run(f.activityId,JSON.stringify({contentRevisionId:f.oldContentId,imageConfigRevisionId:f.boundConfigId}),now);
  f.database.connection.prepare(`INSERT INTO activity_image_attempts(id,activity_id,base_content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,recipe_id,compilation_id,recipe_hash,execution_plan_hash,task_id,status,actual_seed,business_request_hash,created_at,updated_at)
    VALUES ('attempt-old',?,?,?,'slot-old','source','recipe-old','comp-old','recipe','plan','old-upstream','running',42,'request',?,?)`).run(f.activityId,f.oldContentId,f.boundConfigId,now,now);
  f.database.connection.prepare(`INSERT INTO activity_image_execution_snapshots(attempt_id,phase,actual_inputs_json,uploaded_file_mappings_json,request_summary_json,created_at)
    VALUES ('attempt-old','submitted',?,'{}',?,?)`).run(JSON.stringify({referenceArtifactId:f.imageId}),JSON.stringify({api_key:'material-secret',contentRevisionId:f.oldContentId}),now);
  f.database.connection.prepare("INSERT INTO activity_image_attempt_outputs(attempt_id,artifact_id,asset_key,output_name,sort_order,created_at) VALUES ('attempt-old',?,'reference-image','image',0,?)").run(f.imageId,now);
  const zip=await buildActivityExportPackage(f.config,f.database,f.store,f.activityId,{format:'project'}),files=readZip(zip);assert.ok(!files.get('data/provenance/execution-snapshots.json')!.toString().includes('material-secret'));
  const staged=await stageActivityImport(f.config,f.database,zip),copy=await commitActivityImport(f.config,f.database,f.store,staged.jobId),id=copy.activity.id;
  const imported=f.store.getContentRevision(id,copy.activity.currentContentRevisionId!)!.document;
  assert.equal(imported.scenes,undefined);const beat=imported.stages[0].scenes![0].beats[0];assert.notEqual(beat.id,'beat-a');assert.equal(beat.characterId,imported.actors[0].id);assert.equal(beat.action,'beat-a');
  const recipe=f.database.connection.prepare('SELECT * FROM activity_prompt_recipes WHERE activity_id=?').get(id)!;
  assert.notEqual(recipe.content_revision_id,copy.activity.currentContentRevisionId);assert.ok(f.store.getContentRevision(id,String(recipe.content_revision_id)));
  assert.equal(JSON.parse(String(recipe.source_refs_json))[0].ownerRevisionId,recipe.content_revision_id);
  const attempt=f.database.connection.prepare('SELECT * FROM activity_image_attempts WHERE activity_id=?').get(id)!;assert.equal(attempt.base_content_revision_id,recipe.content_revision_id);assert.equal(attempt.status,'abandoned');assert.equal(attempt.error_code,'studio_imported_read_only');
  const compilation=f.database.connection.prepare('SELECT * FROM activity_prompt_compilations WHERE activity_id=?').get(id)!;assert.equal(JSON.parse(String(compilation.execution_plan_json)).contentRevisionId,recipe.content_revision_id);
  const snapshot=f.database.connection.prepare('SELECT * FROM activity_image_execution_snapshots WHERE attempt_id=?').get(attempt.id)!;
  const output=f.database.connection.prepare('SELECT artifact_id FROM activity_image_attempt_outputs WHERE attempt_id=?').get(attempt.id)!;
  assert.equal(JSON.parse(String(snapshot.actual_inputs_json)).referenceArtifactId,output.artifact_id);
  const alias=f.database.connection.prepare("SELECT artifact_id FROM activity_assets WHERE activity_id=? AND asset_key='reference-image'").get(id)!;assert.equal(output.artifact_id,alias.artifact_id);
  assert.ok(resolveArtifactStoragePath(f.database,String(output.artifact_id),f.config.artifactDirectory));
});

test('unknown table/column, cross-project rows, forged owned paths and orphan items are rejected before creating a copy',async t=>{
  const f=await fixture(t),files=readZip(await buildActivityExportPackage(f.config,f.database,f.store,f.activityId,{format:'project'}));
  const original=JSON.parse(files.get('data/studio-archive.json')!.toString()),before=f.database.connection.prepare('SELECT COUNT(*) n FROM activities').get()!.n;
  const mutations=[(a:any)=>{a.rows.generation_tasks=[];},(a:any)=>{a.rows.activity_studio_jobs[0].rogue_column='x';},(a:any)=>{a.rows.activity_studio_jobs[0].activity_id='other';},(a:any)=>{a.artifacts[0].path='assets/media/../../../secrets';},(a:any)=>{a.rows.activity_studio_job_items[0].job_id='other';},(a:any)=>{delete a.rows.activity_studio_jobs[0].id;},(a:any)=>{a.rows.activity_studio_jobs[0].parent_job_id='outside-job';},(a:any)=>{const row=a.rows.activity_comic_drafts[0],doc=JSON.parse(row.document_json);doc.pages[0].panelIds=['missing-panel'];row.document_json=JSON.stringify(doc);}];
  for(const mutate of mutations){const archive=structuredClone(original);mutate(archive);const changed=new Map(files);changed.set('data/studio-archive.json',Buffer.from(JSON.stringify(archive)));
    const manifest=JSON.parse(changed.get('manifest.json')!.toString());manifest.files=manifest.files.map((entry:any)=>{const bytes=changed.get(entry.path)!;return {...entry,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});changed.set('manifest.json',Buffer.from(JSON.stringify(manifest)));
    const zip=createZip([...changed].map(([path,data])=>({path,data})));await assert.rejects(()=>stageActivityImport(f.config,f.database,zip),/invalid_studio_archive/);
  }
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM activities').get()!.n,before);
});

test('late archive insertion failure rolls back the entire copied activity, versions and references',async t=>{
  const f=await fixture(t),files=readZip(await buildActivityExportPackage(f.config,f.database,f.store,f.activityId,{format:'project'}));
  const archive=JSON.parse(files.get('data/studio-archive.json')!.toString());archive.rows.activity_studio_jobs[0].status='not-a-state';
  files.set('data/studio-archive.json',Buffer.from(JSON.stringify(archive)));
  const manifest=JSON.parse(files.get('manifest.json')!.toString());manifest.files=manifest.files.map((entry:any)=>{const bytes=files.get(entry.path)!;return {...entry,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));
  const zip=createZip([...files].map(([path,data])=>({path,data}))),staged=await stageActivityImport(f.config,f.database,zip);
  const before=f.database.connection.prepare('SELECT COUNT(*) n FROM activities').get()!.n,refs=f.database.connection.prepare('SELECT COUNT(*) n FROM artifact_references').get()!.n;
  await assert.rejects(()=>commitActivityImport(f.config,f.database,f.store,staged.jobId),/CHECK constraint failed/);
  assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM activities').get()!.n,before);assert.equal(f.database.connection.prepare('SELECT COUNT(*) n FROM artifact_references').get()!.n,refs);
  assert.deepEqual(f.database.connection.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('old project archives without Studio data still copy their scenes and explicit bound image configuration',async t=>{
  const f=await fixture(t),files=readZip(await buildActivityExportPackage(f.config,f.database,f.store,f.activityId,{format:'project'}));
  for(const path of files.keys())if(path==='data/studio-archive.json'||path.startsWith('assets/studio/'))files.delete(path);
  const manifest=JSON.parse(files.get('manifest.json')!.toString());manifest.files=manifest.files.filter((entry:any)=>files.has(entry.path));files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));
  const staged=await stageActivityImport(f.config,f.database,createZip([...files].map(([path,data])=>({path,data})))),copy=await commitActivityImport(f.config,f.database,f.store,staged.jobId);
  const content=f.store.getContentRevision(copy.activity.id,copy.activity.currentContentRevisionId!)!.document;
  assert.equal(content.scenes![0].beats[0].action,'beat-a');assert.notEqual(content.scenes![0].beats[0].id,'beat-a');assert.equal(content.scenes![0].beats[0].characterId,content.actors[0].id);
  assert.equal(f.studio.list(copy.activity.id).items.length,0);
  const bound=f.store.getMediaRevision(copy.activity.id,copy.activity.currentMediaRevisionId!)!.imageConfigRevisionId!;
  assert.equal(JSON.parse(String(f.database.connection.prepare('SELECT document_json FROM activity_image_config_revisions WHERE id=?').get(bound)!.document_json)).globalStylePrompt,'已绑定的画风');
});

test('portable WAL snapshot restores frozen jobs, media and references; startup holds unfinished work without replay',async t=>{
  const f=await fixture(t,true);
  // A still-queued Studio job must wait for user confirmation after a whole-site restore.
  f.database.connection.prepare("UPDATE activity_studio_jobs SET status='queued' WHERE id=?").run(f.jobId);
  const backup=await createPortableBackup({config:f.config,destination:join(f.root,'backup')});assert.equal((await verifyPortableBackup(backup.destination)).valid,true);
  const restoredConfig=readConfig({STHSTART_DATABASE_PATH:join(f.root,'restored','service.db'),STHSTART_NARRATIVE_DATABASE_PATH:join(f.root,'restored','narrative.db'),STHSTART_ARTIFACT_DIR:join(f.root,'restored','media')});
  await restorePortableBackup(backup.destination,{config:restoredConfig,confirm:true});
  const restored=new ServiceDatabase(restoredConfig.databasePath);t.after(()=>restored.close());
  assert.equal(new StudioStore(restored).get(f.activityId,f.jobId)!.input.versions!==null,true);
  assert.ok(resolveArtifactStoragePath(restored,f.imageId,restoredConfig.artifactDirectory));
  assert.equal(new ComicStore(restored).getComicRevision(f.activityId,f.comicRevisionId)!.document.panels[0].selectedImage!.artifactId,f.imageId);
  assert.ok(restored.connection.prepare('SELECT 1 FROM artifact_references WHERE artifact_id=?').get(f.imageId));
  recoverStudioJobs(restored,restoredConfig,{startup:true});
  await reconcileGenerationTasks(restoredConfig,restored,new SecretStore({}),async()=>{throw new Error('Submitting without an upstream ID cannot send any request');});
  recoverStudioJobs(restored,restoredConfig);
  assert.equal(new StudioStore(restored).get(f.activityId,f.jobId)!.status,'unknown');
  assert.equal(restored.connection.prepare('SELECT upstream_may_continue FROM generation_tasks WHERE id=?').get('original-task')!.upstream_may_continue,1);
  assert.deepEqual(restored.connection.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(restored.connection.prepare('PRAGMA quick_check').get()!.quick_check,'ok');
});
