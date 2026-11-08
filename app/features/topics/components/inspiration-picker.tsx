'use client';
import { TopicWorkFilter } from './topic-work-filter';
import { useTopicSelection } from '../use-topic-selection';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Search, Wand2, X } from 'lucide-react';
import type { ActivityIdea, ActivityIdeaBatch, TopicKind } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { Textarea } from '@/app/components/ui/textarea';
import { Pagination } from '@/app/components/ui/pagination';
import { TOPIC_KIND_LABELS, TOPIC_VIEWS, createIdeaBatch, fetchIdeaBatch, fetchTopics, type TopicListParams } from '../api';
import { TopicSummaryCard } from './topic-card';
import { ideaBatchKeys, topicKeys } from '@/app/lib/query-keys';
import {
  applyTopicListState, defaultTopicDays, parseTopicListState, TOPIC_PAGE_SIZE_OPTIONS,
  topicListParams, topicListUrl, type TopicView,
} from '../url-state';

const MAX_SELECTED = 5;
const PICKER_URL_PREFIX = 'ip';

/**
 * 从话题素材找灵感：复用素材库的筛选与卡片，不触发新的搜集。
 *
 * 只负责「选素材 → 生成点子」；采用动作交给调用方，
 * 因为活动内采用还要先展示将填入的标题、主题与要求。
 */
export function InspirationPicker({ open, onOpenChange, onPickIdea, activityType, leadCharacterId, initialRequirement }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickIdea: (batch: ActivityIdeaBatch, idea: ActivityIdea) => void;
  activityType?: string;
  leadCharacterId?: string;
  initialRequirement?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="从话题素材找灵感"
      description="复用素材库的筛选与卡片，不会触发新的搜集。选中素材后生成点子，再决定是否采用。"
      className="max-w-4xl"
    >
      {/* 关闭时整体卸载，下次打开自然从干净状态开始，不需要在 effect 里重置。 */}
      {open && <PickerBody onPickIdea={onPickIdea} activityType={activityType} leadCharacterId={leadCharacterId} initialRequirement={initialRequirement} />}
    </Dialog>
  );
}

