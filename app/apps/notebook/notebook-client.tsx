'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CreativeNote, NoteKind } from './types';
import { kindLabels, stageLabels } from './types';
import { adminFetch } from '@/app/lib/admin-fetch';

const filters: Array<{ value: 'all' | NoteKind; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'diary', label: '日记' }, { value: 'idea', label: '灵感' },
  { value: 'note', label: '随记' }, { value: 'story', label: '剧情' }, { value: 'character', label: '角色' }, { value: 'world', label: '世界' },
];

function dateLabel(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

export function NotebookClient() {
  const [items, setItems] = useState<CreativeNote[]>([]);
  const [filter, setFilter] = useState<'all' | NoteKind>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    adminFetch('notebook/notes', { cache: 'no-store' }).then(async (response) => {
      const body = await response.json() as { items: CreativeNote[]; message?: string; error?: string }; if (!response.ok) throw new Error(body.message ?? body.error);
      if (active) { setItems(body.items); setLoading(false); }
    }).catch((cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => items.filter((item) => {
    if (filter !== 'all' && item.kind !== filter) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${item.title} ${item.summary} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(needle);
  }), [filter, items, query]);
  const characters = items.filter((item) => item.kind === 'character').slice(0, 4);
  const worlds = items.filter((item) => item.kind === 'world').slice(0, 4);

  return <main className="notebook-shell">
    <header className="notebook-header">
      <Link className="notebook-brand" href="/"><span>拾</span><strong>创作笔记</strong></Link>
      <Link className="notebook-new" href="/apps/notebook/new">新建记录 <span>＋</span></Link>
    </header>

    <section className="notebook-hero">
      <div><p className="eyebrow">CAPTURE · CONNECT · CREATE</p><h1>把散落的念头，<em>留在故事发生之前。</em></h1></div>
      <p>记录日常、灵感和设定。成熟的片段可以标记为剧情候选，留给未来的剧本编辑器继续生长。</p>
    </section>

    <section className="notebook-tools" aria-label="筛选笔记">
      <label className="notebook-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" /></label>
      <div className="notebook-filters">{filters.map((item) => <button className={filter === item.value ? 'active' : ''} key={item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
    </section>

    {error && <div className="notebook-message">{error}</div>}
    {!loading && items.length === 0 ? <section className="notebook-empty">
      <span aria-hidden="true">✦</span><h2>从第一条记录开始</h2>
      <p>可以是一段日记、突然出现的对白，或者一个尚未命名的角色。</p>
      <div className="empty-note-actions"><Link href="/apps/notebook/new">写下第一条</Link><Link href="/apps/notebook/new?kind=character">建立角色</Link><Link href="/apps/notebook/new?kind=world">记录世界</Link></div>
    </section> : <>
      <section className="notebook-section">
        <div className="notebook-section-title"><div><p className="eyebrow">RECENT NOTES</p><h2>{filter === 'all' ? '最近记录' : kindLabels[filter]}</h2></div><span>{visible.length.toString().padStart(2, '0')}</span></div>
        <div className="note-grid">{visible.map((note) => <Link className={`note-card note-kind-${note.kind}`} href={`/apps/notebook/${note.id}`} key={note.id}>
          <div className="note-card-meta"><span>{kindLabels[note.kind]}</span><time>{dateLabel(note.updatedAt)}</time></div>
          <h3>{note.title}</h3><p>{note.summary || '还没有摘要，点开继续写。'}</p>
          <div className="note-card-footer"><span>{stageLabels[note.stage]}</span><span>{note.tags.slice(0, 2).map((tag) => `#${tag}`).join(' ')}</span>{note.favorite && <b aria-label="已收藏">★</b>}</div>
        </Link>)}</div>
      </section>

      <section className="lore-shelves">
        <LoreShelf title="角色人设" kind="character" items={characters}/><LoreShelf title="世界故事" kind="world" items={worlds}/>
      </section>
    </>}
  </main>;
}

function LoreShelf({ title, kind, items }: { title: string; kind: NoteKind; items: CreativeNote[] }) {
  return <div className="lore-shelf"><div className="lore-shelf-heading"><h2>{title}</h2><button onClick={() => document.querySelector<HTMLButtonElement>(`.notebook-filters button:nth-child(${kind === 'character' ? 6 : 7})`)?.click()}>查看全部</button></div>
    <div>{items.length ? items.map((item) => <Link href={`/apps/notebook/${item.id}`} key={item.id}><span>{item.title.slice(0, 1)}</span><div><strong>{item.title}</strong><small>{item.summary || kindLabels[item.kind]}</small></div></Link>) : <Link className="lore-empty-link" href={`/apps/notebook/new?kind=${kind}`}><span>＋</span><div><strong>建立第一份{title}</strong><small>先从名字和一段简短描述开始</small></div></Link>}</div>
  </div>;
}
