'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Search, Star } from 'lucide-react';
import type { NoteKind } from '@sthstart/contracts';
import { useNotes } from '../queries';
import { useLocalNotebookNotes } from '../hooks';
import { kindLabels, stageLabels } from '../schemas';
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

  const { data, isLoading, error } = useNotes();
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

  return (
    <main className="notebook-list-page min-h-screen w-full bg-[#f4f0e7] text-[#18201d] px-4 sm:px-8 md:px-12 py-6">
      <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        className="notebook-list-header"
        backHref="/"
        backLabel="返回门户首页"
        eyebrow="CAPTURE · CONNECT · CREATE"
        title="创作笔记"
        description="把散落的念头留在故事发生之前。记录日常、灵感和设定，成熟片段可标记为剧情候选，流转给剧本与交互体验。"
        actions={
          <Link
            href="/apps/notebook/new"
            className="notebook-new-note-action inline-flex items-center gap-2 px-4 py-2 rounded-[3px_14px_3px_3px] bg-[#e45d35] text-white hover:bg-[#b83b1b] font-semibold text-sm transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>新建记录</span>
          </Link>
        }
      />

      {error && notes.length === 0 && (
        <Alert variant="danger" title="笔记加载失败">
          {error instanceof Error ? error.message : String(error)}
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <div className="notebook-list-filters flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 rounded-[4px_16px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] shadow-sm">
        <div className="relative w-full sm:max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-3 text-[#68716d]" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、正文或标签…"
            className="pl-9 bg-transparent border-[rgb(24_32_29/12%)]"
          />
        </div>

        <div
          className="notebook-filter-options flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0"
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
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#18201d] text-[#f4f0e7]'
                    : 'text-[#68716d] hover:text-[#18201d] hover:bg-[rgb(24_32_29/6%)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid */}
      {isLoading && notes.length === 0 ? (
        <div className="notebook-list-skeleton grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="p-5 rounded-[3px_22px_3px_3px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] space-y-3"
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
            <div className="notebook-section-heading flex items-center justify-between pb-2 border-b border-[rgb(24_32_29/10%)]">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#b83b1b]">
                  RECENT NOTES
                </span>
                <h3 className="font-serif text-2xl font-medium text-[#18201d]">
                  {selectedFilter === 'all' ? '最近记录' : kindLabels[selectedFilter]}
                </h3>
              </div>
              <span className="font-mono text-sm text-[#68716d]">
                {visibleNotes.length.toString().padStart(2, '0')}
              </span>
            </div>

            <div className="notebook-note-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/apps/notebook/${note.id}`}
                  className={`notebook-list-item group relative flex flex-col justify-between p-5 min-h-[220px] rounded-[3px_22px_3px_3px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] hover:border-[#e45d35]/60 hover:shadow-md transition-all duration-200 note-card note-kind-${note.kind}`}
                >
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-[#68716d] mb-2 font-medium">
                      <span>{kindLabels[note.kind]}</span>
                      <time>{formatDate(note.updatedAt)}</time>
                    </div>

                    <h4 className="font-serif text-xl font-medium text-[#18201d] group-hover:text-[#e45d35] transition-colors line-clamp-2">
                      {note.title || '未命名笔记'}
                    </h4>

                    <p className="mt-2 text-xs text-[#68716d] leading-relaxed line-clamp-3">
                      {note.summary || '还没有正文摘要，点开继续记录。'}
                    </p>
                  </div>

                  <div className="notebook-list-item-meta flex items-center justify-between pt-3 mt-4 border-t border-[rgb(24_32_29/8%)] text-[10px] text-[#68716d]">
                    <span className="font-medium">{stageLabels[note.stage]}</span>
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[120px]">
                        {note.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
                      </span>
                      {note.favorite && (
                        <Star className="h-3.5 w-3.5 fill-[#d0a731] text-[#d0a731]" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Lore Shelves */}
          <section className="notebook-lore-section grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[rgb(24_32_29/12%)]">
            <div className="notebook-lore-shelf p-5 rounded-[4px_18px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/12%)] space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-serif text-xl font-medium text-[#18201d]">角色人设</h4>
                <button
                  type="button"
                  onClick={() => setSelectedFilter('character')}
                  className="text-xs text-[#b83b1b] font-medium hover:underline cursor-pointer"
                >
                  查看全部
                </button>
              </div>

              <div className="space-y-2">
                {characterNotes.map((item) => (
                  <Link
                    key={item.id}
                    href={`/apps/notebook/${item.id}`}
                    className="flex items-center justify-between p-2.5 rounded hover:bg-[rgb(24_32_29/4%)] transition-colors border-b border-[rgb(24_32_29/8%)]"
                  >
                    <span className="font-medium text-xs text-[#18201d] truncate">{item.title}</span>
                    <span className="text-[10px] text-[#68716d] flex-shrink-0">
                      {formatDate(item.updatedAt)}
                    </span>
                  </Link>
                ))}
                {characterNotes.length === 0 && (
                  <Link
                    href="/apps/notebook/new?kind=character"
                    className="block p-4 text-center text-xs text-[#68716d] border border-dashed border-[rgb(24_32_29/14%)] rounded hover:border-[#e45d35]"
                  >
                    ＋ 建立第一份角色人设笔记
                  </Link>
                )}
              </div>
            </div>

            <div className="notebook-lore-shelf p-5 rounded-[4px_18px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/12%)] space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-serif text-xl font-medium text-[#18201d]">世界故事</h4>
                <button
                  type="button"
                  onClick={() => setSelectedFilter('world')}
                  className="text-xs text-[#b83b1b] font-medium hover:underline cursor-pointer"
                >
                  查看全部
                </button>
              </div>

              <div className="space-y-2">
                {worldNotes.map((item) => (
                  <Link
                    key={item.id}
                    href={`/apps/notebook/${item.id}`}
                    className="flex items-center justify-between p-2.5 rounded hover:bg-[rgb(24_32_29/4%)] transition-colors border-b border-[rgb(24_32_29/8%)]"
                  >
                    <span className="font-medium text-xs text-[#18201d] truncate">{item.title}</span>
                    <span className="text-[10px] text-[#68716d] flex-shrink-0">
                      {formatDate(item.updatedAt)}
                    </span>
                  </Link>
                ))}
                {worldNotes.length === 0 && (
                  <Link
                    href="/apps/notebook/new?kind=world"
                    className="block p-4 text-center text-xs text-[#68716d] border border-dashed border-[rgb(24_32_29/14%)] rounded hover:border-[#e45d35]"
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
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[3px_14px_3px_3px] bg-[#e45d35] text-white font-semibold text-sm hover:bg-[#b83b1b] transition-colors shadow-xs"
              >
                <Plus className="h-4 w-4" />
                <span>写下第一篇笔记</span>
              </Link>
            </div>
          }
        />
      )}
      </div>
    </main>
  );
}
