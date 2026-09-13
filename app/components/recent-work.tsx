'use client';

import Link from 'next/link';
import { CalendarDays, PenLine, Users } from 'lucide-react';
import { useActivities } from '../features/activities/queries';
import { useNotes } from '../features/notebook/queries';
import { useQuery } from '@tanstack/react-query';
import { browseCharacters } from '../features/characters/api';
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
  const activities = useActivities();
  const notes = useNotes();
  const characters = useQuery({
    queryKey: ['work-overview', 'characters'],
    queryFn: ({ signal }) => browseCharacters({ page: 1, pageSize: 8, sort: 'updated' }, signal),
    staleTime: 30_000,
  });

  const queries = [activities, notes, characters];
  const items: WorkItem[] = [
    ...(activities.data?.items ?? [])
      .filter((item) => !item.archived)
      .map((item) => ({ id: `activity-${item.id}`, title: item.title || '未命名活动', href: `/apps/activities/${item.id}`, kind: '活动' as const, updatedAt: item.updatedAt ?? '' })),
    ...(notes.data?.items ?? [])
      .map((item) => ({ id: `note-${item.id}`, title: item.title || '未命名笔记', href: `/apps/notebook/${item.id}`, kind: '笔记' as const, updatedAt: item.updatedAt ?? '' })),
    ...(characters.data?.items ?? [])
      .map((item) => ({ id: `character-${item.id}`, title: item.displayName || '未命名角色', href: `/apps/characters/${item.id}`, kind: '角色' as const, updatedAt: item.updatedAt ?? '' })),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);

  const loading = queries.some((query) => query.isLoading);
  const failed = queries.every((query) => query.isError);

  /*
   * 载入态用与真实列表同构的骨架占位：高度与行距和加载完成后一致，
   * 避免数据到达时整页高度跳变；加载提示保留在无障碍树中供读屏与测试识别。
   */
  const skeletonRows = (
    <ul className="divide-y divide-border-subtle" aria-hidden="true">
      {Array.from({ length: limit }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-2 py-2.5">
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

      {loading && items.length === 0 ? (
        <>
          <p role="status" className="sr-only">正在读取…</p>
          {skeletonRows}
        </>
      ) : failed ? (
        <button
          type="button"
          onClick={() => void Promise.all(queries.map((query) => query.refetch()))}
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
        <ul className="divide-y divide-border-subtle" data-testid="recent-work-list">
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
                  className="flex items-center gap-3 rounded-[var(--radius-control)] px-2 py-2.5 transition-colors hover:bg-surface-hover"
                >
                  {/* 每行图标随条目类型变化，类型由真实数据决定，故同样按动态内容遮罩。 */}
                  <Icon className="h-4 w-4 flex-none text-muted" aria-hidden="true" data-visual-dynamic="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" data-visual-dynamic="true">{item.title}</span>
                  <span className="flex-none text-xs text-fg-subtle" data-visual-dynamic="true">{item.kind}</span>
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
