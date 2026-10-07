'use client';

import React, { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import type { AiCallDetail, AiCallListQuery, AiCallSummary } from '@sthstart/contracts';
import { fetchAiCall, fetchAiCalls, fetchAiCallStorageStats } from '@/app/features/ai-calls/api';
import { aiCallBusinessHref } from '@/app/features/ai-calls/business-href';
import { businessEventLabel, businessEventTitle, traceGroupTitle } from '@/app/features/ai-calls/business-event-label';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Drawer } from '@/app/components/ui/drawer';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { SplitPanes } from '@/app/components/shared/split-panes';

const wideQuery = '(min-width: 1280px)';
function subscribeWide(listener: () => void) {
  const query = window.matchMedia(wideQuery);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
const readWide = () => window.matchMedia(wideQuery).matches;
const serverWide = () => false;

const statusLabels: Record<string, string> = {
  requested: '已记录', not_dispatched: '未发送', submitted: '已提交', accepted: '已接收', running: '运行中',
  succeeded: '成功', failed: '失败', abandoned: '中断',
};

function time(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto rounded-[var(--radius-control)] bg-surface-muted p-3 text-xs leading-relaxed text-ink whitespace-pre-wrap break-words">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}

function readableStreamText(raw: string | null): string | null {
  if (!raw) return null;
  const chunks: string[] = [];
  const parseMessage = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const choices = Array.isArray(item.choices) ? item.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object') continue;
      const record = choice as Record<string, unknown>;
      const delta = record.delta && typeof record.delta === 'object' ? record.delta as Record<string, unknown> : {};
      const message = record.message && typeof record.message === 'object' ? record.message as Record<string, unknown> : {};
      const content = delta.content ?? message.content;
      if (typeof content === 'string') chunks.push(content);
    }
  };
  const dataLines = raw.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (dataLines.length) {
    for (const line of dataLines) {
      const value = line.slice(5).trim();
      if (!value || value === '[DONE]') continue;
      try { parseMessage(JSON.parse(value)); } catch { /* provider may send non-JSON SSE data */ }
    }
  } else {
    try { parseMessage(JSON.parse(raw)); } catch { return null; }
  }
  return chunks.length ? chunks.join('') : null;
}

function ArtifactPreview({ artifact }: { artifact: AiCallDetail['artifactDetails'][number] }) {
  const [failed, setFailed] = useState(false);
  return <li className="min-w-0 rounded-[var(--radius-control)] border border-border-subtle p-3 text-sm">
    <div className="break-all font-mono text-xs text-ink">{artifact.id}</div>
    <div className="mt-1 break-all text-muted">{artifact.available ? '产物可用' : '产物已不可用'}{artifact.sha256 ? ` · SHA-256 ${artifact.sha256}` : ''}</div>
    {artifact.available && artifact.previewUrl && !failed
      ? <a href={artifact.previewUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-[var(--radius-control)] bg-surface-muted" aria-label={`打开产物预览 ${artifact.id}`}>
        <img src={artifact.previewUrl} alt={`生成产物 ${artifact.id}`} onError={() => setFailed(true)} className="max-h-72 w-full object-contain" />
      </a>
      : artifact.available && failed
        ? <div role="status" className="mt-2 text-xs text-muted">预览文件已失效，仍可使用上方产物 ID 与哈希定位。</div>
        : null}
  </li>;
}

/** 日志详情分组（计划 §15.3）：固定顺序的六个小节，每节带一句说明。 */
function DetailGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <section className="rounded-[var(--radius-control)] border border-border-subtle p-3">
    <div className="mb-2"><h3 className="text-sm font-semibold text-ink">{title}</h3><p className="mt-0.5 text-xs text-muted">{hint}</p></div>
    <div className="space-y-3">{children}</div>
  </section>;
}

