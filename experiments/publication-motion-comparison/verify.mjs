import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'../..'),output=join(root,'artifacts/publication-motion-comparison-20261004');
const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
const shots=[5,17,28,38,48,58];const report={createdAt:new Date().toISOString(),checks:[],videos:{},screenshots:[],paidCalls:0,databaseWrites:0};
const check=(name,passed,details)=>{report.checks.push({name,passed,details});if(!passed) process.exitCode=1;};
await mkdir(join(output,'frames'),{recursive:true});
GlobalFonts.registerFromPath(join(output,'media/NotoSansSC-VF.ttf'),'NotoComic');
for(const engine of ['remotion','hyperframes']){
 const video=join(output,`${engine}.mp4`);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',video],{encoding:'utf8',windowsHide:true}));
 const v=probe.streams.find(s=>s.codec_type==='video'),a=probe.streams.find(s=>s.codec_type==='audio');
 report.videos[engine]={width:v.width,height:v.height,fps:v.avg_frame_rate,frames:v.nb_frames,duration:Number(probe.format.duration),audio:a?.codec_name,size:Number(probe.format.size)};
 check(engine+' dimensions',v.width===1080&&v.height===1920,`${v.width}x${v.height}`);
 check(engine+' fps',v.avg_frame_rate==='30/1',v.avg_frame_rate);
 check(engine+' duration',Math.abs(Number(probe.format.duration)-manifest.durationMs/1000)<.1,probe.format.duration);
 check(engine+' full audio',Boolean(a)&&Math.abs(Number(a.duration)-manifest.durationMs/1000)<.1,a?.duration);
 const sheet=createCanvas(1080,1320),ctx=sheet.getContext('2d');ctx.fillStyle='#101d28';ctx.fillRect(0,0,1080,1320);
 for(const [i,t] of shots.entries()){
  const frame=join(output,'frames',`${engine}-${t}s.png`);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(t),'-i',video,'-frames:v','1',frame],{windowsHide:true});
  const image=await loadImage(frame);const x=i%3*360,y=Math.floor(i/3)*660;
  ctx.drawImage(image,x,y,360,640);ctx.fillStyle='#f5efdf';ctx.font='16px NotoComic';ctx.fillText(`${engine} · ${t}s`,x+12,y+656);
 }
 const path=join(output,`${engine}-contact-sheet.png`);await writeFile(path,await sheet.encode('png'));report.screenshots.push(path);
}
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:3092');
 await page.waitForFunction(()=>[...document.querySelectorAll('section video')].every(v=>v.readyState>=1));
 await page.locator('#play').click();await page.waitForTimeout(3000);
 const playback=await page.evaluate(()=>[...document.querySelectorAll('section video')].map(v=>({time:v.currentTime,paused:v.paused,error:v.error?.code??null,muted:v.muted})));
 check('both videos actually play',playback.every(v=>v.time>1&&!v.paused&&!v.error),playback);
 check('only one audio audible',playback.filter(v=>!v.muted).length===1,playback);
 await page.locator('#pause').click();await page.evaluate(()=>{for(const v of document.querySelectorAll('section video'))v.currentTime=17});
 await page.waitForTimeout(600);await page.screenshot({path:join(output,'comparison-desktop.png'),fullPage:true});
 check('desktop overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),1440);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'comparison-mobile.png'),fullPage:true});
 check('mobile overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),390);
 check('browser no runtime errors',errors.length===0,errors);
}finally{await browser.close();}
await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
