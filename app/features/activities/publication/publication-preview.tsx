'use client';
import {useEffect,useRef,useState} from 'react';
import type {PublicationDocument} from '@sthstart/contracts';
import {compilePublicationCards,renderPublicationCard,publicationCanvasSize} from '@sthstart/activity-playback';
import {publicationFile} from './api';
import {Button} from '@/app/components/ui/button';

export function PublicationComicPreview({document}:{document:PublicationDocument}) {
  const cards=compilePublicationCards(document),[index,setIndex]=useState(0),[issues,setIssues]=useState<string[]>([]),canvas=useRef<HTMLCanvasElement>(null);
  const card=cards[Math.min(index,cards.length-1)],size=publicationCanvasSize(document.orientation);
  useEffect(()=>{
    let cancelled=false;
    const paint=async()=>{
      const node=canvas.current,ctx=node?.getContext('2d');if(!node||!ctx||!card)return;
      const errors:string[]=[];
      try{
        const font=new FontFace('Noto Sans SC','url(/fonts/NotoSansSC-VF.ttf)');await font.load();window.document.fonts.add(font);await window.document.fonts.ready;
        const shot=document.shots.find(s=>s.id===card.shotId),id=shot?.selectedImage?.artifactId;
        let image:HTMLImageElement|null=null;
        if(id){image=new Image();image.src=publicationFile(id);await image.decode();}
        if(cancelled)return;
        errors.push(...renderPublicationCard(ctx,document,card,image?{source:image,width:image.naturalWidth,height:image.naturalHeight}:null));
      }catch{errors.push('预览字体或图片不可读取，请检查产物。');}
      if(!cancelled)setIssues(errors);
    };
    void paint();return()=>{cancelled=true;};
  },[document,card]);
  if(!card)return <p className="p-6 text-muted">先准备关键镜头，再查看漫画预览。</p>;
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><Button disabled={index===0} onClick={()=>setIndex(v=>v-1)}>上一张</Button><span className="text-sm text-muted">{Math.min(index+1,cards.length)} / {cards.length} 张卡片</span><Button disabled={index>=cards.length-1} onClick={()=>setIndex(v=>v+1)}>下一张</Button></div>
    <canvas ref={canvas} width={size.width} height={size.height} aria-label="漫画发布预览" className="mx-auto h-auto w-full max-w-xl rounded-2xl shadow-panel"/>
    {issues.map(issue=><p key={issue} role="alert" className="text-sm text-danger-fg">{issue}</p>)}
  </div>;
}
