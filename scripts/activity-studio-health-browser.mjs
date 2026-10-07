// Read-only diagnostic UI and failure recovery against our isolated synthetic service.
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root='http://127.0.0.1:4289',headers={'x-sthstart-admin-token':'activity-studio-fixture-token-not-production'};
const fixture=await fetch(`${root}/fixture`).then(r=>r.json());
const sampleResponse=await fetch(`${root}/fixture/recovery-sample`,{method:'POST',headers});assert.equal(sampleResponse.status,200);
const sample=await sampleResponse.json(),output=resolve('artifacts/activity-studio-abc',`health-${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},extraHTTPHeaders:headers}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(`http://127.0.0.1:4199/apps/activities/${fixture.activityId}?tab=studio&view=storyboard&panel=smart-create&studioJobId=${sample.jobId}`);
  const smart=page.getByRole('dialog',{name:'智能制作',exact:true});await smart.getByRole('button',{name:'检查生成环境',exact:true}).waitFor({timeout:60000});
  await smart.getByRole('button',{name:'检查生成环境',exact:true}).click();
  const health=page.getByRole('dialog',{name:'生成环境检查',exact:true});await health.waitFor();
  await health.getByRole('button',{name:'重新检查',exact:true}).click();await health.getByText('已保存的生成配置可用',{exact:true}).waitFor();
  for(const title of ['提示词优化模型','生成实例连接','工作流与输入输出','模型与参考文件','生成队列'])assert.equal(await health.getByText(title,{exact:true}).count(),1);
  assert.equal(await health.getByRole('listitem').count(),5);assert.equal(await health.getByLabel('检查目标').locator('option').count(),2);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'desktop-health-layers.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await health.getByRole('button',{name:'重新检查',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(output,'mobile-health-layers.png'),fullPage:true});
  let response;
  await page.route('**/studio-jobs/health',async route=>{
    const res=await route.fetch(),body=await res.json();response=body;
    body.canSubmit=false;const files=body.layers.find(layer=>layer.kind==='files');files.status='error';files.summary='模型与参考文件有缺项';files.issues=['模型缺失：loras / missing-lora.safetensors'];
    await route.fulfill({response:res,json:body});
  });
  await health.getByRole('button',{name:'重新检查',exact:true}).click();await health.getByText('模型缺失：loras / missing-lora.safetensors',{exact:true}).waitFor();
  assert.equal(await health.getByRole('link',{name:'打开相关配置（新标签页）',exact:true}).getAttribute('href'),'/settings/generation');
  assert.equal(await health.getByText('已保存的生成配置可用',{exact:true}).count(),0);
  await page.screenshot({path:resolve(output,'mobile-health-exact-missing-file.png'),fullPage:true});
  await page.unroute('**/studio-jobs/health');
  await page.route('**/studio-jobs/health',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'synthetic_unavailable',message:'模拟检查暂不可用，请稍后重试。'})}));
  await health.getByRole('button',{name:'重新检查',exact:true}).click();await health.getByRole('alert').waitFor();assert.equal(await health.getByText('已保存的生成配置可用',{exact:true}).count(),0);
  await page.unroute('**/studio-jobs/health');await health.getByRole('button',{name:'重新检查',exact:true}).click();await health.getByText('已保存的生成配置可用',{exact:true}).waitFor();
  await health.getByRole('button',{name:'关闭',exact:true}).click();await smart.getByRole('button',{name:'恢复待提交项',exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.equal((await fetch(`${root}/fixture`).then(r=>r.json())).promptNumber,sample.promptNumber,'diagnostics never draw or replay');
  console.log(JSON.stringify({passed:true,output,activityId:fixture.activityId,jobId:sample.jobId,layers:response.layers.length,newImages:0,syntheticOnly:true}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});console.log((await page.locator('body').innerText()).slice(-6000));throw error;}
finally{await browser.close();}
