import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
const doc=JSON.parse(await readFile(new URL('assets/manifest.json',import.meta.url),'utf8'));
await mkdir(new URL('vendor/gsap/',import.meta.url),{recursive:true});
await copyFile(new URL('node_modules/gsap/dist/gsap.min.js',import.meta.url),new URL('vendor/gsap/gsap.min.js',import.meta.url));
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const sceneMarkup=doc.shots.map(s=>{
 const index=s.index,tall=index===1||index===2,top=tall?300:385,height=tall?1110:970;
 const captions=s.captions.map((c,i)=>'<div id="caption-'+index+'-'+i+'" class="caption clip" data-start="'+c.startMs/1000+'" data-duration="'+(c.endMs-c.startMs)/1000+'" data-track-index="8"><div class="speaker">'+esc(s.speaker==='旁白'?'雪夜 · 旁白':s.speaker)+'</div><div class="bubble">'+esc(c.text)+(s.speaker!=='旁白'?'<div class="tail"></div>':'')+'</div></div>').join('');
 return '<section id="scene-'+index+'" class="scene clip" data-start="'+s.startMs/1000+'" data-duration="'+s.durationMs/1000+'" data-track-index="'+(index+1)+'" style="--accent:'+s.accent+'">'+
  '<div class="mast">雪山观察记录 / '+String(index+1).padStart(2,'0')+'</div><h2 class="headline">'+esc(s.headline)+'</h2>'+
  '<div class="shadow" style="top:'+(top+20)+'px;height:'+height+'px"></div><div class="hero" style="top:'+top+'px;height:'+height+'px;--angle:'+[-1.2,.8,-.8,0,-1,.8][index]+'deg"><div class="art"><img src="assets/'+s.image+'" alt="'+esc(s.chapter)+'"/></div><span class="chapter">'+esc(s.chapter)+'</span>'+(index===3?'<div class="glow"></div>':'')+'</div>'+captions+'</section>';
}).join('');
const template=await readFile(new URL('composition.template',import.meta.url),'utf8');
await writeFile(new URL('index.html',import.meta.url),template.replace('<!--SCENES-->',sceneMarkup).replace('/*MANIFEST*/',JSON.stringify(doc).replaceAll('<','\\u003c')));
console.log('Built Hyperframes composition:',doc.durationMs/1000,'seconds');
