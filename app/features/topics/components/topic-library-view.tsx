'use client';
import { TopicWorkFilter } from './topic-work-filter';
import { useTopicSelection } from '../use-topic-selection';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, ChevronLeft, ChevronRight, ExternalLink, Link2, Lightbulb, RefreshCw, Settings2, Wand2, X,
} from 'lucide-react';
import type { ActivityIdea, ActivityIdeaBatch, Topic, TopicKind } from '@sthstart/contracts';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer, WorkbenchColumns } from '@/app/components/shared/page-layout';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { EmptyState } from '@/app/components/ui/empty-state';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { CharacterPickerDialog } from '@/app/features/activities/components/character-picker-dialog';
import {
  TOPIC_KIND_LABELS, TOPIC_NATURE_LABELS, TOPIC_VIEWS, applyIdea, createIdeaBatch, fetchCollectionRuns,
  fetchCollectionSettings, fetchIdeaBatch, fetchIdeaBatches, fetchTopic, fetchTopics, saveCollectionSettings,
  startCollectionRun, updateTopicFlags, type TopicListParams,
} from '../api';
import { saveTopicToKnowledge } from '@/app/features/notebook/api';
import { TopicSummaryCard, formatTopicTime as formatDateTime, publishedLabel } from './topic-card';

const PAGE_SIZE = 24;
const MAX_SELECTED = 5;
const TIME_RANGES = [
  { value: 0, label: '全部时间' },
  { value: 7, label: '最近 7 天' },
  { value: 30, label: '最近 30 天' },
  { value: 90, label: '最近 90 天' },
];

