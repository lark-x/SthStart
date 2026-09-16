'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, RefreshCw, Wand2 } from 'lucide-react';
import type { KnowledgePendingItem } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { Textarea } from '@/app/components/ui/textarea';
import { useNotes } from '@/app/features/notebook/queries';
import { useKnowledgeSearch } from '@/app/features/notebook/queries';
import { adoptOrganizeDraft, createOrganizeDraft, fetchOrganizeDraft } from '../api';

/**
 * 整理草稿：左边是原资料，右边是模型建议。
 * 采用前校验目标资料的版本；生成期间目标被编辑时保留草稿并要求重新预览。
 */
export function OrganizeDraftDialog({ open, onOpenChange, itemIds, items, onAdopted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemIds: string[];
  items: KnowledgePendingItem[];
  onAdopted: (noteId: string, created: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="整理为资料"
      description="选择一个整理方向与目标；模型只使用上面这些来源，不确定的内容会标注为推测。"
      className="max-w-4xl"
    >
      {open && <OrganizeBody itemIds={itemIds} items={items} onAdopted={onAdopted} />}
    </Dialog>
  );
}

function OrganizeBody({ itemIds, items, onAdopted }: {
  itemIds: string[];
  items: KnowledgePendingItem[];
  onAdopted: (noteId: string, created: boolean) => void;
}) {
  const [mode, setMode] = useState<'new-note' | 'append'>('new-note');
  const [targetNoteId, setTargetNoteId] = useState('');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [narrativeRefIds, setNarrativeRefIds] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notesQuery = useNotes({ pageSize: 100 });
  const noteOptions = (notesQuery.data?.items ?? []).filter((note) => note.id);

  const draftQuery = useQuery({
    queryKey: ['knowledge-draft', draftId],
    queryFn: () => fetchOrganizeDraft(draftId!),
    enabled: Boolean(draftId),
    refetchInterval: (query) => (['queued', 'running'].includes(query.state.data?.status ?? '') ? 1_500 : false),
  });
  const draft = draftQuery.data ?? null;

  // 草稿的目标信息用来在采用时提示“目标已被编辑”。
  const targetRevision = notesQuery.data?.items.find((note) => note.id === targetNoteId)?.revision;

  const selectedSources = items.filter((item) => itemIds.includes(item.id));
  // 标题优先用用户输入，其次用草稿标题；不用 effect 回填，避免多余的级联渲染。
  const effectiveTitle = title || draft?.title || '';

  const generate = async () => {
    setError(null); setBusy(true);
    try {
      const created = await createOrganizeDraft({
        itemIds,
        ...(narrativeRefIds.length ? { narrativeRefIds } : {}),
        ...(mode === 'append' && targetNoteId ? { targetNoteId } : {}),
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      });
      setDraftId(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成整理草稿失败。');
    } finally { setBusy(false); }
  };

  const adopt = async () => {
    if (!draft) return;
    setError(null); setBusy(true);
    try {
      const result = await adoptOrganizeDraft(draft.id, {
        mode,
        ...(mode === 'append' ? { targetNoteId, ...(targetRevision === undefined ? {} : { expectedRevision: targetRevision }) } : {}),
        ...(effectiveTitle.trim() ? { title: effectiveTitle.trim() } : {}),
      });
      onAdopted(result.noteId, result.created);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '采用草稿失败。';
      setError(message.includes('已被编辑') || message.includes('已变化')
        ? message + ' 草稿已保留，可以点「重新生成」后再采用。'
        : message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}

      {/* 第一步：选择整理方向与目标 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-semibold text-ink">目标</span>
          <Select aria-label="整理目标" value={mode} className="h-9 text-sm" disabled={Boolean(draft)} onChange={(event) => setMode(event.target.value as 'new-note' | 'append')}>
            <option value="new-note">保存为新资料</option>
            <option value="append">追加到已有资料</option>
          </Select>
        </label>
        {mode === 'append' && (
          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-ink">已有资料</span>
            <Select aria-label="已有资料" value={targetNoteId} className="h-9 text-sm" disabled={Boolean(draft)} onChange={(event) => setTargetNoteId(event.target.value)}>
              <option value="">请选择</option>
              {noteOptions.map((note) => <option key={note.id} value={String(note.id)}>{note.title || '未命名资料'}</option>)}
            </Select>
          </label>
        )}
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">整理方向</span>
        <Textarea aria-label="整理方向" rows={2} value={instruction} placeholder="例如：整理成人物关系资料，只保留有来源的部分" className="text-sm" disabled={Boolean(draft)} onChange={(event) => setInstruction(event.target.value)} />
      </label>
     {!draft && (
       <Button variant="primary" disabled={busy || (mode === 'append' && !targetNoteId)} onClick={() => void generate()}>
      {/* 原文片段：可以直接引用叙事档案里的剧情原文，不要求先成为待整理条目。 */}
      {!draft && (
        <NarrativeFragmentPicker
          picked={narrativeRefIds}
          onChange={setNarrativeRefIds}
        />
      )}

          {busy ? '正在整理…' : <><Wand2 className="h-3.5 w-3.5" />生成整理草稿</>}
        </Button>
      )}

      {/* 两步视图：左边始终是原资料，右边是生成后的建议整理。 */}
      {true && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">原资料（{selectedSources.length}）</h3>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {selectedSources.map((item) => (
                <li key={item.id} className="space-y-1 rounded-lg border border-border-subtle p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="text-xs text-ink">{item.title}</strong>
                    <Badge variant={item.changeType === 'new' ? 'online' : 'warning'} className="text-xs">{item.changeType === 'new' ? '新增' : '有变化'}</Badge>
                  </div>
                  <p className="line-clamp-4 text-xs text-muted">{item.excerpt}</p>
                  {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">打开来源</a>}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">建议整理</h3>
            {!draft && <p className="text-xs text-muted">点「生成整理草稿」后，这里会显示模型建议的正文。</p>}
            {draft && (draft.status === 'queued' || draft.status === 'running') ? <Spinner size="sm" label="正在整理…" /> : null}
            {draft && draft.status === 'failed' && <Alert variant="warning" title="整理失败">{draft.errorMessage || '请稍后重试'}。原始资料仍然保留，可以重新生成。</Alert>}
            {draft && draft.status === 'succeeded' && (
              <>
                <Input aria-label="草稿标题" value={effectiveTitle} className="h-9 text-sm" onChange={(event) => setTitle(event.target.value)} />
                <Textarea aria-label="草稿正文" rows={10} value={draft.text} className="text-sm" readOnly />
                <p className="text-xs text-muted">
                  草稿冻结了 {draft.sources.length} 个来源版本；采用后这些来源会写进资料的来源列表。
                  {mode === 'append' && ' 追加不会删除已有正文。'}
                </p>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void generate()}><RefreshCw className="h-3.5 w-3.5" />重新生成</Button>
              {draft && draft.status === 'succeeded' && (
                <Button variant="primary" disabled={busy || !draft.text.trim()} onClick={() => void adopt()}>
                  {busy ? '正在保存…' : mode === 'append' ? '追加到已有资料' : <><FilePlus2 className="h-3.5 w-3.5" />保存为新资料</>}
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** 原文片段选择：在叙事档案里检索并挑片段，作为整理草稿的来源。 */
function NarrativeFragmentPicker({ picked, onChange }: {
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword), 250);
    return () => clearTimeout(timer);
  }, [keyword]);

  const search = useKnowledgeSearch({ ...(debounced.trim() ? { q: debounced.trim() } : {}), kinds: ['narrative'], limit: 20 }, Boolean(debounced.trim()));
  const items = search.data?.items ?? [];

  return (
    <div className="space-y-2 rounded-lg border border-border-subtle p-3">
      <div>
        <span className="text-sm font-semibold text-ink">添加原文片段（可选）</span>
        <p className="text-xs text-muted">从叙事档案里检索剧情原文，和上面的待整理条目一起整理成一篇资料。</p>
      </div>
      <Input aria-label="搜索原文片段" value={keyword} className="h-9 text-sm" placeholder="输入角色、地点或关键词" onChange={(event) => setKeyword(event.target.value)} />
      {search.isLoading && <Spinner size="sm" label="正在检索原文…" />}
      {Boolean(debounced.trim()) && !search.isLoading && !items.length && (
        <p className="text-xs text-muted">叙事档案中暂未找到匹配片段；可以先导入规范化 JSON，或换个关键词。</p>
      )}
      <ul className="max-h-40 space-y-1.5 overflow-y-auto">
        {items.map((item) => {
          const selected = picked.includes(item.id);
          return (
            <li key={item.id}>
              <label className={'flex items-start gap-2 rounded border p-2 ' + (selected ? 'border-accent bg-accent/5' : 'border-border-subtle')}>
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={'选择原文 ' + item.title}
                  checked={selected}
                  onChange={() => onChange(selected ? picked.filter((id) => id !== item.id) : [...picked, item.id])}
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink">{item.title}{item.work ? '（' + item.work + '）' : ''}</span>
                  <span className="line-clamp-2 block text-xs text-muted">{item.excerpt}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!!picked.length && <p className="text-xs text-muted">已选 {picked.length} 段原文；行号是叙事档案里的本地行号。</p>}
    </div>
  );
}
