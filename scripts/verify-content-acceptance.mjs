// Content-level acceptance after the real database recovery.
// Read-only: opens the live DB and reports per-module content, without writing.
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const dbPath=process.env.STHSTART_DATABASE_PATH||'data/sthstart.db';
const db=new DatabaseSync(dbPath,{readOnly:true});
const rows=(sql,params=[])=>{try{return db.prepare(sql).all(...params)}catch(e){return {error:String(e.message).slice(0,80)}}};
const one=(sql,params=[])=>{try{return db.prepare(sql).get(...params)}catch(e){return {error:String(e.message).slice(0,80)}}};

const report={database:dbPath,generatedAt:new Date().toISOString(),modules:{}};

// Integrity + schema
report.integrity=one('PRAGMA integrity_check')?.integrity_check;
report.foreignKeyViolations=rows('PRAGMA foreign_key_check').length;
report.migration=one('SELECT MAX(version) AS version FROM schema_migrations')?.version;

// Activities
report.modules.activities={
  count:one('SELECT COUNT(*) AS c FROM activities')?.c,
  withDrafts:one('SELECT COUNT(DISTINCT activity_id) AS c FROM activity_drafts')?.c,
  items:rows('SELECT title,created_at FROM activities ORDER BY created_at').map?.(r=>r)??[],
};

// Story
report.modules.story={
  projects:rows('SELECT title FROM story_projects ORDER BY created_at'),
  documentsByKind:rows('SELECT kind,COUNT(*) AS c FROM story_documents GROUP BY kind'),
  entryRevisions:one('SELECT COUNT(*) AS c FROM story_entry_revisions')?.c,
  characters:one('SELECT COUNT(*) AS c FROM story_characters')?.c,
  proposals:one('SELECT COUNT(*) AS c FROM story_proposals')?.c,
};

// Characters
report.modules.characters={
  profiles:one('SELECT COUNT(*) AS c FROM character_profiles')?.c,
  personas:one('SELECT COUNT(*) AS c FROM personas')?.c,
  works:one('SELECT COUNT(*) AS c FROM character_works')?.c,
  sources:one('SELECT COUNT(*) AS c FROM character_sources')?.c,
};

// Generation config
report.modules.generation={
  engines:rows('SELECT id,name,kind FROM generation_engines'),
  workflows:rows('SELECT id,latest_version FROM generation_workflows ORDER BY id'),
  workflowVersions:one('SELECT COUNT(*) AS c FROM generation_workflow_versions')?.c,
  presets:one('SELECT COUNT(*) AS c FROM generation_presets')?.c,
  assignments:rows('SELECT app_id,purpose,workflow_id,workflow_version FROM app_generation_assignments'),
};

// Services / models
report.modules.services={
  connections:rows('SELECT id,name,kind,base_url,enabled FROM service_connections ORDER BY id'),
  models:rows('SELECT id,connection_id,model_id,enabled FROM model_profiles ORDER BY id'),
  providerProfiles:rows('SELECT id,kind,model FROM provider_profiles ORDER BY id'),
  llmAssignments:rows('SELECT app_id,role,profile_id FROM app_llm_assignments ORDER BY app_id,role'),
};

// Artifacts / media
const art=one("SELECT COUNT(*) AS total,SUM(CASE WHEN file_status='missing' THEN 1 ELSE 0 END) AS missing FROM artifacts");
report.modules.artifacts={total:art?.total,missing:art?.missing,references:one('SELECT COUNT(*) AS c FROM artifact_references')?.c};

// AI call trace
report.modules.aiCalls={
  records:one('SELECT COUNT(*) AS c FROM ai_call_records')?.c,
  events:one('SELECT COUNT(*) AS c FROM ai_call_events')?.c,
  byStatus:rows('SELECT status,COUNT(*) AS c FROM ai_call_records GROUP BY status'),
};

// Publication chain
report.modules.publication={
  drafts:one('SELECT COUNT(*) AS c FROM publication_drafts')?.c,
  revisions:one('SELECT COUNT(*) AS c FROM publication_revisions')?.c,
  approvals:one('SELECT COUNT(*) AS c FROM publication_approvals')?.c,
  runs:one('SELECT COUNT(*) AS c FROM publication_runs')?.c,
  tasks:one('SELECT COUNT(*) AS c FROM publication_tasks')?.c,
  speechProfiles:one('SELECT COUNT(*) AS c FROM publication_speech_profiles')?.c,
};

// Comic chain
report.modules.comic={
  drafts:one('SELECT COUNT(*) AS c FROM activity_comic_drafts')?.c,
  revisions:one('SELECT COUNT(*) AS c FROM activity_comic_revisions')?.c,
  jobs:one('SELECT COUNT(*) AS c FROM activity_comic_jobs')?.c,
};

// Generation tasks
report.modules.generationTasks={
  tasks:one('SELECT COUNT(*) AS c FROM generation_tasks')?.c,
  byStatus:rows('SELECT status,COUNT(*) AS c FROM generation_tasks GROUP BY status'),
};

const out=resolve('artifacts/content-acceptance',new Date().toISOString().replaceAll(':','-'));
mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,'content-acceptance.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({out,integrity:report.integrity,fk:report.foreignKeyViolations,migration:report.migration,summary:Object.fromEntries(Object.entries(report.modules).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).filter(([,x])=>typeof x==='number'))]))},null,2));
db.close();
