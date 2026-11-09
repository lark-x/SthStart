/** Read-only SQLite/filesystem inventory. Never starts migrations or changes records. */
import { DatabaseSync } from "node:sqlite";
import { statSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
const [databasePath, artifactRoot, output] = process.argv.slice(2);
if (!databasePath || !artifactRoot || !output) throw new Error("Usage: node scripts/audit-content-availability.mjs <database> <artifact-root> <output-json>");
const db = new DatabaseSync(databasePath, {readOnly:true});
const quote = value => String.fromCharCode(34) + value.replaceAll(String.fromCharCode(34), String.fromCharCode(34).repeat(2)) + String.fromCharCode(34);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ?").all("table", "sqlite_%").map(row=>row.name);
const columns = new Map(tables.map(table=>[table,db.prepare("PRAGMA table_info("+quote(table)+")").all().map(row=>row.name)]));
const fileExists = path => {try{return !!path && statSync(path).isFile();}catch{return false;}};
const safeCandidate = key => { if (!key || isAbsolute(key)) return null; const candidate=resolve(artifactRoot,key); const rel=relative(resolve(artifactRoot),candidate); return rel.startsWith("..")||isAbsolute(rel)?null:candidate; };
const resolveStored = row => {
 if(fileExists(row.local_path)) return {path:row.local_path,method:"stored-path"};
 const normalized=(row.local_path||"").replaceAll(String.fromCharCode(92),"/");
 const marker="/data/artifacts/"; const index=normalized.toLowerCase().lastIndexOf(marker);
 const key=row.storage_key||(index>=0?normalized.slice(index+marker.length):null);
 const candidate=safeCandidate(key);
 return {path:candidate,method:fileExists(candidate)?"portable-path":"missing"};
};
const referenceColumns=[];
for(const [table,cols] of columns) for(const col of cols) if(col==="artifact_id"||col.endsWith("_artifact_id")) referenceColumns.push({table,col});
const artifacts = columns.has("artifacts")?db.prepare("SELECT id,app_id,local_path,storage_key,file_status,byte_size,sha256,content_type,created_at,provider_url FROM artifacts").all().map(row=>{
 const resolved=resolveStored(row);
 const refs=referenceColumns.flatMap(({table,col})=>{const count=db.prepare("SELECT COUNT(*) AS count FROM "+quote(table)+" WHERE "+quote(col)+"=?").get(row.id).count; return count?[{table,column:col,count}]:[];});
 return {id:row.id,appId:row.app_id,storedPath:row.local_path,storageKey:row.storage_key,resolvedPath:resolved.path,availability:resolved.method,storedStatus:row.file_status,byteSize:row.byte_size,sha256:row.sha256,contentType:row.content_type,createdAt:row.created_at,hasRemoteSource:!!row.provider_url,directReferences:refs};
}):[];
const otherFiles=[];
for(const [table,cols] of columns){
 if(table==="artifacts"||!cols.includes("local_path")) continue;
 const selected=[...new Set([...(cols.includes("id")?["id"]:[]),"local_path",...(cols.includes("note_id")?["note_id"]:[])])];
 for(const row of db.prepare("SELECT "+selected.map(quote).join(",")+" FROM "+quote(table)).all()) otherFiles.push({table,...row,available:fileExists(row.local_path)});
}
const taskStates={};
for(const table of ["generation_tasks","activity_jobs","image_tasks"]){const cols=columns.get(table);if(cols?.includes("status")) taskStates[table]=db.prepare("SELECT status,COUNT(*) AS count FROM "+quote(table)+" GROUP BY status").all();}
const countBy=key=>Object.fromEntries([...new Set(artifacts.map(row=>row[key]))].map(value=>[value,artifacts.filter(row=>row[key]===value).length]));
const result={generatedAt:new Date().toISOString(),databasePath,artifactRoot,readOnly:true,integrity:db.prepare("PRAGMA quick_check").all(),summary:{artifacts:artifacts.length,availability:countBy("availability"),storedStatus:countBy("storedStatus"),missingWithDirectReferences:artifacts.filter(row=>row.availability==="missing"&&row.directReferences.length).length,otherFiles:otherFiles.length,otherMissing:otherFiles.filter(row=>!row.available).length},taskStates,artifacts,otherFiles,limitations:["Direct references exclude embedded JSON references; zero is not permission to delete.","Remote sources are counted but not requested; signed URLs and credentials are not exported.","No rows, status fields, or paths are repaired by this script."]};
db.close();writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({summary:result.summary,taskStates,integrity:result.integrity},null,2));
