// Verify the Story → Publication entry on the recovered live database.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base='http://localhost:9320';
const projectId='445461d1-34a0-4848-9b33-b5f4fc3c784a';
const out=resolve('artifacts/publication-entry-acceptance',new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const errors=[],httpErrors=[];
page.on('pageerror',e=>errors.push(String(e.message).slice(0,180)));
page.on('response',r=>{if(r.status()>=400&&r.url().includes('/api/'))httpErrors.push(r.status()+' '+r.url().slice(0,120));});
await page.request.post(new URL('/api/auth/admin-session',base).toString(),{headers:{origin:new URL(base).origin}});
const result={};
try{
  await page.goto(new URL('/apps/story/'+projectId,base).toString(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(2500);
  await page.screenshot({path:resolve(out,'story-workspace.png')});
  const body=(await page.locator('body').innerText()).replace(/\s+/g,' ');
  result.hasStoryWorkspace=body.includes('剧情');
  // Story must expose the publication entry when a chapter revision exists.
  const pubButton=page.getByRole('button',{name:'制作作品',exact:true});
  result.publicationEntryCount=await pubButton.count();
  if(result.publicationEntryCount>0){
    await pubButton.first().click();
    await page.waitForTimeout(1200);
    const dialog=page.getByRole('dialog');
    result.dialogVisible=await dialog.isVisible().catch(()=>false);
    await page.screenshot({path:resolve(out,'story-publication-dialog.png')});
    result.dialogText=(await dialog.innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,300);
  }
  result.bodyExcerpt=body.slice(0,240);
  result.ok=true;
}catch(e){result.ok=false;result.error=String(e.message).slice(0,200);await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});}
await writeFile(resolve(out,'report.json'),JSON.stringify({out,errors,httpErrors,result},null,2));
await browser.close();
console.log(JSON.stringify({out,pageErrors:errors.length,httpErrors,result},null,2));
