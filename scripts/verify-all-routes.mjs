// Cover every portal route that the app exposes, on the live service.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.env.STHSTART_SCREENSHOT_BASE_URL||'http://localhost:9320';
const out=resolve('artifacts/all-routes-acceptance',new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true});
const routes=[
  ['/', '工作台'],
  ['/apps/activities','活动工作室'],
  ['/apps/activities/new',''],
  ['/apps/calendar',''],
  ['/apps/characters','角色资料库'],
  ['/apps/characters/new',''],
  ['/apps/creative',''],
  ['/apps/inspiration',''],
  ['/apps/linshe',''],
  ['/apps/narrative',''],
  ['/apps/notebook',''],
  ['/apps/story','剧情工作室'],
  ['/settings/ai-logs','AI 调用记录'],
  ['/settings/backups',''],
  ['/settings/control-center','控制中心'],
  ['/settings/generation','生成配置'],
  ['/settings/public-services','模型与公共服务'],
];
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(String(e.message).slice(0,160)));
await page.request.post(new URL('/api/auth/admin-session',base).toString(),{headers:{origin:new URL(base).origin}});
const results=[];
for(const [path,expect] of routes){
  try{
    const resp=await page.goto(new URL(path,base).toString(),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(1400);
    const text=(await page.locator('body').innerText()).replace(/\s+/g,' ');
    const okStatus=(resp?.status()??0)<400;
    const found=expect?text.includes(expect):true;
    const safe=path==='/'?'home':path.replace(/[\/]/g,'_');
    await page.screenshot({path:resolve(out,safe+'.png')});
    results.push({path,status:resp?.status(),ok:okStatus&&found,expect,textLen:text.length});
  }catch(e){results.push({path,ok:false,error:String(e.message).slice(0,140)});}
}
await writeFile(resolve(out,'routes.json'),JSON.stringify({out,errors,results},null,2));
await browser.close();
console.log(JSON.stringify({out,pageErrors:errors.length,failed:results.filter(r=>!r.ok),passed:results.filter(r=>r.ok).length,total:results.length},null,2));
