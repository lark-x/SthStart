'use client';

import Link from 'next/link';
import { Compass, ArrowRight, Plus, UserPlus, NotebookPen } from 'lucide-react';
import { useRecentWork } from '@/app/features/workspace/queries';
import { useLocalNotebookNotes } from '@/app/features/notebook/hooks';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EntityImage, type EntityArtTone } from '@/app/components/ui/entity-art';
import { coverImageUrl } from '@/app/features/covers/api';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { pickNextSteps } from '@/app/components/shared/page-archetypes-model';
import type { NavTone } from '@/app/shell/navigation';

export type WorkKind = '作品' | '项目' | '制作' | '活动' | '笔记' | '角色';

export interface WorkItem {
  id: string;
  title: string;
  href: string;
  kind: WorkKind;
  updatedAt: string;
  /** 封面或角色头像的媒体 ID；没有时显示生成式占位。 */
  imageArtifactId?: string | null;
}

const KIND_TONE: Record<WorkKind, NavTone> = {
  作品: 'blue',
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
    case 'world':
      return `/apps/story-worlds?world=${encodeURIComponent(id)}&view=chapters`;
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
      return `/apps/story-worlds`;
  }
}

const KIND_LABELS: Record<string, WorkKind> = {
  world: '作品',
  story: '项目',
  publication: '制作',
  activity: '活动',
  note: '笔记',
  character: '角色',
};

/** 按更新时间合并服务端最近工作与本机未同步笔记；首页主卡、建议与列表共用同一查询。 */
export function useRecentWorkItems(limit = 8) {
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
            imageArtifactId: item.imageArtifactId ?? null,
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

  return { items, recent, visibleLimit, loading: recent.isLoading, failed: recent.isError && items.length === 0 };
}

/** 卡片缩略图：有封面或头像时显示真实图像，否则按实体 ID 生成稳定纹样（EntityArt）。 */
function WorkThumb({ item, size = 'md' }: { item: WorkItem; size?: 'md' | 'lg' }) {
  return (
    <span className="work-thumb-frame" data-size={size} aria-hidden="true">
      <EntityImage
        seed={item.id}
        title={item.title}
        tone={KIND_TONE[item.kind] as EntityArtTone}
        ratio="avatar"
        src={coverImageUrl(item.imageArtifactId)}
        alt=""
      />
    </span>
  );
}

function relativeUpdated(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatUpdated(value);
}

