'use client';

import { useId, useState, type CSSProperties } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-react';
import { Pagination as MantinePagination } from '@mantine/core';
import { getPagination, positiveInteger } from '../../lib/pagination';
import { AnchoredPopover } from './anchored-popover';
import { Button } from './button';
import { Input } from './input';

type EdgeIconProps = { className?: string; style?: CSSProperties };

function PreviousIcon({ className, style }: EdgeIconProps) {
  return <ChevronLeft className={className} style={{ ...style, width: 16, height: 16 }} aria-hidden="true" />;
}

function NextIcon({ className, style }: EdgeIconProps) {
  return <ChevronRight className={className} style={{ ...style, width: 16, height: 16 }} aria-hidden="true" />;
}

/** Mantine's PaginationItems owns the ellipsis wrapper; keep the project's text glyph. */
function EllipsisIcon() {
  return <span className="pagination-ellipsis" aria-hidden="true">…</span>;
}

/** Capacity changes reset the page through the existing caller callback. */
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
  const [open, setOpen] = useState<'size' | 'jump' | null>(null);
  const [jump, setJump] = useState('');
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  const multiPage = state.pageCount > 1;
  const options = [...new Set([...pageSizeOptions, state.pageSize])]
    .filter(value => Number.isSafeInteger(value) && value > 0).sort((a, b) => a - b);
  const summary = state.total === 0 ? '共 0 条' : multiPage
    ? `共 ${state.total} 条，当前 ${state.start}–${state.end} 条`
    : `共 ${state.total} 条`;

  function change(next: number) {
    if (loading) return;
    setOpen(null);
    if (next !== state.page) onPageChange(next);
  }

  function submitJump() {
    if (loading) return;
    const target = positiveInteger(jump.trim(), 0);
    if (!target || target > state.pageCount) { setInvalid(true); return; }
    change(target);
  }

  const nextControl = (
    <MantinePagination.Next className="pagination-next" aria-label="下一页" title="下一页" icon={NextIcon} />
  );

  const jumpTrigger = (
    <Button size="sm" variant="ghost" className="pagination-trigger pagination-jump-trigger"
      data-state={open === 'jump' ? 'open' : 'closed'}
      aria-label={`跳到指定页，当前第 ${state.page} 页，共 ${state.pageCount} 页`} disabled={loading}>
      <span className="pagination-jump-label">跳页</span>
      <span className="pagination-page-counter">{state.page} / {state.pageCount}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </Button>
  );

  const jumpPopover = (
    <AnchoredPopover
      title="跳到指定页" open={open === 'jump'} onOpenChange={next => {
        if (next) { setJump(''); setInvalid(false); }
        setOpen(next ? 'jump' : null);
      }}
      className="pagination-jump-panel" align={compact ? 'center' : 'end'}
      trigger={jumpTrigger}
    >
      <div className="pagination-jump-field">
        <Input aria-label="跳转页码" aria-describedby={hintId} data-popover-focus="true"
          inputMode="numeric" value={jump} placeholder={String(state.page)} error={invalid} disabled={loading}
          onChange={event => { setJump(event.target.value); setInvalid(false); }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            submitJump();
          }} />
        <Button variant="primary" size="sm" disabled={loading || !jump.trim()} onClick={submitJump}>
          跳转 <CornerDownLeft size={14} aria-hidden="true" />
        </Button>
      </div>
      <p id={hintId} className="pagination-jump-hint" data-invalid={invalid || undefined} aria-live="polite">
        {invalid ? `请输入 1–${state.pageCount} 之间的整数页码` : `第 ${state.page} 页 · 共 ${state.pageCount} 页`}
      </p>
      <div className="pagination-boundaries">
        <Button size="sm" variant="ghost" disabled={loading || state.page === 1} onClick={() => change(1)}>首页</Button>
        <Button size="sm" variant="ghost" disabled={loading || state.page === state.pageCount} onClick={() => change(state.pageCount)}>末页</Button>
      </div>
    </AnchoredPopover>
  );

  return (
    <nav aria-label="分页" aria-busy={loading} className="pagination" data-compact={compact || undefined}>
      <div className="pagination-layout">
        <p role="status" className="pagination-summary">{loading ? '正在更新…' : summary}</p>
        {onPageSizeChange && options.length > 1 && (
          <AnchoredPopover
            title="每页条数" open={open === 'size'} onOpenChange={next => setOpen(next ? 'size' : null)}
            className="pagination-size-menu"
            trigger={<Button size="sm" variant="ghost" className="pagination-trigger"
              data-state={open === 'size' ? 'open' : 'closed'}
              aria-label={`每页条数，当前 ${state.pageSize} 条`} disabled={loading}>
              每页 {state.pageSize} 条 <ChevronDown size={14} aria-hidden="true" />
            </Button>}
          >
            <div className="pagination-size-options">
              {options.map(size => (
                <Button key={size} size="sm" variant="ghost" disabled={loading}
                  aria-pressed={size === state.pageSize}
                  data-popover-focus={size === state.pageSize || undefined}
                  onClick={() => {
                    setOpen(null);
                    if (size !== state.pageSize) onPageSizeChange(size);
                  }}>
                  {size} 条
                  {size === state.pageSize && <Check size={16} aria-hidden="true" />}
                </Button>
              ))}
            </div>
          </AnchoredPopover>
        )}
        {multiPage && (
          <MantinePagination.Root
            className="pagination-moves"
            total={state.pageCount}
            value={state.page}
            onChange={change}
            disabled={loading}
            siblings={1}
            boundaries={1}
            classNames={{ control: 'pagination-control', dots: 'pagination-dots' }}
            getItemProps={page => ({ className: 'pagination-number', 'aria-label': `第 ${page} 页` })}
          >
            <MantinePagination.Previous className="pagination-previous" aria-label="上一页" title="上一页" icon={PreviousIcon} />
            {!compact && (
              <div className="pagination-numbers">
                <MantinePagination.Items dotsIcon={EllipsisIcon} />
              </div>
            )}
            {compact ? <>{jumpPopover}{nextControl}</> : <>{nextControl}{jumpPopover}</>}
          </MantinePagination.Root>
        )}
      </div>
    </nav>
  );
}