export function TopicLibraryView() {
  const router = useRouter();
  const client = useQueryClient();
  const [view, setView] = useState<'all' | 'favorite' | 'used' | 'ignored'>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [workFilter, setWorkFilter] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<TopicKind | ''>('');
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const { selected, setSelected, selectedTopics, toggleSelected } = useTopicSelection();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [leadCharacterId, setLeadCharacterId] = useState('');
  const [leadCharacterName, setLeadCharacterName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmIdea, setConfirmIdea] = useState<{ batch: ActivityIdeaBatch; idea: ActivityIdea } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // 收藏视图默认不限时间，其余视图默认最近 30 天。
  const effectiveDays = days;
  const listParams: TopicListParams = {
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
    ...(workFilter.length ? { works: workFilter } : {}),
    ...(kindFilter ? { kinds: [kindFilter] } : {}),
    days: effectiveDays,
    view,
    page,
    pageSize: PAGE_SIZE,
  };

  const runsQuery = useQuery({
    queryKey: ['topic-collection', 'runs'],
    queryFn: () => fetchCollectionRuns(5),
    refetchInterval: (query) => (query.state.data?.items.some((run) => run.status === 'queued' || run.status === 'running') ? 2_000 : 30_000),
  });
  // 有搜集任务在跑时列表跟着刷新，补采完成后不需要手动刷新页面。
  const topicsQuery = useQuery({
    queryKey: ['topics', listParams],
    queryFn: () => fetchTopics(listParams),
    staleTime: 15_000,
    refetchInterval: () => (runsQuery.data?.items.some((run) => run.status === 'queued' || run.status === 'running') ? 3_000 : false),
  });
  const settingsQuery = useQuery({ queryKey: ['topic-collection', 'settings'], queryFn: fetchCollectionSettings, staleTime: 15_000 });
  const detailQuery = useQuery({
    queryKey: ['topics', 'detail', detailId],
    queryFn: () => fetchTopic(detailId!),
    enabled: Boolean(detailId),
  });
  const batchQuery = useQuery({
    queryKey: ['idea-batch', batchId],
    queryFn: () => fetchIdeaBatch(batchId!),
    enabled: Boolean(batchId),
    refetchInterval: (query) => (['queued', 'running'].includes(query.state.data?.status ?? '') ? 2_000 : false),
  });
  const historyQuery = useQuery({ queryKey: ['idea-batches'], queryFn: () => fetchIdeaBatches(20), staleTime: 15_000 });

  const topics = useMemo(() => topicsQuery.data?.items ?? [], [topicsQuery.data]);
  const latestRun = runsQuery.data?.items[0] ?? null;
  const settings = settingsQuery.data;
  const activeRun = latestRun && ['queued', 'running'].includes(latestRun.status) ? latestRun : null;

  const lastCompletedRun = React.useRef<string | null>(null);
  useEffect(() => {
    if (!latestRun || ['queued', 'running'].includes(latestRun.status)) return;
    const key = latestRun.id + ':' + latestRun.updatedAt;
    if (lastCompletedRun.current === key) return;
    lastCompletedRun.current = key;
    void client.invalidateQueries({ queryKey: ['topics'] });
    void client.invalidateQueries({ queryKey: ['topic-collection', 'settings'] });
  }, [latestRun, client]);

  const patchTopic = async (topic: Topic, patch: { favorite?: boolean; ignored?: boolean }) => {
    setError(null);
    try {
      await updateTopicFlags(topic.id, patch);
      if (patch.ignored) setSelected((current) => current.filter((id) => id !== topic.id));
      void client.invalidateQueries({ queryKey: ['topics'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新素材失败。');
    }
  };

  const runCollection = async (retryRunId?: string) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      const result = await startCollectionRun(retryRunId ? { retryRunId } : {});
      void client.invalidateQueries({ queryKey: ['topic-collection', 'runs'] });
      // 立刻刷新一次素材列表；任务结束前列表会持续轮询。
      void client.invalidateQueries({ queryKey: ['topics'] });
      setNotice(result.reused ? '已有一次搜集正在进行，已显示该任务的进度。' : retryRunId ? '已重试上次搜集；有保存的原始候选时会直接重试整理。' : '已开始搜集，页面会自动刷新进度。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '启动搜集失败。');
    } finally { setBusy(false); }
  };

  const generateIdeas = async (append: boolean) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      if (append && batchId) {
        await createIdeaBatch({ topicIds: selected, appendToBatchId: batchId, ideaCount: 3 });
        void client.invalidateQueries({ queryKey: ['idea-batch', batchId] });
      } else {
        const batch = await createIdeaBatch({
          topicIds: selected,
          ...(requirement.trim() ? { requirement: requirement.trim() } : {}),
          ...(leadCharacterId ? { leadCharacterId } : {}),
        });
        setBatchId(batch.id);
        void client.invalidateQueries({ queryKey: ['idea-batches'] });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成点子失败。');
    } finally { setBusy(false); }
  };

  /** 从素材库进入：建立企划会话并跳到新建活动页面。 */
  const adoptIdea = async (batch: ActivityIdeaBatch, idea: ActivityIdea) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      // 从素材库进入会新建企划会话；会话必须有参与角色，所以要用这里选好的主角。
      const result = await applyIdea(batch.id, idea.id, {});
      void client.invalidateQueries({ queryKey: ['topics'] });
      router.push('/apps/activities/new?session=' + result.sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '采用点子失败。');
      setConfirmIdea(null);
    } finally { setBusy(false); }
  };

  const totalPages = topicsQuery.data ? Math.max(1, Math.ceil(topicsQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="w-full bg-paper py-6 text-ink">
      <PageContainer className="space-y-4">
        <PageHeader
          title="话题素材库"
          description="后台定时搜集关注作品的新梗与讨论；勾选素材后可以让模型生成活动点子，再带入企划。"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy || Boolean(activeRun)} onClick={() => void runCollection()}>
                <RefreshCw className="h-3.5 w-3.5" />{activeRun ? '正在搜集…' : '立即补采'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}><Settings2 className="h-3.5 w-3.5" />自动搜集设置</Button>
            </div>
          )}
        />

        {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}

        {/* 状态行：自动搜集开关、最近成功时间、下次执行、最近新增 */}
        <section className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-panel)] border border-border-default bg-surface px-4 py-3 text-sm">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-accent" />
            自动搜集
            <Badge variant={settings?.settings.enabled ? 'online' : 'stopped'} className="text-xs">{settings?.settings.enabled ? '已开启' : '已关闭'}</Badge>
          </span>
          <span className="text-muted">下次执行：{settings?.nextRunLocal ?? '未安排'}</span>
          <span className="text-muted">最近任务：{latestRun ? ({ queued: '排队中', running: '搜集中', succeeded: '已完成', partial: '部分完成', failed: '失败', interrupted: '已中断' }[latestRun.status]) + '（' + formatDateTime(latestRun.finishedAt ?? latestRun.createdAt) + '）' : '还没有执行记录'}</span>
          <span className="text-muted">最近成功：{runsQuery.data?.lastSuccessful?.finishedAt ? formatDateTime(runsQuery.data.lastSuccessful.finishedAt) : '暂无'}</span>
          <span className="text-muted">最近新增：{latestRun ? latestRun.createdCount + ' 条' : '—'}</span>
          {activeRun && <span className="flex items-center gap-1.5 text-amber-800"><Spinner size="sm" label="" />{activeRun.progressLabel || '进行中'}</span>}
          {latestRun?.status === 'partial' && <span className="text-amber-700">部分来源失败：{latestRun.errorMessage}</span>}
          {latestRun?.status === 'failed' && <span className="text-red-700">上次失败：{latestRun.errorMessage}</span>}
        </section>

        <WorkbenchColumns
          left={(
            <>
              <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink">素材（{topicsQuery.data?.total ?? 0}）</h2>
                  <Button size="sm" variant="ghost" onClick={() => void topicsQuery.refetch()}><RefreshCw className="h-3.5 w-3.5" />刷新列表</Button>
                </div>
                <PageTabs
                  ariaLabel="素材视图"
                  value={view}
                  onChange={(value) => { setView(value as typeof view); setDays(value === 'favorite' ? 0 : 30); setPage(1); }}
                  tabs={TOPIC_VIEWS.map((item) => ({ id: item.id, label: item.label }))}
                />
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
                    <span className="text-xs text-muted">内容类型</span>
                    <Select aria-label="按内容类型筛选" value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as TopicKind | ''); setPage(1); }} className="h-9 text-sm">
                      <option value="">全部类型</option>
                      {(Object.keys(TOPIC_KIND_LABELS) as TopicKind[]).map((kind) => <option key={kind} value={kind}>{TOPIC_KIND_LABELS[kind]}</option>)}
                    </Select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted">时间范围</span>
                    <Select aria-label="按时间范围筛选" value={String(days)} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); }} className="h-9 text-sm">
                      {TIME_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
                    </Select>
                  </label>
                </div>

                {topicsQuery.isLoading && <Spinner size="sm" label="正在加载素材…" />}
                {topicsQuery.isError && <Alert variant="warning" title="素材加载失败">{topicsQuery.error instanceof Error ? topicsQuery.error.message : '请稍后重试'}。已有素材不会因此删除。</Alert>}
                {!topicsQuery.isLoading && !topics.length && (
                  <EmptyState
                    icon={Lightbulb}
                    title={view === 'all' ? '还没有素材' : '这个视图里没有素材'}
                    description={settings?.settings.sources.length
                      ? '点击右上角「立即补采」，或等待自动搜集按计划执行。搜集结果会按来源与链接去重。'
                      : '先在「自动搜集设置」里选择资料源与检索工具，再执行一次补采。'}
                    actions={<Button size="sm" onClick={() => setSettingsOpen(true)}><Settings2 className="h-3.5 w-3.5" />配置自动搜集</Button>}
                  />
                )}

                <ul className="space-y-2">
                  {topics.map((topic) => (
                    <TopicSummaryCard
                      key={topic.id}
                      topic={topic}
                      selected={selected.includes(topic.id)}
                      onToggle={toggleSelected}
                      onOpenDetail={(item) => setDetailId(item.id)}
                      onToggleFavorite={(item) => void patchTopic(item, { favorite: !item.favorite })}
                      onToggleIgnore={(item) => void patchTopic(item, { ignored: !item.ignored })}
                      onSaveToLibrary={async (item) => {
                        setError(null);
                        try {
                          const result = await saveTopicToKnowledge(item.id);
                          setNotice(result.created ? '已收藏到创作资料库（默认仅记录，可在资料属性里改成可参考）。' : '这个话题之前已经收藏过，已打开原有资料。');
                          void client.invalidateQueries({ queryKey: ['notebook'] });
                          router.push('/apps/notebook/' + result.noteId);
                        } catch (caught) {
                          setError(caught instanceof Error ? caught.message : '收藏到资料库失败。');
                        }
                      }}
                    />
                  ))}
                </ul>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-1 text-sm">
                    <span className="text-muted">第 {page} / {totalPages} 页</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
                      <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-2 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <h2 className="text-sm font-semibold text-ink">最近的采纳与线索</h2>
                {historyQuery.data?.items.length
                  ? <ul className="space-y-1.5 text-xs text-muted">
                      {historyQuery.data.items.slice(0, 6).map((batch) => (
                        <li key={batch.id}>
                          {formatDateTime(batch.createdAt)} · {batch.status} · {batch.ideas.length} 个点子
                          {batch.activityId ? ' · 已用于活动' : ''}
                          <button type="button" className="ml-2 text-accent hover:underline" onClick={() => { setBatchId(batch.id); setIdeaOpen(true); }}>打开</button>
                        </li>
                      ))}
                    </ul>
                  : <p className="text-xs text-muted">还没有点子批次。选中素材后点「生成活动点子」即可开始。</p>}
              </section>
            </>
          )}
          right={(
            <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Lightbulb className="h-4 w-4 text-accent" />从素材生成点子</h2>
              <p className="text-sm text-muted">勾选 1～3 条素材效果最好，最多 5 条。可以跨页勾选。</p>
              <p className="text-sm">已选 {selected.length} 条{selected.length > MAX_SELECTED ? '（超过上限，请去掉一些）' : ''}</p>
              {!!selectedTopics.length && (
                <ul className="space-y-1 text-xs text-muted">
                  {selectedTopics.map((topic) => <li key={topic.id} className="flex items-center gap-2">· {topic.title}<Button size="sm" variant="ghost" onClick={() => setSelected(current => current.filter(id => id !== topic.id))}>移除</Button></li>)}
                </ul>
              )}
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-ink">可选要求</span>
                <Textarea aria-label="点子要求" rows={3} value={requirement} placeholder="例如：用这几个梗给芙宁娜办一场聚会" onChange={(event) => setRequirement(event.target.value)} />
              </label>
              {/* 这里不能包在 label 里：label 会接管内部按钮的可访问名。 */}
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-ink">活动主角</span>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{leadCharacterName || '未指定'}</span>
                  <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>选择主角</Button>
                  {leadCharacterId && <Button size="sm" variant="ghost" onClick={() => { setLeadCharacterId(''); setLeadCharacterName(''); }}><X className="h-3.5 w-3.5" /></Button>}
                </div>
              </div>
              <Button variant="primary" disabled={busy || !selected.length || selected.length > MAX_SELECTED || !leadCharacterId} onClick={() => { setIdeaOpen(true); void generateIdeas(false); }}>
                <Wand2 className="h-3.5 w-3.5" />生成三个点子
              </Button>
              {!leadCharacterId && <p className="text-xs text-amber-700">请先选择活动主角：采用点子时会用主角建立企划会话。</p>}
              {selected.length > MAX_SELECTED && <Alert variant="warning">一次最多选择 {MAX_SELECTED} 条素材。</Alert>}
              <p className="text-xs text-muted">这里只生成点子方向，不生成完整聊天、图片或视频；详情页与企划会继续沿用已有流程。</p>
            </section>
          )}
        />
      </PageContainer>

      <Drawer
        open={Boolean(detailId)}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
        title={detailQuery.data?.topic.title ?? '素材详情'}
        description="完整说明、来源链接与改编方向。列表只显示摘要，避免铺开全部原文。"
        className="max-w-xl"
      >
        {detailQuery.isLoading && <Spinner size="sm" label="正在加载详情…" />}
        {detailQuery.data && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {detailQuery.data.topic.works.map((work) => <span key={work} className="text-xs text-muted">《{work}》</span>)}
              <Badge variant="outline" className="text-xs">{TOPIC_KIND_LABELS[detailQuery.data.topic.kind]}</Badge>
              <Badge variant="secondary" className="text-xs">{TOPIC_NATURE_LABELS[detailQuery.data.topic.infoNature]}</Badge>
              {detailQuery.data.topic.usedActivityId && <Badge variant="online" className="text-xs">已用于活动</Badge>}
            </div>
            <p className="whitespace-pre-wrap">{detailQuery.data.topic.summary}</p>
            {!!detailQuery.data.topic.characters.length && <p className="text-muted">涉及角色：{detailQuery.data.topic.characters.join('、')}</p>}
            {!!detailQuery.data.topic.adaptationTags.length && (
              <div className="space-y-1">
                <p className="font-semibold">改编方向</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailQuery.data.topic.adaptationTags.map((tag) => <span key={tag} className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent-dark" style={{ color: undefined }}>{tag}</span>)}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <p className="font-semibold">发现时间</p>
              <p className="text-xs text-muted">
                最新来源发布时间：{publishedLabel(detailQuery.data.topic.latestPublishedAt ?? null)} · 首次收集：{formatDateTime(detailQuery.data.topic.firstSeenAt)} · 最近发现：{formatDateTime(detailQuery.data.topic.lastSeenAt)}
              </p>
            </div>
            <div className="space-y-2">
              <p className="font-semibold">来源（{detailQuery.data.sources.length}）</p>
              <ul className="space-y-2">
                {detailQuery.data.sources.map((source) => (
                  <li key={source.id} className="space-y-1 rounded-lg border border-border-subtle p-3">
                    <p className="text-xs font-semibold text-ink">{source.title || source.sourceName}</p>
                    <p className="text-xs text-muted">{source.sourceName} · 发布时间：{publishedLabel(source.publishedAt)}</p>
                    {source.url && (
                      <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                        <Link2 className="h-3 w-3" />打开来源<ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {source.excerpt && <p className="whitespace-pre-wrap text-xs text-muted">{source.excerpt.slice(0, 300)}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Drawer>

      <Dialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="自动搜集设置"
        description="每天固定时间搜集一次；关闭浏览器不影响执行，但电脑关机或后端停止时不会执行，恢复后只补采最近七天。"
        className="max-w-2xl"
        footer={<Button variant="outline" onClick={() => setSettingsOpen(false)}>关闭</Button>}
      >
        <CollectionSettingsForm
          onSaved={(message) => { setNotice(message); void client.invalidateQueries({ queryKey: ['topic-collection'] }); }}
          onError={(message) => setError(message)}
        />
      </Dialog>

      <Dialog
        open={ideaOpen}
        onOpenChange={(open) => { setIdeaOpen(open); if (!open) { setBatchId(null); } }}
        title="活动点子"
        description="默认生成三个有明显区别的方向；「再来三个」会追加一批候选，保留前一批。"
        className="max-w-4xl"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={busy || !batchId || ['queued', 'running'].includes(batchQuery.data?.status ?? '')} onClick={() => void generateIdeas(true)}>再来三个</Button>
            <Button variant="outline" onClick={() => { setIdeaOpen(false); setBatchId(null); }}>关闭</Button>
          </div>
        )}
      >
        {error && <Alert variant="danger">{error}</Alert>}
        <IdeaWorkspace
          batch={batchQuery.data ?? null}
          loading={batchQuery.isLoading}
          busy={busy}
          selectedTopics={selectedTopics}
          onUse={(batch, idea) => setConfirmIdea({ batch, idea })}
        />
      </Dialog>

      <Dialog
        open={Boolean(confirmIdea)}
        onOpenChange={(open) => { if (!open) setConfirmIdea(null); }}
        title="用这个点子创建活动"
        description="会建立一份企划会话并跳到新建活动页面，让你在第一步检查活动意图。推荐人物只是候选，不会自动成为参与者。"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setConfirmIdea(null)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { if (confirmIdea) void adoptIdea(confirmIdea.batch, confirmIdea.idea); }}>{busy ? '正在建立…' : '用这个点子创建活动'}</Button>
          </div>
        )}
      >
        {confirmIdea && (
          <div className="space-y-2 text-sm">
            <p><span className="font-semibold">点子：</span>{confirmIdea.idea.name}</p>
            <p className="text-muted">{confirmIdea.idea.overview}</p>
            <p className="text-xs text-muted">将填入标题与主题，并在企划要求里写明必须采用的灵感；已有主角与日期不会被覆盖。</p>
          </div>
        )}
      </Dialog>

      <CharacterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        existingSourceCharacterIds={[]}
        existingActorCount={0}
        onSelectCharacter={(actor) => {
          setLeadCharacterId(String(actor.sourceCharacterId || actor.id));
          setLeadCharacterName(actor.displayName);
        }}
      />
    </div>
  );
}

/** 自动搜集设置：来源只从已启用的 MCP 中选择，工具从该来源已发现的工具中选择。 */
function CollectionSettingsForm({ onSaved, onError }: { onSaved: (message: string) => void; onError: (message: string) => void }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['topic-collection', 'settings'], queryFn: fetchCollectionSettings });
  const sourcesQuery = useQuery({ queryKey: ['mcp-sources'], queryFn: () => import('@/app/features/mcp-sources/api').then((mod) => mod.fetchMcpSources()), staleTime: 30_000 });
  const worksQuery = useQuery({
    queryKey: ['characters', 'works-facets'],
    queryFn: () => import('@/app/features/characters/api').then((mod) => mod.browseCharacters({ page: 1, pageSize: 1 })),
    staleTime: 60_000,
  });
  const [enabled, setEnabled] = useState(false);
  const [works, setWorks] = useState<string[]>([]);
  const [keywords, setKeywords] = useState('');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [maxNewTopics, setMaxNewTopics] = useState(20);
  const [bindings, setBindings] = useState<Array<{ sourceId: string; searchTool: string; readTool?: string }>>([]);
  const [busy, setBusy] = useState(false);

  // 设置只在首次读取时灌入表单，避免后台刷新覆盖用户正在编辑的内容。
  const hydrated = React.useRef(false);
  useEffect(() => {
    if (hydrated.current || !data) return;
    hydrated.current = true;
    setEnabled(data.settings.enabled);
    setWorks(data.settings.works);
    setKeywords(data.settings.keywords.join(', '));
    setDailyTime(data.settings.dailyTime);
    setMaxNewTopics(data.settings.maxNewTopics);
    setBindings(data.settings.sources);
  }, [data]);

  const enabledSources = (sourcesQuery.data ?? []).filter((source) => source.status === 'enabled');
  const workOptions = (worksQuery.data?.facets.works ?? []).map((work) => work.name);
  const toolsFor = (sourceId: string) => { const source = enabledSources.find(item => item.id === sourceId); return (source?.discoveredTools ?? []).filter(tool => source?.allowedTools.includes(tool.name)); };

  const save = async () => {
    setBusy(true);
    try {
      const result = await saveCollectionSettings({
        enabled,
        works,
        keywords: keywords.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean),
        sources: bindings,
        dailyTime,
        maxNewTopics,
        timezone: data?.settings.timezone ?? 'Asia/Shanghai',
      });
      onSaved(result.settings.enabled ? '设置已保存；下次执行时间：' + (result.nextRunLocal ?? '待计算') + '。' : '设置已保存；自动搜集当前为关闭状态。');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '保存设置失败。');
    } finally { setBusy(false); }
  };

  if (isLoading) return <Spinner size="sm" label="正在读取设置…" />;
  if (isError) return <Alert variant="warning" title="设置加载失败">{error instanceof Error ? error.message : '请稍后重试'}</Alert>;

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        开启自动搜集（首次未配置时为关闭）
      </label>

      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-ink">关注作品</p>
        {workOptions.length ? (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border-subtle p-2">
            {workOptions.map((work) => (
              <label key={work} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={works.includes(work)}
                  onChange={(event) => setWorks((current) => event.target.checked ? [...current, work] : current.filter((item) => item !== work))}
                />
                <span className="truncate">{work}</span>
              </label>
            ))}
          </div>
        ) : <p className="text-xs text-muted">角色库里还没有作品记录，可以直接在下面填写额外关键词。</p>}
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">额外关键词（逗号分隔）</span>
        <Input aria-label="额外关键词" value={keywords} placeholder="例如：料理梗, 角色互动" onChange={(event) => setKeywords(event.target.value)} className="h-9 text-sm" />
      </label>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">信息来源</p>
        <p className="text-xs text-muted">请选择能够检索近期网页或社区信息的资料源；剧情资料库不一定包含新梗。</p>
        {!enabledSources.length && <p className="text-xs text-amber-700">还没有启用的 MCP 资料源，请先到「模型与公共服务」配置并启用。</p>}
        <ul className="space-y-2">
          {enabledSources.map((source) => {
            const binding = bindings.find((item) => item.sourceId === source.id);
            const tools = toolsFor(source.id);
            return (
              <li key={source.id} className="space-y-2 rounded-lg border border-border-subtle p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(binding)}
                    onChange={(event) => setBindings((current) => event.target.checked
                      ? [...current, { sourceId: source.id, searchTool: tools[0]?.name ?? '' }]
                      : current.filter((item) => item.sourceId !== source.id))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{source.name}</span>
                    <span className="block truncate text-xs text-muted">{source.purpose || source.url}</span>
                  </span>
                </label>
                {binding && (
                  <div className="grid gap-2 pl-6 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-muted">检索工具</span>
                      <Select
                        aria-label={source.name + ' 检索工具'}
                        value={binding.searchTool}
                        className="h-9 text-sm"
                        onChange={(event) => setBindings((current) => current.map((item) => item.sourceId === source.id ? { ...item, searchTool: event.target.value } : item))}
                      >
                        <option value="">请选择</option>
                        {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
                      </Select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted">读取工具（可选）</span>
                      <Select
                        aria-label={source.name + ' 读取工具'}
                        value={binding.readTool ?? ''}
                        className="h-9 text-sm"
                        onChange={(event) => setBindings((current) => current.map((item) => item.sourceId === source.id ? { ...item, readTool: event.target.value || undefined } : item))}
                      >
                        <option value="">不需要</option>
                        {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
                      </Select>
                    </label>
                    {!tools.length && <p className="text-xs text-amber-700 sm:col-span-2">该资料源还没有发现工具，请先在公共服务里测试连接。</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-semibold text-ink">每天搜集时间（北京时间）</span>
          <Input aria-label="每天搜集时间" type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} className="h-9 text-sm" />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-semibold text-ink">每轮新增上限</span>
          <Select aria-label="每轮新增上限" value={String(maxNewTopics)} onChange={(event) => setMaxNewTopics(Number(event.target.value))} className="h-9 text-sm">
            <option value="10">10 条</option>
            <option value="20">20 条</option>
            <option value="50">50 条</option>
          </Select>
        </label>
      </div>

      <p className="text-xs text-muted">下次执行：{data?.nextRunLocal ?? '未安排'}。保存后若素材库为空，可回到页面点「立即补采」采集第一批。</p>
      <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存设置'}</Button>
    </div>
  );
}

/** 点子工作区：显示已选素材、生成中的进度与三个点子；追加批次会保留前一批。 */
function IdeaWorkspace({ batch, loading, busy, selectedTopics, onUse }: {
  batch: ActivityIdeaBatch | null;
  loading: boolean;
  busy: boolean;
  selectedTopics: Topic[];
  onUse: (batch: ActivityIdeaBatch, idea: ActivityIdea) => void;
}) {
  if (loading && !batch) return <Spinner size="sm" label="正在准备点子…" />;
  if (!batch) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted">已选素材（{selectedTopics.length}）：</p>
        <ul className="space-y-1 text-xs text-muted">{selectedTopics.map((topic) => <li key={topic.id}>· {topic.title}</li>)}</ul>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm">素材快照（{batch.topics.length}）：</p>
        <ul className="space-y-1 text-xs text-muted">
          {batch.topics.map((topic) => <li key={topic.id}>· {topic.title}</li>)}
        </ul>
        {batch.requirement && <p className="text-xs text-muted">要求：{batch.requirement}</p>}
        {batch.leadCharacterName && <p className="text-xs text-muted">主角：{batch.leadCharacterName}</p>}
      </div>
      {batch.status === 'queued' || batch.status === 'running' ? <Spinner size="sm" label="正在生成点子…" /> : null}
      {batch.status === 'failed' && <Alert variant="danger" title="生成失败">{batch.errorMessage || '请稍后重试'}</Alert>}
      {batch.status === 'succeeded' && !batch.ideas.length && <Alert variant="warning">模型没有返回可用点子，请调整素材或要求后重试。</Alert>}
      <div className="grid gap-3 lg:grid-cols-3">
        {batch.ideas.map((idea) => (
          <article key={idea.id} className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-border-default bg-surface p-3">
            <header className="space-y-1">
              <h3 className="text-sm font-semibold text-ink">{idea.name}</h3>
              <p className="text-xs text-muted">{idea.overview}</p>
            </header>
            <p className="text-xs text-muted"><span className="font-medium text-ink">改编方式：</span>{idea.adaptation}</p>
            {idea.recommendedCharacters.length > 0 && (
              <div className="space-y-0.5 text-xs text-muted">
                <p className="font-medium text-ink">推荐人物（候选提示）</p>
                {idea.recommendedCharacters.map((character, index) => (
                  <p key={character.name + index}>{character.name}{character.work ? '（' + character.work + '）' : ''}：{character.reason}{character.relationshipNote ? '；' + character.relationshipNote : ''}</p>
                ))}
              </div>
            )}
            <div className="text-xs text-muted">
              <p><span className="font-medium text-ink">地点：</span>{idea.location || '未指定'} · <span className="font-medium text-ink">风格：</span>{idea.style || '未指定'}</p>
            </div>
            {idea.stages.length > 0 && (
              <div className="space-y-0.5 text-xs text-muted">
                <p className="font-medium text-ink">初步阶段（参考）</p>
                {idea.stages.map((stage, index) => <p key={stage.title + index}>{index + 1}. {stage.title}：{stage.outline}</p>)}
              </div>
            )}
            {idea.expectedHighlights.length > 0 && (
              <p className="text-xs text-muted"><span className="font-medium text-ink">预期桥段：</span>{idea.expectedHighlights.join('、')}</p>
            )}
            {idea.assumptions.length > 0 && (
              <p className="text-xs text-amber-700"><span className="font-medium">属于建议：</span>{idea.assumptions.join('；')}</p>
            )}
            <div className="mt-auto pt-1">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onUse(batch, idea)}>用这个点子创建活动</Button>
            </div>
          </article>
        ))}
      </div>
      {batch.ideas.length > 3 && <p className="text-xs text-muted">已追加候选共 {batch.ideas.length} 个，前一批仍然保留。</p>}
    </div>
  );
}
