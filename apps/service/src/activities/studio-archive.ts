import {Type,type Static} from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import {ContentDocumentSchema,ComicDocumentSchema,ImageConfigDocumentSchema,type ContentDocument} from '@sthstart/contracts';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import type {ServiceDatabase} from '../database.js';
import {nowIso} from '../database.js';
import type {ServiceConfig} from '../config.js';
import {createArtifactReference,resolveArtifactStoragePath,streamUploadArtifact} from '../artifacts.js';
import {redactAiValue} from '../ai-call-trace.js';
import {validateComicDocument} from './comic-validation.js';
import {hashImageConfig} from './image-configs.js';
import type {ImageConfigDocument} from '@sthstart/contracts';
import type {ZipEntryInput} from './zip.js';

// This is a private on-disk format, not a second business API or execution path.
// Only these fixed tables/columns can ever be copied. Generation rows are evidence,
// never runnable queue entries in a different installation.
const tables=['activity_content_revisions','activity_drafts','activity_image_config_revisions','activity_image_config_drafts',
  'activity_comic_revisions','activity_comic_drafts','activity_comic_jobs',
  'activity_beat_render_candidates','activity_studio_jobs',
  'activity_beat_render_candidate_outputs','activity_comic_job_outputs','activity_studio_job_items'] as const;
type Table=typeof tables[number];
const scalar=Type.Union([Type.String(),Type.Number(),Type.Null()]);
const rowSchema=Type.Record(Type.String(),scalar);
const archiveSchema=Type.Object({schemaVersion:Type.Literal(1),sourceActivityId:Type.String({minLength:1}),
  rows:Type.Object(Object.fromEntries(tables.map(name=>[name,Type.Array(rowSchema)])),{additionalProperties:false}),
  artifacts:Type.Array(Type.Object({id:Type.String({minLength:1}),path:Type.Union([Type.String(),Type.Null()]),
    contentType:Type.String(),mediaType:Type.Union([Type.String(),Type.Null()]),sha256:Type.Union([Type.String(),Type.Null()])},{additionalProperties:false})),
  executions:Type.Record(Type.String(),Type.Unknown()),
  assets:Type.Optional(Type.Array(Type.Object({assetKey:Type.String({minLength:1}),artifactId:Type.String({minLength:1})},{additionalProperties:false}))),
},{additionalProperties:false});
type Archive=Static<typeof archiveSchema>;
type Row=Record<string,string|number|null>;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const filePath=(id:string)=>`assets/studio/${hash(id)}.bin`;
const error=(message:string)=>Object.assign(new Error(`invalid_studio_archive: ${message}`),{code:'invalid_studio_archive',statusCode:400});

function columns(database:ServiceDatabase,table:Table){
  return new Set(database.connection.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name)));
}

function artifactIds(value:unknown,key='',found=new Set<string>()):Set<string>{
  if(typeof value==='string'){
    if(key==='artifact_id'||key==='selected_artifact_id'||/ArtifactId$|^artifactId$/.test(key))found.add(value);
    const match=value.match(/^\/api\/(?:admin|v1)\/artifacts\/([^/?]+)\/file(?:\?.*)?$/);if(match)found.add(decodeURIComponent(match[1]));
    if(key.endsWith('_json'))try{artifactIds(JSON.parse(value),'',found);}catch{/* A prompt is not JSON. */}
  }else if(Array.isArray(value))for(const entry of value)artifactIds(entry,/artifactIds$/i.test(key)||key==='renderedImages'?'artifactId':key,found);
  else if(value&&typeof value==='object')for(const [field,entry]of Object.entries(value))artifactIds(entry,field,found);
  return found;
}

