'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  Star,
  ChevronLeft,
  PanelLeftClose,
  PanelLeft,
  SlidersHorizontal,
} from 'lucide-react';
import type { NoteKind } from '@sthstart/contracts';
import { useNotes } from '../queries';
import { useLocalNotebookNotes } from '../hooks';
import { kindLabels, stageLabels, usageLabels, natureLabels, categoryLabels } from '../schemas';
import { NoteEditor } from './note-editor';
import { CollectionManager } from '@/app/features/knowledge/components/collection-manager';
import { PendingInbox } from '@/app/features/knowledge/components/pending-inbox';
import { Input } from '@/app/components/ui/input';
import { PageHeader } from '@/app/components/shared/page-header';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { PageTabs } from '@/app/components/ui/page-tabs';

const COLLAPSED_KEY = 'sthstart_notebook_sidebar_collapsed';

// 折叠状态以 localStorage 为唯一事实来源：useSyncExternalStore 在服务端
// 渲染固定返回 false，默认展示列表，客户端挂载后读取偏好。
const collapsedListeners = new Set<() => void>();

function subscribeCollapsed(onStoreChange: () => void) {
  collapsedListeners.add(onStoreChange);
  return () => {
    collapsedListeners.delete(onStoreChange);
  };
}

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; }
  catch { return false; }
}

