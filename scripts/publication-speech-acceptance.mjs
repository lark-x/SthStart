// Resume ONLY the isolated real-image fixture; provider key never leaves Docker.
import {join,resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {ServiceDatabase} from '../apps/service/src/database.ts';
import {PublicationStore} from '../apps/service/src/publication/store.ts';
import {createService} from '../apps/service/src/server.ts';
import {readConfig} from '../apps/service/src/config.ts';
import {SecretStore} from '../apps/service/src/security.ts';
import {stepSpeechRelay} from './publication-step-speech-relay.mjs';
if(!process.argv.includes('--confirm-real-speech'))throw new Error('Explicit --confirm-real-speech required: at most six utterances, no automatic retry.');
const directory=resolve('artifacts/story-publication-live/2026-10-04T00-01-48.424Z');
const outputDirectory=join(directory,'speech-checks',new Date().toISOString().replaceAll(':','-'));
await mkdir(outputDirectory,{recursive:true});
const metadata=await stepSpeechRelay({inspect:true});
const db=new ServiceDatabase(join(directory,'acceptance.db'));
const store=new PublicationStore(db,join(directory,'media'));
const activityId='7bc1eb3e-3ecf-4c83-bd64-1759e421b691';
const draft=store.requireDraft(activityId);
if(draft.document.shots.length!==6||draft.document.shots.some(s=>!s.selectedImage))throw new Error('Six saved images required; no redraw in this speech acceptance.');
const time=new Date().toISOString();
db.connection.prepare(`INSERT OR IGNORE INTO service_connections(id,name,kind,base_url,credential_account,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)`).run(metadata.connectionId,'stepaudio-3-tts','openai-compatible-text',metadata.baseUrl,'acceptance-docker-speech',time,time);
db.connection.prepare(`INSERT OR IGNORE INTO model_profiles(id,connection_id,name,model_id,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)`).run(metadata.modelId,metadata.connectionId,'stepaudio-3-tts - stepaudio-2.5-tts',metadata.model,'["text"]',time,time);
class RelaySecrets extends SecretStore {
  async get(account,env){if(account==='acceptance-docker-speech')return {value:'delegated-test-auth',source:'environment'};return super.get(account,env);}
}
const requests=[];
const fetcher=async(input,init)=>{
  const url=String(input);
  if(url.startsWith('http://127.0.0.1:8188/')){if(url.endsWith('/prompt'))throw new Error('Additional image submissions forbidden in speech acceptance');return fetch(input,init);}
  if(url!==metadata.baseUrl+'/audio/speech')throw new Error('Unapproved network destination in speech acceptance');
  const body=JSON.parse(String(init?.body));
  if(requests.length>=6)throw new Error('Bounded six-speech-call acceptance limit reached');
  const item={model:body.model,voice:body.voice,characters:body.input.length};requests.push(item);
  const r=await stepSpeechRelay({body});item.status=r.status;
  if(r.status===599)throw new Error('Provider outcome unknown; no automatic retry');
  if(r.status>=400)return Response.json({error:r.error},{status:r.status});
  return new Response(Buffer.from(r.audio,'base64'),{status:r.status,headers:{'content-type':r.type??'audio/mpeg'}});
};
const config={...readConfig({SERVICE_PORT:'4287',STHSTART_ADMIN_TOKEN:'publication-isolated-admin-token-12345678',STHSTART_ARTIFACT_DIR:join(directory,'media'),STHSTART_LOG_DIR:join(outputDirectory,'logs'),PORTAL_ORIGINS:'http://127.0.0.1:4197'}),databasePath:join(directory,'acceptance.db'),narrativeDatabasePath:join(directory,'narrative.db')};
const {app}=await createService({config,database:db,secrets:new RelaySecrets({}),fetcher});
app.get('/fixture',async()=>({isolated:true,realImageProvider:true,makeVideo:true,outputDirectory,activityId,projectId:draft.document.source.storyProjectId,metadata}));
app.get('/fixture/speech-requests',async()=>requests);
await app.listen({host:'127.0.0.1',port:4287});
console.log(JSON.stringify({isolated:true,outputDirectory,activityId,model:metadata.model}));
let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();db.close();process.exit(0)};
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
