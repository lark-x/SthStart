import {chromium} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const service='http://127.0.0.1:4287',portal='http://127.0.0.1:4197';
const headers={'x-sthstart-admin-token':'publication-isolated-admin-token-12345678'};
const fixture=await fetch(service+'/fixture').then(r=>r.json());assert.equal(fixture.isolated,true);
const output=fixture.outputDirectory,id=fixture.activityId;
async function api(path,body){const r=await fetch(service+path,{method:body?'POST':'GET',headers:{...headers,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const b=await r.json();assert.ok(r.ok,b.message??JSON.stringify(b));return b;}
const before=await api(`/api/v1/admin/activities/${id}/publication`);
const selectedBefore=before.document.shots.map(s=>s.selectedImage.artifactId);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},extraHTTPHeaders:headers});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
let report={fixture,errors,passed:false};
try{
  await page.goto(`${portal}/apps/activities/${id}`);
  await page.getByRole('button',{name:'配置配音服务',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'在线配音配置',exact:true});await dialog.waitFor();
  await dialog.getByLabel('从已配置的语音模型选择').selectOption(fixture.metadata.modelId);
  assert.equal(await dialog.getByLabel('默认声音 ID').inputValue(),'cixingnansheng');
  assert.equal(await dialog.getByLabel('语音模型 ID').inputValue(),'stepaudio-2.5-tts');
  assert.equal(await dialog.getByLabel('密钥环境变量名').count(),0);
  await page.screenshot({path:join(output,'desktop-configured-speech.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'mobile-configured-speech.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await dialog.getByRole('button',{name:'保存配音配置',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('checkbox',{name:'漫画图片＋配音视频',exact:true}).check();
  await page.getByRole('button',{name:'核对方案与额度',exact:true}).click();
  const approval=page.getByRole('dialog',{name:'确认本轮制作',exact:true});await approval.waitFor();
  await approval.getByRole('button',{name:'确认并开始制作',exact:true}).click();await approval.waitFor({state:'hidden',timeout:30000});
  const deadline=Date.now()+15*60*1000;let state,previous='';
  while(Date.now()<deadline){
    state=(await api(`/api/v1/admin/activities/${id}/publication/runs`)).items[0];
    const summary=`${state.status}: ${state.tasks.map(t=>t.kind+'='+t.status).join(',')}`;
    if(summary!==previous){console.log(summary);previous=summary;}
    if(!['queued','running'].includes(state.status))break;
    await new Promise(r=>setTimeout(r,3000));
  }
  report.run=state;report.requests=await fetch(service+'/fixture/speech-requests').then(r=>r.json());
  assert.equal(state.status,'succeeded',state.tasks.find(t=>t.error)?.error??state.status);
  assert.equal(state.imagesUsed,0);assert.equal(state.tasks.filter(t=>t.kind==='speech').length,6);
  assert.equal(report.requests.length,6);assert.ok(report.requests.every(r=>r.status===200));
  const after=await api(`/api/v1/admin/activities/${id}/publication`);
  assert.deepEqual(after.document.shots.map(s=>s.selectedImage.artifactId),selectedBefore);
  assert.ok(after.document.shots.every(s=>s.utterances.every(u=>u.selectedAudioArtifactId)));
  const assets=state.tasks.find(t=>t.kind==='export').artifactIds;
  for(const [index,name] of ['publication.zip','cover.png','video.mp4'].entries()){
    const response=await fetch(service+`/api/v1/admin/artifacts/${assets[index]}/file`,{headers});assert.equal(response.status,200);
    await writeFile(join(output,name),Buffer.from(await response.arrayBuffer()));
  }
  const firstAudio=after.document.shots[0].utterances[0].selectedAudioArtifactId;
  const audio=await fetch(service+`/api/v1/admin/artifacts/${firstAudio}/file`,{headers});
  await writeFile(join(output,'speech-first.mp3'),Buffer.from(await audio.arrayBuffer()));
  await page.reload();await page.getByRole('button',{name:/画面与配音/}).click();
  await page.locator('audio').first().waitFor();await page.screenshot({path:join(output,'desktop-real-speech.png')});
  await page.getByRole('button',{name:/预览与导出/}).click();await page.locator('video').first().waitFor();
  await page.locator('video').first().evaluate(async v=>{v.muted=true;await v.play();});
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.5);
  await page.locator('video').first().evaluate(v=>v.pause());
  await page.screenshot({path:join(output,'desktop-real-video.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'mobile-real-video.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:join(output,'large-real-video.png')});
  assert.deepEqual(errors,[]);report.passed=true;report.audioArtifacts=after.document.shots.map(s=>s.utterances[0].selectedAudioArtifactId);
}catch(error){report.error=error.message;await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});process.exitCode=1;console.error(error.message);}
finally{await writeFile(join(output,'speech-report.json'),JSON.stringify(report,null,2));await browser.close();console.log('Report: '+join(output,'speech-report.json'));}
