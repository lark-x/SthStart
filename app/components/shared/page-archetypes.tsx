'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Rows3, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button, buttonVariants } from '../ui/button';
import { RowActionsMenu } from '../ui/row-actions-menu';
import { PageContainer, ReadingContainer } from './page-layout';
import { PageHeader } from './page-header';
import {
  COLLECTION_VIEW_PARAM,
  collectionViewSearch,
  isSparseCollection,
  parseCollectionView,
  resolveCollectionView,
  splitCollectionActions,
  type CollectionAction,
  type CollectionFilterChip,
  type CollectionView,
} from './page-archetypes-model';

/**
 * 页面原型布局（sthstart-design-language §2）。只编排现有 PageContainer / PageHeader /
 * ReadingContainer，不新增外框；业务状态、请求和筛选模型仍归调用方。
 */

export interface CollectionActionItem extends CollectionAction {
  icon?: React.ReactNode;
}

function ActionControl({ action, variant }: { action: CollectionActionItem; variant: 'primary' | 'outline' }) {
  const content = (
    <>
      {action.icon}
      <span>{action.label}</span>
    </>
  );
  if (action.href && !action.disabled) {
    return (
      <Link href={action.href} className={buttonVariants({ size: 'sm', variant })} data-collection-action={action.id}>
        {content}
      </Link>
    );
  }
  return (
    <Button size="sm" variant={variant} disabled={action.disabled} onClick={action.onSelect} data-collection-action={action.id}>
      {content}
    </Button>
  );
}

/** 页头动作区：主操作 + 至多 2 个次操作 + 溢出菜单；超出预算的次操作自动并入溢出菜单。 */
export function CollectionActions({
  primary,
  secondary,
  overflow,
  overflowLabel = '更多操作',
}: {
  primary?: CollectionActionItem;
  secondary?: CollectionActionItem[];
  overflow?: CollectionActionItem[];
  overflowLabel?: string;
}) {
  const router = useRouter();
  const split = splitCollectionActions(secondary, overflow);
  if (!primary && split.visible.length === 0 && split.overflow.length === 0) return null;
  return (
    <div className="collection-actions" data-collection-actions>
      {primary && <ActionControl action={primary} variant="primary" />}
      {split.visible.map((action) => <ActionControl key={action.id} action={action} variant="outline" />)}
      {split.overflow.length > 0 && (
        <RowActionsMenu
          label={overflowLabel}
          className="h-9 w-9"
          items={split.overflow.map((action) => ({
            label: action.label,
            icon: action.icon,
            tone: action.tone,
            hidden: action.disabled,
            onSelect: () => {
              if (action.onSelect) action.onSelect();
              else if (action.href) router.push(action.href);
            },
          }))}
        />
      )}
    </div>
  );
}

