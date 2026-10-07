import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { createCanvas, loadImage, GlobalFonts, type Canvas } from '@napi-rs/canvas';
import { compilePublicationCards, renderPublicationCard, renderPublicationVideoBackground, renderPublicationSubtitle,
  compilePublicationTimeline, publicationCanvasSize, publicationSrt, type PublicationTimeline, type PublicationImage } from '@sthstart/activity-playback';
import type { PublicationDocument } from '@sthstart/contracts';
import { streamUploadArtifact } from '../artifacts.js';
import { checkFfmpeg } from '../video-utils.js';
import { createZipToFile, type ZipEntryInput } from '../activities/zip.js';
import type { ServiceConfig } from '../config.js';
import { PublicationStore, publicationError } from './store.js';

const exec = promisify(execFile);
const fontPath = resolve(import.meta.dirname, '../../../../public/fonts/NotoSansSC-VF.ttf');
export function loadPublicationFont() {
  if (!GlobalFonts.has('Noto Sans SC') && !GlobalFonts.registerFromPath(fontPath,'Noto Sans SC')) throw publicationError('publication_font_missing','无法加载随项目分发的 Noto Sans SC 字体，停止导出。');
}
function context(canvas: Canvas) { return canvas.getContext('2d') as unknown as CanvasRenderingContext2D; }
function canvasImage(image: Awaited<ReturnType<typeof loadImage>>): PublicationImage { return { source:image as unknown as CanvasImageSource,width:image.width,height:image.height }; }
async function command(args: string[], signal?: AbortSignal) {
  await exec('ffmpeg',args,{windowsHide:true,timeout:600000,maxBuffer:2_000_000,signal});
}
export async function renderPublicationVideo(doc: PublicationDocument, timeline: PublicationTimeline, imagePaths: Record<string,string>, audioPaths: Record<string,string>, directory: string, signal?: AbortSignal) {
  if (!await checkFfmpeg()) throw publicationError('publication_ffmpeg_missing','视频需要 FFmpeg 和 FFprobe，请安装后重试。');
  loadPublicationFont();
  const size = publicationCanvasSize(doc.orientation,true), clips: string[]=[];
  let segmentIndex=0;
  for (const shot of doc.shots) {
    const interval=timeline.shots.find(s=>s.id===shot.id)!;
    const source=await loadImage(imagePaths[shot.id]);
    const background=createCanvas(size.width,size.height);
    renderPublicationVideoBackground(context(background),doc,shot,canvasImage(source));
    const bgPath=join(directory,`bg-${clips.length}.png`); await writeFile(bgPath,await background.encode('png'));
    const subtitles=timeline.subtitles.filter(s=>s.shotId===shot.id);
    const boundaries=[...new Set([interval.startMs,interval.endMs,...subtitles.flatMap(s=>[s.startMs,s.endMs])])].sort((a,b)=>a-b);
    for (let i=0;i<boundaries.length-1;i++) {
      if (signal?.aborted) throw new Error('制作导出已停止。');
      const start=boundaries[i],end=boundaries[i+1],subtitle=subtitles.find(s=>start>=s.startMs && start<s.endMs);
      const overlay=createCanvas(size.width,size.height);
      if (renderPublicationSubtitle(context(overlay),doc,subtitle?.speaker??'',subtitle?.text??'')) throw publicationError('publication_text_overflow',`镜头 ${shot.id} 字幕溢出。`);
      const overlayPath=join(directory,`overlay-${segmentIndex}.png`), output=join(directory,`clip-${segmentIndex++}.mp4`);
      await writeFile(overlayPath,await overlay.encode('png'));
      const frames=Math.max(1,Math.round(end/1000*30)-Math.round(start/1000*30));
      const startZoom=1+0.03*(start-interval.startMs)/(interval.endMs-interval.startMs);
      const zoom=shot.presentation==='push_in'?`zoompan=z='${startZoom}+on*${0.03/Math.max(1,(interval.endMs-interval.startMs)/1000*30)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${size.width}x${size.height}:fps=30`:'null';
      await command(['-y','-threads','2','-filter_complex_threads','1','-loop','1','-framerate','30','-i',bgPath,'-loop','1','-framerate','30','-i',overlayPath,
        '-filter_complex',`[0:v]${zoom}[bg];[bg][1:v]overlay=0:0:shortest=1[v]`,'-map','[v]','-frames:v',String(frames),'-an','-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',output],signal);
      clips.push(output);
    }
  }
  // Paths are exclusively fixed filenames in our newly-created temporary directory.
  const list=join(directory,'concat.txt');
  await writeFile(list,clips.map(path=>`file '${relative(directory,path).replaceAll('\\','/')}'`).join('\n'));
  const silent=join(directory,'silent.mp4');
  await command(['-y','-f','concat','-safe','1','-i',list,'-c','copy',silent],signal);
  const output=join(directory,'video.mp4');
  const firstSubtitles=new Map<string,PublicationTimeline['subtitles'][number]>();
  for(const subtitle of timeline.subtitles) if(!firstSubtitles.has(subtitle.utteranceId)) firstSubtitles.set(subtitle.utteranceId,subtitle);
  const utterances=[...firstSubtitles.values()];
  const inputs=utterances.flatMap(s=>['-i',audioPaths[s.utteranceId]]);
  const audioFilter=utterances.map((s,i)=>`[${i+1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${s.startMs}|${s.startMs}[a${i}]`).join(';');
  const mix=utterances.length?`${audioFilter};${utterances.map((_,i)=>`[a${i}]`).join('')}amix=inputs=${utterances.length}:normalize=0,apad,atrim=duration=${timeline.durationMs/1000}[audio]`:`anullsrc=r=48000:cl=stereo,atrim=duration=${timeline.durationMs/1000}[audio]`;
  await command(['-y','-threads','2','-filter_complex_threads','1','-i',silent,...inputs,'-filter_complex',mix,'-map','0:v','-map','[audio]',
    '-c:v','copy','-c:a','aac','-b:a','192k','-t',String(timeline.durationMs/1000),'-movflags','+faststart',output],signal);
  return output;
}

