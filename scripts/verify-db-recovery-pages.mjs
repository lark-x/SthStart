// Post-recovery smoke: real browser against the live portal + restored DB.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.env.STHSTART_SCREENSHOT_BASE_URL||'http://localhost:9320';
const out=resolve('artifacts/db-recovery-verification',new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const errors=[],httpErrors=[];
page.on('pageerror',e=>errors.push(String(e.message).slice(0,200)));
page.on('console',m=>{if(m.type()==='error')errors.push('[console] '+m.text().slice(0,200));});
page.on('response',r=>{if(r.status()>=400)httpErrors.push(r.status()+' '+r.url().slice(0,140));});
await page.request.post(new URL('/api/auth/admin-session',base).toString(),{headers:{origin:new URL(base).origin}});

const results=[];
async function shot(name,path,waitFor){
  try{
    await page.goto(new URL(path,base).toString(),{waitUntil:'domcontentloaded',timeout:60000});
    if(waitFor) await page.waitForSelector(waitFor,{timeout:45000});
    await page.waitForTimeout(1500);
    await page.screenshot({path:resolve(out,name+'.png'),fullPage:false});
    const text=(await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0,220);
    results.push({name,path,ok:true,text});
  }catch(e){results.push({name,path,ok:false,error:String(e.message).slice(0,200)});}
}
await shot('01-home','/');
await shot('02-activities','/apps/activities');
await shot('03-story','/apps/story');
await shot('04-characters','/apps/characters');
await shot('05-ai-logs','/settings/ai-logs');
await shot('06-generation','/settings/generation');
await shot('07-public-services','/settings/public-services');
await shot('08-control-center','/settings/control-center');

// Activity detail with a real id from the restored DB
const activityId='fd2650c3-ed4f-4b4a-aba7-c3fafc85c90d';
await shot('09-activity-detail','/apps/activities/'+activityId);
await shot('10-activity-detail-mobile','/apps/activities/'+activityId);

const report={base,output:out,errors,httpErrors,results};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
await browser.close();
console.log(JSON.stringify({out,pageErrors:errors.length,httpErrors:httpErrors.length,results:results.map(r=>({name:r.name,ok:r.ok,error:r.error}))},null,2));