function CallButton({ item, selectedId, selectCall }: { item: AiCallSummary; selectedId: string; selectCall: (id: string) => void }) {
  return <button type="button" onClick={() => selectCall(item.id)} aria-current={selectedId === item.id ? 'true' : undefined} className={`grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-1 px-4 py-3 text-left hover:bg-surface-muted/50 ${selectedId === item.id ? 'bg-accent/5' : ''}`}>
    <span className="min-w-0">
      <span className="flex min-w-0 items-center gap-2"><span className="truncate font-semibold text-ink">{businessEventTitle(item.businessEvent)}</span><span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted">{statusLabels[item.status] ?? item.status}</span></span>
      <span className="mt-1 block truncate text-xs text-muted">{item.applicationId} · {item.callType} · {item.models.join(', ') || item.provider || '模型待确认'}</span>
      <span className="mt-1 block truncate font-mono text-[11px] text-muted">{item.workflowId ? `${item.workflowId} v${item.workflowVersion ?? '?'}` : item.objectId ?? item.id}</span>
    </span>
    <span className="flex items-center justify-between gap-2 text-left sm:text-right xl:text-left text-xs text-muted"><span>{time(item.requestedAt)}<br />{item.durationMs == null ? '耗时处理中' : `${item.durationMs} ms`}</span><ChevronRight className="h-4 w-4 shrink-0" /></span>
  </button>;
}

