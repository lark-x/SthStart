'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  Star,
  ArrowLeft,
  ChevronLeft,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import type { NoteKind } from '@sthstart/contracts';
import { useNotes } from '../queries';
import { useLocalNotebookNotes } from '../hooks';
import { kindLabels, stageLabels } from '../schemas';
import { NoteEditor } from './note-editor';
import { Input } from '@/app/components/ui/input';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Button } from '@/app/components/ui/button';
import { EyeCareToggle } from '@/app/components/shared/eye-care-toggle';

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
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
    new Date(iso)
  );
}

export function NotebookWorkspace({
  initialNoteId,
  isNew = false,
  initialKind = 'diary',
}: {
  initialNoteId?: string;
  isNew?: boolean;
  initialKind?: NoteKind;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Sidebar collapsed state: default true (collapsed to 0px)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sthstart_notebook_sidebar_collapsed');
      if (stored !== null) return stored === 'true';
    }
    return true;
  });

  const [selectedFilter, setSelectedFilter] = useState<'all' | NoteKind>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(initialNoteId ?? null);
  const [isCreating, setIsCreating] = useState<boolean>(isNew);
  const [createKind, setCreateKind] = useState<NoteKind>(
    (searchParams?.get('kind') as NoteKind) || initialKind
  );

  const { data, isLoading } = useNotes();
  const localRecords = useLocalNotebookNotes(data?.items);

  const notes = useMemo(() => {
    const merged = new Map(
      (data?.items ?? []).filter((note) => note.id).map((note) => [note.id!, note])
    );
    for (const record of localRecords) {
      if (record.status === 'deleted') merged.delete(record.noteId);
      else merged.set(record.noteId, record.note);
    }
    return [...merged.values()].sort((left, right) =>
      String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
    );
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

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sthstart_notebook_sidebar_collapsed', String(next));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (initialNoteId) {
      setActiveId(initialNoteId);
      setIsCreating(false);
    } else if (isNew) {
      setIsCreating(true);
      setActiveId(null);
    } else if (notes.length > 0 && !activeId && !isCreating) {
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
        setActiveId(notes[0].id ?? null);
      }
    }
  }, [initialNoteId, isNew, notes, activeId, isCreating]);

  const handleSelectNote = (id: string) => {
    setIsCreating(false);
    setActiveId(id);
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      window.history.replaceState(null, '', "/apps/notebook/" + id);
    } else {
      router.push("/apps/notebook/" + id);
    }
  };

  const handleStartNew = (kind: NoteKind = 'diary') => {
    setCreateKind(kind);
    setIsCreating(true);
    setActiveId(null);
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      window.history.replaceState(null, '', "/apps/notebook/new?kind=" + kind);
    } else {
      router.push("/apps/notebook/new?kind=" + kind);
    }
  };

  const handleMobileBack = () => {
    setActiveId(null);
    setIsCreating(false);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/apps/notebook');
    }
  };

  const isEditingOnMobile = Boolean(activeId || isCreating);

  return (
    <main className="notebook-workspace-shell notebook-list-page min-h-screen w-full bg-[#f4f0e7] text-[#18201d] flex flex-col">
      {/* Top Global Header Bar */}
      <header className="notebook-workspace-header notebook-list-header sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-6 py-2 bg-[#f4f0e7]/95 backdrop-blur-md border-b border-[rgb(24_32_29/12%)]">
        {/* Top Left: Navigation & Sidebar Drawer Toggle */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="notebook-back-home inline-flex items-center gap-1.5 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回门户首页</span>
          </Link>
          <span className="text-xs text-[#68716d]/30 hidden sm:inline">|</span>

          {/* Toggle sidebar button (Desktop Left) */}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[3px_8px_3px_3px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] hover:bg-white text-xs font-semibold text-[#68716d] hover:text-[#18201d] transition-colors shadow-2xs cursor-pointer"
            title={collapsed ? '展开笔记列表' : '收起笔记列表'}
            aria-label={collapsed ? '展开笔记列表' : '收起笔记列表'}
          >
            {collapsed ? <PanelLeft className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            <span>{collapsed ? '展开列表' : '收起列表'}</span>
          </button>

          <h1 className="font-serif text-sm font-semibold text-[#18201d] flex items-center gap-2">
            <span className="h-5 w-5 rounded-full bg-[#6b7160] text-[#f4f0e7] flex items-center justify-center font-serif text-xs font-bold">
              拾
            </span>
            <span>创作笔记</span>
          </h1>
        </div>

        {/* Top Right: Actions */}
        <div className="page-header-actions flex items-center gap-2">
          <EyeCareToggle />
          <Link
            href="/apps/notebook/new"
            onClick={(e) => {
              if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                e.preventDefault();
                handleStartNew('diary');
              }
            }}
            className="notebook-new-note-action inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[3px_10px_3px_3px] bg-[#e45d35] text-white hover:bg-[#b83b1b] font-semibold text-xs transition-colors shadow-xs cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建记录</span>
          </Link>
        </div>
      </header>

      {/* 2-Column Master-Detail Workspace Body */}
      <div className="notebook-workspace-body flex flex-1 min-h-0 overflow-hidden">
        {/* Left Column: Master List Pane (Collapsible Drawer) */}
        <aside
          className={
            "notebook-master-pane flex flex-col border-r border-[rgb(24_32_29/10%)] bg-[#f7f4ee] transition-[width,padding] duration-200 ease-in-out " +
            (isEditingOnMobile ? 'hidden lg:flex ' : 'flex ') +
            (collapsed ? 'hidden lg:w-0 lg:min-w-0 lg:overflow-hidden lg:border-none lg:p-0' : 'w-full lg:w-[300px] lg:min-w-[300px]')
          }
        >
          {/* List Search & Filter Toolbar */}
          <div className="notebook-master-toolbar notebook-list-filters p-3 space-y-2.5 border-b border-[rgb(24_32_29/8%)] bg-[#fffdf8]/70">
            <div className="relative w-full">
              <Search
                className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-[#68716d]"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题、正文或标签…"
                className="pl-7.5 h-8 bg-transparent border-[rgb(24_32_29/12%)] text-xs placeholder:text-[#68716d]/50 focus:bg-white"
              />
            </div>

            {/* Filter Category Pills */}
            <div
              className="notebook-filter-options flex items-center gap-1 overflow-x-auto pb-0.5"
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
                    className={"px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer " + (
                      isActive
                        ? 'bg-[#18201d] text-[#f4f0e7]'
                        : 'text-[#68716d] hover:text-[#18201d] hover:bg-[rgb(24_32_29/6%)]'
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Note Items List Stream */}
          <div className="notebook-master-list flex-1 overflow-y-auto p-2 space-y-1.5">
            {isLoading && notes.length === 0 ? (
              <div className="p-2 space-y-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="p-3 rounded-lg border border-[rgb(24_32_29/8%)] bg-[#fffdf8] space-y-2"
                  >
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            ) : visibleNotes.length > 0 ? (
              visibleNotes.map((item) => {
                const isSelected = !isCreating && activeId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectNote(item.id!)}
                    className={"notebook-list-item group relative p-3 rounded-[3px_10px_3px_3px] border transition-all duration-150 cursor-pointer " + (
                      isSelected
                        ? 'bg-[#fffdf8] border-[#e45d35] shadow-xs ring-1 ring-[#e45d35]/30'
                        : 'bg-[#fffdf8]/60 border-[rgb(24_32_29/8%)] hover:bg-[#fffdf8] hover:border-[rgb(24_32_29/18%)]'
                    )}
                  >
                    <div className="flex items-center justify-between text-[10px] text-[#68716d] mb-1">
                      <span className="font-semibold text-[#b83b1b]">
                        {kindLabels[item.kind]}
                      </span>
                      <time className="font-mono text-[9.5px]">{formatDate(item.updatedAt)}</time>
                    </div>

                    <h4
                      className={"font-serif text-sm font-semibold truncate transition-colors " + (
                        isSelected
                          ? 'text-[#18201d]'
                          : 'text-[#18201d] group-hover:text-[#e45d35]'
                      )}
                    >
                      {item.title || '未命名笔记'}
                    </h4>

                    <p className="mt-1 text-[11px] text-[#68716d] line-clamp-2 leading-relaxed">
                      {item.summary || '写下一段文字记录…'}
                    </p>

                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-[rgb(24_32_29/6%)] text-[10px] text-[#68716d]">
                      <span className="text-[9.5px] font-medium text-[#68716d]/80">
                        {stageLabels[item.stage]}
                      </span>
                      <div className="flex items-center gap-1">
                        {item.tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="bg-[rgb(24_32_29/5%)] px-1.5 py-0.2 rounded text-[9px]"
                          >
                            #{t}
                          </span>
                        ))}
                        {item.favorite && (
                          <Star
                            className="h-3 w-3 fill-[#d0a731] text-[#d0a731]"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-[#68716d] space-y-2">
                <p>{query ? '未搜索到相关笔记' : '暂无此类记录'}</p>
                <button
                  type="button"
                  onClick={() => handleStartNew(selectedFilter === 'all' ? 'diary' : selectedFilter)}
                  className="text-[#e45d35] font-semibold hover:underline cursor-pointer"
                >
                  ＋ 新建记录
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Right Column: Detail Canvas Pane */}
        <section
          className={
            "notebook-detail-pane flex-1 min-w-0 bg-[#fffdf8] flex flex-col min-h-0 overflow-y-auto " +
            (isEditingOnMobile ? 'flex' : 'hidden lg:flex')
          }
        >
          {/* Mobile Back Button Bar */}
          {isEditingOnMobile && (
            <div className="lg:hidden flex items-center justify-between px-4 py-2 bg-[#f4f0e7] border-b border-[rgb(24_32_29/10%)]">
              <button
                type="button"
                onClick={handleMobileBack}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>返回笔记列表</span>
              </button>
              <span className="text-xs text-[#68716d] font-medium">编辑模式</span>
            </div>
          )}

          {isCreating ? (
            <NoteEditor
              key={"new-" + createKind}
              initialKind={createKind}
              standalone={false}
            />
          ) : activeId ? (
            <NoteEditor
              key={activeId}
              noteId={activeId}
              standalone={false}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <EmptyState
                symbol="拾"
                title="创作笔记工作台"
                description="从左侧选择一篇笔记开始回顾，或点击右上角「新建记录」随手写下一段灵感。"
                actions={
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => handleStartNew('diary')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>写下第一篇笔记</span>
                  </Button>
                }
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