/** 已生效的筛选条件：可逐个删除，也可一次清除。 */
export function CollectionFilterChips({
  chips,
  onClearAll,
  summary,
}: {
  chips: CollectionFilterChip[];
  onClearAll?: () => void;
  /** 统计数字等短文本，放在胶囊旁边而不是页头。 */
  summary?: React.ReactNode;
}) {
  if (chips.length === 0 && !summary) return null;
  return (
    <div className="collection-chips" data-collection-chips>
      {chips.length > 0 && (
        <ul className="collection-chip-list" aria-label="已生效的筛选条件">
          {chips.map((chip) => (
            <li key={chip.id} className="collection-chip">
              <span className="min-w-0 truncate">{chip.label}</span>
              <button type="button" className="collection-chip-remove" aria-label={`移除筛选：${chip.label}`} onClick={chip.onRemove}>
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {onClearAll && chips.length > 1 && (
            <li>
              <Button size="sm" variant="ghost" onClick={onClearAll}>清除全部</Button>
            </li>
          )}
        </ul>
      )}
      {summary && <span className="collection-summary">{summary}</span>}
    </div>
  );
}

export interface CollectionViewOption<V extends string = CollectionView> {
  value: V;
  label: string;
  icon?: React.ReactNode;
}

/** 通用的「卡片 / 列表」两档选项。 */
export const COLLECTION_VIEW_OPTIONS: CollectionViewOption<CollectionView>[] = [
  { value: 'card', label: '卡片', icon: <LayoutGrid className="size-3.5" aria-hidden="true" /> },
  { value: 'row', label: '列表', icon: <Rows3 className="size-3.5" aria-hidden="true" /> },
];

/** 视图切换：分段控件，状态由调用方（通常是 useCollectionView）管理。 */
export function CollectionViewToggle<V extends string>({
  value,
  onChange,
  options,
  disabled,
  label = '展示方式',
}: {
  value: V;
  onChange: (next: V) => void;
  options: CollectionViewOption<V>[];
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="collection-view-toggle" data-collection-view-toggle>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className="collection-view-option"
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 视图状态记在 URL（默认值不写入）。itemCount 少于 3 时实际视图强制为 sparseView，
 * 但用户的选择保留在 URL 中，数据变多后恢复。
 *
 * 直接读写 window.location / history.replaceState：部分列表（如角色库）用 pushState
 * 维护自己的筛选参数，走路由层可能拿到过期的查询串而把它们冲掉。
 */
const COLLECTION_VIEW_EVENT = 'sthstart:collection-view';

function subscribeLocation(callback: () => void) {
  window.addEventListener('popstate', callback);
  window.addEventListener(COLLECTION_VIEW_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(COLLECTION_VIEW_EVENT, callback);
  };
}

function readLocationSearch() {
  return window.location.search;
}

function serverLocationSearch() {
  return '';
}

export function useCollectionView<V extends string = CollectionView>({
  allowed,
  fallback,
  itemCount,
  sparseView,
  param = COLLECTION_VIEW_PARAM,
}: {
  allowed: readonly V[];
  fallback: V;
  itemCount?: number;
  sparseView?: V;
  param?: string;
}) {
  const search = React.useSyncExternalStore(subscribeLocation, readLocationSearch, serverLocationSearch);
  const requested = parseCollectionView(new URLSearchParams(search).get(param), allowed, fallback);
  const effective = resolveCollectionView(requested, itemCount, sparseView ?? fallback);
  const setView = React.useCallback((next: V) => {
    const nextSearch = collectionViewSearch(window.location.search, next, fallback, param);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${nextSearch}${window.location.hash}`);
    window.dispatchEvent(new Event(COLLECTION_VIEW_EVENT));
  }, [fallback, param]);
  return { requested, view: effective, setView, sparse: isSparseCollection(itemCount) };
}

/** 统一的筛选入口按钮：显示已启用条件数，读屏名称与可见文字一致。 */
export function CollectionFilterButton({
  activeCount,
  onClick,
  expanded,
  label = '筛选',
  describedBy,
}: {
  activeCount: number;
  onClick: () => void;
  expanded?: boolean;
  label?: string;
  describedBy?: string;
}) {
  return (
    <Button
      size="sm"
      variant={activeCount ? 'secondary' : 'outline'}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-describedby={describedBy}
      onClick={onClick}
      data-collection-filter-button
    >
      <SlidersHorizontal className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
      {activeCount > 0 && <span className="tabular-nums">({activeCount})</span>}
    </Button>
  );
}

export interface CollectionLayoutProps {
  title: string;
  description?: string;
  navigation?: React.ReactNode;
  primaryAction?: CollectionActionItem;
  secondaryActions?: CollectionActionItem[];
  overflowActions?: CollectionActionItem[];
  overflowLabel?: string;
  /** 搜索框（通常是带 leftIcon 的 Input）。 */
  search?: React.ReactNode;
  /** 筛选按钮（通常是 CollectionFilterButton）。 */
  filter?: React.ReactNode;
  /** 视图切换（通常是 CollectionViewToggle）。 */
  viewToggle?: React.ReactNode;
  chips?: CollectionFilterChip[];
  onClearChips?: () => void;
  /** 统计数字，显示在胶囊行。 */
  summary?: React.ReactNode;
  /** 当前结果数；少于 3 条时内容区收窄居中。 */
  itemCount?: number;
  /** 列表下方：分页、底部统计。 */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 工具条额外内容（不计入预算的状态提示等），放在视图切换之前。 */
  toolbarExtra?: React.ReactNode;
}

/** Collection 原型：页头（控件预算）+ 搜索/筛选单行 + 筛选胶囊 + 列表 + 底部。 */
export function CollectionLayout({
  title,
  description,
  navigation,
  primaryAction,
  secondaryActions,
  overflowActions,
  overflowLabel,
  search,
  filter,
  viewToggle,
  chips = [],
  onClearChips,
  summary,
  itemCount,
  footer,
  children,
  className,
  bodyClassName,
  toolbarExtra,
}: CollectionLayoutProps) {
  const sparse = isSparseCollection(itemCount);
  const hasToolbar = Boolean(search || filter || viewToggle || toolbarExtra);
  return (
    <PageContainer className={cn('collection-layout space-y-4', className)} data-page-archetype="collection" data-sparse={sparse || undefined}>
      <PageHeader
        compact
        title={title}
        description={description}
        navigation={navigation}
        actions={
          <CollectionActions
            primary={primaryAction}
            secondary={secondaryActions}
            overflow={overflowActions}
            overflowLabel={overflowLabel}
          />
        }
      />
      {hasToolbar && (
        <div className="collection-toolbar" data-collection-toolbar>
          {search && <div className="collection-search">{search}</div>}
          {filter}
          {toolbarExtra}
          {viewToggle && <div className="collection-toolbar-end">{viewToggle}</div>}
        </div>
      )}
      <CollectionFilterChips chips={chips} onClearAll={onClearChips} summary={summary} />
      <div className={cn('collection-body', bodyClassName)} data-collection-body>
        {children}
      </div>
      {footer && <div className="collection-footer">{footer}</div>}
    </PageContainer>
  );
}

/** Overview 原型：问候 + 主卡 + 统计 + 若干分区；少数据时在主卡下方给出下一步建议。 */
export function OverviewLayout({
  greeting,
  hero,
  stats,
  nextSteps,
  children,
  className,
}: {
  greeting: React.ReactNode;
  hero?: React.ReactNode;
  stats?: React.ReactNode;
  nextSteps?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <PageContainer className={cn('overview-layout', className)} data-page-archetype="overview">
      <div className="overview-greeting">{greeting}</div>
      {hero && <section className="overview-hero" aria-label="继续创作">{hero}</section>}
      {/* 建议区由调用方包裹：内容足够时组件自行不渲染，避免留下空的区域地标。 */}
      {nextSteps}
      {stats && <section className="overview-stats" aria-label="内容概览">{stats}</section>}
      {children}
    </PageContainer>
  );
}

/** Detail 原型：实体图像与名称为首屏主角，属性区与辅助栏随宽度堆叠。 */
export function DetailLayout({
  title,
  backHref,
  backLabel,
  navigation,
  status,
  media,
  meta,
  actions,
  aside,
  children,
  className,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  /** 页内视图切换（PageTabs），放在标题区下方。 */
  navigation?: React.ReactNode;
  /** 标题旁的保存状态等短信息。 */
  status?: React.ReactNode;
  media?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <PageContainer className={cn('detail-layout space-y-4', className)} data-page-archetype="detail">
      <PageHeader compact title={title} backHref={backHref} backLabel={backLabel} status={status} actions={actions} navigation={navigation} />
      {(media || meta) && (
        <div className="detail-hero">
          {media && <div className="detail-media">{media}</div>}
          {meta && <div className="detail-meta">{meta}</div>}
        </div>
      )}
      <div className={cn('detail-body', aside && 'detail-body-with-aside')}>
        <div className="min-w-0 space-y-4">{children}</div>
        {aside && <aside className="min-w-0 space-y-4">{aside}</aside>}
      </div>
    </PageContainer>
  );
}

/**
 * Reader 原型：约 40em 行宽、1.8 行高、衬线正文（设计语言 §7）。
 * `embedded` 用于工作台内的阅读栏：只约束行宽，不套页面容器，正文排版交给 `.reader-prose`。
 */
export function ReaderLayout({
  meta,
  embedded = false,
  children,
  className,
  ...rest
}: React.ComponentProps<'article'> & { meta?: React.ReactNode; embedded?: boolean }) {
  if (embedded) {
    return (
      <div data-page-archetype="reader" className={cn('reader-layout', className)} {...(rest as React.ComponentProps<'div'>)}>
        {meta && <div className="reader-meta">{meta}</div>}
        {children}
      </div>
    );
  }
  return (
    <ReadingContainer data-page-archetype="reader">
      <article className={cn('reader-layout', className)} {...rest}>
        {meta && <div className="reader-meta">{meta}</div>}
        <div className="reader-body reader-prose">{children}</div>
      </article>
    </ReadingContainer>
  );
}