export function AiLogsClient() {
  const router = useRouter();
  const wide = useSyncExternalStore(subscribeWide, readWide, serverWide);
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('callId') ?? '';
  const [draftFilters, setDraftFilters] = useState({ applicationId: '', businessEvent: '', status: '', model: '', workflowId: '', from: '', to: '', q: '', objectType: '', objectId: '', traceId: '' });
  const [filters, setFilters] = useState<AiCallListQuery>({ limit: 50 });
  const [cursor, setCursor] = useState<string | undefined>();
  const [items, setItems] = useState<AiCallSummary[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useQuery({ queryKey: ['ai-calls', filters, cursor], queryFn: () => fetchAiCalls({ ...filters, cursor }) });
  const storage = useQuery({ queryKey: ['ai-calls-storage'], queryFn: fetchAiCallStorageStats, staleTime: 60_000 });
  React.useEffect(() => {
    if (!query.data) return;
    setItems((previous) => cursor ? [...previous, ...query.data.items] : query.data.items);
  }, [query.data, cursor]);
  const detail = useQuery({ queryKey: ['ai-call', selectedId], queryFn: () => fetchAiCall(selectedId), enabled: Boolean(selectedId), staleTime: 15_000 });
  const selectedSummary = useMemo(() => items.find((item) => item.id === selectedId), [items, selectedId]);
  const groupedItems = useMemo(() => {
    const groups = new Map<string, AiCallSummary[]>();
    for (const item of items) groups.set(item.traceId, [...(groups.get(item.traceId) ?? []), item]);
    return [...groups.entries()].map(([traceId, calls]) => ({ traceId, calls }));
  }, [items]);

  const applyFilters = () => {
    const next: AiCallListQuery = { limit: 50 };
    for (const [key, value] of Object.entries(draftFilters)) {
      if (!value) continue;
      (next as Record<string, unknown>)[key] = key === 'from' || key === 'to' ? new Date(value).toISOString() : value;
    }
    setFilters(next);
    setCursor(undefined);
    setItems([]);
    setFiltersOpen(false);
  };

  const selectCall = (id: string) => router.replace(`/settings/ai-logs?callId=${encodeURIComponent(id)}`, { scroll: false });
  const closeDetail = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('callId');
    const suffix = params.size ? `?${params.toString()}` : '';
    router.replace(`/settings/ai-logs${suffix}`, { scroll: false });
  };
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== 'limit' && key !== 'cursor' && Boolean(value)).length;
  const loadMore = () => { if (query.data?.nextCursor) setCursor(query.data.nextCursor); };
  const activeBusinessHref = detail.data ? aiCallBusinessHref(detail.data) : selectedSummary ? aiCallBusinessHref(selectedSummary) : null;
  const readableText = detail.data ? readableStreamText(detail.data.responseText) : null;

  const detailContent = (<>
          {activeBusinessHref && <div className="mb-3 flex justify-end"><Link href={activeBusinessHref} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">返回业务页面<ExternalLink className="h-3.5 w-3.5" /></Link></div>}
          {!selectedId ? <div className="p-8 text-sm text-muted">选择一条调用，查看脱敏后的请求、响应和作业时间线。</div>
            : detail.isPending ? <div className="p-6 text-sm text-muted">正在读取调用详情…</div>
              : detail.isError ? <div role="alert" className="p-6 text-sm text-danger-fg">读取详情失败：{detail.error.message}</div>
                : detail.data && <div className="min-w-0 space-y-4 pb-6">
                  {/* 计划 §15.3：来源 → 优化 → 规则 → 最终输入 → 实际图 → 产物，长 JSON 折叠但信息不删。 */}
                  <DetailGroup title="来源" hint="这次调用由哪个业务对象、哪次作业发起。">
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <div><div className="text-xs text-muted">来源 / 功能</div><div className="break-all font-medium text-ink">{detail.data.applicationId} / {detail.data.feature}</div></div>
                      <div><div className="text-xs text-muted">业务事件</div><div className="break-all font-medium text-ink">{businessEventLabel(detail.data.businessEvent)}</div><div className="break-all font-mono text-[11px] text-muted">{detail.data.businessEvent}</div></div>
                      <div><div className="text-xs text-muted">调用类型 / 状态</div><div className="font-medium text-ink">{detail.data.callType} / {statusLabels[detail.data.status] ?? detail.data.status}</div></div>
                      <div><div className="text-xs text-muted">请求 / 结束</div><div className="font-medium text-ink">{time(detail.data.requestedAt)}<br />{time(detail.data.endedAt)}</div></div>
                    </div>
                    <div className="break-all rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-xs text-muted">追踪 ID：<span className="font-mono text-ink">{detail.data.traceId}</span></div>
                    {(detail.data.error || detail.data.errorCode) && <div role="alert" className="rounded border border-danger-fg/20 bg-danger-fg/5 p-3 text-sm text-danger-fg">{detail.data.errorCode && <strong>{detail.data.errorCode}: </strong>}{detail.data.error}</div>}
                  </DetailGroup>

                  <DetailGroup title="优化" hint="文本模型的原始响应与用量，不做截断。">
                    <div><h3 className="mb-2 text-sm font-semibold text-ink">文本响应</h3>{readableText ? <><JsonBlock value={readableText} /><details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-muted">查看原始流响应</summary><div className="mt-2"><JsonBlock value={detail.data.responseText} /></div></details></> : <JsonBlock value={detail.data.responseText ?? '无文本响应（例如图片生成或向量调用）。'} />}</div>
                    {Object.keys(detail.data.usage).length > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-ink">用量</summary><div className="mt-2"><JsonBlock value={detail.data.usage} /></div></details>}
                  </DetailGroup>

                  <DetailGroup title="规则" hint="实际生效的参数与各执行阶段，含规则／知识诊断。">
                    <div><h3 className="mb-2 text-sm font-semibold text-ink">作业时间线（{detail.data.traceCalls.length} 次调用）</h3><ol className="space-y-2 border-l border-border-default pl-4">{detail.data.traceCalls.map((call, index) => <li key={call.id} className="relative text-sm"><span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${call.status === 'failed' ? 'bg-danger-fg' : 'bg-accent'}`} /><button type="button" onClick={() => selectCall(call.id)} className="font-medium text-ink hover:text-accent" aria-current={call.id === selectedId ? 'true' : undefined}>{index + 1}. {businessEventLabel(call.businessEvent)} · {statusLabels[call.status] ?? call.status}</button><div className="text-xs text-muted">{time(call.requestedAt)}{call.durationMs != null ? ` · ${call.durationMs} ms` : ''}{call.models.length ? ` · ${call.models.join(', ')}` : ''}</div>{call.error && <div className="text-xs text-danger-fg">{call.errorCode ? `${call.errorCode}: ` : ''}{call.error}</div>}</li>)}</ol></div>
                    <div><h3 className="mb-2 text-sm font-semibold text-ink">单次调用事件</h3><ol className="space-y-2 border-l border-border-default pl-4">{detail.data.events.map((event) => <li key={event.id} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" /><div className="font-medium text-ink">{event.phase}</div><div className="text-xs text-muted">{time(event.createdAt)}</div>{Object.keys(event.detail).length > 0 && <div className="mt-1"><JsonBlock value={event.detail} /></div>}</li>)}</ol></div>
                    <details><summary className="cursor-pointer text-sm font-semibold text-ink">有效参数</summary><div className="mt-2"><JsonBlock value={detail.data.parameters} /></div></details>
                  </DetailGroup>

                  <DetailGroup title="最终输入" hint="真正提交给生成实例的正负提示词与请求快照。">
                    {detail.data.encodedTexts.length > 0 && <div>
                      <h3 className="mb-2 text-sm font-semibold text-ink">实际文本编码输入</h3>
                      <ul className="space-y-2">{detail.data.encodedTexts.map((entry) => <li key={`${entry.role}:${entry.nodeId}`} className="rounded-[var(--radius-control)] bg-surface-muted p-2">
                        <div className="mb-1 text-xs text-muted">{entry.role === 'positive' ? '正向' : '负向'} · 节点 {entry.nodeId || '未确定'} · {entry.input}</div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">{entry.text}</pre>
                      </li>)}</ul>
                    </div>}
                    {detail.data.encodedTexts.length === 0 && <p className="text-xs text-muted">无法从这次调用的工作流快照确定实际编码文本（例如工作流由节点自行拼接，或本次调用不生成图片）。</p>}
                    <details open><summary className="cursor-pointer text-sm font-semibold text-ink">正向提示词</summary><div className="mt-2"><JsonBlock value={detail.data.positivePrompt ?? '本次调用没有正向提示词。'} /></div></details>
                    <details open><summary className="cursor-pointer text-sm font-semibold text-ink">反向提示词</summary><div className="mt-2"><JsonBlock value={detail.data.negativePrompt ?? '本次调用没有反向提示词。'} /></div></details>
                    <details><summary className="cursor-pointer text-sm font-semibold text-ink">实际请求快照</summary><div className="mt-2"><JsonBlock value={detail.data.requestSnapshot} /></div></details>
                  </DetailGroup>

                  <DetailGroup title="实际图" hint="这次调用实际使用的工作流、版本与模型。">
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <div><div className="text-xs text-muted">工作流</div><div className="break-all font-medium text-ink">{detail.data.workflowId ? `${detail.data.workflowId} v${detail.data.workflowVersion}` : '—'}</div></div>
                      <div><div className="text-xs text-muted">模型</div><div className="break-all font-medium text-ink">{detail.data.models.join(', ') || '—'}</div></div>
                    </div>
                  </DetailGroup>

                  <DetailGroup title="产物" hint="本次调用产生的图片与其哈希、可用性。">
                    {detail.data.artifactDetails.length > 0
                      ? <ul className="space-y-2">{detail.data.artifactDetails.map((artifact) => <ArtifactPreview key={artifact.id} artifact={artifact} />)}</ul>
                      : <p className="text-sm text-muted">本次调用没有产物（文本或向量调用）。</p>}
                  </DetailGroup>
                </div>}
  </>);
  const callList = (
        <section aria-label="调用列表" className="min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-border-default bg-surface">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /><h2 className="font-semibold text-ink">作业列表</h2><span className="text-xs text-muted">{items.length} 次调用 · {groupedItems.length} 组</span></div>
            <Button variant="ghost" size="sm" onClick={() => { setCursor(undefined); setItems([]); void query.refetch(); }} aria-label="刷新调用列表"><RefreshCw className="h-4 w-4" /></Button>
          </div>
          {query.isPending && items.length === 0 ? <div className="p-6 text-sm text-muted">正在读取调用记录…</div>
            : query.isError && items.length === 0 ? <div role="alert" className="p-6 text-sm text-danger-fg">读取调用记录失败：{query.error.message}</div>
              : items.length === 0 ? <div className="p-8 text-center text-sm text-muted">没有符合筛选条件的调用记录。</div>
                : <div className="divide-y divide-border-subtle">
                  {groupedItems.map(({ traceId, calls }) => calls.length === 1
                    ? <CallButton key={calls[0].id} item={calls[0]} selectedId={selectedId} selectCall={selectCall} />
                    : <details key={traceId} open={calls.some((call) => call.id === selectedId)} className="group">
                      <summary className="cursor-pointer list-none px-4 py-3 hover:bg-surface-muted/50">
                        <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate font-semibold text-ink">{traceGroupTitle(calls)}</span><span className="mt-1 block text-xs text-muted">{calls.length} 次调用 · 追踪 {traceId}</span></span><span className="shrink-0 text-right text-xs text-muted">{time(calls[0].requestedAt)}<br /><span className="inline-flex items-center gap-1">展开时间线<ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" /></span></span></span>
                      </summary>
                      <ol className="divide-y divide-border-subtle border-t border-border-subtle bg-surface-muted/30">{calls.map((item, index) => <li key={item.id} className="relative pl-3"><span className="absolute left-5 top-6 text-[10px] text-muted">{index + 1}</span><div className="pl-5"><CallButton item={item} selectedId={selectedId} selectCall={selectCall} /></div></li>)}</ol>
                    </details>)}
                </div>}
          {query.data?.nextCursor && <div className="border-t border-border-subtle p-3 text-center"><Button variant="outline" size="sm" disabled={query.isFetching} onClick={loadMore}>加载更多<ChevronDown className="ml-1 h-4 w-4" /></Button></div>}
        </section>

  );

  return (
    <PageContainer className="max-w-[1600px]">
      <PageHeader title="AI 调用记录" description="按业务事件查看实际发送的模型请求、执行阶段、响应与生成产物。" />
      <div className="mb-4 rounded-[var(--radius-control)] border border-border-subtle bg-surface-muted/50 px-4 py-3 text-sm text-muted leading-relaxed">
        仅包含经 SthStart 服务转发、且已接入审计的调用。旧任务和旧镜头没有历史调用详情；独立启动、未经过本项目网关的邻舍进程也不会出现在这里。
      </div>
      <section aria-label="日志留存" className="mb-4 grid grid-cols-1 gap-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 sm:grid-cols-3">
        <div><div className="text-xs text-muted">数据库占用（含 WAL）</div><div className="mt-1 text-lg font-semibold text-ink">{storage.data ? formatBytes(storage.data.totalBytes) : storage.isError ? '暂不可读取' : '读取中…'}</div></div>
        <div><div className="text-xs text-muted">永久保留的调用 / 事件</div><div className="mt-1 text-lg font-semibold text-ink">{storage.data ? `${storage.data.recordCount.toLocaleString()} / ${storage.data.eventCount.toLocaleString()}` : '—'}</div></div>
        <p className="text-xs leading-relaxed text-muted sm:col-span-1">调用记录不会自动过期或截断。请把数据库纳入例行备份；可运行 <code className="rounded bg-surface-muted px-1 py-0.5 text-ink">npm run db:backup</code> 创建一致性快照。</p>
      </section>

      <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }} className="mb-4 flex min-w-0 items-center gap-2">
          <Input aria-label="关键词" placeholder="搜索提示词、事件或对象" value={draftFilters.q} onChange={(event) => setDraftFilters({ ...draftFilters, q: event.target.value })} />
          <Button type="submit" variant="accent" aria-label="应用筛选"><Search className="h-4 w-4" /><span className="sr-only">应用筛选</span></Button>
          <Button type="button" variant="outline" className="shrink-0" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><SlidersHorizontal className="mr-1 h-4 w-4" />更多筛选{activeFilterCount ? ` · ${activeFilterCount}` : ''}</Button>
      </form>
      <ResponsiveEditOverlay
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="筛选调用记录"
        description="按来源、状态、模型、工作流、时间或业务对象缩小结果范围。"
        footer={<><Button variant="outline" onClick={() => setDraftFilters({ applicationId: '', businessEvent: '', status: '', model: '', workflowId: '', from: '', to: '', q: '', objectType: '', objectId: '', traceId: '' })}>清空条件</Button><Button variant="primary" onClick={applyFilters}>应用筛选</Button></>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input aria-label="来源应用" placeholder="来源应用，如 activities" value={draftFilters.applicationId} onChange={(event) => setDraftFilters({ ...draftFilters, applicationId: event.target.value })} />
          <Input aria-label="业务事件" placeholder="业务事件" value={draftFilters.businessEvent} onChange={(event) => setDraftFilters({ ...draftFilters, businessEvent: event.target.value })} />
          <select aria-label="调用状态" value={draftFilters.status} onChange={(event) => setDraftFilters({ ...draftFilters, status: event.target.value })} className="h-10 rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 text-sm text-ink">
            <option value="">所有状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Input aria-label="模型" placeholder="模型名称" value={draftFilters.model} onChange={(event) => setDraftFilters({ ...draftFilters, model: event.target.value })} />
          <Input aria-label="工作流" placeholder="工作流 ID" value={draftFilters.workflowId} onChange={(event) => setDraftFilters({ ...draftFilters, workflowId: event.target.value })} />
          <Input aria-label="追踪 ID" placeholder="追踪 ID" value={draftFilters.traceId} onChange={(event) => setDraftFilters({ ...draftFilters, traceId: event.target.value })} />
          <Input aria-label="起始时间" type="datetime-local" value={draftFilters.from} onChange={(event) => setDraftFilters({ ...draftFilters, from: event.target.value })} />
          <Input aria-label="结束时间" type="datetime-local" value={draftFilters.to} onChange={(event) => setDraftFilters({ ...draftFilters, to: event.target.value })} />
          <Input aria-label="对象类型" placeholder="对象类型" value={draftFilters.objectType} onChange={(event) => setDraftFilters({ ...draftFilters, objectType: event.target.value })} />
          <Input aria-label="对象 ID" placeholder="业务对象 ID" value={draftFilters.objectId} onChange={(event) => setDraftFilters({ ...draftFilters, objectId: event.target.value })} />
        </div>
      </ResponsiveEditOverlay>

      <div className="grid min-w-0 grid-cols-1 gap-4">
        <SplitPanes
          from="xl"
          className="xl:grid-cols-[400px_minmax(0,1fr)]"
          left={callList}
          right={wide ? <section aria-label="AI 调用详情" className="min-w-0 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">AI 调用详情</h2>
              {selectedId && <Button size="sm" variant="ghost" onClick={closeDetail}>取消选择</Button>}
            </div>
            {detailContent}
          </section> : null}
          rightClassName={!wide ? 'hidden' : undefined}
        />

        <Drawer
          open={!wide && Boolean(selectedId)}
          onOpenChange={(open) => { if (!open) closeDetail(); }}
          title="AI 调用详情"
          description="查看请求快照、执行时间线、产物和模型响应。"
          className="!max-w-[min(56rem,100vw)]"
        >
          {detailContent}
        </Drawer>
      </div>
    </PageContainer>
  );
}
