'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Plus, Search, Star, SlidersHorizontal } from 'lucide-react';
import type { NoteCategory, NoteKind, NoteNature, NoteUsage } from '@sthstart/contracts';
import { useNotes } from '../queries';
import { useLocalNotebookNotes } from '../hooks';
import { categoryLabels, kindLabels, natureLabels, stageLabels, usageLabels } from '../schemas';
import { PageHeader } from '@/app/components/shared/page-header';
import { Input } from '@/app/components/ui/input';
import { Pagination } from '@/app/components/ui/pagination';
import { Alert } from '@/app/components/ui/alert';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { SectionHeader } from '@/app/components/shared/section-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { localNoteBadge } from '../model/local-note-status';
import './notebook-layout.css';

const filterOptions: Array<{ value: 'all' | NoteKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'diary', label: '日记' },
  { value: 'idea', label: '灵感' },
  { value: 'note', label: '随记' },
  { value: 'story', label: '剧情' },
  { value: 'character', label: '角色' },
  { value: 'world', label: '世界' },
];

function formatDate(iso?: string) {
  if (!iso) return '';
  // 本地离线记录可能带有无效时间戳，Intl.format(Invalid Date) 会抛
  // RangeError 打白整个列表；无效值直接不显示。
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

export function NotebookList() {
  const [selectedFilter, setSelectedFilter] = useState<'all' | NoteKind>('all');
  const [query, setQuery] = useState('');
  const [usageFilter, setUsageFilter] = useState<'' | NoteUsage>('');
  const [natureFilter, setNatureFilter] = useState<'' | NoteNature>('');
  const [categoryFilter, setCategoryFilter] = useState<'' | NoteCategory>('');
  const [workFilter, setWorkFilter] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [composing, setComposing] = useState(false);
  const filterKey = JSON.stringify([selectedFilter, query, usageFilter, natureFilter, categoryFilter, workFilter]);
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (filterKey !== previousFilterKey) { setPreviousFilterKey(filterKey); setPage(1); }
  // 元数据与关键词筛选走服务端：不在首批 300 条里过滤。
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query, composing]);
  const restoring = useRef(true);
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const kind = filterOptions.find(option => option.value === params.get('filterKind'))?.value ?? 'all';
      const q = params.get('q') ?? '';
      const usage = params.get('usage') ?? '', nature = params.get('nature') ?? '', category = params.get('category') ?? '', work = params.get('work') ?? '';
      restoring.current = true;
      setSelectedFilter(kind); setQuery(q); setDebouncedQuery(q);
      setUsageFilter(usage as '' | NoteUsage); setNatureFilter(nature as '' | NoteNature); setCategoryFilter(category as '' | NoteCategory); setWorkFilter(work);
      setPreviousFilterKey(JSON.stringify([kind, q, usage, nature, category, work]));
      setPage(Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1));
      setPageSize([20, 50, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20);
    };
    restore(); window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (restoring.current) { restoring.current = false; return; }
    const params = new URLSearchParams(window.location.search);
    const values = { q: query, filterKind: selectedFilter, usage: usageFilter, nature: natureFilter, category: categoryFilter, work: workFilter, page: String(page), pageSize: String(pageSize) };
    for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); }
    window.history.replaceState(window.history.state, '', window.location.pathname + '?' + params);
  }, [query, selectedFilter, usageFilter, natureFilter, categoryFilter, workFilter, page, pageSize]);

  const { data, isLoading, isFetching, error, refetch } = useNotes({
    ...(debouncedQuery.trim() ? { q: debouncedQuery.trim() } : {}),
    ...(selectedFilter !== 'all' ? { kind: selectedFilter } : {}),
    ...(usageFilter ? { usage: usageFilter } : {}),
    ...(natureFilter ? { nature: natureFilter } : {}),
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(workFilter ? { works: [workFilter] } : {}),
    page, pageSize,
  });
  const localRecords = useLocalNotebookNotes(data?.items);
  const localStatusById = useMemo(
    () => new Map(localRecords.map((record) => [record.noteId, record.status])),
    [localRecords],
  );
  const notes = useMemo(() => {
    const merged = new Map((data?.items ?? []).filter((note) => note.id).map((note) => [note.id!, note]));
    for (const record of localRecords) {
      if (record.status === 'deleted') merged.delete(record.noteId);
      else if (!data || record.status !== 'synced') merged.set(record.noteId, record.note);
    }
    return [...merged.values()].sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));
  }, [data, localRecords]);

  const matchingNotes = useMemo(() => {
    return notes.filter((item) => {
      if (selectedFilter !== 'all' && item.kind !== selectedFilter) return false;
      if (usageFilter && (item.knowledge?.usage ?? 'record') !== usageFilter) return false;
      if (natureFilter && (item.knowledge?.nature ?? 'unconfirmed') !== natureFilter) return false;
      if (categoryFilter && item.knowledge?.category !== categoryFilter) return false;
      if (workFilter && !item.knowledge?.works.some(work => work.name === workFilter || work.key === workFilter)) return false;
      if (data?.items.some(server => server.id === item.id)) return true;
      const needle = debouncedQuery.trim().toLowerCase();
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.summary.toLowerCase().includes(needle) ||
        item.tags.some((t) => t.toLowerCase().includes(needle)) || JSON.stringify(item.content).toLowerCase().includes(needle)
      );
    });
  }, [notes, selectedFilter, debouncedQuery, usageFilter, natureFilter, categoryFilter, workFilter, data]);
  const visibleNotes = data ? matchingNotes : matchingNotes.slice((page - 1) * pageSize, page * pageSize);
  const total = data?.total ?? matchingNotes.length;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconcile server/cache bounds after deletion and synchronization.
  useEffect(() => { if (!isFetching) setPage(p => Math.min(p, Math.max(1, Math.ceil(total / pageSize)))); }, [total, pageSize, isFetching]);

  const characterNotes = notes.filter((n) => n.kind === 'character').slice(0, 4);
  const worldNotes = notes.filter((n) => n.kind === 'world').slice(0, 4);
  const facets = data?.facets;
  const metadataFilterActive = Boolean(usageFilter || natureFilter || categoryFilter || workFilter);

  return (
    <PageContainer className="notebook-list-page space-y-5 py-6 pb-10 text-ink">
      <PageHeader
        className="notebook-list-header"
        title="创作笔记"
        description="记录日常、灵感与设定；标记为「可参考」的资料会进入企划检索范围。"
        actions={
          <Link
            href="/apps/notebook/new"
            className={`${buttonVariants({ variant: 'accent', size: 'sm' })} notebook-new-note-action`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>新建笔记</span>
          </Link>
        }
      />

      {error && (
        <Alert variant="danger" title="笔记加载失败">
          {error instanceof Error ? error.message : String(error)}
          <Button size="sm" onClick={() => void refetch()}>重试</Button><p>当前仅显示本机缓存资料。</p>
        </Alert>
      )}

      <div className="notebook-list-filters notebook-toolbar flex flex-col items-stretch gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            value={query}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、正文或标签…"
            className="pl-9 text-base sm:text-sm"
          />
        </div>

        <div
          // globals.css 的未分层 .notebook-filter-options 会压过 overflow-x-auto
          // utility，这里与工作台一致改为换行，避免 769-1023px 视口裁掉尾部分类。
          className="notebook-filter-options flex flex-wrap items-center gap-1 w-full"
          role="group"
          aria-label="笔记分类筛选"
        >
          {filterOptions.map((opt) => {
            const isActive = selectedFilter === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={isActive}
                onClick={() => setSelectedFilter(opt.value)}
                className={'ui-choice notebook-filter-chip px-2.5 py-1 text-sm font-medium whitespace-nowrap ' + (
                  isActive
                    ? 'bg-surface-sunken text-ink'
                    : 'text-muted'
                )}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="notebook-filter-summary flex min-w-0 flex-wrap items-center gap-3 px-1 py-1">
        <Button size="sm" variant="outline" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />更多筛选{metadataFilterActive ? ' · 已启用' : ''}
        </Button>
        {metadataFilterActive && <p className="min-w-0 flex-1 text-sm text-muted">{[
          workFilter && `作品：${workFilter}`,
          usageFilter && `参考状态：${usageLabels[usageFilter]}`,
          natureFilter && `内容性质：${natureLabels[natureFilter]}`,
          categoryFilter && `资料类型：${categoryLabels[categoryFilter]}`,
        ].filter(Boolean).join('　·　')}</p>}
        {data?.total !== undefined && <span className="ml-auto text-sm text-muted">共 {data.total} 条资料</span>}
      </div>

      <ResponsiveEditOverlay
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="资料筛选"
        description="搜索和资料分类常驻在列表顶部；这些元数据条件只影响当前列表。"
        footer={<><Button type="button" variant="outline" onClick={() => { setUsageFilter(''); setNatureFilter(''); setCategoryFilter(''); setWorkFilter(''); }}>清空条件</Button><Button type="button" onClick={() => setFiltersOpen(false)}>完成</Button></>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!!facets?.works.length && (
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted">作品</span>
                <Select aria-label="按作品筛选" value={workFilter} onChange={(event) => setWorkFilter(event.target.value)} className="h-10 text-base sm:text-sm">
                  <option value="">全部作品</option>
                  {facets.works.map((work) => <option key={work} value={work}>{work}</option>)}
                </Select>
              </label>
            )}
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted">参考状态</span>
                <Select aria-label="按参考状态筛选" value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as '' | NoteUsage)} className="h-10 text-base sm:text-sm">
                <option value="">不限</option>
                {Object.entries(usageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted">内容性质</span>
                <Select aria-label="按内容性质筛选" value={natureFilter} onChange={(event) => setNatureFilter(event.target.value as '' | NoteNature)} className="h-10 text-base sm:text-sm">
                <option value="">不限</option>
                {Object.entries(natureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted">资料类型</span>
                <Select aria-label="按资料类型筛选" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as '' | NoteCategory)} className="h-10 text-base sm:text-sm">
                <option value="">不限</option>
                {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
        </div>
      </ResponsiveEditOverlay>

      {isLoading && notes.length === 0 ? (
        <div className="notebook-list-skeleton divide-y divide-border-subtle">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="flex items-center gap-4 py-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      ) : visibleNotes.length > 0 ? (
        <div className="notebook-list-results space-y-10">
          <section className="notebook-recent-section space-y-1">
            <SectionHeader
              className="notebook-section-heading"
              title={selectedFilter === 'all' ? '最近记录' : kindLabels[selectedFilter]}
              description="按最近更新排列，继续你的创作线索。"
              actions={<span className="text-xs tabular-nums text-fg-subtle">{visibleNotes.length} 条</span>}
            />

            <ul className="notebook-note-list divide-y divide-border-subtle" role="list">
              {visibleNotes.map((note) => {
                const badge = localNoteBadge(note.id ? localStatusById.get(note.id) : undefined, Boolean(data));
                return (
                <li key={note.id}>
                  <Link
                    href={'/apps/notebook/' + note.id}
                    className={'notebook-list-item group -mx-2 flex items-baseline gap-4 rounded-control px-2 py-3 transition-colors hover:bg-surface-hover note-kind-' + note.kind}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2.5">
                        <h4 className="truncate text-sm font-medium text-ink">{note.title || '未命名笔记'}</h4>
                        <span className="notebook-list-meta flex-none text-xs">{kindLabels[note.kind]}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted">{note.summary || '还没有正文摘要，点开继续记录。'}</p>
                    </div>
                    <div className="flex flex-none flex-wrap items-center justify-end gap-2 text-xs">
                      <span className="notebook-list-meta">{stageLabels[note.stage]}</span>
                      {note.knowledge?.usage === 'reference' && <span className="notebook-list-meta">{usageLabels[note.knowledge.usage]}</span>}
                      <time className="notebook-list-meta tabular-nums">{formatDate(note.updatedAt)}</time>
                      {badge && (
                        <span className="notebook-local-badge" data-local-status={badge.status} title="本机记录；未同步的草稿会在联网后自动同步">
                          {badge.label}
                        </span>
                      )}
                      {note.favorite && <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />}
                    </div>
                  </Link>
                </li>
                );
              })}
            </ul>
          </section>

          <section className="notebook-lore-section grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="notebook-lore-shelf">
              <div className="flex items-baseline justify-between border-b border-border-subtle pb-2">
                <h4 className="text-sm font-semibold text-ink">角色人设</h4>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedFilter('character')}
                  className="px-1 text-xs font-medium text-muted"
                >
                  查看全部
                </Button>
              </div>
              <ul className="divide-y divide-border-subtle" role="list">
                {characterNotes.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={'/apps/notebook/' + item.id}
                      className="-mx-1 flex items-center justify-between gap-3 rounded-control px-1 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <span className="truncate text-sm text-ink">{item.title}</span>
                      <time className="flex-none text-xs tabular-nums text-fg-subtle">{formatDate(item.updatedAt)}</time>
                    </Link>
                  </li>
                ))}
                {characterNotes.length === 0 && (
                  <li>
                    <Link
                      href="/apps/notebook/new?kind=character"
                      className="block py-3 text-sm text-muted hover:text-ink"
                    >
                      ＋ 建立第一份角色人设笔记
                    </Link>
                  </li>
                )}
              </ul>
            </div>

            <div className="notebook-lore-shelf">
              <div className="flex items-baseline justify-between border-b border-border-subtle pb-2">
                <h4 className="text-sm font-semibold text-ink">世界故事</h4>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedFilter('world')}
                  className="px-1 text-xs font-medium text-muted"
                >
                  查看全部
                </Button>
              </div>
              <ul className="divide-y divide-border-subtle" role="list">
                {worldNotes.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={'/apps/notebook/' + item.id}
                      className="-mx-1 flex items-center justify-between gap-3 rounded-control px-1 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <span className="truncate text-sm text-ink">{item.title}</span>
                      <time className="flex-none text-xs tabular-nums text-fg-subtle">{formatDate(item.updatedAt)}</time>
                    </Link>
                  </li>
                ))}
                {worldNotes.length === 0 && (
                  <li>
                    <Link
                      href="/apps/notebook/new?kind=world"
                      className="block py-3 text-sm text-muted hover:text-ink"
                    >
                      ＋ 记录第一份世界观设定
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          </section>
        </div>
      ) : error ? (
        <p className="py-8 text-center text-sm text-muted">本机没有匹配的缓存资料，请恢复连接后重试。</p>
      ) : (
        <EmptyState
          symbol="拾"
          title={query ? '未搜索到相关笔记' : '从第一条创作记录开始'}
          description={
            query
              ? '尝试输入其他关键词，或在上方切换筛选分类。'
              : '写下一段随想、灵感对白，或者构思一个尚未命名的人物设定。'
          }
          actions={
            <div className="flex gap-2">
              <Link
                href="/apps/notebook/new"
                className={buttonVariants({ variant: 'accent', size: 'md' })}
              >
                <Plus className="h-4 w-4" />
                <span>写下第一篇笔记</span>
              </Link>
            </div>
          }
        />
      )}
      <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} pageSizeOptions={[20, 50, 100]} loading={isFetching} />
    </PageContainer>
  );
}
