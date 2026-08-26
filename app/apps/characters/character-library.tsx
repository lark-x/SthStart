'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CharacterProfile } from '@sthstart/contracts';
import { adminFetch } from '@/app/lib/admin-fetch';

export function CharacterLibrary() {
  const [items, setItems] = useState<CharacterProfile[]>([]); const [query, setQuery] = useState(''); const [error, setError] = useState('');
  useEffect(() => { adminFetch('characters').then(async (response) => { const body = await response.json() as { items?: CharacterProfile[]; message?: string }; if (!response.ok) throw new Error(body.message); setItems(body.items ?? []); }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, []);
  const filtered = useMemo(() => items.filter((item) => !query || `${item.displayName} ${item.draft.englishName} ${item.draft.work} ${item.draft.world} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  return <main className="character-library-shell">
    <header className="character-library-header"><Link className="brand" href="/"><span className="brand-mark">S</span><span>SthStart</span></Link><nav><Link href="/apps/notebook">创作笔记</Link><Link href="/">返回主页</Link></nav></header>
    <section className="character-library-hero"><div><p className="eyebrow">SHARED CHARACTER LIBRARY</p><h1>角色不是一段提示词，<em>而是一份会生长的资料。</em></h1><p>在这里整理稳定设定，发布后再交给邻舍和其他应用使用。</p></div><Link className="character-create" href="/apps/characters/new">＋ 新建角色</Link></section>
    <div className="character-library-tools"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色、作品、世界或标签"/></label><span>{filtered.length} 个角色</span></div>
    {error && <p className="editor-error">{error}</p>}
    <section className="character-card-grid">{filtered.map((character) => <Link className="library-character-card" href={`/apps/characters/${character.id}`} key={character.id}>
      <div className="library-character-avatar">{character.avatarUrl ? <Image src={character.avatarUrl} alt="" fill unoptimized sizes="180px"/> : <span>{character.displayName.slice(0, 1)}</span>}<i>{character.latestVersion ? `v${character.latestVersion}` : '草稿'}</i></div>
      <div><p>{character.draft.work || character.draft.world || (character.draft.originType === 'ip' ? '已有作品' : '原创角色')}</p><h2>{character.displayName}</h2><span>{character.draft.summary || character.draft.identity || '还没有填写角色摘要。'}</span><footer>{character.tags.slice(0, 3).map((tag) => <b key={tag}>{tag}</b>)}</footer></div>
    </Link>)}</section>
    {!filtered.length && <div className="character-empty"><span>角</span><h2>{query ? '没有找到匹配的角色' : '角色资料库还是空的'}</h2><p>从一个名字、一段描述或 Tavern JSON 角色卡开始。</p><Link href="/apps/characters/new">建立第一个角色</Link></div>}
  </main>;
}
