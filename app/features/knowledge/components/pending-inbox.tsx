'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Ban, Check, Eye, Inbox, Lightbulb, Wand2 } from 'lucide-react';
import type { KnowledgePendingItem } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Drawer } from '@/app/components/ui/drawer';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { EmptyState } from '@/app/components/ui/empty-state';
import { formatTopicTime } from '@/app/features/topics/components/topic-card';
import { fetchPending, fetchPendingDetail, setPendingState } from '../api';
import { OrganizeDraftDialog } from './organize-draft-dialog';

const STATE_TABS: Array<{ id: 'pending' | 'kept' | 'ignored' | 'organized'; label: string }> = [
  { id: 'pending', label: '待整理' },
  { id: 'kept', label: '已保留' },
  { id: 'organized', label: '已整理' },
  { id: 'ignored', label: '已忽略' },
];

/**
 * 待整理：搜集结果的确认入口。
 * 「保留」只让它可被检索到，不强制生成重复笔记；「整理为资料」才生成可编辑正文。
 */
export function PendingInbox() {
  const router = useRouter();
  const client = useQueryClient();
  const [state, setState] = useState<'pending' | 'kept' | 'ignored' | 'organized'>('pending');
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [organizeIds, setOrganizeIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingQuery = useQuery({
    queryKey: ['knowledge-pending', state],
    queryFn: () => fetchPending({ state, limit: 100 }),
    staleTime: 10_000,
  });
  const detailQuery = useQuery({
    queryKey: ['knowledge-pending', 'detail', detailId],
    queryFn: () => fetchPendingDetail(detailId!),
    enabled: Boolean(detailId),
  });

  const items = useMemo(() => pendingQuery.data?.items ?? [], [pendingQuery.data]);
  const counts = pendingQuery.data?.counts ?? {};

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const apply = async (ids: string[], next: 'pending' | 'kept' | 'ignored' | 'organized') => {
    if (!ids.length) return;
    setError(null); setNotice(null); setBusy(true);
    try {
      await setPendingState(ids, next);
      setSelected([]);
      setNotice(next === 'kept' ? '已保留：这些来源摘录现在可以被资料搜索找到，没有生成新的笔记。'
        : next === 'ignored' ? '已忽略：后续搜到同一版本不会再提示，新版本仍会重新出现。'
          : next === 'organized' ? '已标记为已整理。' : '已恢复为待整理。');
      void client.invalidateQueries({ queryKey: ['knowledge-pending'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新失败。');
    } finally { setBusy(false); }
  };

  /** 未整理的来源也能显式带进企划：跳转到新建活动并把来源作为参考资料。 */
  const sendToPlanning = (targets: KnowledgePendingItem[]) => {
    if (!targets.length) return;
    const refs = items.map((item) => 'collection:' + item.sourceVersionId).join(',');
    router.push('/apps/activities/new?refs=' + encodeURIComponent(refs));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">待整理</h2>
          <p className="text-sm text-muted">搜集结果先到这里确认。保留只让它可被检索；整理为资料才会生成可编辑正文，并保留来源。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="待整理状态" value={state} className="h-9 w-32 text-sm" onChange={(event) => { setState(event.target.value as typeof state); setSelected([]); }}>
            {STATE_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </Select>
        </div>
      </div>

      {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
      {notice && <Alert variant="info">{notice}</Alert>}

      <nav className="flex flex-wrap gap-1.5" aria-label="待整理分组">
        {STATE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={state === tab.id}
            onClick={() => { setState(tab.id); setSelected([]); }}
            className={'rounded-full px-3 py-1 text-sm transition-colors ' + (state === tab.id ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5')}
          >
            {tab.label}
            {typeof counts[tab.id] === 'number' ? ' ' + counts[tab.id] : ''}
          </button>
        ))}
      </nav>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-sm">
          <span>已选 {selected.length} 条</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void apply(selected, state === 'ignored' ? 'pending' : 'kept')}>
            {state === 'ignored' ? <><Check className="h-3.5 w-3.5" />恢复</> : <><Check className="h-3.5 w-3.5" />保留</>}
          </Button>
          {state !== 'ignored' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void apply(selected, 'ignored')}><Ban className="h-3.5 w-3.5" />忽略</Button>}
          {state !== 'organized' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setOrganizeIds(selected)}><Wand2 className="h-3.5 w-3.5" />整理为资料</Button>}
          <Button size="sm" variant="ghost" onClick={() => sendToPlanning(items.filter((item) => selected.includes(item.id)))}><Lightbulb className="h-3.5 w-3.5" />用于企划</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>清空选择</Button>
        </div>
      )}

      {pendingQuery.isLoading && <Spinner size="sm" label="正在加载…" />}
      {pendingQuery.isError && <Alert variant="warning" title="加载失败">{pendingQuery.error instanceof Error ? pendingQuery.error.message : '请稍后重试'}</Alert>}
      {!pendingQuery.isLoading && !items.length && (
        <EmptyState
          icon={Inbox}
          title={state === 'pending' ? '没有待整理的内容' : '这个分组是空的'}
          description={state === 'pending' ? '在「搜集任务」里执行一次任务，发现的新内容会出现在这里。' : '切换到其他分组查看。'}
        />
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className={'space-y-2 rounded-[var(--radius-panel)] border p-3 ' + (selected.includes(item.id) ? 'border-accent bg-accent/5' : 'border-border-subtle')}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" aria-label={'选择 ' + item.title} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <strong className="text-sm font-semibold text-ink">{item.title}</strong>
                  <Badge variant={item.changeType === 'new' ? 'online' : 'warning'} className="text-xs">{item.changeType === 'new' ? '新增' : '有变化'}</Badge>
                  {item.work && <span className="text-xs text-muted">《{item.work}》</span>}
                  {item.truncated && <Badge variant="warning" className="text-xs">仅读取部分内容</Badge>}
                  {item.state === 'kept' && <Badge variant="outline" className="text-xs">已保留</Badge>}
                  {item.state === 'organized' && <Badge variant="accent" className="text-xs">已整理</Badge>}
                </div>
                <p className="line-clamp-3 text-sm text-muted">{item.excerpt}</p>
                <p className="text-xs text-muted">
                  {item.sourceName} · 任务：{item.collectionName || '—'} · 获取于 {formatTopicTime(item.retrievedAt)}
                  {item.publishedAt ? ' · 发布时间：' + formatTopicTime(item.publishedAt) : ' · 发布时间未知'}
                </p>
                {!!item.characters.length && <p className="text-xs text-muted">涉及角色：{item.characters.join('、')}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDetailId(item.id)}><Eye className="h-3.5 w-3.5" />查看详情</Button>
              {item.state !== 'kept' && item.state !== 'organized' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void apply([item.id], 'kept')}><Check className="h-3.5 w-3.5" />保留</Button>}
              {item.state !== 'ignored' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void apply([item.id], 'ignored')}><Ban className="h-3.5 w-3.5" />忽略</Button>}
              {item.state === 'ignored' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void apply([item.id], 'pending')}>恢复</Button>}
              {item.state !== 'organized' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setOrganizeIds([item.id])}><Wand2 className="h-3.5 w-3.5" />整理为资料</Button>}
              <Button size="sm" variant="ghost" onClick={() => sendToPlanning([item])}>用于企划</Button>
              {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center text-xs text-accent hover:underline">打开来源</a>}
            </div>
          </li>
        ))}
      </ul>

      <Drawer
        open={Boolean(detailId)}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
        title={detailQuery.data?.item.title ?? '来源详情'}
        description="原始摘录与历史版本。AI 摘要有变化时仍然保留旧版本。"
        className="max-w-xl"
      >
        {detailQuery.isLoading && <Spinner size="sm" label="正在加载…" />}
        {detailQuery.data && (
          <div className="space-y-4 text-sm">
            <p className="whitespace-pre-wrap">{detailQuery.data.item.excerpt}</p>
            <div className="text-xs text-muted">
              <p>来源：{detailQuery.data.item.sourceName}{detailQuery.data.item.url ? '（' + detailQuery.data.item.url + '）' : ''}</p>
              <p>获取于 {formatTopicTime(detailQuery.data.item.retrievedAt)}{detailQuery.data.item.publishedAt ? ' · 发布时间 ' + formatTopicTime(detailQuery.data.item.publishedAt) : ' · 发布时间未知'}</p>
            </div>
            {!!detailQuery.data.versions.length && (
              <div className="space-y-2">
                <p className="font-semibold">历史版本（{detailQuery.data.versions.length}）</p>
                <ul className="space-y-2">
                  {detailQuery.data.versions.map((version) => (
                    <li key={version.id} className={'space-y-1 rounded-lg border p-2 ' + (version.id === detailQuery.data!.item.sourceVersionId ? 'border-accent' : 'border-border-subtle')}>
                      <p className="text-xs text-muted">
                        获取于 {formatTopicTime(version.retrievedAt)}
                        {version.publishedAt ? ' · 发布时间 ' + formatTopicTime(version.publishedAt) : ''}
                        {version.id === detailQuery.data!.item.sourceVersionId ? ' · 当前' : ''}
                        {version.truncated ? ' · 仅读取部分内容' : ''}
                      </p>
                      <p className="line-clamp-4 text-xs">{version.excerpt}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <OrganizeDraftDialog
        open={Boolean(organizeIds)}
        onOpenChange={(open) => { if (!open) setOrganizeIds(null); }}
        itemIds={organizeIds ?? []}
        items={items}
        onAdopted={(noteId, created) => {
          setOrganizeIds(null);
          setSelected([]);
          setNotice(created ? '已保存为新资料。建议接着把它的参考状态改成可参考。' : '已追加到已有资料。');
          void client.invalidateQueries({ queryKey: ['knowledge-pending'] });
          void client.invalidateQueries({ queryKey: ['notebook'] });
          void router.push('/apps/notebook/' + noteId);
        }}
      />
    </div>
  );
}
