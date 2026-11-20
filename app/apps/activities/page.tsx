'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  FolderDown,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
  Calendar,
  Compass,
  CalendarDays,
  Lightbulb,
  ArrowRight,
  X,
} from 'lucide-react';
import { useActivityPage } from '@/app/features/activities/use-activity-page';
import { Pagination } from '@/app/components/ui/pagination';
import { positiveInteger } from '@/app/lib/pagination';
import { useDeleteActivity, useDuplicateActivity, useUpdateActivity } from '@/app/features/activities/mutations/activities';
import { COLLECTION_VIEW_OPTIONS, CollectionLayout, CollectionViewToggle, useCollectionView } from '@/app/components/shared/page-archetypes';
import type { CollectionView } from '@/app/components/shared/page-archetypes-model';
import { Input } from '@/app/components/ui/input';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EntityImage } from '@/app/components/ui/entity-art';
import { coverImageUrl } from '@/app/features/covers/api';
import { Alert } from '@/app/components/ui/alert';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { EmptyState } from '@/app/components/ui/empty-state';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Spinner } from '@/app/components/ui/spinner';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { ActivityImportModal } from '@/app/features/activities/components/activity-import-modal';
import type { Activity } from '@sthstart/contracts';

const ACTIVITY_VIEWS = ['row', 'card'] as const satisfies readonly CollectionView[];

const activityDateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });

/** 列表用相对时间表达「上次改动」，精确日期放在 title 与桌面端更新列里。 */
function formatActivityUpdated(iso: string): { label: string; title: string } {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return { label: '时间未知', title: '更新时间未知' };
  const exact = activityDateFormat.format(time);
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return { label: '今天更新', title: exact };
  if (days === 1) return { label: '昨天更新', title: exact };
  if (days < 30) return { label: `${days} 天前更新`, title: exact };
  return { label: `${exact} 更新`, title: exact };
}

