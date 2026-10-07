import {AbsoluteFill,CanvasImage,Easing,interpolate,staticFile,useCurrentFrame} from 'remotion';
import {ink,paper,Snow} from './ComicScene';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
export const Opening=()=>{
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:ink,color:paper,fontFamily:'NotoComic',overflow:'hidden'}}>
  <CanvasImage src={staticFile('media/shot-1.png')} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',opacity:.45,scale:interpolate(frame,[0,72],[1,1.06],clamp)}}/>
  <AbsoluteFill style={{background:'linear-gradient(0deg,#101d28 2%,#101d2800 90%)'}}/><Snow frame={frame}/>
  <div style={{position:'absolute',left:80,top:585,fontSize:31,letterSpacing:10,color:'#e2bc76'}}>DRAGONSPINE / 雪夜观察</div>
  <div style={{position:'absolute',left:76,top:695,fontSize:166,fontWeight:900,lineHeight:1.13,letterSpacing:12,
   opacity:interpolate(frame,[3,15],[0,1],clamp),translate:`0px ${interpolate(frame,[3,20],[50,0],{...clamp,easing:Easing.bezier(.16,1,.3,1)})}px`}}>雪山<br/>回声<span style={{color:'#e2bc76'}}>。</span></div>
  <div style={{position:'absolute',left:80,top:1190,fontSize:40,letterSpacing:3}}>阿贝多 × 砂糖</div>
  <div style={{position:'absolute',left:80,top:1270,fontSize:32,color:'#c7cdd1'}}>一次不急着寻找答案的实验</div>
  <div style={{position:'absolute',bottom:165,left:80,fontSize:25,color:'#d4d9da'}}>原神同人短篇 / 非官方剧情</div>
 </AbsoluteFill>;
};
export const Closing=()=>{
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:ink,color:paper,fontFamily:'NotoComic'}}>
  <Snow frame={frame}/><div style={{position:'absolute',left:80,top:640,fontSize:32,color:'#e2bc76',letterSpacing:8}}>观察记录 / 未完</div>
  <div style={{position:'absolute',left:80,top:750,fontSize:85,lineHeight:1.5,fontWeight:800,opacity:interpolate(frame,[0,12],[0,1],clamp)}}>把答案，<br/>留给下一次实验。</div>
  <div style={{position:'absolute',left:80,top:1170,fontSize:36,color:'#aebec5'}}>雪山似乎，也在回答我们。</div>
  <div style={{position:'absolute',left:80,bottom:170,fontSize:26,color:'#aebec5'}}>雪山回声 / 原神同人 · 非官方剧情</div>
 </AbsoluteFill>;
};
