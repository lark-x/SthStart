import {chromium} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const service='http://127.0.0.1:4287',portal='http://127.0.0.1:4197';
const fixture=await fetch(`${service}/fixture`).then(r=>r.json());assert.equal(fixture.isolated,true);
const token='publication-isolated-admin-token-12345678',headers={'x-sthstart-admin-token':token};
const stamp=new Date().toISOString().replaceAll(':','-');
const output=fixture.outputDirectory?resolve(fixture.outputDirectory,'checks',stamp):resolve('artifacts/story-publication',stamp);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},extraHTTPHeaders:headers});
const page=await context.newPage(),errors=[],httpErrors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/api/auth/admin-session'))httpErrors.push(`${r.status()} ${r.url()}`);});
page.on('dialog',async d=>await d.accept());
const api=async(path,body)=>{const r=await fetch(`${service}${path}`,{method:body===undefined?'GET':'POST',headers:{...headers,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;};
let mcp;
try {
  // Real stdio MCP -> exact Portal proxy -> isolated Service (no model, no paid provider).
  const grant=await api(`/api/v1/admin/story/projects/${fixture.projectId}/publication-grant`,{});
  mcp=new Client({name:'publication-acceptance',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(resolve('node_modules/tsx/dist/esm/index.mjs')).href,resolve('apps/service/src/publication/mcp-server.ts')],env:{...process.env,STHSTART_STORY_PROJECT_ID:fixture.projectId,STHSTART_STORY_PORTAL_URL:portal,STHSTART_PUBLICATION_BRIDGE_TOKEN:grant.token}});
  await mcp.connect(transport);assert.equal((await mcp.listTools()).tools.length,8);
  const chunk=await mcp.callTool({name:'get_source_bundle',arguments:{activityId:fixture.activityId,limit:4}});assert.ok(!chunk.isError,JSON.stringify(chunk));assert.equal(JSON.parse(chunk.content[0].text).body.length,4);
  const state=await mcp.callTool({name:'get_publication',arguments:{activityId:fixture.activityId}});assert.ok(!state.isError,JSON.stringify(state));
  const draft=JSON.parse(state.content[0].text).draft;
  const planned=await mcp.callTool({name:'propose_publication_plan',arguments:{activityId:fixture.activityId,expectedDraftVersion:draft.draftVersion,document:{...draft.document,synopsis:'隔离验收：六个关键画面与六句对白。'}}});assert.ok(!planned.isError,JSON.stringify(planned));
  const unauthorized=await mcp.callTool({name:'start_approved_run',arguments:{activityId:fixture.activityId,approvalId:'not-approved',idempotencyKey:'unapproved-test'}});assert.equal(unauthorized.isError,true);
  const forbidden=await fetch(`${portal}/api/publication-bridge/projects/${fixture.projectId}/publications/${fixture.activityId}/approvals`,{method:'POST',headers:{authorization:`Bearer ${grant.token}`,'content-type':'application/json'},body:'{}'});assert.ok([403,404].includes(forbidden.status));

  await page.goto(`${portal}/apps/story/${fixture.projectId}`);await page.getByRole('button',{name:'制作作品',exact:true}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'制作作品',exact:true}).click();await page.getByRole('dialog',{name:'制作作品',exact:true}).waitFor();
  await page.screenshot({path:resolve(output,'desktop-story-entry.png'),fullPage:true});
  await page.getByRole('button',{name:'进入制作台',exact:true}).click();await page.waitForURL(/\/apps\/activities\//);
  await page.getByTestId('publication-workspace').waitFor();assert.ok(page.url().includes('/apps/activities/'));
  // The newly created empty draft is independent; test the populated six-shot document next.
  await page.goto(`${portal}/apps/activities/${fixture.activityId}`);await page.getByRole('button',{name:'核对方案与额度',exact:true}).waitFor();
  if(fixture.makeVideo===false)await page.getByRole('checkbox',{name:'漫画图片＋配音视频',exact:true}).uncheck();
  await page.screenshot({path:resolve(output,'desktop-plan.png'),fullPage:true});
  await page.getByRole('button',{name:'2. 画面与配音',exact:true}).click();
  await page.getByRole('button',{name:'绘制设置',exact:true}).click();const drawing=page.getByRole('dialog',{name:'绘制设置',exact:true});
  await drawing.getByText('高级：尺寸、负向词与镜头 LoRA',{exact:true}).click();await drawing.getByRole('spinbutton',{name:'宽度',exact:true}).fill('832');
  await drawing.getByRole('button',{name:'保存镜头设置',exact:true}).click();await drawing.waitFor({state:'hidden'});
  await page.reload();await page.getByRole('button',{name:'2. 画面与配音',exact:true}).click();await page.getByRole('button',{name:'绘制设置',exact:true}).click();
  await drawing.getByText('高级：尺寸、负向词与镜头 LoRA',{exact:true}).click();assert.equal(await drawing.getByRole('spinbutton',{name:'宽度',exact:true}).inputValue(),'832');
  await page.screenshot({path:resolve(output,'desktop-drawing.png'),fullPage:true});await drawing.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'1. 制作方案',exact:true}).click();
  if(fixture.makeVideo===false)await page.getByRole('checkbox',{name:'漫画图片＋配音视频',exact:true}).uncheck();
  await page.getByRole('button',{name:'核对方案与额度',exact:true}).click();
  const approval=page.getByRole('dialog',{name:'确认本轮制作',exact:true});await approval.waitFor();await page.screenshot({path:resolve(output,'desktop-approval.png'),fullPage:true});
  await approval.getByRole('button',{name:'确认并开始制作',exact:true}).click();await approval.waitFor({state:'hidden'});
  const root=`/api/v1/admin/activities/${fixture.activityId}/publication`;
  let run;
  let progress='';
  for(let i=0;i<(fixture.realImageProvider?1000:50);i++){run=(await api(`${root}/runs`)).items[0];const next=run?`${run.status}, image calls ${run.imagesUsed}, completed ${run.tasks.filter(t=>t.kind==='image'&&t.status==='succeeded').length}`:'';if(next!==progress){console.log(next);progress=next;}if(run&&['succeeded','failed','unknown','interrupted'].includes(run.status))break;await new Promise(r=>setTimeout(r,1500));}
  assert.equal(run?.status,'succeeded',JSON.stringify(run));assert.equal(run.imagesUsed,6);assert.equal(run.tasks.filter(t=>t.kind==='speech'&&t.status==='succeeded').length,fixture.makeVideo===false?0:6);
  await page.reload();await page.getByRole('button',{name:'2. 画面与配音',exact:true}).click();
  await page.getByRole('img',{name:'当前关键镜头画面',exact:true}).waitFor();await page.screenshot({path:resolve(output,'desktop-media.png'),fullPage:true});
  await page.getByRole('button',{name:'3. 预览与导出',exact:true}).click();await page.getByRole('link',{name:'发布 ZIP',exact:true}).first().waitFor();await page.waitForFunction(()=>Boolean(document.querySelector('canvas')));
  await page.waitForFunction(()=>{const c=document.querySelector('canvas');return c&&c.getContext('2d').getImageData(0,0,1,1).data[3]>0;});
  await page.screenshot({path:resolve(output,'desktop-export.png'),fullPage:true});
  const assets=run.tasks.find(t=>t.kind==='export'&&t.status==='succeeded').artifactIds;
  for(const [i,name]of (fixture.makeVideo===false?['publication.zip','cover.png']:['publication.zip','cover.png','video.mp4']).entries()) {const response=await fetch(`${service}/api/v1/admin/artifacts/${assets[i]}/file`,{headers});assert.ok(response.ok);await writeFile(resolve(output,name),Buffer.from(await response.arrayBuffer()));}
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'2. 画面与配音',exact:true}).click();await page.screenshot({path:resolve(output,'mobile-media.png'),fullPage:true});
  await page.getByRole('button',{name:'绘制设置',exact:true}).click();await drawing.waitFor();await page.screenshot({path:resolve(output,'mobile-drawing.png'),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false);await drawing.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>window.innerHeight+1),false,'Workstation must not produce full-page vertical scrolling');
  if(fixture.makeVideo!==false){await page.getByRole('heading',{name:'对白与配音',exact:true}).scrollIntoViewIfNeeded();await page.getByText(/^本句配音历史/).first().click();
  await page.screenshot({path:resolve(output,'mobile-audio-history.png'),fullPage:true});}
  await page.setViewportSize({width:1920,height:1080});await page.getByRole('button',{name:'3. 预览与导出',exact:true}).click();await page.screenshot({path:resolve(output,'large-export.png'),fullPage:true});
  const requests=await fetch(`${service}/fixture/requests`).then(r=>r.json());assert.equal(requests.filter(r=>r.url.endsWith('/prompt')).length,6);assert.equal(requests.filter(r=>r.url.endsWith('/audio/speech')).length,fixture.makeVideo===false?0:6);assert.ok(!requests.some(r=>r.url.includes('/chat/completions')));
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
  await writeFile(resolve(output,'report.json'),JSON.stringify({isolated:true,fixture,run,errors,httpErrors,mcpTools:8,actualProvider:fixture.realImageProvider?'real local ComfyUI; no speech provider configured':'synthetic ComfyUI and tone audio; real FFmpeg',viewports:['1440x900','390x844','1920x1080']},null,2));
  console.log(JSON.stringify({passed:true,output,runId:run.id,mcpTools:8}));
} finally {await mcp?.close();await context.close();await browser.close();}
