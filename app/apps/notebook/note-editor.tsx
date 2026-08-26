'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreativeNote, NoteBlock, NoteKind, NoteStage } from './types';
import { kindLabels, newBlock, stageLabels } from './types';
import { adminFetch } from '@/app/lib/admin-fetch';
import type { CharacterProfile } from '@sthstart/contracts';

const initialNote: CreativeNote = {
  title: '', kind: 'note', summary: '', content: [newBlock('text')], tags: [], stage: 'draft', favorite: false,
};

function summaryFrom(blocks: NoteBlock[]) {
  return blocks.filter((block): block is Extract<NoteBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text.trim()).filter(Boolean).join(' ').slice(0, 180);
}

export function NoteEditor({ noteId, initialKind = 'note' }: { noteId?: string; initialKind?: NoteKind }) {
  const router = useRouter();
  const [note, setNote] = useState<CreativeNote>({ ...initialNote, content: [newBlock('text')], kind: initialKind });
  const [loading, setLoading] = useState(Boolean(noteId));
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'error'>('clean');
  const [error, setError] = useState('');
  const currentId = useRef(noteId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);

  useEffect(() => {
    void adminFetch('characters', { cache: 'no-store' }).then(async (response) => {
      if (response.ok) setCharacters(((await response.json()) as { items: CharacterProfile[] }).items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!noteId) return;
    let active = true;
    adminFetch(`notebook/notes/${noteId}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json() as CreativeNote & { message?: string; error?: string }; if (!response.ok) throw new Error(body.message ?? body.error);
      if (active) { setNote(body); setLoading(false); setStatus('clean'); }
    }).catch((cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); } });
    return () => { active = false; };
  }, [noteId]);

  useEffect(() => {
    if (!currentId.current || status !== 'dirty') return;
    const timer = window.setTimeout(() => { void persist(note, true); }, 900);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, status]);

  function change(update: (current: CreativeNote) => CreativeNote) {
    setNote((current) => update(current)); setStatus('dirty');
  }

  async function persist(value = note, quiet = false) {
    setStatus('saving'); setError('');
    const payload = { ...value, title: value.title.trim() || '未命名笔记', summary: summaryFrom(value.content) };
    const id = currentId.current;
    try {
      const response = await adminFetch(id ? `notebook/notes/${id}` : 'notebook/notes', {
        method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json() as CreativeNote & { id: string; message?: string; error?: string }; if (!response.ok) throw new Error(body.message ?? body.error);
      if (!id) {
        currentId.current = body.id; setNote(body); router.replace(`/apps/notebook/${body.id}`);
      }
      setStatus('saved'); window.setTimeout(() => setStatus('clean'), quiet ? 900 : 1500);
      return String(body.id);
    } catch (cause) {
      setStatus('error'); setError(cause instanceof Error ? cause.message : String(cause)); return null;
    }
  }

  function updateBlock(id: string, values: Partial<NoteBlock>) {
    change((current) => ({ ...current, content: current.content.map((block) => block.id === id ? { ...block, ...values } as NoteBlock : block) }));
  }

  function addBlock(type: NoteBlock['type']) {
    change((current) => ({ ...current, content: [...current.content, newBlock(type)] }));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    change((current) => {
      const content = [...current.content]; const target = index + direction;
      if (target < 0 || target >= content.length) return current;
      [content[index], content[target]] = [content[target], content[index]]; return { ...current, content };
    });
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError('单张图片不能超过 8 MB。'); return; }
    const savedId = currentId.current ?? await persist(); if (!savedId) return;
    setStatus('saving');
    const dataUrl = await new Promise<string>((resolvePromise, reject) => {
      const reader = new FileReader(); reader.onload = () => resolvePromise(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
    });
    try {
      const response = await adminFetch('notebook/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ noteId: savedId, dataUrl, filename: file.name }) });
      const body = await response.json() as { url: string; message?: string; error?: string }; if (!response.ok) throw new Error(body.message ?? body.error);
      change((current) => ({ ...current, content: [...current.content, { id: crypto.randomUUID(), type: 'image', src: body.url, caption: '' }] }));
    } catch (cause) { setStatus('error'); setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function removeNote() {
    if (!currentId.current || !window.confirm('确定删除这条记录和它的本地图片吗？')) return;
    const response = await adminFetch(`notebook/notes/${currentId.current}`, { method: 'DELETE' });
    if (response.ok) router.push('/apps/notebook'); else setError('删除失败，请稍后重试。');
  }

  if (loading) return <main className="editor-loading"><span>拾</span><p>正在翻开这一页…</p></main>;

  return <main className="note-editor-shell">
    <header className="editor-toolbar">
      <Link href="/apps/notebook" aria-label="返回笔记列表">←</Link>
      <div className={`save-state save-${status}`}>{status === 'saving' ? '保存中…' : status === 'dirty' ? '等待保存' : status === 'error' ? '保存失败' : status === 'saved' ? '已保存' : '本地笔记'}</div>
      <div><button className="editor-star" aria-label={note.favorite ? '取消收藏' : '收藏'} onClick={() => change((current) => ({ ...current, favorite: !current.favorite }))}>{note.favorite ? '★' : '☆'}</button><button className="editor-save" onClick={() => void persist()}>保存</button></div>
    </header>

    <article className="editor-paper">
      <div className="editor-meta-row">
        <select aria-label="记录类型" value={note.kind} onChange={(event) => change((current) => ({ ...current, kind: event.target.value as NoteKind }))}>{Object.entries(kindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select aria-label="创作阶段" value={note.stage} onChange={(event) => change((current) => ({ ...current, stage: event.target.value as NoteStage }))}>{Object.entries(stageLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      </div>
      <textarea className="editor-title" aria-label="标题" rows={1} value={note.title} onChange={(event) => change((current) => ({ ...current, title: event.target.value }))} placeholder="给这一页一个标题" />
      <input className="editor-tags" aria-label="标签" value={note.tags.join('，')} onChange={(event) => change((current) => ({ ...current, tags: event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) }))} placeholder="添加标签，用逗号分隔" />

      <div className="editor-blocks">{note.content.map((block, index) => <section className={`editor-block block-${block.type}`} key={block.id}>
        <div className="block-actions"><span>{block.type === 'text' ? '文本' : block.type === 'image' ? '图片' : block.type === 'link' ? '链接' : block.type === 'character-reference' ? '角色引用' : '叙事档案引用'}</span><div><button onClick={() => moveBlock(index, -1)} disabled={index === 0}>↑</button><button onClick={() => moveBlock(index, 1)} disabled={index === note.content.length - 1}>↓</button><button onClick={() => change((current) => ({ ...current, content: current.content.filter((item) => item.id !== block.id) }))}>删除</button></div></div>
        {block.type === 'text' && <textarea value={block.text} onChange={(event) => updateBlock(block.id, { text: event.target.value })} placeholder="写下一段文字…" rows={Math.max(5, block.text.split('\n').length + 2)} />}
        {block.type === 'image' && <><div className="image-preview">{block.src ? <Image src={block.src} alt={block.caption || '笔记图片'} fill sizes="(max-width: 640px) 100vw, 760px" unoptimized /> : <span>等待选择图片</span>}</div><input value={block.caption} onChange={(event) => updateBlock(block.id, { caption: event.target.value })} placeholder="图片说明（可选）" /></>}
        {block.type === 'link' && <div className="link-editor"><input type="url" value={block.url} onChange={(event) => updateBlock(block.id, { url: event.target.value })} placeholder="https://…"/><input value={block.label} onChange={(event) => updateBlock(block.id, { label: event.target.value })} placeholder="链接标题"/><textarea value={block.note} onChange={(event) => updateBlock(block.id, { note: event.target.value })} placeholder="为什么保存这个链接？" rows={2}/>{/^https?:\/\//.test(block.url) && <a href={block.url} target="_blank" rel="noreferrer">打开链接 ↗</a>}</div>}
        {block.type === 'character-reference' && <CharacterReferenceEditor block={block} characters={characters} onChange={(values) => updateBlock(block.id, values)}/>}
        {block.type === 'archive-reference' && <blockquote className="archive-reference"><p>{block.quote}</p><Link href={`/apps/narrative?utterance=${encodeURIComponent(block.targetId)}`}>{block.locator} →</Link></blockquote>}
      </section>)}</div>

      <div className="insert-bar"><button onClick={() => addBlock('text')}>＋ 文本</button><button onClick={() => fileInput.current?.click()}>＋ 图片</button><button onClick={() => addBlock('link')}>＋ 链接</button><button onClick={() => addBlock('character-reference')}>＋ 角色</button><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void uploadImage(event)}/></div>
      {error && <p className="editor-error">{error}</p>}
      {currentId.current && <button className="delete-note" onClick={() => void removeNote()}>删除这条记录</button>}
    </article>
  </main>;
}

function CharacterReferenceEditor({ block, characters, onChange }: { block: Extract<NoteBlock, { type: 'character-reference' }>; characters: CharacterProfile[]; onChange: (values: Partial<NoteBlock>) => void }) {
  const character = characters.find((item) => item.id === block.characterId);
  return <div className="note-character-reference"><select aria-label="引用角色" value={block.characterId} onChange={(event) => onChange({ characterId: event.target.value })}><option value="">选择资料库角色</option>{characters.map((item) => <option value={item.id} key={item.id}>{item.displayName}{item.draft.work ? ` · ${item.draft.work}` : ''}</option>)}</select>{character ? <Link href={`/apps/characters/${character.id}`}><strong>{character.displayName}</strong><span>{character.draft.summary || character.draft.identity || '尚未填写摘要'}</span><small>{character.draft.personality.slice(0, 3).join(' · ') || '查看角色资料'} →</small></Link> : block.characterId ? <p>原角色已归档或不可用。</p> : <p>选择后，这里会实时显示角色资料库中的最新信息。</p>}<textarea rows={2} value={block.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="这条笔记与角色的关系（可选）"/></div>;
}
