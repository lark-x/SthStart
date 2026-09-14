'use client';
import { TopicWorkFilter } from './topic-work-filter';
import { useTopicSelection } from '../use-topic-selection';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { TOPIC_KIND_LABELS, TOPIC_VIEWS, createIdeaBatch, fetchIdeaBatch, fetchTopics, type TopicListParams } from '../api';
import { TopicSummaryCard } from './topic-card';

const PAGE_SIZE = 8;
const MAX_SELECTED = 5;

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
  const [view, setView] = useState<'all' | 'favorite'>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [workFilter, setWorkFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<TopicKind | ''>('');
  const [days, setDays] = useState(30);
  const { selected, setSelected, selectedTopics, toggleSelected: toggle } = useTopicSelection();
  const [requirement, setRequirement] = useState(initialRequirement || '');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const params: TopicListParams = {
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
    ...(workFilter.length ? { works: workFilter } : {}),
    view, days, ...(kind ? { kinds: [kind] } : {}),
    page,
    pageSize: PAGE_SIZE,
  };
  const topicsQuery = useQuery({ queryKey: ['topics', 'picker', params], queryFn: () => fetchTopics(params), staleTime: 15_000 });
  const batchQuery = useQuery({
    queryKey: ['idea-batch', batchId],
    queryFn: () => fetchIdeaBatch(batchId!),
    enabled: Boolean(batchId),
    refetchInterval: (query) => (['queued', 'running'].includes(query.state.data?.status ?? '') ? 2_000 : false),
  });

  const topics = useMemo(() => topicsQuery.data?.items ?? [], [topicsQuery.data]);
  const totalPages = topicsQuery.data ? Math.max(1, Math.ceil(topicsQuery.data.total / PAGE_SIZE)) : 1;
  const batch = batchQuery.data ?? null;

  const generate = async (append: boolean) => {
    setError(null); setBusy(true);
    try {
      if (append && batchId) {
        await createIdeaBatch({ topicIds: selected, appendToBatchId: batchId, ideaCount: 3 });
        void client.invalidateQueries({ queryKey: ['idea-batch', batchId] });
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
          <Input aria-label="搜索素材" value={search} placeholder="搜索标题、摘要、作品或角色" onChange={(event) => setSearch(event.target.value)} className="h-9 text-sm" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">作品</span>
          <TopicWorkFilter value={workFilter} options={topicsQuery.data?.facets.works ?? []} onChange={value => { setWorkFilter(value); setPage(1); }} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">视图</span>
          <Select aria-label="素材视图" value={view} onChange={(event) => { setView(event.target.value as 'all' | 'favorite'); setDays(event.target.value === 'favorite' ? 0 : 30); setPage(1); }} className="h-9 text-sm">
            {TOPIC_VIEWS.filter((item) => item.id === 'all' || item.id === 'favorite').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
        </label>
        <label className="space-y-1"><span className="text-xs text-muted">内容类型</span><Select aria-label="素材内容类型" value={kind} onChange={event => { setKind(event.target.value as TopicKind | ''); setPage(1); }}><option value="">全部类型</option>{(Object.keys(TOPIC_KIND_LABELS) as TopicKind[]).map(value => <option key={value} value={value}>{TOPIC_KIND_LABELS[value]}</option>)}</Select></label>
        <label className="space-y-1"><span className="text-xs text-muted">时间范围</span><Select aria-label="素材时间范围" value={days} onChange={event => { setDays(Number(event.target.value)); setPage(1); }}><option value={7}>最近七天</option><option value={30}>最近三十天</option><option value={0}>不限时间</option></Select></label>
      </div>

      {topicsQuery.isError && <Alert variant="danger">素材加载失败，请稍后重新打开。</Alert>}
      {topicsQuery.isLoading && <Spinner size="sm" label="正在加载素材…" />}
      {!topicsQuery.isLoading && !topics.length && (
        <Alert variant="info" title="还没有可用素材">先去「话题素材库」配置自动搜集并补采，或稍后再来。</Alert>
      )}
      <ul className="space-y-2">
        {topics.map((topic) => (
          <TopicSummaryCard key={topic.id} topic={topic} selected={selected.includes(topic.id)} onToggle={toggle} showActions={false} />
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">第 {page} / {totalPages} 页</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</Button>
          </div>
        </div>
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
              <article key={idea.id} className="flex flex-col gap-1.5 rounded-[var(--radius-panel)] border border-border-default bg-surface p-3">
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
