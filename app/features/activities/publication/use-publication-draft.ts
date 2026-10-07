'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Value} from '@sinclair/typebox/value';
import {PublicationDocumentSchema,type PublicationDocument,type PublicationDraft} from '@sthstart/contracts';
import {DraftSaveQueue} from '@/app/lib/draft-save-queue';
import {ApiClientError} from '@/app/lib/api-client';
import {publicationApi} from './api';

export function usePublicationDraft(id:string,incoming?:PublicationDraft) {
  const queue=useRef(new DraftSaveQueue<PublicationDocument>()),timer=useRef<ReturnType<typeof setTimeout>|null>(null),recovered=useRef(false);
  const [document,setDocument]=useState<PublicationDocument|null>(null),[status,setStatus]=useState('载入中'),[error,setError]=useState('');
  const key=`sthstart:publication-draft:${id}`;
  useEffect(()=>{
    const q=queue.current;
    if(!incoming||q.dirty||q.saving||q.blocked) return;
    q.document=incoming.document;q.version=incoming.draftVersion;setDocument(incoming.document);setStatus('已保存');
    if(!recovered.current){
      recovered.current=true;
      try{const raw=localStorage.getItem(key);if(raw){const local=JSON.parse(raw);if(Value.Check(PublicationDocumentSchema,local)&&JSON.stringify(local)!==JSON.stringify(incoming.document)){q.document=local;q.dirty=true;q.blocked=true;setDocument(local);setStatus('待恢复');setError('已找回本机未同步内容。请先复制或检查服务器版本，再手动决定恢复。');}}}catch{}
    }
  },[incoming,key]);
  const flush=useCallback(async()=>{
    if(timer.current) clearTimeout(timer.current);
    const q=queue.current;if(q.blocked) return false;if(!q.dirty) return true;
    setStatus('保存中');setError('');let latest:PublicationDraft|null=null;
    const ok=await q.flush(async(doc,version)=>{latest=await publicationApi.save(id,version,doc);return latest.draftVersion;},e=>{
      setStatus(e instanceof ApiClientError&&e.status===409?'版本冲突':'仅保存在本机');setError(e instanceof Error?e.message:'保存失败，本地输入保留。');
    });
    if(ok&&!q.dirty){
      if(latest){const result=latest as PublicationDraft;q.document=result.document;setDocument(result.document);}
      setStatus('已保存');try{localStorage.removeItem(key);}catch{}
    }
    return ok;
  },[id,key]);
  const update=(next:PublicationDocument)=>{
    queue.current.document=next;queue.current.dirty=true;setDocument(next);if(!queue.current.blocked) setStatus('未保存');
    try{localStorage.setItem(key,JSON.stringify(next));}catch{setError('本机存储不可用，请保存或复制文本后再离开。');}
    if(timer.current) clearTimeout(timer.current);timer.current=setTimeout(()=>void flush(),600);
  };
  const accept=(server:PublicationDraft)=>{if(queue.current.dirty||queue.current.saving){setError('后台已更新图片或音频。当前文字输入保留，保存时会检查版本。');return;}queue.current.document=server.document;queue.current.version=server.draftVersion;setDocument(server.document);};
  const resolve=(server:PublicationDraft,keep:boolean)=>{
    queue.current.version=server.draftVersion;queue.current.blocked=false;setError('');
    if(keep&&queue.current.document) update(queue.current.document);
    else{queue.current.document=server.document;queue.current.dirty=false;setDocument(server.document);setStatus('已保存');try{localStorage.removeItem(key);}catch{}}
  };
  useEffect(()=>{const prevent=(e:BeforeUnloadEvent)=>{if(queue.current.dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>{if(timer.current)clearTimeout(timer.current);window.removeEventListener('beforeunload',prevent);};},[]);
  return {document,status,error,update,flush,accept,resolve,version:()=>queue.current.version,clean:()=>!queue.current.dirty&&!queue.current.saving&&!queue.current.blocked};
}
