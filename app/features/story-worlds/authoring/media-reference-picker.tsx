'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ImageIcon, Search, X } from 'lucide-react';
import type { MediaLibraryItem, MediaLibraryKind } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Alert } from '@/app/components/ui/alert';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Skeleton } from '@/app/components/ui/skeleton';
import { fetchMediaLibrary } from '@/app/features/media-library/api';

export interface MediaReferencePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已选素材 ID；页面永远只保存 ID，不保存 URL 或文件名。 */
  value: string[];
  onChange: (ids: string[]) => void;
  title?: string;
  /** 默认最多 10 个，与 WorldActor/WorldVisualReference 契约一致。 */
  max?: number;
  /** 世界参考只接受图片；保留参数仅为兼容旧调用，非图片会被收敛为 image。 */
  mediaKind?: MediaLibraryKind | 'all';
}

const PAGE_SIZE = 24;

/**
 * 媒体引用选择器：作者只从真实媒体库勾选，不手填 artifact ID。
 * 正文按“打开一次重建一次”挂载，因此外部已选值只在打开瞬间对齐。
 */
export function MediaReferencePicker({
  open,
  onOpenChange,
  value,
  onChange,
  title = '选择参考素材',
  max = 10,
}: MediaReferencePickerProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={`从媒体库选择参考素材，最多 ${max} 个。这里只保存素材 ID，生成时会读取对应文件。`}
      size="lg"
    >
      {open ? (
        <MediaPickerBody
          initialValue={value}
          onChange={onChange}
          onClose={() => onOpenChange(false)}
          max={max}
        />
      ) : null}
    </Dialog>
  );
}

function MediaPickerBody({
  initialValue,
  onChange,
  onClose,
  max,
}: {
  initialValue: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
  max: number;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const kind: MediaLibraryKind = 'image';
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initialValue);
  const [selectedMeta, setSelectedMeta] = useState<Record<string, MediaLibraryItem>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const searchId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchMediaLibrary({
          q: debouncedQuery || undefined,
          mediaKind: kind,
          status: 'ready',
          limit: PAGE_SIZE,
          offset,
        });
        if (cancelled) return;
        setItems(response.items);
        setTotal(response.total);
        setSelectedMeta((current) => {
          const next = { ...current };
          for (const item of response.items) next[item.id] = item;
          return next;
        });
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : '媒体库加载失败，请重试。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, kind, offset, reloadToken]);

  const selectedItems = useMemo(
    () => selected.map((id) => selectedMeta[id]).filter((item): item is MediaLibraryItem => Boolean(item)),
    [selected, selectedMeta],
  );

  const toggle = (item: MediaLibraryItem) => {
    setSelected((current) => {
      if (current.includes(item.id)) return current.filter((id) => id !== item.id);
      if (current.length >= max) return current;
      setSelectedMeta((meta) => ({ ...meta, [item.id]: item }));
      return [...current, item.id];
    });
  };

  const remove = (id: string) => setSelected((current) => current.filter((entry) => entry !== id));

  const confirm = () => {
    onChange(selected);
    onClose();
  };

  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-sunken/50 px-3 py-2">
        <span className="text-sm text-muted">已选 {selected.length} / {max}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button variant="primary" size="sm" onClick={confirm} disabled={selected.length === 0}>
            使用这 {selected.length} 个素材
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor={searchId} className="mb-1 block text-sm font-medium text-ink">搜索媒体</label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              value={query}
              placeholder="按文件名或应用搜索"
              className="pl-9"
              onChange={(event) => { setQuery(event.target.value); setOffset(0); }}
            />
          </div>
        </div>
        <p className="self-end pb-2 text-xs text-muted sm:w-40">世界参考只接受图片</p>
      </div>

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="已选素材">
          {selectedItems.map((item) => (
            <span
              key={item.id}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border-subtle bg-surface-sunken py-1 pl-1 pr-2 text-xs text-ink"
            >
              <img
                src={item.thumbnailUrl ?? item.fileUrl}
                alt=""
                className="h-6 w-6 shrink-0 rounded-full object-cover"
              />
              <span className="max-w-[16rem] truncate">{item.originalName ?? item.id}</span>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="rounded-full p-0.5 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-focus-ring"
                aria-label={`移除 ${item.originalName ?? item.id}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error ? (
        <Alert variant="danger" title="媒体库加载失败">
          <p>{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setReloadToken((current) => current + 1)}>
            重试
          </Button>
        </Alert>
      ) : loading && items.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="没有匹配的媒体"
          description={debouncedQuery ? '换个关键词，或放宽类型筛选。' : '媒体库还是空的；先在制作或自由生成里保存素材，再回来选择。'}
        />
      ) : (
        <ul className="grid max-h-[22rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
          {items.map((item) => {
            const checked = selected.includes(item.id);
            const atLimit = !checked && selected.length >= max;
            return (
              <li key={item.id} className="min-w-0">
                <label
                  className={`group flex h-full cursor-pointer flex-col gap-2 rounded-panel border p-2 transition-colors ${
                    checked
                      ? 'border-[var(--selection-border)] bg-[var(--selection-bg)]'
                      : 'border-border-subtle bg-surface hover:bg-surface-hover'
                  } ${atLimit ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-control bg-surface-sunken">
                    <img
                      src={item.thumbnailUrl ?? item.fileUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute right-2 top-2 rounded-full bg-surface/90 p-1 shadow-xs">
                      <Checkbox
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggle(item)}
                        aria-label={`选择 ${item.originalName ?? item.id}`}
                      />
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink" title={item.originalName ?? item.id}>
                      {item.originalName ?? item.id}
                    </span>
                    <span className="block truncate text-xs text-muted">{item.appName} · {item.mediaKind}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>共 {total} 个素材</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!hasPrev} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>上一页</Button>
            <Button size="sm" variant="outline" disabled={!hasNext} onClick={() => setOffset((current) => current + PAGE_SIZE)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 表单里的只读引用行：显示已选数量并提供选择/清除入口。 */
export function MediaReferenceField({
  value,
  onOpen,
  onClear,
  label = '参考素材',
  max = 10,
}: {
  value: string[];
  onOpen: () => void;
  onClear: () => void;
  label?: string;
  max?: number;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={onOpen}>
        <ImageIcon className="h-4 w-4" aria-hidden="true" />
        {value.length > 0 ? `已选 ${value.length} 个素材` : `选择${label}`}
      </Button>
      {value.length > 0 && (
        <Button size="sm" variant="ghost" onClick={onClear}>清除</Button>
      )}
      <span className="text-xs text-muted">最多 {max} 个；只保存素材 ID。</span>
    </div>
  );
}
