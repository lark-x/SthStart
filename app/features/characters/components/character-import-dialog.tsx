'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Search, Upload, Link as LinkIcon, Check, AlertTriangle, Loader2 } from 'lucide-react';
import type { CharacterCardSearchResult, CharacterImportSession } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import {
  cancelCharacterImportSession,
  commitCharacterImportSession,
  createCharacterImportSession,
  createCharacterImportSessionFromFile,
  searchCharacterCards,
  updateCharacterImportSession,
} from '../api';

type ImportMode = 'file' | 'url' | 'online' | 'paste';

export function CharacterImportDialog({
  open,
  onOpenChange,
  targetCharacterId,
  baseDraftRevision,
  onCommitted,
  initialMode = 'file',
}: {
  initialMode?: ImportMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetCharacterId?: string;
  baseDraftRevision?: number;
  onCommitted: (characterId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [url, setUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CharacterCardSearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [session, setSession] = useState<CharacterImportSession | null>(null);
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState('');
  const [appearance, setAppearance] = useState('');
  const [coverAvatar, setCoverAvatar] = useState(false);
  const [coverReference, setCoverReference] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingOnlineId, setLoadingOnlineId] = useState<string | null>(null);
  const [error, setError] = useState('');

  /* eslint-disable react-hooks/set-state-in-effect -- reset and hydrate the explicit import-session editor state. */
  useEffect(() => {
    if (!open) {
      searchControllerRef.current?.abort(); ++searchSequenceRef.current;
      setSession(null); setResults([]); setError(''); setUrl(''); setQuery(''); setPastedText(''); setNextCursor(null); setSearchedQuery('');
    }
  }, [open]);

  useEffect(() => {
    const candidate = session?.candidate;
    if (!candidate) return;
    setName(candidate.draft.displayName);
    setIdentity(candidate.draft.identity);
    setAppearance(candidate.draft.appearance.description);
    setCoverAvatar(candidate.cover.selectedForAvatar);
    setCoverReference(candidate.cover.selectedForReference);
  }, [session]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const showError = (value: unknown) => setError(value instanceof Error ? value.message : String(value));

  const loadSession = (next: CharacterImportSession) => {
    setSession(next); setError('');
  };

  const importFile = async (file: File) => {
    setBusy(true); setError('');
    try { loadSession(await createCharacterImportSessionFromFile(file, targetCharacterId, baseDraftRevision)); }
    catch (value) { showError(value); }
    finally { setBusy(false); }
  };

  const importUrl = async () => {
    if (!url.trim()) return;
    setBusy(true); setError('');
    try {
      loadSession(await createCharacterImportSession({ url: url.trim(), ...(targetCharacterId ? { targetCharacterId } : {}), ...(baseDraftRevision == null ? {} : { baseDraftRevision }) }, crypto.randomUUID()));
    } catch (value) { showError(value); }
    finally { setBusy(false); }
  };

  const importPastedText = async () => {
    const value = pastedText.trim();
    if (!value) return;
    setBusy(true); setError('');
    try {
      let card: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(value);
        card = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : { name: '待命名角色', description: value };
      } catch {
        card = { name: '待命名角色', description: value };
      }
      loadSession(await createCharacterImportSession({ card, ...(targetCharacterId ? { targetCharacterId } : {}), ...(baseDraftRevision == null ? {} : { baseDraftRevision }) }, crypto.randomUUID()));
    } catch (value) { showError(value); }
    finally { setBusy(false); }
  };

  const search = async (cursor?: string) => {
    if (!query.trim()) return;
    const requestQuery = query.trim();
    if (cursor && requestQuery !== searchedQuery) cursor = undefined;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    const sequence = ++searchSequenceRef.current;
    setBusy(true); setError('');
    try {
      const response = await searchCharacterCards({ query: query.trim(), cursor, limit: 8, signal: controller.signal });
      if (sequence !== searchSequenceRef.current) return;
      setResults((current) => {
        const items = cursor ? [...current, ...response.items] : response.items;
        return [...new Map(items.map((item) => [`${item.providerId}:${item.externalId}`, item])).values()];
      });
      setNextCursor(response.nextCursor);
      setSearchedQuery(requestQuery);
    } catch (value) {
      if (controller.signal.aborted || sequence !== searchSequenceRef.current) return;
      showError(value);
    }
    finally { if (sequence === searchSequenceRef.current) setBusy(false); }
  };

  const importOnline = async (item: CharacterCardSearchResult) => {
    const onlineKey = `${item.providerId}:${item.externalId}`;
    setLoadingOnlineId(onlineKey);
    setBusy(true); setError('');
    try {
      loadSession(await createCharacterImportSession({ providerId: item.providerId, externalId: item.externalId, url: item.sourceUrl, ...(targetCharacterId ? { targetCharacterId } : {}), ...(baseDraftRevision == null ? {} : { baseDraftRevision }) }, crypto.randomUUID()));
    } catch (value) { showError(value); }
    finally { setLoadingOnlineId(null); setBusy(false); }
  };

  const persistPreview = async () => {
    if (!session?.candidate) throw new Error('请先选择角色卡');
    return updateCharacterImportSession(session.id, {
      expectedPreviewRevision: session.previewRevision,
      candidatePatch: { draft: { displayName: name, identity, appearance: { ...session.candidate.draft.appearance, description: appearance } } },
      cover: { selectedForAvatar: coverAvatar, selectedForReference: coverReference },
    });
  };

  const commit = async () => {
    if (!session) return;
    setBusy(true); setError('');
    try {
      const preview = await persistPreview();
      setSession(preview);
      const committed = await commitCharacterImportSession(preview.id, {
        expectedPreviewRevision: preview.previewRevision, previewHash: preview.previewHash,
        targetCharacterId: targetCharacterId || null, baseDraftRevision: targetCharacterId ? baseDraftRevision ?? null : null,
      }, `commit-${session.id}`);
      onCommitted(committed.characterId); onOpenChange(false);
    } catch (value) { showError(value); }
    finally { setBusy(false); }
  };

  const close = async (nextOpen: boolean) => {
    if (busy) return;
    if (!nextOpen && session && session.status !== 'committed') await cancelCharacterImportSession(session.id).catch(() => undefined);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => void close(nextOpen)} title="导入角色卡" description="先解析并预览候选字段，确认后才会写入角色库。原始卡片会作为来源快照保留。" className="max-w-2xl max-h-[95dvh] overflow-y-auto" footer={
      session ? <div className="flex w-full items-center justify-between gap-2"><Button variant="outline" size="sm" onClick={() => void close(false)}>取消</Button><div className="flex gap-2"><Button size="sm" onClick={() => void commit()} disabled={busy || !name.trim() || session.status !== 'ready'}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}<span>{busy ? '正在导入…' : '确认导入'}</span></Button></div></div> : <Button variant="outline" size="sm" onClick={() => void close(false)}>关闭</Button>
    }>
      {!session ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1 border-b border-[rgb(24_32_29/10%)]">
            {([['file', '本地 JSON / PNG', Upload], ['url', '来源 URL', LinkIcon], ['paste', '粘贴资料', LinkIcon], ['online', '在线搜索', Search]] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => setMode(value)} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${mode === value ? 'border-accent text-accent' : 'border-transparent text-muted'}`}><Icon className="h-4 w-4" />{label}</button>)}
          </div>
          {mode === 'file' && <div className="rounded border border-dashed border-[rgb(24_32_29/18%)] p-6 text-center"><p className="text-sm text-muted">支持 Tavern Card V1/V2/V3 JSON，以及带 chara / ccv3 元数据的 PNG。</p><Button className="mt-3" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}<span>{busy ? '正在解析…' : '选择文件'}</span></Button><input ref={fileRef} hidden type="file" accept="application/json,.json,image/png,.png,image/jpeg,.jpg,image/webp,.webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} /></div>}
          {mode === 'url' && <div className="space-y-2"><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Character Tavern 角色页或 PNG 下载地址" /><Button onClick={() => void importUrl()} disabled={busy || !url.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}<span>{busy ? '正在获取…' : '获取并预览'}</span></Button></div>}
          {mode === 'paste' && <div className="space-y-2"><Textarea value={pastedText} onChange={(event) => setPastedText(event.target.value)} rows={9} placeholder="粘贴角色描述，或粘贴一段 Tavern JSON。纯文字会作为身份描述候选，确认前仍可编辑。" /><Button onClick={() => void importPastedText()} disabled={busy || !pastedText.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}<span>{busy ? '正在解析…' : '解析并预览'}</span></Button></div>}
          {mode === 'online' && <div className="space-y-3"><div className="flex gap-2"><Input value={query} onChange={(event) => { searchControllerRef.current?.abort(); ++searchSequenceRef.current; setBusy(false); setQuery(event.target.value); setResults([]); setNextCursor(null); setSearchedQuery(''); }} placeholder="搜索角色名或作品" onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} /><Button onClick={() => void search()} disabled={busy || !query.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}<span>{busy ? '搜索中…' : '搜索'}</span></Button></div><div className="space-y-2">{results.map((item) => <div key={`${item.providerId}:${item.externalId}`} className="flex items-center justify-between gap-3 rounded border border-[rgb(24_32_29/12%)] p-3"><div className="flex min-w-0 items-center gap-3">{item.thumbnail && <Image src={item.thumbnail} alt="" width={48} height={48} unoptimized className="h-12 w-12 shrink-0 rounded object-cover" />}<div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="truncate text-xs text-muted">{item.author || '未知作者'} · {item.summary || '无摘要'}</p></div></div><Button size="sm" variant="outline" onClick={() => void importOnline(item)} disabled={busy}>{loadingOnlineId === `${item.providerId}:${item.externalId}` ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span>下载解析中…</span></> : '预览'}</Button></div>)}{!busy && searchedQuery === query.trim() && searchedQuery.length >= 1 && results.length === 0 && !error && <p className="rounded border border-dashed border-[rgb(24_32_29/14%)] p-4 text-center text-sm text-muted">没有找到匹配的角色卡。</p>}{nextCursor && searchedQuery === query.trim() && <Button size="sm" variant="outline" onClick={() => void search(nextCursor)} disabled={busy}>加载更多</Button>}</div></div>}
          {error && <p className="text-sm text-accent-dark">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Badge variant="accent">{session.compatibility?.format || 'card'}</Badge>{typeof session.source.providerId === 'string' && <Badge variant="outline">来源：{session.source.providerId}</Badge>}{session.compatibility?.isSceneCard && <Badge variant="warning">可能是场景卡</Badge>}</div>
          {(typeof session.source.author === 'string' || typeof session.source.remoteVersion === 'string' || typeof session.source.sourceUrl === 'string') && <div className="rounded border border-[rgb(24_32_29/12%)] bg-surface-muted p-3 text-xs text-muted"><p>作者：{typeof session.source.author === 'string' ? session.source.author : '未知'} · 卡片版本：{typeof session.source.remoteVersion === 'string' ? session.source.remoteVersion : '未知'}</p>{typeof session.source.sourceUrl === 'string' && <a href={session.source.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-accent-dark hover:underline">打开来源页面</a>}</div>}
          {session.compatibility?.warnings?.length ? <div className="space-y-1 rounded border border-[#d0a731]/30 bg-[#d0a731]/8 p-3 text-sm text-[#6f5a16]"><p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" />导入边界</p>{session.compatibility.warnings.map((warning) => <p key={warning}>· {warning}</p>)}</div> : null}
          {session.candidate?.cover.available && <Image src={`/api/admin/characters/import-sessions/${session.id}/cover`} alt="待导入的角色卡封面" width={160} height={160} unoptimized className="mx-auto h-40 w-40 rounded object-contain" />}
          {targetCharacterId && <p className="text-sm text-muted">将更新当前角色中本卡提供的字段，其余详细设定保留。</p>}
          {session.candidate && <div className="space-y-3"><div><label className="mb-1 block text-xs font-semibold text-muted">角色名称</label><Input value={name} onChange={(event) => setName(event.target.value)} /></div><div><label className="mb-1 block text-xs font-semibold text-muted">身份与原卡描述</label><Textarea value={identity} onChange={(event) => setIdentity(event.target.value)} rows={5} /></div><div><label className="mb-1 block text-xs font-semibold text-muted">显式外观（不会根据名字推断）</label><Textarea value={appearance} onChange={(event) => setAppearance(event.target.value)} rows={3} /></div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={coverAvatar} disabled={!session.candidate.cover.available} onChange={(event) => setCoverAvatar(event.target.checked)} />将封面设为头像</label><label className="flex items-center gap-2"><input type="checkbox" checked={coverReference} disabled={!session.candidate.cover.available} onChange={(event) => setCoverReference(event.target.checked)} />将封面作为外观参考</label></div></div>}
          {session.candidate?.mappings.length ? <details className="rounded border border-[rgb(24_32_29/12%)] p-3"><summary className="cursor-pointer text-sm font-semibold">查看确定性字段映射（{session.candidate.mappings.length} 项）</summary><div className="mt-2 space-y-1 text-xs text-muted">{session.candidate.mappings.map((mapping) => <div key={`${mapping.fieldPath}:${mapping.sourcePointer}`} className="flex flex-wrap gap-x-2"><code>{mapping.fieldPath}</code><span>←</span><code>{mapping.sourcePointer}</code><span>· {mapping.status}</span></div>)}</div></details> : null}
          {session.candidate?.originalCard && <details className="rounded border border-[rgb(24_32_29/12%)] p-3"><summary className="cursor-pointer text-sm font-semibold">查看原卡内容（只读）</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{JSON.stringify(session.candidate.originalCard, null, 2)}</pre></details>}
          {error && <p className="text-sm text-accent-dark">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