export function collectStudioArchive(database:ServiceDatabase,config:ServiceConfig,activityId:string):ZipEntryInput[]{
  const rows:Record<string,Row[]>={};
  for(const table of tables){
    if(table==='activity_studio_job_items')rows[table]=database.connection.prepare('SELECT i.* FROM activity_studio_job_items i JOIN activity_studio_jobs j ON j.id=i.job_id WHERE j.activity_id=?').all(activityId) as Row[];
    else if(table==='activity_beat_render_candidate_outputs')rows[table]=database.connection.prepare('SELECT o.* FROM activity_beat_render_candidate_outputs o JOIN activity_beat_render_candidates c ON c.id=o.candidate_id WHERE c.activity_id=?').all(activityId) as Row[];
    else if(table==='activity_comic_job_outputs')rows[table]=database.connection.prepare('SELECT o.* FROM activity_comic_job_outputs o JOIN activity_comic_jobs j ON j.id=o.job_id WHERE j.activity_id=?').all(activityId) as Row[];
    else rows[table]=database.connection.prepare(`SELECT * FROM ${table} WHERE activity_id=? ORDER BY ${table.endsWith('_revisions')?'created_at,id':'rowid'}`).all(activityId) as Row[];
  }
  const executions:Record<string,unknown>={};
  for(const list of Object.values(rows))for(const row of list)for(const key of ['input_json','result_json']){
    if(typeof row[key]==='string')row[key]=JSON.stringify(redactAiValue(JSON.parse(row[key])));
  }
  const materialRows=database.connection.prepare('SELECT id,task_id FROM activity_image_attempts WHERE activity_id=?').all(activityId);
  const records=[...rows.activity_studio_job_items,...rows.activity_comic_jobs,...rows.activity_beat_render_candidates,...materialRows];
  for(const item of records){
    const taskId=item.generation_task_id??item.task_id;
    const task=taskId?database.connection.prepare('SELECT id,status,provider_task_id,actual_seed,purpose,engine_id,workflow_id,workflow_version,workflow_snapshot_json,request_params_json FROM generation_tasks WHERE id=? AND app_id=?').get(String(taskId),'activities'):null;
    const query='SELECT id,parent_id,trace_id,models_json,positive_prompt,negative_prompt,parameters_json,request_snapshot_json,response_text,usage_json,status,requested_at FROM ai_call_records WHERE application_id=? AND ';
    const call=item.call_id?database.connection.prepare(query+'id=?').get('activities',String(item.call_id)):taskId?database.connection.prepare(query+'generation_task_id=?').get('activities',String(taskId)):null;
    const evidence=(row:Record<string,unknown>|null|undefined)=>row?Object.fromEntries(Object.entries(row).map(([key,value])=>{
      if(key.endsWith('_json')&&typeof value==='string')return [key,JSON.parse(value)];return [key,value];
    })):null;
    executions[String(item.id)]=redactAiValue({generation:evidence(task),call:evidence(call)});
  }
  const assets=database.connection.prepare('SELECT asset_key,artifact_id FROM activity_assets WHERE activity_id=?').all(activityId)
    .filter(row=>row.artifact_id!=null).map(row=>({assetKey:String(row.asset_key),artifactId:String(row.artifact_id)}));
  const found=artifactIds(rows),entries:ZipEntryInput[]=[],artifacts:Archive['artifacts']=[];
  assets.forEach(asset=>found.add(asset.artifactId));
  for(const id of found){
    const row=database.connection.prepare('SELECT content_type,media_type,sha256 FROM artifacts WHERE id=? AND app_id=?').get(id,'activities');
    const path=row?resolveArtifactStoragePath(database,id,config.artifactDirectory):null;
    artifacts.push({id,path:path?filePath(id):null,contentType:String(row?.content_type??'image/png'),mediaType:row?.media_type?String(row.media_type):null,sha256:row?.sha256?String(row.sha256):null});
    if(path)entries.push({path:filePath(id),filePath:path});
  }
  const archive={schemaVersion:1,sourceActivityId:activityId,rows,artifacts,executions,assets};
  // Do not redact creative text here. Only actual provider evidence passes through
  // the audit sanitizer; the archive never contains service profiles or credentials.
  entries.push({path:'data/studio-archive.json',data:JSON.stringify(archive)});
  return entries;
}

