'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from './dialog';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { getPagination, getPageNumbers, positiveInteger } from '../../lib/pagination';
import { Button } from './button';
import { Input } from './input';
import { Select } from './select';

/** Stable shared API. onPageSizeChange owns resetting the caller's page to 1. */
export interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  loading?: boolean;
  compact?: boolean;
}

export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange,
  pageSizeOptions = [20, 50, 100], loading = false, compact = false }: PaginationProps) {
  const state = getPagination(total, page, pageSize);
  const [jump, setJump] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const options = [...new Set([...pageSizeOptions, state.pageSize])]
    .filter(value => Number.isSafeInteger(value) && value > 0).sort((a, b) => a - b);
  const change = (next: number) => {
    if (loading || !state.total) return;
    const valid = Math.min(Math.max(1, next), state.pageCount);
    if (valid !== state.page) onPageChange(valid);
  };
  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      {onPageSizeChange && <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
        每页
        <Select aria-label="每页条数" className="w-auto" value={state.pageSize} disabled={loading}
          onChange={event => onPageSizeChange(Number(event.target.value))}>
          {options.map(size => <option key={size} value={size}>{size} 条</option>)}
        </Select>
      </label>}
      <div className="flex items-center gap-2 text-sm">
        <Input aria-label="跳转页码" className="w-20" inputMode="numeric" value={jump}
          placeholder={String(state.page)} disabled={loading || !state.total}
          onChange={event => setJump(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            const target = positiveInteger(jump, 0);
            if (target) { change(target); setJump(''); }
          }} />
        <Button size="sm" variant="outline" disabled={loading || !state.total || !positiveInteger(jump, 0)}
          onClick={() => { change(positiveInteger(jump, state.page)); setJump(''); }}>跳转</Button>
      </div>
    </div>
  );
  return <nav aria-label="分页" aria-busy={loading} className={compact ? 'grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-1 gap-y-1 py-1 text-sm' : 'flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle py-3 text-sm'}>
    <p role="status" className="text-muted">{loading ? '正在更新…' : state.total ? `共 ${state.total} 条，当前 ${state.start}–${state.end} 条` : '共 0 条'}</p>
    {(!compact || state.pageCount > 1) && <div className={compact ? 'col-span-2 row-start-2 flex min-w-0 items-center justify-between gap-0' : 'flex min-w-0 flex-wrap items-center gap-1'}>
      <Button size="icon" variant="ghost" aria-label="首页" disabled={loading || state.page <= 1 || !state.total} onClick={() => change(1)}><ChevronsLeft size={16} /></Button>
      <Button size="icon" variant="ghost" aria-label="上一页" disabled={loading || state.page <= 1 || !state.total} onClick={() => change(state.page - 1)}><ChevronLeft size={16} /></Button>
      {compact ? <span className="px-2 tabular-nums">{state.total ? `${state.page} / ${state.pageCount}` : '0 条'}</span> : getPageNumbers(state.page, state.pageCount).map(token => typeof token === 'number'
        ? <Button key={token} size="icon" variant={token === state.page ? 'secondary' : 'ghost'}
          aria-label={`第 ${token} 页`} aria-current={token === state.page ? 'page' : undefined}
          disabled={loading || !state.total} onClick={() => change(token)}>{token}</Button>
        : <span key={token} aria-hidden="true" className="px-1 text-muted">…</span>)}
      <Button size="icon" variant="ghost" aria-label="下一页" disabled={loading || state.page >= state.pageCount || !state.total} onClick={() => change(state.page + 1)}><ChevronRight size={16} /></Button>
      <Button size="icon" variant="ghost" aria-label="末页" disabled={loading || state.page >= state.pageCount || !state.total} onClick={() => change(state.pageCount)}><ChevronsRight size={16} /></Button>
    </div>}
    {compact ? <>
      <Button variant="ghost" size="sm" className="col-start-2 row-start-1" aria-label="分页选项" aria-haspopup="dialog" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(true)}>选项</Button>
      {optionsOpen && createPortal(<Dialog open onOpenChange={setOptionsOpen} title="分页选项" size="sm" footer={<Button onClick={() => setOptionsOpen(false)}>完成</Button>}>{controls}</Dialog>, document.body)}
    </> : controls}
  </nav>;
}
