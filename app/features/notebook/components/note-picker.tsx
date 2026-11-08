'use client';

import { useEffect, useState, useId } from 'react';
import { useNotes } from '../queries';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Pagination } from '@/app/components/ui/pagination';

/** Search the complete server collection; selection is owned by the caller across pages. */
export function NotePicker({ value, onChange, multiple = true }: {
  value: string[]; onChange: (ids: string[]) => void; multiple?: boolean;
}) {
  const [search, setSearch] = useState('');
  const radioName = useId();
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { if (composing) return; const timer = setTimeout(() => { setQ(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search, composing]);
  const result = useNotes({ q, page, pageSize: 20 });
  const updating = result.isFetching || composing || q !== search.trim();
  const total = result.data?.total ?? result.data?.items.length ?? 0;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconcile pagination with the completed server result.
  useEffect(() => { if (result.data && !result.isFetching) setPage(p => Math.min(p, Math.max(1, Math.ceil(total / 20)))); }, [result.data, result.isFetching, total]);
  return <div className="space-y-2">
    <Input aria-label="搜索可关联资料" placeholder="搜索全部资料的标题或正文" value={search} onChange={event => setSearch(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
    <div className="flex items-center justify-between text-xs text-muted"><span>已选 {value.length} 条（跨页保留）</span>{value.length > 0 && <Button size="sm" variant="ghost" onClick={() => onChange([])}>清空选择</Button>}</div>
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-control bg-surface-muted p-2" aria-busy={updating}>
      {result.isError ? <div role="alert">资料读取失败。<Button size="sm" onClick={() => void result.refetch()}>重试</Button></div>
        : result.isLoading || q !== search.trim() ? <p role="status">正在读取资料…</p>
        : !result.data?.items.length ? <p className="text-sm text-muted">{q ? '没有匹配的资料，请调整关键词。' : '还没有可关联的资料。'}</p>
        : result.data.items.filter(note => note.id).map(note => <label key={note.id} className="flex min-h-9 items-center gap-2 rounded-control px-2 text-sm hover:bg-surface-hover">
          <input type={multiple ? 'checkbox' : 'radio'} name={multiple ? undefined : radioName} aria-label={'关联资料 ' + note.title} checked={value.includes(note.id!)} onChange={event => onChange(multiple ? event.target.checked ? [...new Set([...value, note.id!])] : value.filter(id => id !== note.id) : [note.id!])} />
          <span className="min-w-0 truncate">{note.title || '未命名资料'}</span>
        </label>)}
    </div>
    <Pagination total={total} page={page} pageSize={20} onPageChange={setPage} loading={updating} compact />
  </div>;
}