export function readStudioArchive(database:ServiceDatabase,files:Map<string,Buffer>):Archive|null{
  const bytes=files.get('data/studio-archive.json');if(!bytes)return null;
  let archive:unknown;try{archive=JSON.parse(bytes.toString());}catch{throw error('归档 JSON 无法解析。');}
  if(!Value.Check(archiveSchema,archive))throw error('不支持的归档结构。');
  // A project archive is untrusted input, even if it resembles our own export.
  // Apply audit redaction again before storing execution evidence or returning history.
  archive.executions=redactAiValue(archive.executions) as Record<string,unknown>;
  const ids=new Set<string>();
  for(const table of tables)for(const row of archive.rows[table]){
    const allowed=columns(database,table);
    if(Object.keys(row).some(key=>!allowed.has(key)))throw error(`未知列 ${table}。`);
    for(const column of database.connection.prepare(`PRAGMA table_info(${table})`).all()){
      const key=String(column.name),value=row[key];
      if((column.notnull||column.pk)&&column.dflt_value==null&&(value==null||(column.pk&&value==='')))throw error(`缺少必需列 ${table}.${key}。`);
      if(value!=null&&((column.type==='TEXT'&&typeof value!=='string')||(column.type==='INTEGER'&&!Number.isInteger(value))))throw error(`列类型不合法 ${table}.${key}。`);
      if(key.endsWith('_json')&&typeof value==='string')try{JSON.parse(value);}catch{throw error(`非法 JSON ${table}.${key}。`);}
    }
    for(const key of ['input_json','result_json'])if(typeof row[key]==='string')row[key]=JSON.stringify(redactAiValue(JSON.parse(row[key])));
    if('activity_id' in row&&row.activity_id!==archive.sourceActivityId)throw error('归档混入其他活动的数据。');
    if(typeof row.id==='string'){if(ids.has(row.id))throw error('重复对象 ID。');ids.add(row.id);}
    if(typeof row.document_json==='string'){
      const doc=JSON.parse(row.document_json);
      if((table==='activity_content_revisions'||table==='activity_drafts')&&!Value.Check(ContentDocumentSchema,doc))throw error('非法内容快照。');
      if(table.startsWith('activity_comic_')&&!Value.Check(ComicDocumentSchema,doc))throw error('非法漫画快照。');
      if(table.startsWith('activity_image_config_')&&!Value.Check(ImageConfigDocumentSchema,doc))throw error('非法美术配置快照。');
    }
  }
  const jobs=new Set(archive.rows.activity_studio_jobs.map(row=>row.id)),comics=new Set(archive.rows.activity_comic_jobs.map(row=>row.id)),beats=new Set(archive.rows.activity_beat_render_candidates.map(row=>row.id));
  if(archive.rows.activity_studio_job_items.some(row=>!jobs.has(row.job_id))||archive.rows.activity_comic_job_outputs.some(row=>!comics.has(row.job_id))||archive.rows.activity_beat_render_candidate_outputs.some(row=>!beats.has(row.candidate_id)))throw error('历史条目不属于归档中的任务。');
  const sources=new Map(archive.rows.activity_content_revisions.map(row=>[row.id,JSON.parse(String(row.document_json)) as ContentDocument]));
  const configs=new Set(archive.rows.activity_image_config_revisions.map(row=>row.id)),comicRevisions=new Set(archive.rows.activity_comic_revisions.map(row=>row.id)),items=new Set(archive.rows.activity_studio_job_items.map(row=>row.id));
  const belongs=(rows:Row[],key:string,owned:ReadonlySet<unknown>)=>{if(rows.some(row=>row[key]!=null&&!owned.has(row[key])))throw error(`跨归档引用 ${key}。`);};
  belongs(archive.rows.activity_content_revisions,'parent_id',new Set(sources.keys()));
  belongs(archive.rows.activity_drafts,'base_content_revision_id',new Set(sources.keys()));
  belongs(archive.rows.activity_image_config_revisions,'parent_id',configs);
  belongs(archive.rows.activity_image_config_drafts,'base_revision_id',configs);
  belongs(archive.rows.activity_comic_drafts,'base_revision_id',comicRevisions);
  belongs(archive.rows.activity_studio_jobs,'parent_job_id',jobs);
  belongs(archive.rows.activity_studio_job_items,'retry_of_item_id',items);
  for(const row of [...archive.rows.activity_comic_drafts,...archive.rows.activity_comic_revisions]){
    const doc=JSON.parse(String(row.document_json)),source=sources.get(doc.contentRevisionId);
    if(!source)throw error('漫画引用了归档以外的剧情版本。');
    try{validateComicDocument(doc,source);}catch(issue){throw error(String((issue as Error).message));}
  }
  const artifactSet=new Set<string>();
  for(const artifact of archive.artifacts){
    if(artifactSet.has(artifact.id))throw error('重复图片引用。');artifactSet.add(artifact.id);
    if(artifact.path!==null&&(artifact.path!==filePath(artifact.id)||!files.has(artifact.path)))throw error('图片路径或文件缺失。');
  }
  if([...artifactIds(archive.rows)].some(id=>!artifactSet.has(id)))throw error('缺少图片引用清单。');
  const assetKeys=new Set<string>();
  for(const asset of archive.assets??[]){if(assetKeys.has(asset.assetKey)||!artifactSet.has(asset.artifactId))throw error('素材别名重复或引用缺失。');assetKeys.add(asset.assetKey);}
  return archive;
}

/** Uploads only zip-owned bytes. Missing old files become explicit unavailable
 * descriptors; no remote download or arbitrary server path is accepted. */