function getServerCollapsed() {
  return false;
}

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focused = pathname !== '/apps/notebook' && pathname !== '/apps/notebook/offline';
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const update = () => {
      if (focused || window.innerWidth < 1024) { el.style.removeProperty('height'); return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - 16;
      el.style.height = available >= 360 ? `${available}px` : '';
    };
    update(); window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [focused]);

  // 初次访问默认显示列表，保留用户主动收起的偏好。
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, getServerCollapsed);

  const [selectedFilter, setSelectedFilter] = useState<'all' | NoteKind>(() => filterOptions.find((item) => item.value === searchParams.get('filterKind'))?.value ?? 'all');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [page, setPage] = useState(Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1));
  const [filters, setFilters] = useState({ work: searchParams.get('work') ?? '', character: searchParams.get('character') ?? '', usage: searchParams.get('usage') ?? '', nature: searchParams.get('nature') ?? '', category: searchParams.get('category') ?? '' });
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const [activeId, setActiveId] = useState<string | null>(initialNoteId ?? null);
  const [isCreating, setIsCreating] = useState<boolean>(isNew);
  // 用户在移动端点过“返回笔记列表”后不再被 initialNoteId 自动拉回编辑器：
  // initialNoteId 是固定 prop，若不加此标记，返回会被 effect 立即撤销，
  // 列表永远隐藏（表现为“列表无法选择”）。
  const [exitedToMobileList, setExitedToMobileList] = useState(false);
  // 资料库顶栏三个视图：资料 / 搜集任务 / 待整理。
  // 视图由 URL 参数推导（任务中心用 ?view=collections 深链进来）；
  // 标签切换同步 URL，刷新与浏览器前进/后退可以还原当前视图。
  const viewParam = searchParams?.get('view');
  const view: 'notes' | 'collections' | 'pending' =
    viewParam === 'collections' || viewParam === 'pending' ? viewParam : 'notes';
  const setView = (next: 'notes' | 'collections' | 'pending') => {
    const params = new URLSearchParams(searchParams?.toString());
    if (next === 'notes') params.delete('view');
    else params.set('view', next);
    router.push(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  const [createKind, setCreateKind] = useState<NoteKind>(
    (searchParams?.get('kind') as NoteKind) || initialKind
  );

  const { data, isLoading, isError, error, refetch } = useNotes({ q: query, kind: selectedFilter, page, pageSize: 50,
    works: filters.work ? [filters.work] : [], characters: filters.character ? [filters.character] : [],
    usage: filters.usage, nature: filters.nature, category: filters.category });
  const localRecords = useLocalNotebookNotes(data?.items);

  const notes = useMemo(() => {
    const merged = new Map(
      (data?.items ?? []).filter((note) => note.id).map((note) => [note.id!, note])
    );
    for (const record of localRecords) {
      if (record.status === 'deleted') merged.delete(record.noteId);
      else if (!data || record.status !== 'synced') merged.set(record.noteId, record.note);
    }
    return [...merged.values()].sort((left, right) =>
      String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
    );
  }, [data, localRecords]);

  const visibleNotes = useMemo(() => {
    return notes.filter((item) => {
      if (selectedFilter !== 'all' && item.kind !== selectedFilter) return false;
      const knowledge = item.knowledge;
      if (filters.work && !knowledge?.works.some((work) => work.name === filters.work || work.key === filters.work)) return false;
      if (filters.character && !knowledge?.characters.some((character) => character.name === filters.character)) return false;
      if (filters.usage && (knowledge?.usage ?? 'record') !== filters.usage) return false;
      if (filters.nature && (knowledge?.nature ?? 'unconfirmed') !== filters.nature) return false;
      if (filters.category && knowledge?.category !== filters.category) return false;
      const needle = query.trim().toLowerCase();
      return !needle || JSON.stringify([item.title, item.summary, item.tags, item.content, knowledge]).toLowerCase().includes(needle);
    });
  }, [notes, selectedFilter, query, filters]);

  const toggleCollapsed = useCallback(() => {
    const next = !readCollapsed();
    try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch { /* 隐私模式仍可使用页面 */ }
    for (const listener of collapsedListeners) listener();
  }, []);

  // 路由切换时同步选中项；同一路由上的其他交互不能反复重置编辑状态。
  // 桌面概览在资料加载后自动预览第一条，正式选中则进入详情路由。
  const appliedRouteRef = useRef<string | null>(null);
  useEffect(() => {
    const routeKey = `${initialNoteId ?? ''}|${isNew ? 'new' : ''}`;
    const routeChanged = appliedRouteRef.current !== routeKey;
    if (routeChanged) appliedRouteRef.current = routeKey;
    if (initialNoteId && !exitedToMobileList) {
      if (routeChanged) {
        setActiveId(initialNoteId);
        setIsCreating(false);
      }
    } else if (isNew) {
      if (routeChanged) {
        setIsCreating(true);
        setActiveId(null);
      }
    } else if (notes.length > 0 && !activeId && !isCreating) {
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- 桌面端未选中时自动打开第一条资料，属于路由/列表外部状态同步。 */
        setActiveId(notes[0].id ?? null);
      }
    }
  }, [initialNoteId, isNew, notes, activeId, isCreating, exitedToMobileList]);

  // 详情与返回链接携带浏览筛选，不依赖组件是否被路由重挂载。
  const browseHref = (path: string, kind?: NoteKind) => {
    const params = new URLSearchParams();
    if (selectedFilter !== 'all') params.set('filterKind', selectedFilter);
    if (query) params.set('q', query);
    if (page > 1) params.set('page', String(page));
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (kind) params.set('kind', kind);
    return `${path}${params.size ? `?${params}` : ''}`;
  };

  const handleSelectNote = (id: string) => {
    setIsCreating(false);
    setActiveId(id);
    router.push(browseHref("/apps/notebook/" + id), { scroll: false });
  };

  const handleStartNew = (kind: NoteKind = 'diary') => {
    setCreateKind(kind);
    setIsCreating(true);
    setActiveId(null);
    router.push(browseHref("/apps/notebook/new", kind), { scroll: false });
  };

  // 退出编辑态回到列表：移动端“返回列表”按钮与删除笔记共用。
  // exitedToMobileList 同时防止 initialNoteId 自动把刚删除/刚退出的笔记拉回编辑器。
  const handleExitEditor = () => {
    setExitedToMobileList(true);
    setActiveId(null);
    setIsCreating(false);
    router.push(browseHref('/apps/notebook'), { scroll: false });
  };

  const isEditingOnMobile = Boolean(activeId || isCreating);

  // 移动端（<1024px）：非编辑态始终整宽显示列表，编辑态只显示编辑器；
  // 桌面端：折叠即隐藏列表。避免把无前缀 hidden 与 flex 同时挂在一个元素上，
  // hidden 会在所有断点压过 flex，导致手机上列表整个消失。
  const masterPaneClass = isEditingOnMobile
    ? collapsed
      ? 'hidden'
      : 'hidden lg:flex lg:w-[280px] lg:min-w-[280px]'
    : collapsed
    ? 'flex w-full lg:hidden'
    : 'flex w-full lg:w-[280px] lg:min-w-[280px]';

  const headerActions = (
            <>
              <button
                type="button"
                onClick={toggleCollapsed}
                className="hidden lg:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-control)] border border-border-default bg-surface text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-ink cursor-pointer"
                title={collapsed ? '展开笔记列表' : '收起笔记列表'}
                aria-label={collapsed ? '展开笔记列表' : '收起笔记列表'}
              >
                {collapsed ? <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{collapsed ? '展开列表' : '收起列表'}</span>
              </button>
          <Link
            href={browseHref("/apps/notebook/new", 'diary')}
            onClick={(e) => {
              if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                e.preventDefault();
                handleStartNew('diary');
              }
            }}
            className="notebook-new-note-action inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-[var(--radius-control)] bg-accent text-[var(--fg-on-accent)] hover:bg-accent-dark font-semibold text-sm transition-colors cursor-pointer shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">新建资料</span>
            <span className="sm:hidden">新建</span>
          </Link>
            </>
  );

  return (
    <div ref={workspaceRef} className={"notebook-workspace-shell notebook-list-page w-full bg-paper text-ink flex flex-col " + (focused ? 'notebook-focused h-dvh overflow-hidden' : '')}>
      {/* Top Global Header Bar */}
      {focused ? <WorkspaceHeader title="创作资料库" backHref={browseHref("/apps/notebook")} backLabel="资料列表" actions={headerActions} /> : <header className="notebook-workspace-header notebook-list-header sticky top-0 z-30 px-4 sm:px-6 py-2 bg-paper/95 backdrop-blur-md border-b border-border-subtle">
        <PageHeader
          compact
          title="创作资料库"
          actions={headerActions}
        />
      </header>}

      {/* 资料库视图切换：资料 / 搜集任务 / 待整理 */}
      <div className="border-b border-border-subtle px-4 py-2 sm:px-6">
        <PageTabs
          ariaLabel="资料库视图"
          value={view}
          tabs={[{ id: 'notes', label: '资料' }, { id: 'collections', label: '搜集任务' }, { id: 'pending', label: '待整理' }]}
          onChange={(next) => {
            if (next === 'notes' || next === 'collections' || next === 'pending') setView(next);
          }}
        />
      </div>

      {view !== 'notes' && (
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-[1400px]">
            {view === 'collections'
              ? <CollectionManager onOpenPending={() => setView('pending')} />
              : <PendingInbox />}
          </div>
        </div>
      )}

      {/* 2-Column Master-Detail Workspace Body */}
      <div className={"notebook-workspace-body min-h-0 overflow-hidden " + (view === 'notes' ? 'flex flex-1' : 'hidden')}>
        {/* Left Column: Master List Pane (Collapsible Drawer) */}
        <aside
          className={
            "notebook-master-pane flex-col border-r border-border-subtle bg-surface-muted transition-[width,padding] duration-200 ease-in-out " +
            masterPaneClass
          }
        >
          {/* List Search & Filter Toolbar */}
          <div className="notebook-master-toolbar notebook-list-filters p-3 space-y-2.5 border-b border-border-subtle bg-surface/70">
            <div className="relative w-full">
              <Search
                className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                placeholder="搜索标题、正文或标签…"
                className="pl-7.5 h-8 border-border-control text-sm placeholder:text-muted/50"
              />
            </div>

            {/* Filter Category Pills */}
            <div
              className="notebook-filter-options flex flex-wrap items-center gap-1 pb-0.5"
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
                    onClick={() => { setSelectedFilter(opt.value); setPage(1); }}
                    className={"px-2.5 py-1 rounded-full text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer " + (
                      isActive
                        ? 'bg-ink text-paper'
                        : 'text-muted hover:text-ink hover:bg-ink/6'
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Advanced Filter Toggle & Drawer */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-surface/50 text-xs">
            <button
              type="button"
              onClick={() => setFilterPanelOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 py-1 px-2 rounded-md font-medium transition-colors cursor-pointer ${
                filterPanelOpen || activeFilterCount > 0
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>高级筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
            </button>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFilters({ work: '', character: '', usage: '', nature: '', category: '' });
                  setPage(1);
                }}
                className="text-muted hover:text-accent cursor-pointer"
              >
                重置
              </button>
            )}
          </div>

          {filterPanelOpen && (
            <div className="grid grid-cols-2 gap-2 p-3 bg-surface-muted/50 border-b border-border-subtle anim-zoom-in-95">
              {([
                ['work', '作品', (data?.facets?.works ?? []).map((v) => [v, v])],
                ['character', '角色', (data?.facets?.characters ?? []).map((v) => [v, v])],
                ['usage', '用途', Object.entries(usageLabels)],
                ['nature', '资料性质', Object.entries(natureLabels)],
                ['category', '内容分类', Object.entries(categoryLabels)],
              ] as [keyof typeof filters, string, string[][]][]).map(([key, label, options]) => (
                <select
                  key={key}
                  aria-label={label}
                  value={filters[key]}
                  className="min-w-0 rounded-md border border-border-control bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  onChange={(event) => {
                    setFilters((current) => ({ ...current, [key]: event.target.value }));
                    setPage(1);
                  }}
                >
                  <option value="">全部{label}</option>
                  {options.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          )}

          {isError && <Alert variant="danger" className="m-3 text-sm" title="资料列表加载失败">
            {error instanceof Error ? error.message : '暂时无法读取服务端资料。'}
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>重试</Button>
          </Alert>}
          {/* Note Items List Stream */}
          <div className="notebook-master-list flex-1 overflow-y-auto p-2 space-y-1.5">
            {isLoading && notes.length === 0 ? (
              <div className="p-2 space-y-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="p-3 rounded-lg border border-border-subtle bg-surface space-y-2"
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
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNote(item.id!)}
                    aria-current={isSelected ? 'page' : undefined}
                    className={"notebook-list-item group relative p-3 rounded-[var(--radius-control)] border transition-all duration-150 cursor-pointer " + (
                      isSelected
                        ? 'bg-surface border-accent shadow-xs ring-1 ring-accent/30'
                        : 'bg-surface/60 border-border-subtle hover:bg-surface hover:border-border-default'
                    )}
                  >
                    <div className="flex items-center justify-between text-sm text-muted mb-1">
                      <span className="font-semibold text-accent-dark">
                        {kindLabels[item.kind]}
                      </span>
                      <time className="text-xs tabular-nums">{formatDate(item.updatedAt)}</time>
                    </div>

                    <h4
                      className={"text-sm font-semibold truncate transition-colors" + (
                        isSelected
                          ? 'text-ink'
                          : 'text-ink group-hover:text-accent'
                      )}
                    >
                      {item.title || '未命名笔记'}
                    </h4>

                    <p className="mt-1 text-sm text-muted line-clamp-2 leading-relaxed">
                      {item.summary || '写下一段文字记录…'}
                    </p>

                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-ink/6 text-sm text-muted">
                      <span className="text-xs text-fg-subtle">
                        {stageLabels[item.stage]}
                      </span>
                      <div className="flex items-center gap-1">
                        {item.tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="bg-ink/5 px-1.5 py-0.2 rounded text-sm"
                          >
                            #{t}
                          </span>
                        ))}
                        {item.favorite && (
                          <Star
                            className="h-3 w-3 fill-warning text-warning"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-6 text-center text-sm text-muted space-y-2">
                <p>{isError ? '可用的本地资料将显示在这里' : query ? '未搜索到相关笔记' : '暂无此类记录'}</p>
                <button
                  type="button"
                  onClick={() => handleStartNew(selectedFilter === 'all' ? 'diary' : selectedFilter)}
                  className="text-accent font-semibold hover:underline cursor-pointer"
                >
                  ＋ 新建资料
                </button>
              </div>
            )}
          </div>
          {data && <div className="flex items-center justify-between gap-2 border-t p-2 text-sm">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button>
            <span>{page} 页 · 共 {data.total ?? data.items.length} 条</span>
            <Button size="sm" variant="ghost" disabled={page * 50 >= (data.total ?? data.items.length)} onClick={() => setPage((value) => value + 1)}>下一页</Button>
          </div>}
        </aside>

        {/* Right Column: Detail Canvas Pane */}
        <section
          className={
            "notebook-detail-pane flex-1 min-w-0 bg-surface flex flex-col min-h-0 overflow-y-auto " +
            (isEditingOnMobile ? 'flex' : 'hidden lg:flex')
          }
        >
          {/* Mobile Back Button Bar */}
          {isEditingOnMobile && !focused && (
            <div className="lg:hidden flex items-center justify-between px-4 py-2 bg-paper border-b border-border-subtle">
              <button
                type="button"
                onClick={handleExitEditor}
                className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-accent cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>返回笔记列表</span>
              </button>
              <span className="text-sm text-muted font-medium">编辑模式</span>
            </div>
          )}

          {isCreating ? (
            <NoteEditor
              key={"new-" + createKind}
              initialKind={createKind}
              standalone={false}
              onDeleted={handleExitEditor}
            />
          ) : activeId ? (
            <NoteEditor
              key={activeId}
              noteId={activeId}
              standalone={false}
              onDeleted={handleExitEditor}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <EmptyState
                symbol="拾"
                title="笔记工作台"
                description="从左侧选择一篇资料开始回顾，或点击右上角「新建资料」随手写下一段灵感。"
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
    </div>
  );
}
