'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { CharacterImportSession, CharacterWork } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { cancelCharacterImportSession, commitCharacterImportSession, createCharacterImportSessionFromFile, fetchImportDuplicates, fetchImportSession, updateCharacterImportSession } from '../api';
import type { ImportDuplicate } from '../api';
import { CharacterOrganizationFields, emptyOrganizationFields, splitLabels } from './character-organization-editor';

type Row = { key: string; filename: string; session?: CharacterImportSession; file?: File; selected: boolean; name: string; work: string; tags: string; groups: string; interpretation: string; status: 'ready' | 'error' | 'done'; error?: string; duplicates: ImportDuplicate[]; characterId?: string; targetId?: string; targetRevision?: number; coverAvatar: boolean; coverReference: boolean; originType: 'ip' | 'original' };
const STORAGE_KEY = 'sthstart.character-import-batch.v1';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function CharacterBatchImport({ open, onOpenChange, onCommitted, works }: { open: boolean; onOpenChange: (open: boolean) => void; onCommitted: () => void; works: CharacterWork[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [coverAvatar, setCoverAvatar] = useState(true);
  const [coverReference, setCoverReference] = useState(false);
  const [fields, setFields] = useState(emptyOrganizationFields);
  const updateRows = (update: Row[] | ((current: Row[]) => Row[])) => { const next = typeof update === 'function' ? update(rowsRef.current) : update; rowsRef.current = next; setRows(next); };
  const patch = (key: string, changes: Partial<Row>) => updateRows(current => current.map(row => row.key === key ? { ...row, ...changes } : row));
  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Array<Omit<Row, 'session' | 'file'> & { sessionId?: string }>;
        const restored: Row[] = [];
        for (const row of saved.slice(0, 500)) {
          if (row.status === 'done') { restored.push({ ...row, selected: false }); continue; }
          if (!row.sessionId) continue;
          try {
            const session = await fetchImportSession(row.sessionId);
            if (session.status === 'cancelled' || session.status === 'expired') continue;
            restored.push({ ...row, session, status: session.status === 'committed' ? 'done' : 'ready', selected: session.status === 'committed' ? false : row.selected, characterId: typeof session.commitResult?.characterId === 'string' ? session.commitResult.characterId : row.characterId });
          } catch { restored.push({ ...row, status: 'error', selected: false, error: '会话恢复失败，请重新选择该文件' }); }
        }
        if (active) { rowsRef.current = restored; setRows(restored); }
      } catch { /* An invalid local checkpoint must not prevent a fresh import. */ }
      if (active) setReady(true);
    };
    void restore();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.map(row => { const { session, ...saved } = row; delete saved.file; return { ...saved, sessionId: session?.id }; }))); }
    catch { /* Import still works when browser storage is unavailable. */ }
  }, [rows, ready]);
  const parseFile = async (file: File, key = crypto.randomUUID()) => {
    let session: CharacterImportSession | undefined;
    try {
      session = await createCharacterImportSessionFromFile(file);
      if (!session.candidate || !Object.keys(session.candidate.originalCard).length) throw new Error('未检测到角色卡数据；普通图片请到角色详情中上传');
      const duplicates = (await fetchImportDuplicates(session.id)).items;
      const inBatch = rowsRef.current.some(r => r.key !== key && r.session?.source.payloadHash === session!.source.payloadHash);
      const draft = session.candidate.draft;
      const row: Row = { key, file, filename: file.name, session, selected: !inBatch && !duplicates.some(d => d.kind === 'exact'), name: draft.displayName, work: draft.work, tags: (session.candidate.tags || []).join('，'), groups: '', interpretation: '', coverAvatar: session.candidate.cover.available, coverReference: false, originType: draft.originType, status: 'ready', duplicates, error: inBatch ? '本批次已有相同文件，默认不勾选' : undefined };
      updateRows(current => [...current.filter(r => r.key !== key), row]);
    } catch (error) {
      if (session) await cancelCharacterImportSession(session.id).catch(() => undefined);
      updateRows(current => [...current.filter(r => r.key !== key), { key, file, filename: file.name, selected: false, name: file.name, work: '', tags: '', groups: '', interpretation: '', coverAvatar: false, coverReference: false, originType: 'original', status: 'error', error: message(error), duplicates: [] }]);
    }
  };
  const addFiles = async (files: File[]) => {
    if (busy || !ready) return;
    setBusy(true); setNotice('正在逐张解析…');
    const available = Math.max(0, 500 - rowsRef.current.length);
    for (const file of files.slice(0, available)) { setNotice(`正在解析 ${file.name}`); await parseFile(file); }
    setBusy(false); setNotice(files.length > available ? '本批次最多 500 张，超出的文件请在下一批导入。' : '解析完成。请检查作品、重复提示和勾选项，再确认导入。');
  };
  const applyFields = () => updateRows(current => current.map(row => row.selected && row.status !== 'done' ? { ...row,
    work: fields.work.trim() && (!fields.fillEmpty || !row.work) ? fields.work.trim() : row.work,
    coverAvatar: !!row.session?.candidate?.cover.available && coverAvatar,
    coverReference: !!row.session?.candidate?.cover.available && coverReference,
    originType: fields.originType || row.originType,
    interpretation: fields.interpretation.trim() && (!fields.fillEmpty || !row.interpretation) ? fields.interpretation.trim() : row.interpretation,
    tags: [...new Set([...splitLabels(row.tags), ...splitLabels(fields.tags)])].join('，'),
    groups: [...new Set([...splitLabels(row.groups), ...splitLabels(fields.groups)])].join('，'),
  } : row));
  const commit = async () => {
    if (busy) return;
    setBusy(true); setNotice('正在导入…');
    for (const original of rowsRef.current.filter(row => row.selected && row.session && row.status !== 'done')) {
      let row = original;
      try {
        // Recover a successful response lost in transit before attempting another write.
        const current = await fetchImportSession(row.session!.id);
        if (current.status === 'committed') { patch(row.key, { status: 'done', selected: false, error: undefined, characterId: typeof current.commitResult?.characterId === 'string' ? current.commitResult.characterId : undefined }); continue; }
        if (!row.name.trim()) throw new Error('请填写角色名称');
        const duplicates = (await fetchImportDuplicates(current.id)).items;
        const target = row.targetId ? duplicates.find(d => d.id === row.targetId) : undefined;
        if (row.targetId && !target) throw new Error('待更新角色已改变，请重新预览');
        const session = await updateCharacterImportSession(current.id, {
          expectedPreviewRevision: current.previewRevision,
          cover: { selectedForAvatar: row.coverAvatar, selectedForReference: row.coverReference },
          candidatePatch: { draft: { displayName: row.name, work: row.work, originType: row.originType }, tags: splitLabels(row.tags), organization: { favorite: false, groups: splitLabels(row.groups), interpretation: row.interpretation } },
        });
        row = { ...row, session }; patch(row.key, { session });
        const result = await commitCharacterImportSession(session.id, { expectedPreviewRevision: session.previewRevision, previewHash: session.previewHash, targetCharacterId: target?.id || null, baseDraftRevision: row.targetRevision ?? null }, `batch-commit-${session.id}`);
        patch(row.key, { status: 'done', selected: false, characterId: result.characterId, error: undefined });
      } catch (error) { patch(row.key, { status: 'error', error: message(error) }); }
    }
    onCommitted(); setBusy(false); setNotice('已完成本次提交。成功项不会重复导入；失败项可修改后重试。');
  };
  const clear = async () => {
    setBusy(true);
    for (const row of rowsRef.current) if (row.session && row.status !== 'done') await cancelCharacterImportSession(row.session.id).catch(() => undefined);
    updateRows([]); setNotice(''); setBusy(false);
  };
  const count = rows.filter(r => r.selected && r.session && r.status !== 'done').length;
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }} title="批量导入角色卡" description="先预览并整理，再确认写入。关闭后可继续本批次，待导入会话保留 24 小时。" className="max-w-5xl" footer={<div className="flex w-full flex-wrap items-center justify-between gap-2"><span className="text-sm">成功 {rows.filter(r => r.status === 'done').length} · 失败 {rows.filter(r => r.status === 'error').length} · 已选 {count}</span><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>稍后继续</Button><Button disabled={busy || !count} onClick={() => void commit()}>{busy ? '处理中…' : `确认导入 / 重试 ${count} 张`}</Button></div></div>}>
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-accent/40 p-4 text-center" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void addFiles(Array.from(e.dataTransfer.files)); }}><p className="mb-2 text-sm text-muted">拖入多个 PNG / JSON 角色卡，或选择文件</p><Button variant="outline" disabled={busy || !ready} onClick={() => fileRef.current?.click()}>选择多个文件</Button><input ref={fileRef} hidden multiple type="file" accept=".json,.png" onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void addFiles(files); }} /></div>
      <fieldset disabled={busy} className="space-y-3"><CharacterOrganizationFields value={fields} onChange={setFields} works={works} /><div className="flex flex-wrap gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={coverAvatar} onChange={e => setCoverAvatar(e.target.checked)} />有封面时设为头像</label><label className="flex items-center gap-2"><input type="checkbox" checked={coverReference} onChange={e => setCoverReference(e.target.checked)} />有封面时作为外观参考</label></div><Button size="sm" variant="outline" disabled={!count} onClick={applyFields}>应用到已勾选项</Button>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => updateRows(current => current.map(r => ({ ...r, selected: !!r.session && r.status !== 'done' && !r.duplicates.some(d => d.kind === 'exact') && !r.error?.includes('相同文件') })))}>选择非重复项</Button><Button size="sm" variant="ghost" onClick={() => updateRows(current => current.map(r => ({ ...r, selected: false })))}>取消全选</Button><Button size="sm" variant="ghost" onClick={() => void clear()}>结束本批次 / 清空待导入</Button></div>
      <div className="space-y-3">{rows.map(row => <div key={row.key} className="rounded-lg border border-ink/15 p-3">
        <div className="flex items-center gap-3"><input aria-label={`选择 ${row.name}`} type="checkbox" disabled={!row.session || row.status === 'done'} checked={row.selected} onChange={e => patch(row.key, { selected: e.target.checked })} />{row.session?.candidate?.cover.available && <Image unoptimized width={48} height={48} className="h-12 w-12 rounded object-cover" src={`/api/admin/characters/import-sessions/${row.session.id}/cover`} alt="" />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{row.name}</p><p className="text-sm text-muted">{row.filename} · {row.status === 'done' ? '已导入' : row.status === 'error' ? '待处理' : '待确认'}</p></div>{row.characterId && <a className="text-sm text-accent" href={`/apps/characters/${row.characterId}`} target="_blank" rel="noreferrer">打开角色</a>}</div>
        {row.error && <p role="alert" className="mt-2 text-sm text-accent-dark">{row.error}</p>}
        {!row.session && row.file && <Button size="sm" variant="outline" onClick={async () => { setBusy(true); await parseFile(row.file!, row.key); setBusy(false); }}>重新解析</Button>}
        {row.session && row.status !== 'done' && <details className="mt-2"><summary className="cursor-pointer text-sm">编辑与预览 · {row.work || '未分类'} · {row.tags || '无标签'}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{(['name', 'work', 'tags', 'groups', 'interpretation'] as const).map((key, i) => <label key={key} className="text-sm">{['角色名', '作品', '标签（逗号分隔）', '分组（逗号分隔）', '人设演绎'][i]}<Input value={row[key]} onChange={e => patch(row.key, { [key]: e.target.value })} /></label>)}<label className="text-sm">创作类型<select className="block w-full rounded border p-2" value={row.originType} onChange={e => patch(row.key, { originType: e.target.value as Row['originType'] })}><option value="original">原创</option><option value="ip">已有 IP</option></select></label></div><div className="mt-3 flex flex-wrap gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" disabled={!row.session.candidate?.cover.available} checked={row.coverAvatar || false} onChange={e => patch(row.key, { coverAvatar: e.target.checked })} />封面设为头像</label><label className="flex items-center gap-2"><input type="checkbox" disabled={!row.session.candidate?.cover.available} checked={row.coverReference || false} onChange={e => patch(row.key, { coverReference: e.target.checked })} />封面作为外观参考</label></div><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-sm text-muted">{JSON.stringify(row.session.candidate?.draft, null, 2)}</pre>{row.session.compatibility?.warnings.map(w => <p key={w} className="mt-1 text-sm text-muted">{w}</p>)}</details>}
        {!!row.duplicates.length && row.status !== 'done' && <div className="mt-2 text-sm"><Button size="sm" variant="ghost" onClick={async () => { setBusy(true); try { const matches = await fetchImportDuplicates(row.session!.id); patch(row.key, { duplicates: matches.items, targetId: undefined, targetRevision: undefined, error: undefined }); } catch (error) { patch(row.key, { error: message(error) }); } finally { setBusy(false); } }}>刷新重复预览</Button><p>发现{row.duplicates.some(d => d.kind === 'exact') ? '相同内容（默认跳过）' : '同名或同来源角色'}，不会自动覆盖。</p><select aria-label={`${row.name} 的重复处理`} className="mt-2 w-full rounded border p-2" value={row.targetId || ''} onChange={e => patch(row.key, { targetId: e.target.value || undefined, targetRevision: row.duplicates.find(d => d.id === e.target.value)?.draftRevision })}><option value="">另存为一张人设卡（需勾选）</option>{[...new Map(row.duplicates.map(d => [d.id, d])).values()].map(d => <option key={d.id} value={d.id}>更新：{d.displayName} · {d.id.slice(0, 8)}</option>)}</select></div>}
      </div>)}</div></fieldset>
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    </div>
  </Dialog>;
}