export async function uploadStudioArchiveArtifacts(database:ServiceDatabase,config:ServiceConfig,files:Map<string,Buffer>,archive:Archive,reused:ReadonlyMap<string,string>=new Map()){
  const mapped=new Map<string,string>();
  for(const item of archive.artifacts){
    if(item.path){
      const bytes=files.get(item.path)!;
      const checksum=createHash('sha256').update(bytes).digest('hex');if(item.sha256&&checksum!==item.sha256)throw error('图片内容哈希不一致。');
      const existing=reused.get(item.id);
      if(existing){const row=database.connection.prepare('SELECT sha256 FROM artifacts WHERE id=? AND app_id=?').get(existing,'activities');if(row?.sha256!==checksum)throw error('素材别名与图片内容不一致。');mapped.set(item.id,existing);continue;}
      const uploaded=await streamUploadArtifact(config,database,{stream:Readable.from(bytes),contentType:item.contentType,contentLength:bytes.length,originalName:'archive-image',appId:'activities'});mapped.set(item.id,uploaded.id);
    }else{
      const id=randomUUID(),now=nowIso();
      database.connection.prepare("INSERT INTO artifacts(id,app_id,content_type,byte_size,created_at,updated_at,media_type,file_status,sha256) VALUES (?,'activities',?,0,?,?,?,'missing',?)")
        .run(id,item.contentType,now,now,item.mediaType??'image',item.sha256);mapped.set(item.id,id);
    }
  }
  return mapped;
}

// Only identity-bearing fields are rewritten. A title/action/prompt that happens
// to equal an old ID is still creative text, not an identity reference.
const identityKeys=new Set(['id','activityId','stageId','sceneId','beatId','slotId','characterId','primaryActorId','panelId','speakerActorId','contentRevisionId','sourceContentRevisionId','baseContentRevisionId','imageConfigRevisionId','baseRevisionId','revisionId','traceId','retryOfItemId','jobId','renderJobId','parentJobId','childJobId','fallbackOf','rootJobId','fallbackRootJobId','candidateId','nativeId','nativeJobId','artifactId','selectedArtifactId','previewArtifactId','ownerRevisionId','targetId','entityId','replyToMessageId','replyToCommentId','actorId','fromActorId','toActorId','conversationId','authorActorId','postId']);
const identityArrays=new Set(['actorIds','beatIds','panelIds','pageIds','sourceBeatIds','artifactIds','renderedImages','unavailableArtifactIds','memberActorIds','mediaSlotIds','sourceFactIds','knownByActorIds','sourceRecordIds','factIds','lockedMediaSlotIds','birthdayActorIds']);
export function remapStudioArchiveValue(value:unknown,ids:Map<string,string>,key=''):unknown{
  if(typeof value==='string'){
    if(identityKeys.has(key)||identityArrays.has(key)||/ArtifactId$/.test(key))return ids.get(value)??value;
    if(['mediaUrl','media_url'].includes(key))return value.replace(/^(\/api\/(?:admin|v1)\/artifacts\/)([^/?]+)(\/file.*)$/,(_all,prefix,id,suffix)=>`${prefix}${ids.get(decodeURIComponent(id))??id}${suffix}`);
    return value;
  }
  if(Array.isArray(value))return value.map(entry=>remapStudioArchiveValue(entry,ids,key));
  if(key==='actorMappings'&&value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([role,entries])=>[role,remapStudioArchiveValue(entries,ids,'actorIds')]));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,entry])=>[field,remapStudioArchiveValue(entry,ids,field)]));
  return value;
}

export function allocateStudioArchiveIds(archive:Archive,ids:Map<string,string>){
  const allocate=(id:unknown)=>{if(typeof id==='string'&&!ids.has(id))ids.set(id,randomUUID());};
  const entityArrays=new Set(['actors','stages','conversations','messages','posts','comments','mediaSlots','facts','pages','panels','scenes','beats','bubbles','requiredBeats']);
  const walk=(value:unknown)=>{if(!value||typeof value!=='object')return;
    for(const [key,entry]of Object.entries(value)){if(entityArrays.has(key)&&Array.isArray(entry))for(const entity of entry){allocate(entity.id);walk(entity);}}
  };
  for(const table of tables)for(const row of archive.rows[table]){
    allocate(row.id);allocate(row.trace_id);
    if(typeof row.document_json!=='string')continue;
    const doc=JSON.parse(row.document_json);
    walk(doc);
  }
}

/** Caller owns the import transaction. Never inserts generation tasks, native
 * active states, automatic selection or model calls. */