function PickerBody({ onPickIdea, activityType, leadCharacterId, initialRequirement }: {
  onPickIdea: (batch: ActivityIdeaBatch, idea: ActivityIdea) => void;
  activityType?: string;
  leadCharacterId?: string;
  initialRequirement?: string;
}) {
  const client = useQueryClient();
  const [initial] = useState(() => parseTopicListState(
    typeof window === 'undefined' ? '' : window.location.search,
    PICKER_URL_PREFIX,
  ));
  const initialView: 'all' | 'favorite' = initial.view === 'favorite' ? 'favorite' : 'all';
  const [view, setView] = useState<'all' | 'favorite'>(initialView);
  const [searchInput, setSearchInput] = useState(initial.q);
  const [search, setSearch] = useState(initial.q);
  const [debouncedSearch, setDebouncedSearch] = useState(initial.q);
  const [workFilter, setWorkFilter] = useState<string[]>(initial.works);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [kind, setKind] = useState<TopicKind | ''>(initial.kind);
  const [days, setDays] = useState(initial.view === 'favorite' ? 0 : initial.days);
  const { selected, setSelected, selectedTopics, toggleSelected: toggle } = useTopicSelection();
  const [requirement, setRequirement] = useState(initialRequirement || '');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!composingRef.current) setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const params: TopicListParams = topicListParams({
    q: debouncedSearch, works: workFilter, kind, days, view, page, pageSize,
  });
  const topicsQuery = useQuery({
    queryKey: topicKeys.picker(params),
    queryFn: ({ signal }) => fetchTopics(params, { signal }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const batchQuery = useQuery({
    queryKey: ideaBatchKeys.detail(batchId),
    queryFn: () => fetchIdeaBatch(batchId!),
    enabled: Boolean(batchId),
    refetchInterval: (query) => (['queued', 'running'].includes(query.state.data?.status ?? '') ? 2_000 : false),
  });

  const topics = useMemo(() => topicsQuery.data?.items ?? [], [topicsQuery.data]);
  const batch = batchQuery.data ?? null;

  const restoreFromUrl = useCallback((input: string | URLSearchParams) => {
    const next = parseTopicListState(input, PICKER_URL_PREFIX);
    const nextView: 'all' | 'favorite' = next.view === 'favorite' ? 'favorite' : 'all';
    setView(nextView);
    setSearchInput(next.q);
    setSearch(next.q);
    setDebouncedSearch(next.q);
    setWorkFilter(next.works);
    setKind(next.kind);
    setDays(next.days);
    setPage(next.page);
    setPageSize(next.pageSize);
  }, []);

  useEffect(() => {
    const restore = () => restoreFromUrl(window.location.search);
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [restoreFromUrl]);

  // 选择器的搜索、筛选与页码也写入 URL，关闭再打开或刷新后可以恢复。
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    applyTopicListState(query, {
      q: debouncedSearch, works: workFilter, kind, days, view, page, pageSize,
    }, PICKER_URL_PREFIX);
    const nextSearch = query.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, [debouncedSearch, workFilter, kind, days, view, page, pageSize]);

  const totalPages = topicsQuery.data ? Math.max(1, Math.ceil(topicsQuery.data.total / pageSize)) : 1;
  useEffect(() => {
    if (!topicsQuery.data || page <= totalPages) return;
    const timer = setTimeout(() => setPage(totalPages), 0);
    return () => clearTimeout(timer);
  }, [page, topicsQuery.data, totalPages]);
  const isPageTransition = topicsQuery.isFetching && topicsQuery.isPlaceholderData;
  const displayedPage = isPageTransition && topicsQuery.data ? topicsQuery.data.page : page;
  const hasPickerCriteria = Boolean(debouncedSearch.trim()) || workFilter.length > 0 || Boolean(kind) || days !== 30 || view !== 'all';
  const clearPickerCriteria = () => {
    setSearchInput('');
    setSearch('');
    setDebouncedSearch('');
    setWorkFilter([]);
    setKind('');
    setDays(30);
    setView('all');
    setPage(1);
  };
  const pickerState = { q: debouncedSearch, works: workFilter, kind, days, view, page, pageSize };
  const pushPickerPage = (nextPage: number, nextPageSize = pageSize) => {
    if (typeof window === 'undefined') return;
    const next = topicListUrl(window.location.href, {
      ...pickerState,
      page: nextPage,
      pageSize: nextPageSize,
    }, PICKER_URL_PREFIX);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.pushState(window.history.state, '', next);
  };
  const changePickerPage = (nextPage: number) => {
    pushPickerPage(nextPage);
    setPage(nextPage);
  };
  const changePickerPageSize = (nextPageSize: number) => {
    pushPickerPage(1, nextPageSize);
    setPageSize(nextPageSize);
    setPage(1);
  };

  const generate = async (append: boolean) => {
    setError(null); setBusy(true);
    try {
      if (append && batchId) {
        await createIdeaBatch({ topicIds: selected, appendToBatchId: batchId, ideaCount: 3 });
        void client.invalidateQueries({ queryKey: ideaBatchKeys.detail(batchId) });
      } else {
        const created = await createIdeaBatch({
          topicIds: selected,
          ...(leadCharacterId ? { leadCharacterId } : {}),
          ...(requirement.trim() ? { requirement: requirement.trim() } : {}),
          ...(activityType ? { activityType } : {}),
        });
        setBatchId(created.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成点子失败。');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-xs text-muted">关键词</span>
          <Input
            aria-label="搜索素材"
            value={searchInput}
            placeholder="搜索标题、摘要、作品或角色"
            onChange={(event) => {
              const value = event.target.value;
              setSearchInput(value);
              if (composingRef.current) return;
              setSearch(value);
              setPage(1);
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const value = event.currentTarget.value;
              setSearchInput(value);
              setSearch(value);
              setPage(1);
            }}
            className="h-9 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">作品</span>
          <TopicWorkFilter value={workFilter} options={topicsQuery.data?.facets.works ?? []} onChange={value => { setWorkFilter(value); setPage(1); }} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">视图</span>
          <Select aria-label="素材视图" value={view} onChange={(event) => { const nextView = event.target.value as TopicView; setView(nextView === 'favorite' ? 'favorite' : 'all'); setDays(defaultTopicDays(nextView)); setPage(1); }} className="h-9 text-sm">
            {TOPIC_VIEWS.filter((item) => item.id === 'all' || item.id === 'favorite').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
        </label>
        <label className="space-y-1"><span className="text-xs text-muted">内容类型</span><Select aria-label="素材内容类型" value={kind} onChange={event => { setKind(event.target.value as TopicKind | ''); setPage(1); }}><option value="">全部类型</option>{(Object.keys(TOPIC_KIND_LABELS) as TopicKind[]).map(value => <option key={value} value={value}>{TOPIC_KIND_LABELS[value]}</option>)}</Select></label>
        <label className="space-y-1"><span className="text-xs text-muted">时间范围</span><Select aria-label="素材时间范围" value={days} onChange={event => { setDays(Number(event.target.value)); setPage(1); }}><option value={7}>最近七天</option><option value={30}>最近三十天</option><option value={90}>最近九十天</option><option value={0}>不限时间</option></Select></label>
      </div>

      {topicsQuery.isError && <Alert variant="danger">素材加载失败，请稍后重试。<Button size="sm" variant="ghost" onClick={() => { void topicsQuery.refetch(); }}>重试</Button></Alert>}
      {topicsQuery.isLoading && <Spinner size="sm" label="正在加载素材…" />}
      {isPageTransition && <span className="text-xs text-muted" role="status">正在更新素材…</span>}
      {!topicsQuery.isLoading && !topicsQuery.isError && !topics.length && (
        <Alert variant="info" title={hasPickerCriteria ? '没有匹配的素材' : '还没有可用素材'}>
          {hasPickerCriteria ? '换一个关键词，或清除筛选后再试。' : '先去「话题素材库」配置自动搜集并补采，或稍后再来。'}
          {hasPickerCriteria && <Button size="sm" variant="ghost" onClick={clearPickerCriteria}>清除筛选</Button>}
        </Alert>
      )}
      <ul className="space-y-2">
        {topics.map((topic) => (
          <TopicSummaryCard key={topic.id} topic={topic} selected={selected.includes(topic.id)} onToggle={toggle} showActions={false} />
        ))}
      </ul>
      {topicsQuery.data && (
        <Pagination
          total={topicsQuery.data.total}
          page={displayedPage}
          pageSize={pageSize}
          onPageChange={changePickerPage}
          onPageSizeChange={changePickerPageSize}
          pageSizeOptions={TOPIC_PAGE_SIZE_OPTIONS}
          loading={isPageTransition}
          compact
        />
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-sm">
        <Lightbulb className="h-4 w-4 text-accent" />
        已选 {selected.length} 条（最多 {MAX_SELECTED} 条）
        {!!selectedTopics.length && <span className="truncate text-xs text-muted">{selectedTopics.map((topic) => topic.title).join('、')}</span>}
        {!!selected.length && <Button size="sm" variant="ghost" onClick={() => setSelected([])}><X className="h-3.5 w-3.5" />清空</Button>}
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-ink">可选要求</span>
        <Textarea aria-label="点子要求" rows={2} value={requirement} placeholder="例如：用这几个梗给芙宁娜办一场聚会" onChange={(event) => setRequirement(event.target.value)} />
      </label>

      {batch && (
        <div className="space-y-3 border-t border-border-subtle pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">候选点子（{batch.ideas.length}）</h3>
            {(batch.status === 'queued' || batch.status === 'running') && <Spinner size="sm" label="正在生成…" />}
            {batch.status === 'failed' && <Badge variant="error" className="text-xs">生成失败</Badge>}
          </div>
          {batch.status === 'failed' && <Alert variant="danger" title="生成失败">{batch.errorMessage || '请稍后重试'}</Alert>}
          <div className="grid gap-2 sm:grid-cols-2">
            {batch.ideas.map((idea) => (
              <article key={idea.id} className="flex flex-col gap-1.5 rounded-panel border border-border-default bg-surface p-3">
                <h4 className="text-sm font-semibold text-ink">{idea.name}</h4>
                <p className="text-xs text-muted">{idea.overview}</p>
                <p className="text-xs text-muted"><span className="font-medium text-ink">改编：</span>{idea.adaptation}</p>
                {!!idea.recommendedCharacters.length && (
                  <p className="text-xs text-muted">推荐人物：{idea.recommendedCharacters.map((character) => character.name + (character.work ? '（' + character.work + '）' : '')).join('、')}</p>
                )}
                {idea.stages.length > 0 && <p className="text-xs text-muted">阶段：{idea.stages.map((stage) => stage.title).join(' → ')}</p>}
                {!!idea.assumptions.length && <p className="text-xs text-amber-700">属于建议：{idea.assumptions.join('；')}</p>}
                <div className="mt-auto pt-1">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onPickIdea(batch, idea)}>应用这个点子</Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {!batch && (
        <p className="flex items-center gap-1.5 text-xs text-muted"><Search className="h-3.5 w-3.5" />选择素材后点「生成三个点子」；默认给出三个有明显区别的方向。</p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-3">
        <Button variant="outline" disabled={busy || !batchId || ['queued', 'running'].includes(batch?.status ?? '')} onClick={() => void generate(true)}>再来三个</Button>
        <Button variant="primary" disabled={busy || ['queued', 'running'].includes(batch?.status ?? '') || !selected.length || selected.length > MAX_SELECTED} onClick={() => void generate(false)}>
          <Wand2 className="h-3.5 w-3.5" />生成三个点子
        </Button>
      </div>
    </div>
  );
}
