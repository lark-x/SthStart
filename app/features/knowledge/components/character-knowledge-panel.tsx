'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BookOpen, Search } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { fetchMcpSources } from '@/app/features/mcp-sources/api';
import { natureLabels, usageLabels } from '@/app/features/notebook/schemas';
import { createCollection, runCollection } from '../api';
/**
 * 角色的相关资料：按角色与作品查询资料库。
 * 可以从不完整开始——资料只要填了角色名就能关联，不要求先建人设卡。
 */
export function CharacterKnowledgePanel({ characterName, work }: { characterName: string; work: string }) {
  const [collectOpen, setCollectOpen] = useState(false);
  const relatedQuery = useQuery({
    queryKey: ['knowledge-character-notes', characterName, work],
    queryFn: async () => {
      const params = new URLSearchParams({ characters: characterName, limit: '20' });
      if (work) params.set('works', work);
      const response = await fetch('/api/admin/knowledge/notes?' + params.toString());
      if (!response.ok) throw new Error('读取相关资料失败');
      return (await response.json()) as { items: Array<Record<string, unknown>>; total: number };
    },
    enabled: Boolean(characterName),
    staleTime: 20_000,
  });

  const items = relatedQuery.data?.items ?? [];

  return (
    <section className="space-y-3" aria-label="相关资料">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><BookOpen className="h-4 w-4 text-accent" />相关资料（{relatedQuery.data?.total ?? 0}）</h3>
          <p className="text-xs text-muted">按角色{work ? '与作品' : ''}查询资料库；只显示已标记为「可参考」的资料。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={'/apps/notebook?q=' + encodeURIComponent(characterName)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-hover">
            <Search className="h-3.5 w-3.5" />在资料库中搜索
          </Link>
          <Button size="sm" variant="outline" onClick={() => setCollectOpen(true)}>发起专题搜集</Button>
        </div>
      </div>

      {relatedQuery.isLoading && <Spinner size="sm" label="正在查询相关资料…" />}
      {relatedQuery.isError && <Alert variant="warning" title="查询失败">{relatedQuery.error instanceof Error ? relatedQuery.error.message : '请稍后重试'}</Alert>}
      {!relatedQuery.isLoading && !items.length && (
        <p className="rounded-lg border border-dashed border-border-default p-4 text-sm text-muted">
          资料库中暂未找到与「{characterName}」关联的可参考资料。可以为这个角色发起一次专题搜集，或直接在资料库里写一篇并把角色填进资料属性。
        </p>
      )}
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={String(item.id)} className="rounded-lg border border-border-subtle p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={'/apps/notebook/' + String(item.id)} className="truncate text-sm font-medium text-ink hover:underline">{String(item.title ?? '未命名资料')}</Link>
              <Badge variant="outline" className="text-xs">{usageLabels[(item.usage as keyof typeof usageLabels) ?? 'record'] ?? String(item.usage ?? '')}</Badge>
              <Badge variant="secondary" className="text-xs">{natureLabels[(item.nature as keyof typeof natureLabels) ?? 'unconfirmed'] ?? String(item.nature ?? '')}</Badge>
            </div>
            {typeof item.excerpt === 'string' && item.excerpt && <p className="line-clamp-2 text-xs text-muted">{item.excerpt}</p>}
          </li>
        ))}
      </ul>

      <Dialog
        open={collectOpen}
        onOpenChange={setCollectOpen}
        title={'为「' + characterName + '」发起专题搜集'}
        description="按角色建立一次专题任务；结果会进入资料库的「待整理」，不会自动改写任何资料。"
        className="max-w-2xl"
        footer={<Button variant="outline" onClick={() => setCollectOpen(false)}>关闭</Button>}
      >
        <CharacterCollectForm characterName={characterName} work={work} onDone={() => setCollectOpen(false)} />
      </Dialog>
    </section>
  );
}

/** 建任务并立即执行：复用第二轮的搜集任务，只把角色与作品预填好。 */
function CharacterCollectForm({ characterName, work, onDone }: { characterName: string; work: string; onDone: () => void }) {
  const [goal, setGoal] = useState('整理' + characterName + '的人物关系与相关设定');
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sourcesQuery = useQuery({ queryKey: ['mcp-sources'], queryFn: fetchMcpSources, staleTime: 30_000 });
  const usable = (sourcesQuery.data ?? []).filter((source) => source.status === 'enabled' && (source.discoveredTools?.length || source.allowedTools.length));
  const effective = sourceId || usable[0]?.id || '';

  const start = async () => {
    setError(null); setNotice(null);
    const source = usable.find((item) => item.id === effective);
    if (!source) { setError('没有可用资料源，请先在公共服务里配置并启用。'); return; }
    const tool = source.discoveredTools?.[0]?.name || source.allowedTools[0];
    if (!tool) { setError('该资料源还没有可用工具，请先测试连接。'); return; }
    setBusy(true);
    try {
      const collection = await createCollection({
        name: characterName + '专题搜集',
        goal,
        works: work ? [work] : [],
        characters: [characterName],
        // 专题不限时间，避免把长期设定当成近期动态。
        mode: 'topic',
        sources: [{ sourceId: source.id, searchTool: tool }],
        frequency: 'once',
        enabled: false,
      });
      await runCollection(collection.id);
      setNotice('已开始搜集，结果会出现在资料库的「待整理」。');
      void onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发起搜集失败。');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 text-sm">
      {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
      {notice && <Alert variant="info">{notice}</Alert>}
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">搜集目标</span>
        <Input aria-label="搜集目标" value={goal} className="h-9 text-sm" onChange={(event) => setGoal(event.target.value)} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">使用资料源</span>
        {usable.length ? (
          <Select aria-label="资料源" value={effective} className="h-9 text-sm" onChange={(event) => setSourceId(event.target.value)}>
            {usable.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
          </Select>
        ) : <p className="text-xs text-amber-700">没有可用资料源；请先在公共服务里配置。</p>}
      </label>
      <Button variant="primary" disabled={busy || !usable.length} onClick={() => void start()}>{busy ? '正在发起…' : '保存并立即搜集'}</Button>
      <p className="text-xs text-muted">任务只负责搜集与保存来源，不会自动修改这个角色的人设。</p>
    </div>
  );
}
