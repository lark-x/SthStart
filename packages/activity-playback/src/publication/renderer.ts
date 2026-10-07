import type { PublicationDocument, PublicationShot } from '@sthstart/contracts';
import { layoutBubbleText } from '../comic/text-layout.js';

export interface PublicationCard { shotId: string; utteranceIds: string[] }
export function compilePublicationCards(doc: PublicationDocument): PublicationCard[] {
  return doc.shots.flatMap(s => s.utterances.length ? Array.from({ length: Math.ceil(s.utterances.length / 3) }, (_, i) => ({ shotId: s.id, utteranceIds: s.utterances.slice(i * 3, i * 3 + 3).map(u => u.id) })) : [{ shotId: s.id, utteranceIds: [] }]);
}
export function publicationCanvasSize(orientation: PublicationDocument['orientation'], video = false) {
  return orientation === 'portrait' ? { width: 1080, height: video ? 1920 : 1440 } : { width: 1920, height: 1080 };
}
export interface PublicationImage { source: CanvasImageSource; width: number; height: number }
export function drawPublicationImage(ctx: CanvasRenderingContext2D, image: PublicationImage, rect: { x: number; y: number; width: number; height: number }) {
  const ratio = Math.min(rect.width / image.width, rect.height / image.height);
  const w = image.width * ratio, h = image.height * ratio;
  ctx.drawImage(image.source, rect.x + (rect.width-w)/2, rect.y+(rect.height-h)/2, w,h);
}
/** One compositor for the browser preview, comic cards and server PNGs. Image files remain unchanged. */
export function renderPublicationCard(ctx: CanvasRenderingContext2D, doc: PublicationDocument, card: PublicationCard, image: PublicationImage | null): string[] {
  const issues: string[] = [], shot = doc.shots.find(s => s.id === card.shotId);
  const { width, height } = publicationCanvasSize(doc.orientation);
  ctx.clearRect(0,0,width,height); ctx.fillStyle = '#f5f0e7'; ctx.fillRect(0,0,width,height);
  if (!shot) return [`镜头 ${card.shotId} 不存在。`];
  const margin = 48, imageHeight = doc.orientation === 'portrait' ? 840 : 660;
  ctx.fillStyle = '#16191b'; ctx.fillRect(margin, margin, width-2*margin,imageHeight);
  if (image) drawPublicationImage(ctx,image,{ x:margin,y:margin,width:width-2*margin,height:imageHeight });
  else issues.push(`镜头 ${shot.id} 缺少画面。`);
  let y = imageHeight + margin + 28;
  for (const u of shot.utterances.filter(u => card.utteranceIds.includes(u.id))) {
    const speaker = doc.actors.find(a => a.id === u.speakerActorId)?.name ?? '旁白';
    const boxHeight = Math.floor((height-y-margin) / Math.max(1, card.utteranceIds.length - shot.utterances.filter(v => card.utteranceIds.includes(v.id) && shot.utterances.indexOf(v) < shot.utterances.indexOf(u)).length));
    ctx.fillStyle = '#fffdfa'; ctx.fillRect(margin,y,width-2*margin,boxHeight-12);
    ctx.font = '600 32px "Noto Sans SC"'; ctx.fillStyle = '#a14323'; ctx.fillText(speaker,margin+24,y+39);
    ctx.font = '40px "Noto Sans SC"'; ctx.fillStyle = '#22272b';
    const layout = layoutBubbleText(ctx,{ text:u.text,fontSize:40,rect:{x:0,y:0,width:1,height:1}},width-2*margin-48,boxHeight-82);
    if (layout.overflow) issues.push(`镜头 ${shot.id} 对白 ${u.id} 文字溢出，请拆句或减少每页对白。`);
    layout.lines.forEach((line,i) => ctx.fillText(line,margin+24,y+90+i*54));
    y += boxHeight;
  }
  return issues;
}
/** Video image background; subtitles are separate immutable overlay PNGs. */
export function renderPublicationVideoBackground(ctx: CanvasRenderingContext2D, doc: PublicationDocument, _shot: PublicationShot, image: PublicationImage) {
  const {width,height} = publicationCanvasSize(doc.orientation,true);
  ctx.clearRect(0,0,width,height); ctx.fillStyle='#16191b'; ctx.fillRect(0,0,width,height);
  drawPublicationImage(ctx,image,{x:0,y:0,width,height:height-(doc.orientation==='portrait'?340:200)});
}
export function renderPublicationSubtitle(ctx: CanvasRenderingContext2D, doc: PublicationDocument, speaker: string, text: string): boolean {
  const {width,height} = publicationCanvasSize(doc.orientation,true), areaHeight = doc.orientation==='portrait'?340:200;
  ctx.clearRect(0,0,width,height); ctx.fillStyle='rgba(22,25,27,0.94)'; ctx.fillRect(0,height-areaHeight,width,areaHeight);
  ctx.fillStyle='#f3b58e'; ctx.font='600 40px "Noto Sans SC"'; ctx.fillText(speaker,48,height-areaHeight+60);
  ctx.fillStyle='#fffdfa'; ctx.font='48px "Noto Sans SC"';
  const layout=layoutBubbleText(ctx,{text,fontSize:48,rect:{x:0,y:0,width:1,height:1}},width-96,areaHeight-100);
  layout.lines.forEach((line,i)=>ctx.fillText(line,48,height-areaHeight+126+i*65));
  return layout.overflow;
}