export function importStudioArchive(database:ServiceDatabase,archive:Archive,ids:Map<string,string>,selectedContentRevisionId:string|null){
  const activityId=ids.get(archive.sourceActivityId)!;
  for(const table of tables)for(const original of archive.rows[table]){
    if(table==='activity_content_revisions'&&original.id===selectedContentRevisionId){
      database.connection.prepare('UPDATE activity_content_revisions SET parent_id=? WHERE id=? AND activity_id=?')
        .run(original.parent_id?ids.get(String(original.parent_id))??null:null,ids.get(String(original.id))!,activityId);
      const mapped=remapStudioArchiveValue(JSON.parse(String(original.document_json)),ids);
      for(const artifactId of artifactIds(mapped))createArtifactReference(database,{artifactId,appId:'activities',refType:'activity_studio_archive',refId:`studio-archive:${activityId}:${table}:${ids.get(String(original.id))}`});
      continue;
    }
    const row:Row={...original};
    for(const [key,value]of Object.entries(row)){
      if(typeof value==='string'&&key.endsWith('_json')){
        const parsed=JSON.parse(value);row[key]=JSON.stringify(remapStudioArchiveValue(parsed,ids));
      }else if(typeof value==='string'&&(key==='id'||key.endsWith('_id')))row[key]=ids.get(value)??value;
    }
    if('activity_id'in row)row.activity_id=activityId;
    if(row.document_json){const json=String(row.document_json);if('hash'in row)row.hash=table==='activity_image_config_revisions'?hashImageConfig(JSON.parse(json) as ImageConfigDocument):hash(json);if('document_hash'in row)row.document_hash=hash(json);}
    if(table==='activity_studio_jobs'||table==='activity_comic_jobs'){
      const input=JSON.parse(String(row.input_json));row.input_json=JSON.stringify({...input,readOnly:true,importedFrom:{activityId:archive.sourceActivityId,jobId:original.id,status:original.status},
        ...(table==='activity_comic_jobs'?{importedExecution:remapStudioArchiveValue(archive.executions[String(original.id)]??null,ids)}:{})});
      row.idempotency_key=`import:${row.id}`;row.call_id=null;
      if(table==='activity_studio_jobs'){row.lease_owner=null;row.lease_expires_at=null;row.stop_requested=1;}
      else row.generation_task_id=null;
      if(['queued','preparing','running','paused','unknown'].includes(String(row.status))){row.status='interrupted';row.error_code='studio_imported_read_only';row.error_message='导入的历史任务只读，未恢复或提交请求。';}
    }
    if(table==='activity_studio_job_items'){
      row.generation_task_id=null;row.call_id=null;row.submission_key=`import:${row.id}`;
      const input=JSON.parse(String(row.input_json));row.input_json=JSON.stringify({...input,readOnly:true,importedExecution:remapStudioArchiveValue(archive.executions[String(original.id)]??null,ids)});
      if(['waiting','preparing','submitted','unknown'].includes(String(row.state)))row.state='interrupted';
      if(row.placement_state==='pending'){row.placement_state='ineligible';row.placement_reason='导入历史不自动入图';}
      if(row.result_json){
        const result=JSON.parse(String(row.result_json));
        const unavailable=(result.artifactIds??[]).filter((id:string)=>database.connection.prepare('SELECT file_status FROM artifacts WHERE id=?').get(id)?.file_status!=='ready');
        result.unavailableArtifactIds=unavailable;row.result_json=JSON.stringify(result);
        if(unavailable.length&&(result.artifactIds??[]).length===unavailable.length){row.state='failed';row.error_code='studio_artifact_unavailable';row.error_message='历史图片文件不可用，原始记录仍保留。';}
      }
    }
    if(table==='activity_beat_render_candidates'){
      row.task_id=null;row.call_id=null;row.idempotency_key=`import:${row.id}`;row.auto_apply_state='ineligible';row.auto_apply_reason='导入历史，不自动写回';
      if(['preparing','queued','running'].includes(String(row.status)))row.status='failed';
      row.media_url=remapStudioArchiveValue(row.media_url,ids,'media_url') as string|null;
    }
    if(table==='activity_image_config_revisions'){
      if(database.connection.prepare('UPDATE activity_image_config_revisions SET document_json=?,hash=? WHERE id=? AND activity_id=?').run(row.document_json,row.hash,row.id,activityId).changes!==1)throw error('冻结图像配置不在工程来源记录中。');
    }else{
      const keys=Object.keys(row),replace=['activity_drafts','activity_image_config_drafts'].includes(table);
      database.connection.prepare(`INSERT ${replace?'OR REPLACE ':''}INTO ${table} (${keys.map(key=>`"${key}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));
    }
    for(const artifactId of artifactIds(row))createArtifactReference(database,{artifactId,appId:'activities',refType:'activity_studio_archive',refId:`studio-archive:${activityId}:${table}:${row.id??activityId}`});
  }
}
