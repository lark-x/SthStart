'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Search, Star } from 'lucide-react';
import type { NoteCategory, NoteKind, NoteNature, NoteUsage } from '@sthstart/contracts';
import { useNotes } from '../queries';
import { useLocalNotebookNotes } from '../hooks';
import { categoryLabels, kindLabels, natureLabels, stageLabels, usageLabels } from '../schemas';
import { PageHeader } from '@/app/components/shared/page-header';
import { Input } from '@/app/components/ui/input';
import { Alert } from '@/app/components/ui/alert';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Skeleton } from '@/app/components/ui/skeleton';

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
  // 元数据与关键词筛选走服务端：不在首批 300 条里过滤。
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading, error } = useNotes({
    ...(debouncedQuery.trim() ? { q: debouncedQuery.trim() } : {}),
    ...(selectedFilter !== 'all' ? { kind: selectedFilter } : {}),
    ...(usageFilter ? { usage: usageFilter } : {}),
    ...(natureFilter ? { nature: natureFilter } : {}),
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(workFilter ? { works: [workFilter] } : {}),
    pageSize: 120,
  });
  const localRecords = useLocalNotebookNotes(data?.items);
  const notes = useMemo(() => {
    const merged = new Map((data?.items ?? []).filter((note) => note.id).map((note) => [note.id!, note]));
    for (const record of localRecords) {
      if (record.status === 'deleted') merged.delete(record.noteId);
      else merged.set(record.noteId, record.note);
    }
    return [...merged.values()].sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));
  }, [data, localRecords]);

  const visibleNotes = useMemo(() => {
    return notes.filter((item) => {
      if (selectedFilter !== 'all' && item.kind !== selectedFilter) return false;
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.summary.toLowerCase().includes(needle) ||
        item.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [notes, selectedFilter, query]);

  const characterNotes = notes.filter((n) => n.kind === 'character').slice(0, 4);
  const worldNotes = notes.filter((n) => n.kind === 'world').slice(0, 4);
  const facets = data?.facets;
  const metadataFilterActive = Boolean(usageFilter || natureFilter || categoryFilter || workFilter);

  return (
    <div className="notebook-list-page w-full bg-paper text-ink px-4 sm:px-6 py-6">
      <div className="mx-auto w-full max-w-[1920px] space-y-4">
      <PageHeader
        className="notebook-list-header"
        title="创作资料库"
        description="记录日常、灵感与设定，也可以把资料整理成可供企划参考的依据。标记为「可参考」的资料会进入检索范围。"
        actions={
          <Link
            href="/apps/notebook/new"
            className="notebook-new-note-action inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-white hover:bg-accent-dark font-semibold text-sm transition-colors cursor-pointer shadow-xs shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>新建资料</span>
          </Link>
        }
      />

      {error && notes.length === 0 && (
        <Alert variant="danger" title="笔记加载失败">
          {error instanceof Error ? error.message : String(error)}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <div className="notebook-list-filters flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 rounded-[var(--radius-panel)] bg-surface border border-border-default shadow-sm">
        <div className="relative w-full sm:max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、正文或标签…"
            className="pl-9 border-border-control"
          />
        </div>

        <div
          // globals.css 的未分层 .notebook-filter-options 会压过 overflow-x-auto
          // utility，这里与工作台一致改为换行，避免 769-1023px 视口裁掉尾部分类。
          className="notebook-filter-options flex flex-wrap items-center gap-1.5 w-full"
          role="group"
          aria-label="笔记分类筛选"
        >
          {filterOptions.map((opt) => {
            const isActive = selectedFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setSelectedFilter(opt.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-ink text-paper'
                    : 'text-muted hover:text-ink hover:bg-ink/6'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

     {/* Main Grid */}
        {/* 元数据筛选：作品 / 参考状态 / 内容性质 / 资料类型（服务端筛选）。 */}
        {(facets || metadataFilterActive) && (
          <div className="flex flex-wrap items-end gap-2 px-4 py-3 rounded-[var(--radius-panel)] bg-surface border border-border-default shadow-sm">
            {!!facets?.works.length && (
              <label className="space-y-1">
                <span className="text-xs text-muted">作品</span>
                <select aria-label="按作品筛选" value={workFilter} onChange={(event) => setWorkFilter(event.target.value)} className="h-8 rounded border border-border-control bg-surface-raised px-2 text-sm text-ink">
                  <option value="">全部作品</option>
                  {facets.works.map((work) => <option key={work} value={work}>{work}</option>)}
                </select>
              </label>
            )}
            <label className="space-y-1">
              <span className="text-xs text-muted">参考状态</span>
              <select aria-label="按参考状态筛选" value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as '' | NoteUsage)} className="h-8 rounded border border-border-control bg-surface-raised px-2 text-sm text-ink">
                <option value="">不限</option>
                {Object.entries(usageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">内容性质</span>
              <select aria-label="按内容性质筛选" value={natureFilter} onChange={(event) => setNatureFilter(event.target.value as '' | NoteNature)} className="h-8 rounded border border-border-control bg-surface-raised px-2 text-sm text-ink">
                <option value="">不限</option>
                {Object.entries(natureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">资料类型</span>
              <select aria-label="按资料类型筛选" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as '' | NoteCategory)} className="h-8 rounded border border-border-control bg-surface-raised px-2 text-sm text-ink">
                <option value="">不限</option>
                {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {metadataFilterActive && (
              <button type="button" className="h-8 px-3 rounded border border-border-default text-sm text-muted hover:text-ink" onClick={() => { setUsageFilter(''); setNatureFilter(''); setCategoryFilter(''); setWorkFilter(''); }}>清空筛选</button>
            )}
            {data?.total !== undefined && <span className="ml-auto text-xs text-muted">共 {data.total} 条资料</span>}
          </div>
        )}
      {isLoading && notes.length === 0 ? (
        <div className="notebook-list-skeleton grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="p-5 rounded-[var(--radius-panel)] border border-border-default bg-surface space-y-3"
            >
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : visibleNotes.length > 0 ? (
        <div className="notebook-list-results space-y-10">
          <section className="notebook-recent-section space-y-4">
            <div className="notebook-section-heading flex items-center justify-between pb-2 border-b border-border-subtle">
              <div>
                <span className="text-sm font-bold uppercase tracking-wider text-accent-dark">
                  RECENT NOTES
                </span>
                <h3 className="text-xl font-medium text-ink">
                  {selectedFilter === 'all' ? '最近记录' : kindLabels[selectedFilter]}
                </h3>
              </div>
              <span className="font-mono text-sm text-muted">
                {visibleNotes.length.toString().padStart(2, '0')}
              </span>
            </div>

            <div className="notebook-note-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/apps/notebook/${note.id}`}
                  className={`notebook-list-item group relative flex flex-col justify-between p-5 min-h-[220px] rounded-[var(--radius-panel)] border border-border-default bg-surface hover:border-accent/60 hover:shadow-md transition-all duration-200 note-card note-kind-${note.kind}`}
                >
                  <div>
                    <div className="flex items-center justify-between text-sm text-muted mb-2 font-medium">
                      <span>{kindLabels[note.kind]}</span>
                      <time>{formatDate(note.updatedAt)}</time>
                    </div>

                    <h4 className="text-xl font-medium text-ink group-hover:text-accent transition-colors line-clamp-2">
                      {note.title || '未命名笔记'}
                    </h4>

                    <p className="mt-2 text-sm text-muted leading-relaxed line-clamp-3">
                      {note.summary || '还没有正文摘要，点开继续记录。'}
                    </p>
                  </div>

                    <div className="notebook-list-item-meta flex items-center justify-between pt-3 mt-4 border-t border-border-subtle text-sm text-muted">
                      <span className="font-medium">{stageLabels[note.stage]}</span>
                      <div className="flex items-center gap-2">
                        {note.knowledge && (
                          <>
                            <span className={note.knowledge.usage === 'reference' ? 'text-accent-dark' : ''}>{usageLabels[note.knowledge.usage]}</span>
                            <span>{natureLabels[note.knowledge.nature]}</span>
                          </>
                        )}
                      <span className="truncate max-w-[120px]">
                        {note.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
                      </span>
                      {note.favorite && (
                        <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Lore Shelves */}
          <section className="notebook-lore-section grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border-subtle">
            <div className="notebook-lore-shelf p-5 rounded-[var(--radius-panel)] bg-surface border border-border-subtle space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xl font-medium text-ink">角色人设</h4>
                <button
                  type="button"
                  onClick={() => setSelectedFilter('character')}
                  className="text-sm text-accent-dark font-medium hover:underline cursor-pointer"
                >
                  查看全部
                </button>
              </div>

              <div className="space-y-2">
                {characterNotes.map((item) => (
                  <Link
                    key={item.id}
                    href={`/apps/notebook/${item.id}`}
                    className="flex items-center justify-between p-2.5 rounded hover:bg-ink/4 transition-colors border-b border-border-subtle"
                  >
                    <span className="font-medium text-sm text-ink truncate">{item.title}</span>
                    <span className="text-sm text-muted flex-shrink-0">
                      {formatDate(item.updatedAt)}
                    </span>
                  </Link>
                ))}
                {characterNotes.length === 0 && (
                  <Link
                    href="/apps/notebook/new?kind=character"
                    className="block p-4 text-center text-sm text-muted border border-dashed border-border-default rounded hover:border-accent"
                  >
                    ＋ 建立第一份角色人设笔记
                  </Link>
                )}
              </div>
            </div>

            <div className="notebook-lore-shelf p-5 rounded-[var(--radius-panel)] bg-surface border border-border-subtle space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xl font-medium text-ink">世界故事</h4>
                <button
                  type="button"
                  onClick={() => setSelectedFilter('world')}
                  className="text-sm text-accent-dark font-medium hover:underline cursor-pointer"
                >
                  查看全部
                </button>
              </div>

              <div className="space-y-2">
                {worldNotes.map((item) => (
                  <Link
                    key={item.id}
                    href={`/apps/notebook/${item.id}`}
                    className="flex items-center justify-between p-2.5 rounded hover:bg-ink/4 transition-colors border-b border-border-subtle"
                  >
                    <span className="font-medium text-sm text-ink truncate">{item.title}</span>
                    <span className="text-sm text-muted flex-shrink-0">
                      {formatDate(item.updatedAt)}
                    </span>
                  </Link>
                ))}
                {worldNotes.length === 0 && (
                  <Link
                    href="/apps/notebook/new?kind=world"
                    className="block p-4 text-center text-sm text-muted border border-dashed border-border-default rounded hover:border-accent"
                  >
                    ＋ 记录第一份世界观设定
                  </Link>
                )}
              </div>
            </div>
          </section>
        </div>
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
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-panel)] bg-accent text-white font-semibold text-sm hover:bg-accent-dark transition-colors shadow-xs"
              >
                <Plus className="h-4 w-4" />
                <span>写下第一篇笔记</span>
              </Link>
            </div>
          }
        />
      )}
      </div>
    </div>
  );
}