/** 首页主卡：最近编辑的一项，告诉用户上次停在哪里，并给出唯一的主按钮。 */
export function ContinueCreatingCard() {
  const { items, loading, failed } = useRecentWorkItems(HOME_RECENT_LIMIT);
  const latest = items[0];
  if (loading && !latest) {
    return (
      <div className="continue-card" aria-busy="true">
        <Skeleton className="h-20 w-20 rounded-[var(--radius-panel)] flex-none" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
    );
  }
  if (!latest) {
    return (
      <div className="continue-card" data-empty="true">
        <span className="work-thumb" data-size="lg" data-tone="blue" aria-hidden="true">
          <Compass className="work-thumb-icon" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="continue-card-eyebrow">{failed ? '暂时无法读取最近工作' : '从这里开始'}</p>
          <h2 className="continue-card-title">写下第一部作品</h2>
          <p className="continue-card-meta">作品是章节、设定与角色的归属。建好之后，这里会接着显示你上次停下的位置。</p>
        </div>
        <Link href="/apps/story-worlds/new" className={buttonVariants({ variant: 'primary', size: 'md', className: 'continue-card-action' })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>新建作品</span>
        </Link>
      </div>
    );
  }
  const updated = relativeUpdated(latest.updatedAt);
  return (
    <div className="continue-card">
      <WorkThumb item={latest} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="continue-card-eyebrow">继续创作 · {latest.kind}</p>
        <h2 className="continue-card-title" data-visual-dynamic="true">{latest.title}</h2>
        <p className="continue-card-meta" data-visual-dynamic="true">
          {updated ? <>上次编辑于 <time dateTime={latest.updatedAt}>{updated}</time></> : '最近编辑'}
        </p>
      </div>
      <Link href={latest.href} className={buttonVariants({ variant: 'primary', size: 'md', className: 'continue-card-action' })}>
        <span>继续</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** 首页主卡、建议和最近工作共用同一个查询参数，避免重复请求。 */
export const HOME_RECENT_LIMIT = 6;

const NEXT_STEPS = [
  { href: '/apps/story-worlds/new', title: '新建一部作品', description: '先定下世界观和主线，章节与角色都挂在作品下。', icon: Compass, tone: 'blue' as NavTone },
  { href: '/apps/characters/new', title: '添加一位角色', description: '角色卡可以在作品、制作和邻舍之间复用。', icon: UserPlus, tone: 'violet' as NavTone },
  { href: '/apps/notebook/new', title: '记一条创作笔记', description: '灵感、设定碎片和参考资料都可以先放进资料库。', icon: NotebookPen, tone: 'green' as NavTone },
];

/** 少数据（0–2 条）时给出下一步建议；内容足够时不渲染。 */
export function HomeNextSteps() {
  const { items, loading } = useRecentWorkItems(HOME_RECENT_LIMIT);
  if (loading) return null;
  const steps = pickNextSteps(NEXT_STEPS, items.length);
  if (steps.length === 0) return null;
  return (
    <section className="overview-next-steps" aria-labelledby="home-next-steps-title" data-motion-list="">
      <h2 id="home-next-steps-title" className="sr-only">下一步可以做什么</h2>
      {steps.map(({ href, title, description, icon: Icon, tone }) => (
        <Link key={href} href={href} className="next-step-card" data-tone={tone}>
          <span className="next-step-icon" aria-hidden="true"><Icon className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="next-step-title">{title}</span>
            <span className="next-step-description">{description}</span>
          </span>
        </Link>
      ))}
    </section>
  );
}

/** 工作台主区：最近处理过的作品、创作笔记与角色，以带缩略图的卡片展示。 */
export function RecentWork({ limit = 8 }: { limit?: number }) {
  const { items, recent, visibleLimit, loading, failed } = useRecentWorkItems(limit);

  /*
   * 载入态用与真实卡片同构的骨架占位，避免数据到达时整页高度跳变；
   * 加载提示保留在无障碍树中供读屏与测试识别。
   */
  const skeletonCards = (
    <ul className="recent-work-grid" aria-hidden="true">
      {Array.from({ length: Math.min(visibleLimit, 6) }, (_, index) => (
        <li key={index} className="recent-work-card">
          <Skeleton className="h-11 w-11 rounded-control flex-none" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" data-visual-dynamic="true" />
            <Skeleton className="h-3 w-1/2" data-visual-dynamic="true" />
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="home-section" aria-labelledby="recent-work-title">
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border-subtle pb-3">
        <div>
          <h2 id="recent-work-title" className="tpl-section-title">最近工作</h2>
          <p className="mt-0.5 text-xs text-muted">最近编辑的作品、创作笔记与角色</p>
        </div>
        <Link href="/apps/story-worlds" className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-accent">
          <span>全部作品</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {recent.isError && items.length > 0 && (
        <p role="status" className="mb-3 text-xs text-muted">
          暂时无法刷新服务端最近工作，当前显示缓存与本机笔记。
          <Button size="sm" variant="ghost" className="ml-2 h-auto px-1 py-0 text-xs" onClick={() => void recent.refetch()}>重试</Button>
        </p>
      )}

      {loading && items.length === 0 ? (
        <>
          <p role="status" className="sr-only">正在读取…</p>
          {skeletonCards}
        </>
      ) : failed ? (
        <Button size="sm" variant="outline" onClick={() => void recent.refetch()}>
          读取失败，点击重试
        </Button>
      ) : items.length === 0 ? (
        <p className="py-4 text-sm text-muted">还没有记录。上方的建议可以帮你开个头，这里会显示最近处理过的内容。</p>
      ) : (
        <ul className="recent-work-grid" data-testid="recent-work-list" data-motion-list="">
          {items.map((item) => {
            const updated = formatUpdated(item.updatedAt);
            return (
              <li key={item.id}>
                <Link href={item.href} className="recent-work-row recent-work-card group">
                  <WorkThumb item={item} />
                  <span className="min-w-0 flex-1">
                    <span className="recent-work-title" data-visual-dynamic="true">{item.title}</span>
                    <span className="recent-work-sub">
                      <span className="recent-work-kind" data-tone={KIND_TONE[item.kind]} data-visual-dynamic="true">{item.kind}</span>
                      {updated && <time className="recent-work-time tabular-nums" dateTime={item.updatedAt} data-visual-dynamic="true">{updated}</time>}
                    </span>
                  </span>
                  <span className="recent-work-arrow" aria-hidden="true"><ArrowRight className="h-4 w-4" /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
