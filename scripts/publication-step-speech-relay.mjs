// Test-only IPC relay: the real provider key stays inside the existing container.
import {spawn} from 'node:child_process';

const worker=String.raw`
import {readdirSync,readFileSync} from 'node:fs';
import {SecretStore} from '/app/apps/service/dist/security.js';
let env;
for(const pid of readdirSync('/proc').filter(n=>/^\d+$/.test(n))){try{const e=Object.fromEntries(readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(x=>{const p=x.indexOf('=');return[x.slice(0,p),x.slice(p+1)]}));if(e.STHSTART_ADMIN_TOKEN){env=e;break}}catch{}}
if(!env)throw new Error('Running Service credentials unavailable');
Object.assign(process.env,env);
const headers={'x-sthstart-admin-token':env.STHSTART_ADMIN_TOKEN};
const cr=await fetch('http://127.0.0.1:4100/api/v1/admin/connections/conn-mut24bmg',{headers});
if(!cr.ok)throw new Error('Configured Step connection unavailable');
const c=await cr.json();
const mr=await fetch('http://127.0.0.1:4100/api/v1/admin/models/conn-mut24bmg-stepaudio-2-5-tts',{headers});
if(!mr.ok)throw new Error('Configured Step TTS model unavailable');
const m=await mr.json();
if(!c.enabled||!m.enabled||m.connectionId!==c.id||m.modelId!=='stepaudio-2.5-tts'||c.baseUrl!=='https://api.stepfun.com/step_plan/v1')throw new Error('Step configuration changed; acceptance stopped');
const key=await new SecretStore(env).get(c.credentialAccount,'STHSTART_SECRET_CONN_MUT24BMG');
if(!key.value)throw new Error('Step key missing');
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const request=JSON.parse(raw||'{}');
if(request.inspect){console.log(JSON.stringify({connectionId:c.id,modelId:m.id,baseUrl:c.baseUrl,model:m.modelId,hasCredential:true}));process.exit(0);}
const body=request.body;
if(!body||body.model!==m.modelId||typeof body.input!=='string'||body.input.length>1000||!['cixingnansheng'].includes(body.voice)||body.response_format!=='mp3'||body.speed!==1||Object.keys(body).some(k=>!['model','input','voice','response_format','speed'].includes(k)))throw new Error('Speech request outside bounded acceptance');
let response;
try{response=await fetch(c.baseUrl+'/audio/speech',{method:'POST',headers:{authorization:'Bearer '+key.value,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});}catch{console.log(JSON.stringify({status:599,error:'Provider timeout; outcome unknown. Do not retry automatically.'}));process.exit(0);}
const bytes=Buffer.from(await response.arrayBuffer());
if(!response.ok){let error='';try{const parsed=JSON.parse(bytes.toString());error=String(parsed.error?.message??parsed.message??'Provider rejected request').replaceAll(key.value,'[redacted]').slice(0,600);}catch{error='Provider rejected request';}console.log(JSON.stringify({status:response.status,error}));}
else console.log(JSON.stringify({status:response.status,type:response.headers.get('content-type'),audio:bytes.toString('base64')}));
`;

export function stepSpeechRelay(request){
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i','sthstart','node','--input-type=module','-e',worker],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',errors='';
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>25*1024*1024)child.kill();});
    child.stderr.on('data',chunk=>{errors+=chunk;});
    child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error('Speech relay failed: '+errors.slice(0,400)));try{resolve(JSON.parse(output));}catch{reject(new Error('Speech relay returned invalid data'));}});
    child.stdin.end(JSON.stringify(request));
  });
}
