import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {buildActivityDocument,ActivityGallerySchema} from '@sthstart/contracts';
import {Value} from '@sinclair/typebox/value';
import {ServiceDatabase,nowIso} from './database.js';
import {readConfig} from './config.js';
import {ActivityStore} from './activities/store.js';
import {ComicStore} from './activities/comic-store.js';
import {createArtifactReference,resolveArtifactStoragePath,streamUploadArtifact} from './artifacts.js';
import {buildActivityGallery} from './activities/gallery.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function fixture(t:test.TestContext){
  const root=mkdtempSync(join(tmpdir(),'sthstart-gallery-')),database=new ServiceDatabase(),config=readConfig({STHSTART_ARTIFACT_DIR:join(root,'media')});
  t.after(()=>{try{database.close();}catch{/* already closed */}});const now=nowIso();
  database.connection.prepare("INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','测试','hash','[]',1,?,?)").run(now,now);
  const store=new ActivityStore(database),document=buildActivityDocument({templateId:'blank',title:'画廊测试',type:'测试',theme:'',location:'营地',rules:'',actors:[]});
  document.actors=[{id:'actor-a',displayName:'角色甲',activityRole:'主角',outfitDescription:'实验服',persona:{},appearanceReferenceAssetKeys:[]}];
  const activity=store.createActivity({title:document.activity.title,type:'测试',initialDocument:document}).activity;
  const upload=async()=>streamUploadArtifact(config,database,{stream:Readable.from(png),contentType:'image/png',contentLength:png.length,appId:'activities'});
  return {root,database,config,store,activityId:activity.id,upload};
}

test('gallery aggregates lens, comic, material and upload images once each with readable status',async t=>{
  const f=await fixture(t),now=nowIso();
  const beatImage=await f.upload(),comicImage=await f.upload(),materialImage=await f.upload(),uploadImage=await f.upload();
  f.database.connection.prepare(`INSERT INTO activity_beat_render_candidates(id,activity_id,stage_id,scene_id,beat_id,source_fingerprint,draft_version,status,positive_prompt,negative_prompt,created_at)
    VALUES ('candidate',?,'s1','sc1','b1','fp',1,'succeeded','p','',?)`).run(f.activityId,now);
  f.database.connection.prepare('INSERT INTO activity_beat_render_candidate_outputs(candidate_id,artifact_id,sort_order,created_at) VALUES (?,?,0,?)').run('candidate',beatImage.id,now);
  const comics=new ComicStore(f.database),job=comics.createComicJob({activityId:f.activityId,kind:'render',panelId:'p1',idempotencyKey:'k',traceId:'t',request:{panelId:'p1'}}).job;
  comics.recordComicJobOutputs(job.id,[comicImage.id]);
  f.database.connection.prepare(`INSERT INTO activity_prompt_recipes(id,activity_id,content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,source_refs_json,blocks_json,references_json,recipe_hash,created_at)
    VALUES ('recipe',?,'cr','icr','slot','fp','[]','[]','[]','rh',?)`).run(f.activityId,now);
  f.database.connection.prepare(`INSERT INTO activity_prompt_compilations(id,recipe_id,activity_id,compiler_version,template_id,template_version,channels_json,effective_params_json,execution_plan_hash,created_at)
    VALUES ('compilation','recipe',?,'v1','tpl','1','{}','{}','eph',?)`).run(f.activityId,now);
  f.database.connection.prepare(`INSERT INTO activity_image_attempts(id,activity_id,base_content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,recipe_id,compilation_id,recipe_hash,execution_plan_hash,task_id,status,actual_seed,business_request_hash,created_at,updated_at)
    VALUES ('attempt',?,'cr','icr','slot','fp','recipe','compilation','rh','eph','task-material','succeeded',7,'brh',?,?)`).run(f.activityId,now,now);
  f.database.connection.prepare('INSERT INTO activity_image_attempt_outputs(attempt_id,artifact_id,asset_key,sort_order,created_at) VALUES (?,?,?,0,?)').run('attempt',materialImage.id,'slot_asset',now);
  f.database.connection.prepare("INSERT INTO activity_assets(activity_id,asset_key,artifact_id,source,type,hash,created_at) VALUES (?,'uploaded',?,'upload','image','',?)").run(f.activityId,uploadImage.id,now);
  createArtifactReference(f.database,{artifactId:uploadImage.id,appId:'activities',refType:'activity_asset',refId:'uploaded'});
  const gallery=buildActivityGallery(f.database,f.activityId,f.config.artifactDirectory);
  assert.ok(Value.Check(ActivityGallerySchema,gallery));
  assert.deepEqual(gallery.counts,{beat:1,comic:1,material:1,upload:1});assert.equal(gallery.items.length,4);
  assert.deepEqual([...gallery.items.map(item=>item.kind)].sort(),['beat','comic','material','upload']);
  assert.ok(gallery.items.every(item=>item.available));
  // All four stay readable from their own histories.
  for(const id of [beatImage.id,comicImage.id,materialImage.id,uploadImage.id])assert.ok(resolveArtifactStoragePath(f.database,id,f.config.artifactDirectory));
});

test('gallery keeps a record for a missing file, marks it unavailable, and never invents or duplicates entries',async t=>{
  const f=await fixture(t),now=nowIso(),beatImage=await f.upload();
  f.database.connection.prepare(`INSERT INTO activity_beat_render_candidates(id,activity_id,stage_id,scene_id,beat_id,source_fingerprint,draft_version,status,positive_prompt,negative_prompt,created_at)
    VALUES ('candidate',?,'s1','sc1','b1','fp',1,'succeeded','p','',?)`).run(f.activityId,now);
  f.database.connection.prepare('INSERT INTO activity_beat_render_candidate_outputs(candidate_id,artifact_id,sort_order,created_at) VALUES (?,?,0,?)').run('candidate',beatImage.id,now);
  // The same artifact reached by a second source must still appear only once.
  f.database.connection.prepare(`INSERT INTO activity_beat_render_candidates(id,activity_id,stage_id,scene_id,beat_id,source_fingerprint,draft_version,status,positive_prompt,negative_prompt,created_at)
    VALUES ('candidate-2',?,'s1','sc1','b1','fp',1,'succeeded','p','',?)`).run(f.activityId,now);
  f.database.connection.prepare('INSERT INTO activity_beat_render_candidate_outputs(candidate_id,artifact_id,sort_order,created_at) VALUES (?,?,0,?)').run('candidate-2',beatImage.id,now);
  unlinkSync(resolveArtifactStoragePath(f.database,beatImage.id,f.config.artifactDirectory)!);
  const gallery=buildActivityGallery(f.database,f.activityId,f.config.artifactDirectory);
  assert.equal(gallery.items.length,1);assert.equal(gallery.items[0].available,false);assert.equal(gallery.counts.beat,1);
  assert.equal(resolveArtifactStoragePath(f.database,gallery.items[0].artifactId,f.config.artifactDirectory),null);
});
