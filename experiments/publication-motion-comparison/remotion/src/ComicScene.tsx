import {AbsoluteFill, CanvasImage, Easing, interpolate, staticFile, useCurrentFrame} from 'remotion';
import type {Caption} from '@remotion/captions';
import manifest from './manifest.json';
export const ink='#101d28',paper='#f5efdf';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
export type Shot=typeof manifest.shots[number];
export const Snow=({frame}:{frame:number})=><AbsoluteFill style={{pointerEvents:'none',overflow:'hidden'}}>
 {Array.from({length:30},(_,i)=><div key={i} style={{position:'absolute',left:(i*173+19)%1080,
  top:((i*97+frame*(1.5+i%4))%2130)-100,width:3+i%5,height:3+i%5,borderRadius:50,
  background:paper,opacity:.10+(i%3)*.07,translate:`${Math.sin(frame/70+i)*16}px 0px`}}/>)}
</AbsoluteFill>;
export const ComicScene=({shot}:{shot:Shot})=>{
 const frame=useCurrentFrame(),length=Math.round(shot.durationMs*.03),now=shot.startMs+frame/30*1000;
 const caption:Caption|undefined=shot.captions.find(c=>now>=c.startMs&&now<c.endMs);
 const enter=interpolate(frame,[0,12],[0,1],{...clamp,easing:Easing.bezier(.16,1,.3,1)});
 const exit=interpolate(frame,[length-7,length],[1,0],clamp),age=caption?(now-caption.startMs)/1000*30:0;
 const angle=[-1.2,.8,-.8,0,-1,.8][shot.index],tall=shot.index===1||shot.index===2;
 const top=tall?300:385,height=tall?1110:970;
 return <AbsoluteFill style={{background:ink,color:paper,fontFamily:'NotoComic',overflow:'hidden'}}>
  <AbsoluteFill style={{backgroundImage:'radial-gradient(#f5efdf22 1.5px, transparent 1.5px)',backgroundSize:'14px 14px',opacity:.4}}/>
  <div style={{position:'absolute',top:95,left:80,fontSize:30,letterSpacing:5,color:shot.accent}}>雪山观察记录 / {String(shot.index+1).padStart(2,'0')}</div>
  <div style={{position:'absolute',top:155,left:80,width:920,fontSize:60,fontWeight:800,lineHeight:1.3,opacity:enter,translate:`${(1-enter)*25}px 0px`}}>{shot.headline}</div>
  <div style={{position:'absolute',left:60,top:top+20,width:940,height,background:shot.accent,rotate:`${angle-1}deg`,opacity:.25}}/>
  <div style={{position:'absolute',left:70,top,width:940,height,overflow:'hidden',border:`8px solid ${paper}`,rotate:`${angle}deg`,opacity:enter*exit,
   translate:`${(1-enter)*100}px 0px`,boxShadow:'0 28px 70px #0008'}}>
   <div style={{position:'absolute',inset:-24,scale:interpolate(frame,[0,length],[1.02,1.10],clamp),
    translate:`${interpolate(frame,[0,length],[shot.index%2?-16:16,shot.index%2?16:-16],clamp)}px 0px`}}>
    <CanvasImage src={staticFile(`media/${shot.image}`)} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:shot.index===1?'42% 48%':'50% 50%'}}/>
   </div>
   <div style={{position:'absolute',left:24,top:24,background:ink,color:paper,padding:'10px 22px',fontSize:28,letterSpacing:4}}>{shot.chapter}</div>
   {shot.index===3?<div style={{position:'absolute',inset:0,background:'#81dbef',mixBlendMode:'screen',opacity:(.08+.08*Math.sin(frame/8))*Math.min(1,frame/15)}}/>:null}
  </div>
  <Snow frame={frame+shot.index*83}/>
  {caption?<div style={{position:'absolute',top:1485,left:80,width:920,opacity:interpolate(age,[0,5],[0,1],clamp),
   translate:`0px ${interpolate(age,[0,7],[24,0],clamp)}px`,rotate:shot.speaker==='砂糖'?'.4deg':'-.4deg'}}>
   <div style={{color:shot.accent,fontWeight:700,fontSize:32,letterSpacing:5,marginBottom:16}}>{shot.speaker==='旁白'?'雪夜 · 旁白':shot.speaker}</div>
   <div style={{position:'relative',background:paper,color:ink,padding:'32px 40px',fontSize:48,lineHeight:1.42,fontWeight:600,
    boxShadow:'10px 12px 0 #0007',borderLeft:`10px solid ${shot.accent}`}}>
    {caption.text}
    {shot.speaker!=='旁白'?<div style={{position:'absolute',top:-17,left:48,width:32,height:32,background:paper,rotate:'45deg'}}/>:null}
   </div>
  </div>:null}
  <div style={{position:'absolute',bottom:92,left:80,right:80,display:'flex',justifyContent:'space-between',fontSize:23,letterSpacing:4,color:'#b9c2c7'}}>
   <span>雪山回声</span><span>原神同人 · 非官方剧情</span>
  </div>
 </AbsoluteFill>;
};
