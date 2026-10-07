/** Phase-six recovery UI proof, exclusively against the synthetic 4199/4289 fixture. */
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root='http://127.0.0.1:4289',headers={'x-sthstart-admin-token':'activity-studio-fixture-token-not-production'};
const fixture=await fetch(`${root}/fixture`).then(r=>r.json());
const sampleResponse=await fetch(`${root}/fixture/recovery-sample`,{method:'POST',headers});assert.equal(sampleResponse.status,200);
const sample=await sampleResponse.json(),jobUrl=`${root}/api/v1/admin/activities/${fixture.activityId}/studio-jobs/${sample.jobId}`;
const get=suffix=>fetch(`${jobUrl}${suffix}`,{headers}).then(r=>r.json());
assert.deepEqual(sample.items.map(item=>item.state),['succeeded','waiting']);
const output=resolve('artifacts/activity-studio-abc',`recovery-${new Date().toISOString().replaceAll(':','-')}`);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},extraHTTPHeaders:headers}),page=await context.newPage();
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/resume'))requests.push(r.postDataJSON());});
try{
  await page.goto(`http://127.0.0.1:4199/apps/activities/${fixture.activityId}?tab=studio&view=storyboard&panel=smart-create&studioJobId=${sample.jobId}`);
  const smart=page.getByRole('dialog',{name:'智能制作',exact:true});await smart.getByRole('button',{name:'恢复待提交项',exact:true}).waitFor({timeout:60000});
  await smart.getByRole('button',{name:'核对原任务状态',exact:true}).click();
  await smart.getByRole('button',{name:'恢复待提交项',exact:true}).click();
  const resume=page.getByRole('dialog',{name:'恢复安全的待提交项',exact:true});await resume.waitFor();
  const waiting=resume.getByRole('checkbox');assert.equal(await waiting.count(),1,'successful item cannot be selected for recovery');await waiting.check();
  await page.screenshot({path:resolve(output,'desktop-resume-confirmation.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await resume.getByRole('button',{name:'确认恢复',exact:true}).waitFor();assert.equal(await waiting.isChecked(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(output,'mobile-resume-confirmation.png'),fullPage:true});
  let simulated=false;
  await page.route('**/studio-jobs/*/resume',async route=>{
    if(!simulated){simulated=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'synthetic_unavailable',message:'模拟恢复请求失败；原任务仍保留。'})});}
    else await route.continue();
  });
  await resume.getByRole('button',{name:'确认恢复',exact:true}).click();await resume.getByRole('alert').waitFor();
  assert.equal(await waiting.isChecked(),true);assert.equal((await get('')).status,'paused');
  await page.screenshot({path:resolve(output,'mobile-resume-error-preserved.png'),fullPage:true});
  await resume.getByRole('button',{name:'确认恢复',exact:true}).click();
  for(let n=0;n<150;n++){if((await get('')).status==='succeeded')break;await new Promise(r=>setTimeout(r,200));}
  assert.equal((await get('')).status,'succeeded');const after=(await get('/items')).items;
  assert.equal(after[1].state,'succeeded');assert.deepEqual(after[0],sample.items[0],'prior successful result is immutable');
  assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.deepEqual(requests[1].itemIds,[sample.items[1].id]);
  const replay=await fetch(`${jobUrl}/resume`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(requests[1])});assert.equal(replay.status,202);
  assert.equal((await fetch(`${root}/fixture`).then(r=>r.json())).promptNumber,sample.promptNumber+1,'only one remaining image is submitted');
  await page.reload();await smart.getByText(/逐项进度 · 2 项完成 · 2 张可用图片/).waitFor({timeout:60000});
  assert.equal(await smart.getByRole('button',{name:'恢复待提交项',exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(output,'mobile-recovered-complete.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,output,activityId:fixture.activityId,jobId:sample.jobId,requests:2,newImages:1,syntheticOnly:true}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});console.log((await page.locator('body').innerText()).slice(-8000));throw error;}
finally{await browser.close();}
