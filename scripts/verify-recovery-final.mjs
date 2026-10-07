import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base='http://localhost:9320';
const out=resolve('artifacts/db-recovery-verification',new Date().toISOString().replaceAll(':','-')+'-final');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(String(e.message).slice(0,160)));
await page.request.post(new URL('/api/auth/admin-session',base).toString(),{headers:{origin:new URL(base).origin}});
const results=[];
async function shot(name,path,assertText){
  try{
    await page.goto(new URL(path,base).toString(),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(1800);
    await page.screenshot({path:resolve(out,name+'.png')});
    const text=(await page.locator('body').innerText()).replace(/\s+/g,' ');
    const found=assertText?text.includes(assertText):true;
    results.push({name,ok:found,assertText,found,excerpt:text.slice(0,160)});
  }catch(e){results.push({name,ok:false,error:String(e.message).slice(0,160)});}
}
await shot('public-services','/settings/public-services','stepaudio');
await shot('generation','/settings/generation','ComfyUI');
await shot('activities','/apps/activities','共 12 场活动');
await shot('story','/apps/story','剧情工作室');
await shot('activity-detail','/apps/activities/fd2650c3-ed4f-4b4a-aba7-c3fafc85c90d','阿贝多');
await writeFile(resolve(out,'report.json'),JSON.stringify({out,errors,results},null,2));
await browser.close();
console.log(JSON.stringify({out,pageErrors:errors.length,results},null,2));
