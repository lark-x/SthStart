'use client';
import { useState } from 'react';
import Image from 'next/image';
import { useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { CharacterFilters, CharacterPagination, useCharacterBrowser } from '@/app/features/characters/components/character-filters';
import { editCharacterOrganization } from '@/app/features/characters/api';
import { useActivityCapabilities } from '../queries';
import { fetchActivityCharacterSnapshot } from '../api';
import type { ActorSnapshot, CharacterProfile } from '@sthstart/contracts';

interface CharacterPickerDialogProps {
  open: boolean; onOpenChange: (open: boolean) => void; existingSourceCharacterIds: string[]; existingActorCount: number;
  onSelectCharacter: (actor: ActorSnapshot) => void;
}
export function CharacterPickerDialog({ open, onOpenChange, existingSourceCharacterIds, existingActorCount, onSelectCharacter }: CharacterPickerDialogProps) {
  const [hideAdded, setHideAdded] = useState(false);
  const browser = useCharacterBrowser({ excludeIds: hideAdded ? existingSourceCharacterIds : [] }, open);
  const { data: capabilities } = useActivityCapabilities();
  const remaining = Math.max(0, (capabilities?.limits.maxActors ?? 20) - existingActorCount);
  const client = useQueryClient();
  const [selected, setSelected] = useState<Record<string, CharacterProfile>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = Object.values(selected).filter(c => !existingSourceCharacterIds.includes(c.id));
  const toggle = (character: CharacterProfile) => setSelected(current => { const next = { ...current }; if (next[character.id]) delete next[character.id]; else next[character.id] = character; return next; });
  const confirm = async () => {
    if (busy || !candidates.length) return;
    if (candidates.length > remaining) { setError(`本场还可加入 ${remaining} 位，请减少选择`); return; }
    setBusy(true); setError('');
    try {
      // Resolve every snapshot before changing the activity: failed reads cannot partially add a cast.
      const actors: ActorSnapshot[] = [];
      for (const character of candidates) actors.push(await fetchActivityCharacterSnapshot(character.id, character.latestVersion ?? undefined));
      for (const actor of actors) onSelectCharacter(actor);
      setSelected({}); onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const favorite = async (character: CharacterProfile) => {
    try { await editCharacterOrganization({ ids: [character.id], favorite: !character.organization?.favorite }); void client.invalidateQueries({ queryKey: ['characters'] }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }} title="选择活动角色" description="可跨页多选。加入时使用角色已发布版本；尚未发布的角色使用当前草稿。" className="max-w-4xl" footer={<div className="flex w-full items-center justify-between gap-2"><span className="text-sm">已选 {candidates.length} 位 · 还可加入 {remaining} 位</span><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={busy || !candidates.length || candidates.length > remaining} onClick={() => void confirm()}>{busy ? '正在添加…' : `确认加入 ${candidates.length} 位`}</Button></div></div>}>
    <fieldset disabled={busy} className="space-y-3">
      <CharacterFilters filter={browser.filter} onChange={browser.change} onReset={() => { browser.reset(); setHideAdded(false); }} facets={browser.facets} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hideAdded} disabled={!existingSourceCharacterIds.length} onChange={e => { setHideAdded(e.target.checked); browser.change({ page: 1 }); }} />隐藏已加入角色</label>
      {!!candidates.length && <div className="flex flex-wrap gap-2 rounded-lg bg-accent/5 p-3">{candidates.map(c => <button key={c.id} type="button" className="rounded bg-surface px-2 py-1 text-sm" onClick={() => toggle(c)}>{c.displayName} ×</button>)}<Button size="sm" variant="ghost" onClick={() => setSelected({})}>清空已选</Button></div>}
      {(error || browser.error) && <p role="alert" className="text-sm text-accent-dark">{error || String(browser.error)}</p>}
      {browser.isLoading ? <p className="py-6 text-center text-muted">正在加载…</p> : <div className="grid gap-2 sm:grid-cols-2">{browser.data?.items.map(character => {
        const added = existingSourceCharacterIds.includes(character.id);
        return <div key={character.id} className={`flex items-center gap-3 rounded-lg border p-3 ${selected[character.id] ? 'border-accent bg-accent/5' : 'border-[rgb(24_32_29/12%)]'}`}><label className={`flex min-w-0 flex-1 items-center gap-3 ${added ? 'opacity-50' : 'cursor-pointer'}`}><input type="checkbox" checked={added || !!selected[character.id]} disabled={added || (!selected[character.id] && candidates.length >= remaining)} onChange={() => toggle(character)} />{character.avatarUrl ? <Image src={character.avatarUrl} width={40} height={40} alt="" unoptimized className="h-10 w-10 rounded object-cover" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-surface-muted">{character.displayName.slice(0, 1)}</span>}<span className="min-w-0"><span className="block truncate text-sm font-medium">{character.displayName}{added ? ' · 已加入' : ''}</span><span className="block truncate text-sm text-muted">{character.draft.work || '未分类'} · {character.organization?.interpretation || (character.latestVersion ? `v${character.latestVersion}` : '草稿')}</span></span></label><button type="button" aria-label={`${character.organization?.favorite ? '取消收藏' : '收藏'} ${character.displayName}`} onClick={() => void favorite(character)}><Star className={`h-4 w-4 ${character.organization?.favorite ? 'fill-accent text-accent' : 'text-muted'}`} /></button></div>;
      })}</div>}
      {!browser.isLoading && browser.data?.total === 0 && <p className="py-6 text-center text-muted">没有匹配角色，请调整筛选。</p>}
      <CharacterPagination data={browser.data} onPage={page => browser.change({ page })} />
    </fieldset>
  </Dialog>;
}
