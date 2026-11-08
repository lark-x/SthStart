'use client';

import Link from 'next/link';
import { CalendarDays, PenLine, Users, ArrowRight, BookOpen, Film } from 'lucide-react';
import { useRecentWork } from '../features/workspace/queries';
import { useLocalNotebookNotes } from '../features/notebook/hooks';
import { Skeleton } from './ui/skeleton';
import type { NavTone } from './shared/navigation';

export type WorkKind = '项目' | '制作' | '活动' | '笔记' | '角色';

interface WorkItem {
  id: string;
  title: string;
  href: string;
  kind: WorkKind;
  updatedAt: string;
}

const KIND_ICON: Record<WorkKind, React.ComponentType<{ className?: string; 'data-visual-dynamic'?: string }>> = {
  项目: BookOpen,
  制作: Film,
  活动: CalendarDays,
  笔记: PenLine,
  角色: Users,
};

const KIND_TONE: Record<WorkKind, NavTone> = {
  项目: 'blue',
  制作: 'pink',
  活动: 'orange',
  笔记: 'green',
  角色: 'violet',
};

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

function resolveWorkHref(kind: string, id: string): string {
  switch (kind) {
    case 'story':
      return `/apps/projects/${encodeURIComponent(id)}`;
    case 'publication':
    case 'activity':
      return `/apps/activities/${encodeURIComponent(id)}`;
    case 'note':
      return `/apps/notebook/${encodeURIComponent(id)}`;
    case 'character':
      return `/apps/characters/${encodeURIComponent(id)}`;
    default:
      return `/apps/projects/${encodeURIComponent(id)}`;
  }
}

const KIND_LABELS: Record<string, WorkKind> = {
  story: '项目',
  publication: '制作',
  activity: '活动',
  note: '笔记',
  character: '角色',
};

/** 工作台主区：按更新时间合并展示最近处理过的创作项目、制作、活动、笔记与角色。 */
export function RecentWork({ limit = 8 }: { limit?: number }) {
  const visibleLimit = Math.min(50, Math.max(1, Math.trunc(limit) || 8));
  const localNotes = useLocalNotebookNotes();
  const deleted = new Set(localNotes.filter((record) => record.status === 'deleted').map((record) => record.noteId));
  const requestLimit = Math.min(50, visibleLimit + deleted.size);
  const recent = useRecentWork(requestLimit);

  const merged = new Map<string, WorkItem>(
    (recent.data?.items ?? [])
      .filter((item) => item.kind !== 'note' || !deleted.has(item.id))
      .map((item) => {
        const kindLabel: WorkKind = KIND_LABELS[item.kind] ?? '项目';
        return [
          `${item.kind}-${item.id}`,
          {
            id: `${item.kind}-${item.id}`,
            title: item.title || `未命名${kindLabel}`,
            href: resolveWorkHref(item.kind, item.id),
            kind: kindLabel,
            updatedAt: item.updatedAt,
          },
        ];
      })
  );

  // Pending local drafts remain visible even before the background sync finishes.
  for (const record of localNotes) {
    if (record.status === 'deleted' || (record.status === 'synced' && !recent.isError)) continue;
    const id = `note-${record.noteId}`;
    if (record.status === 'synced' && merged.has(id)) continue;
    merged.set(id, {
      id,
      title: record.note.title || '未命名笔记',
      kind: '笔记',
      href: `/apps/notebook/${encodeURIComponent(record.noteId)}`,
      updatedAt: record.status === 'synced' ? record.note.updatedAt ?? '' : new Date(record.updatedAt).toISOString(),
    });
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
    <ul className="home-list" aria-hidden="true">
      {Array.from({ length: visibleLimit }, (_, index) => (
        <li key={index} className="home-row">
          <Skeleton className="h-8 w-8 rounded-lg flex-none" />
          <Skeleton className="h-4 min-w-0 flex-1" data-visual-dynamic="true" />
          <Skeleton className="h-5 w-12 rounded-full flex-none" data-visual-dynamic="true" />
          <Skeleton className="hidden h-3 w-24 flex-none sm:block" data-visual-dynamic="true" />
        </li>
      ))}
    </ul>
  );

  return (
    <section className="home-section" aria-labelledby="recent-work-title">
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border-subtle pb-3">
        <div>
          <h2 id="recent-work-title" className="tpl-section-title">最近工作</h2>
          <p className="mt-0.5 text-xs text-muted">最近编辑的创作项目、活动、笔记与角色</p>
        </div>
        <Link href="/apps/projects" className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-accent">
          <span>全部项目</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {recent.isError && items.length > 0 && (
        <p role="status" className="mb-3 text-xs text-muted">
          暂时无法刷新服务端最近工作，当前显示缓存与本机笔记。
          <button type="button" className="ml-2 text-sm underline" onClick={() => void recent.refetch()}>重试</button>
        </p>
      )}

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
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted">还没有记录。先新建一个创作项目或角色，这里会显示最近处理过的内容。</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/apps/projects" className="inline-flex min-h-9 items-center rounded-control bg-accent px-3.5 text-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-dark">
              创作项目
            </Link>
            <Link href="/apps/resources" className="inline-flex min-h-9 items-center rounded-control border border-border-default bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-hover">
              资料库
            </Link>
            <Link href="/apps/characters/new" className="inline-flex min-h-9 items-center rounded-control border border-border-default bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-hover">
              新建角色
            </Link>
          </div>
        </div>
      ) : (
        <ul className="home-list" data-testid="recent-work-list">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind] ?? BookOpen;
            const updated = formatUpdated(item.updatedAt);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="recent-work-row home-row group transition-colors"
                >
                  <span className="home-row-icon" data-tone={KIND_TONE[item.kind]}>
                    <Icon className="h-4 w-4" aria-hidden="true" data-visual-dynamic="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" data-visual-dynamic="true">{item.title}</span>
                  <span className="flex-none text-xs text-fg-subtle" data-visual-dynamic="true">{item.kind}</span>
                  {updated && <time className="hidden flex-none text-xs text-fg-subtle tabular-nums sm:inline" dateTime={item.updatedAt} data-visual-dynamic="true">{updated}</time>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
