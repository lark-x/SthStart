'use client';

import Link from 'next/link';
import { CalendarDays, PenLine, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchRecentWork } from '../features/workspace/api';
import { useLocalNotebookNotes } from '../features/notebook/hooks';
import { Skeleton } from './ui/skeleton';

interface WorkItem {
  id: string;
  title: string;
  href: string;
  kind: '活动' | '笔记' | '角色';
  updatedAt: string;
}

const KIND_ICON = {
  活动: CalendarDays,
  笔记: PenLine,
  角色: Users,
} as const;

function formatUpdated(value: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 工作台主区：按更新时间合并展示最近处理过的活动、笔记与角色。 */
export function RecentWork({ limit = 8 }: { limit?: number }) {
  const visibleLimit = Math.min(50, Math.max(1, Math.trunc(limit) || 8));
  const localNotes = useLocalNotebookNotes();
  const deleted = new Set(localNotes.filter(record => record.status === 'deleted').map(record => record.noteId));
  const requestLimit = Math.min(50, visibleLimit + deleted.size);
  const recent = useQuery({
    queryKey: ['workspace', 'recent', requestLimit],
    queryFn: ({ signal }) => fetchRecentWork(requestLimit, signal),
    staleTime: 0,
  });
  const kinds = { activity: '活动', note: '笔记', character: '角色' } as const;
  const paths = { activity: 'activities', note: 'notebook', character: 'characters' } as const;
  const merged = new Map<string, WorkItem>((recent.data?.items ?? [])
    .filter(item => item.kind !== 'note' || !deleted.has(item.id))
    .map(item => [`${item.kind}-${item.id}`, {
      id: `${item.kind}-${item.id}`, title: item.title || `未命名${kinds[item.kind]}`,
      href: `/apps/${paths[item.kind]}/${encodeURIComponent(item.id)}`, kind: kinds[item.kind], updatedAt: item.updatedAt,
    }]));
  // Pending local drafts remain visible even before the background sync finishes.
  for (const record of localNotes) {
    if (record.status === 'deleted' || (record.status === 'synced' && !recent.isError)) continue;
    const id = `note-${record.noteId}`;
    if (record.status === 'synced' && merged.has(id)) continue;
    merged.set(id, { id, title: record.note.title || '未命名笔记', kind: '笔记',
      href: `/apps/notebook/${encodeURIComponent(record.noteId)}`,
      updatedAt: record.status === 'synced' ? record.note.updatedAt ?? '' : new Date(record.updatedAt).toISOString() });
  }
  const items = [...merged.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, visibleLimit);

  const loading = recent.isLoading;
  const failed = recent.isError && items.length === 0;

  /*
   * 载入态用与真实列表同构的骨架占位：高度与行距和加载完成后一致，
   * 避免数据到达时整页高度跳变；加载提示保留在无障碍树中供读屏与测试识别。
   */
  const skeletonRows = (
    <ul className="space-y-1.5" aria-hidden="true">
      {Array.from({ length: visibleLimit }, (_, index) => (
        <li key={index} className="flex items-center gap-3 rounded-xl bg-surface-sunken/45 px-3 py-2.5">
          <Skeleton className="h-4 w-4 flex-none" />
          <Skeleton className="h-4 min-w-0 flex-1" data-visual-dynamic="true" />
          <Skeleton className="h-3 w-8 flex-none" data-visual-dynamic="true" />
          <Skeleton className="hidden h-3 w-24 flex-none sm:block" data-visual-dynamic="true" />
        </li>
      ))}
    </ul>
  );

  return (
    <section className="tpl-panel p-4 sm:p-5" aria-labelledby="recent-work-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="recent-work-title" className="tpl-section-title">最近工作</h2>
        <Link href="/apps/activities" className="text-sm font-medium text-muted transition-colors hover:text-accent">
          全部活动
        </Link>
      </div>

      {recent.isError && items.length > 0 && <p role="status" className="mb-3 text-xs text-muted">
        暂时无法刷新服务端最近工作，当前显示缓存与本机笔记。
        <button type="button" className="ml-2 underline" onClick={() => void recent.refetch()}>重试</button>
      </p>}

      {loading && items.length === 0 ? (
        <>
          <p role="status" className="sr-only">正在读取…</p>
          {skeletonRows}
        </>
      ) : failed ? (
        <button
          type="button"
          onClick={() => void recent.refetch()}
          className="text-sm font-medium text-accent-dark"
        >
          读取失败，点击重试
        </button>
      ) : items.length === 0 ? (
        <div className="space-y-2 py-2">
          <p className="text-sm text-muted">还没有记录。先新建一个角色或活动，这里会显示最近处理过的内容。</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/apps/characters/new" className="inline-flex min-h-9 items-center rounded-[var(--radius-control)] bg-accent px-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark">
              新建角色
            </Link>
            <Link href="/apps/activities/new" className="inline-flex min-h-9 items-center rounded-[var(--radius-control)] border border-border-default bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-hover">
              新建活动
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-1.5" data-testid="recent-work-list">
          {/*
           * 行数固定为 limit，行距与图标属于版式，纳入基线；
           * 标题与时间来自真实库（含随机夹具后缀），单独标为动态以免每次运行都污染基线。
           */}
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            const updated = formatUpdated(item.updatedAt);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="recent-work-row group flex items-center gap-3 rounded-xl border border-transparent bg-surface-sunken/40 px-3.5 py-2.5 transition-[background-color,border-color,transform] duration-150 ease-[var(--motion-ease)] hover:border-accent/20 hover:bg-surface-sunken/80 hover:translate-x-0.5 active:scale-[0.99]"
                >
                  {/* 每行图标随条目类型变化，类型由真实数据决定，故同样按动态内容遮罩。 */}
                  <span className="recent-work-icon flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-surface text-accent shadow-xs border border-border-subtle/50 transition-transform duration-150 group-hover:scale-105">
                    <Icon className="h-4 w-4" aria-hidden="true" data-visual-dynamic="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" data-visual-dynamic="true">{item.title}</span>
                  <span className="flex-none text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface text-fg-subtle border border-border-subtle/50" data-visual-dynamic="true">{item.kind}</span>
                  {updated && <time className="hidden flex-none text-xs text-fg-subtle sm:inline" dateTime={item.updatedAt} data-visual-dynamic="true">{updated}</time>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
