'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Star, Plus, Search, Upload } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { PageHeader } from '@/app/components/shared/page-header';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterBatchImport } from './character-batch-import';
import { CharacterFilters, CharacterPagination, useCharacterBrowser } from './character-filters';
import { CharacterOrganizationFields, emptyOrganizationFields, splitLabels } from './character-organization-editor';
import { editCharacterOrganization, saveCharacterWork } from '../api';
import type { CharacterWork } from '@sthstart/contracts';

export function CharacterLibrary() {
  const browser = useCharacterBrowser();
  const router = useRouter();
  const client = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [fields, setFields] = useState(emptyOrganizationFields);
  const [replaceTags, setReplaceTags] = useState(false);
  const [replaceGroups, setReplaceGroups] = useState(false);
  const [work, setWork] = useState<CharacterWork>({ name: '', aliases: [], mediaType: '' });
  const [aliases, setAliases] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => { void client.invalidateQueries({ queryKey: ['characters'] }); };
  const organize = async () => {
    setBusy(true); setError('');
    try {
      await editCharacterOrganization({ ids: Object.keys(selected), ...(fields.work.trim() ? { work: fields.work.trim() } : {}), tags: splitLabels(fields.tags), groups: splitLabels(fields.groups), ...(fields.interpretation.trim() ? { interpretation: fields.interpretation.trim() } : {}), fillEmpty: fields.fillEmpty, replaceTags, replaceGroups, ...(fields.originType ? { originType: fields.originType } : {}) });
      refresh(); setOrganizeOpen(false); setSelected({});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const toggleFavorite = async (id: string, favorite: boolean) => {
    setError('');
    try { await editCharacterOrganization({ ids: [id], favorite }); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const saveWork = async () => {
    setBusy(true); setError('');
    try { await saveCharacterWork({ ...work, aliases: splitLabels(aliases) }); refresh(); setWorksOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-paper px-4 py-6 text-ink sm:px-8 md:px-12"><div className="mx-auto max-w-7xl space-y-5">
    <PageHeader backHref="/" backLabel="返回门户首页" eyebrow="SHARED CHARACTER LIBRARY" title="角色资料库" description="按作品与标签找角色，为下一场活动挑选参与者。" actions={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Search className="h-4 w-4" />搜索 / 导入</Button><Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}><Upload className="h-4 w-4" />批量导入</Button><Link className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-sm text-white" href="/apps/characters/new"><Plus className="h-4 w-4" />新建角色</Link></div>} />
    {(error || browser.error) && <p role="alert" className="text-sm text-accent-dark">{error || String(browser.error)}</p>}
    <CharacterFilters filter={browser.filter} onChange={browser.change} onReset={browser.reset} facets={browser.facets} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><div className="flex flex-wrap items-center gap-2"><span>已选 {Object.keys(selected).length} 位{browser.isFetching ? ' · 筛选中…' : ''}</span><Button size="sm" variant="ghost" onClick={() => setSelected(current => ({ ...current, ...Object.fromEntries((browser.data?.items || []).map(c => [c.id, c.displayName])) }))}>选择本页</Button><Button size="sm" variant="ghost" onClick={() => setSelected({})}>取消选择</Button><Button size="sm" variant="outline" disabled={!Object.keys(selected).length} onClick={() => { setError(''); setOrganizeOpen(true); }}>批量整理</Button></div><Button size="sm" variant="ghost" onClick={() => { setError(''); setWorksOpen(true); }}>管理作品与别名</Button></div>
    {Object.keys(selected).length > 0 && <details className="text-sm"><summary className="cursor-pointer text-muted">查看跨页已选名单</summary><div className="mt-2 flex flex-wrap gap-2">{Object.entries(selected).map(([id, name]) => <button key={id} type="button" className="rounded bg-accent/10 px-2 py-1" onClick={() => setSelected(current => { const next = { ...current }; delete next[id]; return next; })}>{name} ×</button>)}</div></details>}
    {browser.isLoading ? <p className="py-12 text-center text-muted">正在加载角色…</p> : <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">{browser.data?.items.map(character => <article key={character.id} className="rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/14%)] bg-surface p-3.5">
      <div className="mb-2 flex items-center justify-between"><label className="flex items-center gap-2 text-sm text-muted"><input aria-label={`选择 ${character.displayName}`} type="checkbox" checked={!!selected[character.id]} onChange={e => setSelected(current => { const next = { ...current }; if (e.target.checked) next[character.id] = character.displayName; else delete next[character.id]; return next; })} />{character.draft.work || '未设置作品'}</label><button type="button" aria-label={`${character.organization?.favorite ? '取消收藏' : '收藏'} ${character.displayName}`} aria-pressed={character.organization?.favorite || false} onClick={() => void toggleFavorite(character.id, !character.organization?.favorite)}><Star className={`h-4 w-4 ${character.organization?.favorite ? 'fill-accent text-accent' : 'text-muted'}`} /></button></div>
      <Link href={`/apps/characters/${character.id}`} className="group flex gap-3"><div className="relative flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-2xl">{character.avatarUrl ? <Image src={character.avatarUrl} alt="" fill unoptimized className="object-cover" /> : character.displayName.slice(0, 1)}</div><div className="min-w-0"><h3 className="truncate font-serif text-lg group-hover:text-accent">{character.displayName}</h3><p className="mt-1 line-clamp-2 text-sm text-muted">{character.draft.summary || character.draft.identity || '尚未补充简介'}</p><p className="mt-2 text-sm text-muted">{character.organization?.interpretation || '未标注演绎'} · {character.latestVersion ? `v${character.latestVersion}` : '草稿'}</p></div></Link>
      <div className="mt-3 flex flex-wrap gap-1.5">{character.tags.slice(0, 4).map(tag => <button key={tag} type="button" className="rounded bg-accent/10 px-2 py-0.5 text-sm" onClick={() => browser.change({ tags: [...new Set([...(browser.filter.tags || []), tag])] })}>{tag}</button>)}</div>
    </article>)}</div>}
    {!browser.isLoading && browser.data?.total === 0 && <p className="py-12 text-center text-muted">没有匹配的角色，可以清空筛选或导入新角色。</p>}
    <CharacterPagination data={browser.data} onPage={page => browser.change({ page })} />
  </div>
  <CharacterImportDialog open={importOpen} onOpenChange={setImportOpen} initialMode="online" onCommitted={id => { refresh(); router.push(`/apps/characters/${id}`); }} />
  <CharacterBatchImport open={batchOpen} onOpenChange={setBatchOpen} onCommitted={refresh} works={browser.facets?.works || []} />
  <Dialog open={organizeOpen} onOpenChange={v => { if (!busy) setOrganizeOpen(v); }} title={`整理 ${Object.keys(selected).length} 位角色`} description="只修改角色库资料，已保存的活动快照保持原样。" footer={<Button disabled={busy} onClick={() => void organize()}>{busy ? '保存中…' : '保存整理结果'}</Button>}><CharacterOrganizationFields value={fields} onChange={setFields} works={browser.facets?.works || []} /><div className="mt-3 space-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={replaceTags} onChange={e => setReplaceTags(e.target.checked)} />改为替换全部标签（留空则清除）</label><label className="flex items-center gap-2"><input type="checkbox" checked={replaceGroups} onChange={e => setReplaceGroups(e.target.checked)} />改为替换全部分组（留空则清除）</label></div>{error && <p role="alert" className="mt-3 text-sm text-accent-dark">{error}</p>}</Dialog>
  <Dialog open={worksOpen} onOpenChange={v => { if (!busy) setWorksOpen(v); }} title="作品与别名" description="新增作品，或选择已有作品编辑别名与类型。别名可以用于搜索和筛选。" footer={<Button disabled={busy || !work.name.trim()} onClick={() => void saveWork()}>保存作品</Button>}><div className="space-y-3"><label className="block text-sm">选择已有作品<select className="mt-1 w-full rounded border p-2" value="" onChange={e => { const next = browser.facets?.works.find(w => w.name === e.target.value); if (next) { setWork(next); setAliases(next.aliases.join('，')); } }}><option value="">选择作品，或在下方新建</option>{browser.facets?.works.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}</select></label><label className="block text-sm">标准名称<Input value={work.name} onChange={e => setWork({ ...work, name: e.target.value })} /></label><label className="block text-sm">别名（逗号分隔）<Input value={aliases} onChange={e => setAliases(e.target.value)} /></label><label className="block text-sm">作品类型<select className="mt-1 w-full rounded border p-2" value={work.mediaType} onChange={e => setWork({ ...work, mediaType: e.target.value })}><option value="">未分类</option>{['游戏', '动画', '漫画', '小说', '影视', '其他'].map(t => <option key={t}>{t}</option>)}</select></label>{error && <p role="alert" className="text-sm text-accent-dark">{error}</p>}</div></Dialog>
  </main>;
}
