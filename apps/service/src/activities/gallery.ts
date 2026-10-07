import type {ServiceDatabase} from '../database.js';
import {resolveArtifactStoragePath} from '../artifacts.js';
import type {ActivityGallery,ActivityGalleryItem} from '@sthstart/contracts';

const MAX_ITEMS=400;

/** Read-only aggregate over native histories. Unavailable files stay visible as
 * records; nothing is re-generated, re-selected or re-linked here. */
export function buildActivityGallery(database:ServiceDatabase,activityId:string,artifactDirectory:string):ActivityGallery{
  const items:ActivityGalleryItem[]=[];
  const artwork=database.connection.prepare(`SELECT a.id,a.width,a.height,o.created_at FROM activity_beat_render_candidate_outputs o
    JOIN activity_beat_render_candidates c ON c.id=o.candidate_id JOIN artifacts a ON a.id=o.artifact_id
    WHERE c.activity_id=? ORDER BY o.created_at DESC`).all(activityId) as Array<Row>;
  for(const row of artwork)items.push(item(database,row,artifactDirectory,'beat','镜头绘制'));
  const comic=database.connection.prepare(`SELECT a.id,a.width,a.height,o.created_at FROM activity_comic_job_outputs o
    JOIN activity_comic_jobs j ON j.id=o.job_id JOIN artifacts a ON a.id=o.artifact_id
    WHERE j.activity_id=? AND j.kind='render' ORDER BY o.created_at DESC`).all(activityId) as Array<Row>;
  for(const row of comic)items.push(item(database,row,artifactDirectory,'comic','漫画画格'));
  const material=database.connection.prepare(`SELECT a.id,a.width,a.height,o.created_at FROM activity_image_attempt_outputs o
    JOIN activity_image_attempts t ON t.id=o.attempt_id JOIN artifacts a ON a.id=o.artifact_id
    WHERE t.activity_id=? ORDER BY o.created_at DESC`).all(activityId) as Array<Row>;
  for(const row of material)items.push(item(database,row,artifactDirectory,'material','素材绘制'));
  const uploads=database.connection.prepare(`SELECT a.id,a.width,a.height,aa.created_at FROM activity_assets aa
    JOIN artifacts a ON a.id=aa.artifact_id WHERE aa.activity_id=? AND aa.type='image' ORDER BY aa.created_at DESC`).all(activityId) as Array<Row>;
  for(const row of uploads)items.push(item(database,row,artifactDirectory,'upload','已有图片'));
  const seen=new Set<string>();
  const unique=items.filter(entry=>{if(seen.has(entry.artifactId))return false;seen.add(entry.artifactId);return true;})
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const counts={beat:0,comic:0,material:0,upload:0};
  for(const entry of unique)counts[entry.kind]+=1;
  return {items:unique.slice(0,MAX_ITEMS),counts,truncated:unique.length>MAX_ITEMS};
}

type Row={id:string;width:number|null;height:number|null;created_at:string};
function item(database:ServiceDatabase,row:Row,artifactDirectory:string,kind:ActivityGalleryItem['kind'],label:string):ActivityGalleryItem{
  const artifactId=String(row.id);
  // Availability reflects the real file, so a deleted file is never presented
  // as a usable picture even if its database row still says ready.
  return {artifactId,kind,label,available:Boolean(resolveArtifactStoragePath(database,artifactId,artifactDirectory)),
    width:row.width??null,height:row.height??null,createdAt:String(row.created_at),objectLabel:null};
}

/** The gallery never claims a missing file is present. */
export function galleryItemReadable(database:ServiceDatabase,artifactId:string,artifactDirectory:string):boolean{
  return Boolean(resolveArtifactStoragePath(database,artifactId,artifactDirectory));
}