export async function exportPublication(input:{store:PublicationStore;config:ServiceConfig;activityId:string;taskId:string;revisionId:string;makeVideo:boolean;signal?:AbortSignal}) {
  const {store,config,activityId,taskId,revisionId,makeVideo,signal}=input;
  const doc=store.revisionDocument(activityId,revisionId);
  if (!doc.shots.length) throw publicationError('publication_empty','作品没有关键镜头。');
  loadPublicationFont();
  const imagePaths:Record<string,string>={}, audioPaths:Record<string,string>={}, durations:Record<string,{artifactId:string;durationMs:number}>={};
  for (const shot of doc.shots) {
    if (!shot.selectedImage) throw publicationError('publication_image_missing',`镜头 ${shot.id} 尚未选图。`,409);
    imagePaths[shot.id]=store.artifact(shot.selectedImage.artifactId,'image').path;
    for (const u of shot.utterances) {
      if (!u.selectedAudioArtifactId) { if (makeVideo) throw publicationError('publication_audio_missing',`对白 ${u.id} 未配音。`,409); continue; }
      const asset=store.artifact(u.selectedAudioArtifactId,'audio');
      audioPaths[u.id]=asset.path; durations[u.id]={artifactId:u.selectedAudioArtifactId,durationMs:Number(asset.duration_ms)};
    }
  }
  const timeline=makeVideo?compilePublicationTimeline(doc,durations):null;
  const prefix=join(tmpdir(),'sthstart-publication-'), directory=await mkdtemp(prefix);
  try {
    const entries:ZipEntryInput[]=[], cards=compilePublicationCards(doc), size=publicationCanvasSize(doc.orientation);
    let coverPath='';
    for (const [i,card] of cards.entries()) {
      const image=await loadImage(imagePaths[card.shotId]), canvas=createCanvas(size.width,size.height);
      const issues=renderPublicationCard(context(canvas),doc,card,canvasImage(image));
      if (issues.length) throw publicationError('publication_text_overflow',issues.join('；'));
      const file=join(directory,`page-${String(i+1).padStart(3,'0')}.png`); await writeFile(file,await canvas.encode('png'));
      entries.push({path:`images/page-${String(i+1).padStart(3,'0')}.png`,filePath:file});
      if (i===0) {
        const cover=createCanvas(size.width,size.height), ctx=context(cover);
        ctx.drawImage(canvas as unknown as CanvasImageSource,0,0); ctx.fillStyle='rgba(22,25,27,0.88)';ctx.fillRect(0,size.height-180,size.width,180);
        ctx.font='600 56px "Noto Sans SC"';ctx.fillStyle='#fffdfa';
        const {layoutBubbleText}=await import('@sthstart/activity-playback');
        const layout=layoutBubbleText(ctx,{text:doc.title,fontSize:56,rect:{x:0,y:0,width:1,height:1}},size.width-96,160);
        if(layout.overflow) throw publicationError('publication_text_overflow','封面标题过长，请缩短标题。');
        layout.lines.forEach((line,j)=>ctx.fillText(line,48,size.height-112+j*75));
        coverPath=join(directory,'cover.png'); await writeFile(coverPath,await cover.encode('png'));entries.push({path:'cover.png',filePath:coverPath});
      }
    }
    let videoPath:string|null=null;
    if (timeline) { videoPath=await renderPublicationVideo(doc,timeline,imagePaths,audioPaths,directory,signal);entries.push({path:'video.mp4',filePath:videoPath});entries.push({path:'subtitles.srt',data:publicationSrt(timeline)}); }
    entries.push({path:'publish-copy.md',data:`# ${doc.publishingCopy.title||doc.title}\n\n${doc.publishingCopy.description}\n\n${doc.publishingCopy.tags.map(t=>`#${t}`).join(' ')}\n`});
    entries.push({path:'manifest.json',data:JSON.stringify({schemaVersion:1,revisionId,title:doc.title,orientation:doc.orientation,cards:cards.length,
      durationMs:timeline?.durationMs??null,source:doc.source,media:doc.shots.map(s=>({shotId:s.id,imageId:s.selectedImage?.artifactId,utterances:s.utterances.map(u=>({id:u.id,audioId:u.selectedAudioArtifactId}))}))},null,2)});
    const zipPath=join(directory,'publication.zip'); await createZipToFile(entries,zipPath);
    const persist=async(path:string,type:string,name:string)=>{
      const artifact=await streamUploadArtifact(config,store.db,{appId:'activities',stream:createReadStream(path),contentType:type,originalName:name,
        refType:'publication_history',refId:`publication:${activityId}:${taskId}`,metadata:{publicationActivityId:activityId,revisionId}});
      return artifact.id;
    };
    const ids=[await persist(zipPath,'application/zip','publication.zip'),await persist(coverPath,'image/png','cover.png')];
    if(videoPath) ids.push(await persist(videoPath,'video/mp4','video.mp4'));
    return ids;
  } finally {
    // Cleanup is confined to the random temporary directory created by this operation.
    if(directory.startsWith(prefix)) await rm(directory,{recursive:true,force:true});
  }
}