export default function ActivitiesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const search = params.get('q') || '';
  const [searchDraft, setSearchDraft] = useState(search);
  const [previousSearch, setPreviousSearch] = useState(search);
  const [composing, setComposing] = useState(false);
  if (previousSearch !== search) { setPreviousSearch(search); setSearchDraft(search); }
  const showArchived = params.get('archived') === 'true';
  const page = positiveInteger(params.get('page'));
  const pageSize = [20, 50, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20;
  const updateList = (patch: Record<string, string | number | boolean>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) next.set(key, String(value));
    router.push('/apps/activities?' + next, {scroll: false});
  };
  useEffect(() => {
    if (composing || searchDraft === search) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString()); next.set('q', searchDraft); next.set('page', '1');
      router.push('/apps/activities?' + next, {scroll: false});
    }, 250);
    return () => clearTimeout(timer);
  }, [composing, searchDraft, search, params, router]);
  const setShowArchived = (archived: boolean) => updateList({archived, page: 1});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);


  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useActivityPage({q: search, archived: showArchived, page, pageSize});

  const deleteMutation = useDeleteActivity();
  const duplicateMutation = useDuplicateActivity();
  const updateMutation = useUpdateActivity();

  const filtered = data?.items ?? [];
  useEffect(() => {
    if (data && !isPlaceholderData && data.page !== page) {
      const next = new URLSearchParams(params.toString()); next.set('page', String(data.page));
      router.replace('/apps/activities?' + next, {scroll: false});
    }
  }, [data, isPlaceholderData, page, params, router]);

  /** 失败时抛出，让确认框保持打开；错误同时留在页面内。 */
  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除制作项目失败');
      throw err;
    }
  };

  const handleDuplicate = async (id: string) => {
    setActionError(null);
    try {
      const res = await duplicateMutation.mutateAsync({ id });
      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '复制制作项目失败');
    }
  };

  const handleToggleArchive = async (act: Activity) => {
    setActionError(null);
    try {
      await updateMutation.mutateAsync({
        id: act.id,
        expectedHeadVersion: act.headVersion,
        patch: { archived: !act.archived },
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '归档操作失败');
    }
  };

  const { view, setView } = useCollectionView({ allowed: ACTIVITY_VIEWS, fallback: 'row', itemCount: data ? filtered.length : undefined, sparseView: 'card' });
  const rowActions = (act: Activity) => [
    { label: '复制副本', icon: <Copy className="size-4" />, onSelect: () => { void handleDuplicate(act.id); } },
    { label: act.archived ? '恢复制作项目' : '归档制作项目', icon: act.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />, onSelect: () => { void handleToggleArchive(act); } },
    { label: '删除制作项目', icon: <Trash2 className="size-4" />, tone: 'danger' as const, separatorBefore: true, onSelect: () => setPendingDelete({ id: act.id, title: act.title }) },
  ];
  const activityKind = (act: Activity) => (act.type === 'publication' ? '配音/画面制作' : act.type || '互动演出');

  const renderRow = (act: Activity) => {
    const updated = formatActivityUpdated(act.updatedAt);
    return (
      <li
        key={act.id}
        className="group -mx-2 flex min-w-0 items-start gap-2.5 rounded-control px-2 py-3 transition-colors hover:bg-surface-hover sm:items-center sm:gap-4 sm:py-4"
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <EntityImage
            className="activity-row-thumb hidden sm:block"
            seed={act.id}
            title={act.title}
            tone={act.type === 'publication' ? 'violet' : 'pink'}
            ratio="avatar"
            src={coverImageUrl(act.coverArtifactId)}
            alt=""
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={`/apps/activities/${act.id}`}
                className="min-w-0 truncate text-sm font-semibold tracking-tight text-ink transition-colors hover:text-accent group-hover:text-accent sm:text-base"
              >
                {act.title}
              </Link>
              <Badge variant="secondary" className="shrink-0 font-mono tabular-nums">
                v{act.headVersion}
              </Badge>
              <Badge
                variant={act.type === 'publication' ? 'accent' : 'outline'}
                className="shrink-0 text-xs"
              >
                {act.type === 'publication' ? '配音/画面制作' : act.type || '互动演出'}
              </Badge>
              {act.archived && (
                <Badge variant="stopped" className="shrink-0 text-xs">
                  已归档
                </Badge>
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted">
              <time className="shrink-0" dateTime={act.updatedAt} title={updated.title}>
                {updated.label}
              </time>
              {/* 分隔点与它后面的内容同生同灭，窄屏隐藏内容时不留下孤立的「·」。 */}
              {act.theme && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{act.theme}</span>
                </>
              )}
              {act.location && (
                <>
                  <span aria-hidden="true" className="hidden sm:inline">·</span>
                  <span className="hidden truncate sm:inline">{act.location}</span>
                </>
              )}
              {act.rules && (
                <>
                  <span aria-hidden="true" className="hidden md:inline">·</span>
                  <span className="hidden min-w-0 truncate md:inline">{act.rules}</span>
                </>
              )}
            </div>
            {act.location && (
              <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted sm:hidden">
                <Calendar className="size-3 shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate">{act.location}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 self-center sm:gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <Link
              href={`/apps/activities/${act.id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <span>{act.type === 'publication' ? '进入制作台' : '进入工作室'}</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>
          <RowActionsMenu label={`管理制作项目 ${act.title}`} items={rowActions(act)} />
        </div>
      </li>
    );
  };

  const renderCard = (act: Activity) => {
    const updated = formatActivityUpdated(act.updatedAt);
    return (
      <li key={act.id} className="activity-card group">
        <Link href={`/apps/activities/${act.id}`} tabIndex={-1} aria-hidden="true" className="activity-card-cover">
          <EntityImage
            seed={act.id}
            title={act.title}
            tone={act.type === 'publication' ? 'violet' : 'pink'}
            ratio="cover"
            src={coverImageUrl(act.coverArtifactId)}
            alt=""
          />
        </Link>
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/apps/activities/${act.id}`}
              className="line-clamp-2 text-base font-semibold tracking-tight text-ink transition-colors hover:text-accent"
            >
              {act.title}
            </Link>
            <p className="mt-1 text-xs text-muted">
              <time dateTime={act.updatedAt} title={updated.title}>{updated.label}</time>
            </p>
          </div>
          <RowActionsMenu label={`管理制作项目 ${act.title}`} items={rowActions(act)} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-mono tabular-nums">v{act.headVersion}</Badge>
          <Badge variant={act.type === 'publication' ? 'accent' : 'outline'} className="text-xs">{activityKind(act)}</Badge>
          {act.archived && <Badge variant="stopped" className="text-xs">已归档</Badge>}
        </div>
        {act.theme && <p className="line-clamp-2 text-sm text-muted">{act.theme}</p>}
        <Link
          href={`/apps/activities/${act.id}`}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-auto self-start' })}
        >
          <span>{act.type === 'publication' ? '进入制作台' : '进入工作室'}</span>
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </li>
    );
  };

  return (
    <div className="w-full bg-paper text-ink py-6">
      <CollectionLayout
        title="制作项目"
        description="管理配音、画面与互动演出制作版本。"
        className="space-y-5"
        itemCount={data ? filtered.length : undefined}
        primaryAction={{ id: 'new-activity', label: '新建制作', icon: <Plus className="h-4 w-4" aria-hidden="true" />, href: '/apps/activities/new' }}
        overflowLabel="更多活动工具"
        overflowActions={[
          { id: 'projects', label: '返回项目列表', icon: <ArrowRight className="size-3.5 rotate-180 text-muted" aria-hidden="true" />, href: '/apps/projects' },
          { id: 'import', label: '导入制作', icon: <FolderDown className="size-3.5 text-muted" aria-hidden="true" />, onSelect: () => setImportModalOpen(true) },
          { id: 'inspiration', label: '从话题找灵感', icon: <Lightbulb className="size-3.5 text-muted" aria-hidden="true" />, href: '/apps/inspiration' },
          { id: 'calendar', label: '创作日历', icon: <CalendarDays className="size-3.5 text-muted" aria-hidden="true" />, href: '/apps/calendar' },
        ]}
        search={
          <div className="relative w-full sm:max-w-md">
            <Input
              leftIcon={<Search className="h-4 w-4 text-muted" />}
              value={searchDraft}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={e => {setComposing(false); setSearchDraft(e.currentTarget.value);}}
              onChange={(e) => setSearchDraft(e.target.value)}
              maxLength={500}
              aria-label="搜索制作项目"
              placeholder="搜索制作项目标题、主题或类型…"
              className="h-9 border-border-control pl-9 pr-9 text-base sm:text-sm"
            />
            {searchDraft && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="清空搜索"
                className="absolute right-1 top-1/2 size-7 min-h-0 -translate-y-1/2 p-0 text-muted hover:text-ink"
                onClick={() => { setSearchDraft(''); updateList({ q: '', page: 1 }); }}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        }
        toolbarExtra={
          <PageTabs
            ariaLabel="制作项目状态筛选"
            variant="local"
            value={showArchived ? 'archived' : 'active'}
            onChange={value => setShowArchived(value === 'archived')}
            tabs={[
              { id: 'active', label: '活跃活动' },
              { id: 'archived', label: '已归档' },
            ]}
          />
        }
        viewToggle={<CollectionViewToggle value={view} onChange={setView} options={COLLECTION_VIEW_OPTIONS} disabled={filtered.length > 0 && filtered.length < 3} />}
        footer={<Pagination total={data?.total ?? 0} page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} loading={isFetching || searchDraft !== search} onPageChange={page => updateList({page})} onPageSizeChange={pageSize => updateList({pageSize, page: 1})} />}
      >
        {error && !data && (
          <Alert variant="danger" title="制作项目列表加载失败">
            {error instanceof Error ? error.message : String(error)}
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => { void refetch(); }}>重试读取</Button>
          </Alert>
        )}

        {error && data && (
          <Alert variant="danger" title="列表更新失败，当前仍显示上次读取结果">
            {error instanceof Error ? error.message : String(error)}
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => { void refetch(); }}>重新读取</Button>
          </Alert>
        )}

        {actionError && (
          <Alert variant="danger" title="操作失败">
            {actionError}
          </Alert>
        )}

        {(isFetching || searchDraft !== search) && (
          <Spinner size="sm" label={searchDraft !== search ? '正在搜索…' : '正在更新列表…'} className="text-xs" />
        )}
        {error && !data ? null : isLoading ? (
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="flex items-center gap-3 py-3.5 sm:py-4">
                <Skeleton className="h-8 w-8 rounded-control flex-none" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-20 flex-none" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={search ? Search : Compass}
            title={
              search
                ? `没有匹配「${search}」的制作项目`
                : showArchived
                  ? '暂无已归档制作项目'
                  : '暂无制作项目'
            }
            description={
              search
                ? '搜索范围包括标题、主题、类型与地点。换一个关键词，或清空搜索查看全部制作项目。'
                : showArchived
                  ? '归档后的制作项目会保留在这里，可随时恢复为活跃项目。'
                  : '支持从创作项目章节直接创建制作版本，或选用角色与模板快速建立独立制作工程。'
            }
            actions={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {search ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setSearchDraft(''); updateList({ q: '', page: 1 }); }}
                  >
                    清空搜索
                  </Button>
                ) : (
                  !showArchived && (
                    <>
                      <Link
                        href="/apps/projects"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <span>返回创作项目</span>
                      </Link>
                      <Link
                        href="/apps/activities/new"
                        className={buttonVariants({ variant: 'primary', size: 'sm' })}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        <span>新建制作工程</span>
                      </Link>
                    </>
                  )
                )}
                {showArchived && !search && (
                  <Link
                    href="/apps/activities"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <span>查看活跃制作项目</span>
                  </Link>
                )}
              </div>
            }
          />
        ) : view === 'card' ? (
          <ul className="activity-card-grid" data-collection-items>{filtered.map(renderCard)}</ul>
        ) : (
          <ul className="divide-y divide-border-subtle border-y border-border-subtle">{filtered.map(renderRow)}</ul>
        )}
        <ActivityImportModal
          open={importModalOpen}
          onOpenChange={setImportModalOpen}
        />
        <ConfirmDialog
          open={Boolean(pendingDelete)}
          onOpenChange={open => { if (!open) setPendingDelete(null); }}
          title="彻底删除制作项目？"
          description={
            pendingDelete
              ? `《${pendingDelete.title}》的草稿、分镜、生成记录与制作版本都会一并删除，此操作无法撤销。若只是暂时不用，可以改为归档。`
              : undefined
          }
          confirmLabel="彻底删除"
          danger
          onConfirm={async () => {
            if (!pendingDelete) return;
            await handleDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      </CollectionLayout>
    </div>
  );
}
