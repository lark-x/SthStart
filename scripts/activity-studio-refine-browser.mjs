/** Stage-four gate, synthetic models and temporary in-memory databases only. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const token='activity-studio-fixture-token-not-production',fixture=await fetch('http://127.0.0.1:4289/fixture').then(response=>response.json());
const output=resolve('artifacts/activity-studio-abc',`refine-${new Date().toISOString().replaceAll(':','-')}`);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},extraHTTPHeaders:{'x-sthstart-admin-token':token}}),page=await context.newPage();
const errors=[],unexpected=[];page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400&&!(response.status()===401&&response.url().endsWith('/api/auth/admin-session'))&&!(response.status()===400&&/\/studio-jobs$/.test(response.url())))unexpected.push(`${response.status()} ${response.url()}`);});
const base=`http://127.0.0.1:4199/apps/activities/${fixture.activityId}`,service=`http://127.0.0.1:4289/api/v1/admin/activities/${fixture.activityId}`;
const get=suffix=>fetch(`${service}${suffix}`,{headers:{'x-sthstart-admin-token':token}}).then(response=>response.json());
const eventually=async(check)=>{for(let i=0;i<120;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('Expected UI state did not arrive');};
try{
  await page.goto(`${base}?tab=studio&view=storyboard&stageId=${fixture.stageId}&sceneId=${fixture.sceneId}&beatId=${fixture.beatId}`);
  await page.getByRole('button',{name:'绘制新图',exact:true}).waitFor({timeout:60000});
  if(!await page.getByRole('img',{name:'当前镜头画面',exact:true}).isVisible()){
    await page.getByRole('button',{name:'绘制新图',exact:true}).click();await page.getByRole('img',{name:'当前镜头画面',exact:true}).waitFor({timeout:60000});
  }
  const before=await get('/draft'),beatBefore=before.draft.document.scenes.find(scene=>scene.id===fixture.sceneId).beats.find(beat=>beat.id===fixture.beatId);
  await page.getByRole('button',{name:'智能制作',exact:true}).click();const dialog=page.getByRole('dialog',{name:'智能制作',exact:true});
  await dialog.getByRole('button',{name:'调整画面',exact:true}).click();await dialog.getByRole('combobox',{name:'画面调整对象',exact:true}).selectOption(`beat:${fixture.beatId}`);
  await dialog.getByRole('textbox',{name:'画面调整要求',exact:true}).fill('更换角色为其他人');await dialog.getByRole('button',{name:'生成待审调整',exact:true}).click();await dialog.getByText(/画面调整只支持景别/).waitFor();
  await dialog.getByRole('textbox',{name:'画面调整要求',exact:true}).fill('拉远一点，俯视，暖光，表情更平静。');
  await page.screenshot({path:resolve(output,'desktop-refine-input.png'),fullPage:true});
  await dialog.getByRole('button',{name:'生成待审调整',exact:true}).click();await dialog.getByRole('button',{name:'应用并绘制新图',exact:true}).waitFor({timeout:30000});
  assert.deepEqual(await get('/draft'),before,'Review must not alter content');
  const jobId=new URL(page.url()).searchParams.get('studioJobId');await page.reload();await dialog.getByRole('button',{name:'应用并绘制新图',exact:true}).waitFor({timeout:60000});
  await page.screenshot({path:resolve(output,'desktop-refine-review.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,'mobile-refine-review.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await dialog.getByRole('button',{name:'应用并绘制新图',exact:true}).click();await dialog.getByText('已应用，重复操作不会再修改或重复提交。',{exact:true}).waitFor();
  await eventually(async()=>{const job=await get(`/studio-jobs/${jobId}`);if(!job.appliedResult?.childJobId)return false;const child=await get(`/studio-jobs/${job.appliedResult.childJobId}`);return child.status==='succeeded';});
  const parent=await get(`/studio-jobs/${jobId}`),childId=parent.appliedResult.childJobId,child=await get(`/studio-jobs/${childId}`);assert.equal(child.result.renderedImages.length,1);
  const after=await get('/draft'),beatAfter=after.draft.document.scenes.find(scene=>scene.id===fixture.sceneId).beats.find(beat=>beat.id===fixture.beatId);
  for(const key of ['mediaUrl','action','dialogue','outcome','characterId'])assert.equal(beatAfter[key],beatBefore[key]);assert.equal(beatAfter.renderSettings.director.lighting,'warm');
  await dialog.getByRole('button',{name:'查看绘制任务',exact:true}).click();await dialog.getByText(/逐项进度 · 1 项完成 · 1 张可用图片/).waitFor();
  await page.screenshot({path:resolve(output,'mobile-linked-render.png'),fullPage:true});
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'绘制设置',exact:true}).waitFor();await eventually(async()=>await page.getByLabel('历史图片缩略图',{exact:true}).getByRole('button').count()>=2);
  await page.screenshot({path:resolve(output,'desktop-refine-history.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(JSON.stringify({passed:true,output,jobId,childId,sourcePictureKept:true}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});console.log('BODY',(await page.locator('body').innerText()).slice(-9000));throw error;}finally{await browser.close();}
