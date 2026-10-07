import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const output=resolve(root,'artifacts/publication-motion-comparison-20261004');
const whitelist=new Map([
 ['/',[resolve(import.meta.dirname,'preview.html'),'text/html; charset=utf-8']],
 ['/remotion.mp4',[resolve(output,'remotion.mp4'),'video/mp4']],
 ['/hyperframes.mp4',[resolve(output,'hyperframes.mp4'),'video/mp4']],
 ['/baseline.mp4',[resolve(root,'artifacts/publication-production/2026-10-04T07-25-32.657Z/video.mp4'),'video/mp4']],
]);
createServer(async(req,res)=>{
 const entry=whitelist.get(new URL(req.url,'http://127.0.0.1').pathname);
 if(!entry||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
 try{
  const [path,type]=entry,info=await stat(path);const headers={'Content-Type':type,'Cache-Control':'no-store'};
  if(type.startsWith('text/html')){res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:await readFile(path));return;}
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(info.size-1,Number(range[2])):info.size-1;
  if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
  res.writeHead(range?206:200,{...headers,'Accept-Ranges':'bytes','Content-Length':end-start+1,...range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{}});
  if(req.method==='HEAD')res.end();else createReadStream(path,{start,end}).pipe(res);
 }catch{res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('小样仍在渲染，请稍后刷新。');}
}).listen(3092,'127.0.0.1',()=>console.log('Comparison: http://127.0.0.1:3092'));
