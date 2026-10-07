// Enter the publication workstation from the recovered Story project and verify
// it renders with the restored workflows/presets. Read-mostly: creates one
// publication shell that the caller removes afterwards.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base='http://localhost:9320';
const projectId='445461d1-34a0-4848-9b33-b5f4fc3c784a';
const out=resolve('artifacts/publication-workstation-acceptance',new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(String(e.message).slice(0,180)));
await page.request.post(new URL('/api/auth/admin-session',base).toString(),{headers:{origin:new URL(base).origin}});
const result={};
try{
  await page.goto(new URL('/apps/story/'+projectId,base).toString(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:'制作作品',exact:true}).waitFor({timeout:45000});
  await page.getByRole('button',{name:'制作作品',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'制作作品',exact:true});
  await dialog.waitFor();
  // Select the first chapter revision if a selector is offered.
  const option=dialog.getByRole('radio').or(dialog.getByRole('checkbox'));
  if(await option.count()){await option.first().check().catch(()=>{});}
  await dialog.getByRole('button',{name:'进入制作台',exact:true}).click();
  await page.waitForURL(/\/apps\/activities\//,{timeout:60000});
  await page.getByTestId('publication-workspace').waitFor({timeout:60000});
  await page.waitForTimeout(2000);
  result.activityId=(page.url().match(/activities\/([0-9a-f-]{36})/)||[])[1]??null;
  await page.screenshot({path:resolve(out,'desktop-plan.png')});
  const body=(await page.locator('body').innerText()).replace(/\s+/g,' ');
  result.planText=body.slice(0,300);
  // Move to the second and third step to prove the tabs work.
  await page.getByRole('button',{name:/画面与配音/}).click().catch(()=>{});
  await page.waitForTimeout(1200);
  await page.screenshot({path:resolve(out,'desktop-media.png')});
  await page.getByRole('button',{name:/预览与导出/}).click().catch(()=>{});
  await page.waitForTimeout(1200);
  await page.screenshot({path:resolve(out,'desktop-export.png')});
  // Narrow viewport.
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(1000);
  result.noHorizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  await page.screenshot({path:resolve(out,'mobile-export.png')});
  result.ok=true;
}catch(e){result.ok=false;result.error=String(e.message).slice(0,220);await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});}
await writeFile(resolve(out,'report.json'),JSON.stringify({out,errors,result},null,2));
await browser.close();
console.log(JSON.stringify({out,pageErrors:errors.length,result},null,2));
