'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type {
  KnowledgeGap, KnowledgeRecommendation, PlanningKnowledgeSnapshot, PlanningKnowledgeReference,
  PlanningReferenceSelection, PlanningReferenceUsage,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Spinner } from '@/app/components/ui/spinner';
import { Textarea } from '@/app/components/ui/textarea';
import { fetchMcpSources } from '@/app/features/mcp-sources/api';
import { checkReferences, previewReferences, recommendKnowledge } from '@/app/features/notebook/api';
import { createCollection, fetchCollectionRun, runCollection, type RunFinding } from '../api';

export interface AssistantSelection {
  sourceKind: PlanningReferenceSelection['sourceKind'];
  sourceId: string;
  usage: PlanningReferenceUsage;
  title: string;
  excerpt: string;
  nature?: string;
  authorship?: string;
  frozenReference?: PlanningKnowledgeReference;
}

/** 把「来源标识」解析成带正文的引用草稿：只引用已保存的内容。 */
async function resolveSelectionDrafts(selections: PlanningReferenceSelection[]): Promise<AssistantSelection[]> {
  if (!selections.length) return [];
  const result = await previewReferences(selections);
  return result.snapshot.references.map((reference) => ({
    sourceKind: reference.sourceKind,
    sourceId: reference.sourceId,
    usage: reference.usage,
    title: reference.title,
    excerpt: reference.excerpt,
    nature: reference.nature,
    authorship: reference.authorship,
    frozenReference: reference,
  }));
}

/** 本地推荐：只查本地资料库，不联网；展示可理解的原因。 */
export function RecommendationDialog({ open, onOpenChange, works, characters, theme, onAdd }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  works: string[];
  characters: string[];
  theme: string;
  onAdd: (items: AssistantSelection[]) => void;
}) {
  const [picked, setPicked] = useState<Record<string, KnowledgeRecommendation>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recommendations = useQuery({
    queryKey: ['knowledge-recommendations', works, characters, theme],
    queryFn: () => recommendKnowledge({ works, characters, theme, limit: 12 }),
    enabled: open,
    staleTime: 30_000,
  });

  const items = recommendations.data?.items ?? [];

  const add = async () => {
    setBusy(true); setError(null);
    try {
      const drafts = await resolveSelectionDrafts(
        Object.values(picked).map((item) => ({ sourceKind: 'note' as const, sourceId: item.noteId, usage: 'background' as const })),
      );
      if (!drafts.length) setError('这些资料暂时读取不到内容，可能已被删除。');
      else onAdd(drafts);
      onOpenChange(false);
      setPicked({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加入参考资料失败。');
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="推荐资料"
      description="按作品、角色与主题从资料库里挑出可参考的资料。只查本地，不会联网。"
      className="max-w-3xl"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button variant="primary" disabled={busy || !Object.keys(picked).length} onClick={() => void add()}>
            {busy ? '正在读取…' : '加入参考资料（' + Object.keys(picked).length + '）'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-3">
        {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
        {recommendations.isLoading && <Spinner size="sm" label="正在查找…" />}
        {recommendations.isError && <Alert variant="warning" title="查找失败">{recommendations.error instanceof Error ? recommendations.error.message : '请稍后重试'}</Alert>}
        {!recommendations.isLoading && !items.length && (
          <Alert variant="info" title="资料库中暂未找到">
            换一个主角或作品再试；也可以直接手动检索，或先写一篇资料并标成「可参考」。
          </Alert>
        )}
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
          {items.map((item) => {
            const selected = Boolean(picked[item.noteId]);
            return (
              <li key={item.noteId} className={'space-y-1.5 rounded-lg border p-3 ' + (selected ? 'border-accent bg-accent/5' : 'border-border-subtle')}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" aria-label={'选择 ' + item.title} checked={selected} onChange={() => setPicked((current) => {
                    const next = { ...current };
                    if (next[item.noteId]) delete next[item.noteId];
                    else next[item.noteId] = item;
                    return next;
                  })} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <strong className="truncate text-sm font-semibold text-ink">{item.title}</strong>
                      {item.work && <span className="text-xs text-muted">《{item.work}》</span>}
                      {item.usage === 'pending' && <Badge variant="warning" className="text-xs">待整理</Badge>}
                      {item.nature === 'personal' && <Badge variant="secondary" className="text-xs">个人设定</Badge>}
                    </div>
                    <p className="line-clamp-2 text-xs text-muted">{item.excerpt}</p>
                    <ul className="space-y-0.5 text-xs text-accent-dark">
                      {item.reasons.map((reason) => <li key={reason}>· {reason}</li>)}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}

/** 引用更新检查：只比较本地内容，不逐条联网；可选择用新内容或继续用旧内容。 */
export function ReferenceUpdateDialog({ open, onOpenChange, snapshot, onPinOld, onRefresh }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: PlanningKnowledgeSnapshot | null | undefined;
  /** 用户选择继续使用旧内容时，把旧摘要固定下来（excerptOverride）。 */
  onPinOld: (referenceId: string, excerpt: string) => void;
  onRefresh: (referenceId: string, currentSourceId?: string) => Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="检查资料更新"
      description="只比较本地内容，不会逐条联网。修改方案需要你明确重新生成，旧候选仍然保留原依据。"
      className="max-w-3xl"
      footer={<Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>}
    >
      {/* 面板只在打开时挂载：状态天然重置，不需要在 effect 里同步 setState。 */}
      {open && <ReferenceUpdateBody snapshot={snapshot ?? null} onPinOld={onPinOld} onRefresh={onRefresh} />}
    </Dialog>
  );
}

function ReferenceUpdateBody({ snapshot, onPinOld, onRefresh }: {
  snapshot: PlanningKnowledgeSnapshot | null;
  onPinOld: (referenceId: string, excerpt: string) => void;
  onRefresh: (referenceId: string, currentSourceId?: string) => Promise<void>;
}) {
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState<Record<string, boolean>>({});
  const check = useQuery({
    queryKey: ['knowledge-reference-check', snapshot?.capturedAt ?? 'none'],
    queryFn: () => checkReferences(snapshot!),
    enabled: Boolean(snapshot),
    staleTime: 10_000,
  });
  const statuses = check.data?.items ?? [];
  const updated = statuses.filter((item) => item.state === 'updated');
  const missing = statuses.filter((item) => item.state === 'missing');

  return (
    <div className="space-y-3 text-sm">
      {refreshError && <Alert variant="danger">{refreshError}</Alert>}
      {check.isLoading && <Spinner size="sm" label="正在比较内容…" />}
      {check.isError && <Alert variant="danger" title="检查失败">{check.error instanceof Error ? check.error.message : '请稍后重试'}</Alert>}
      {!snapshot && <Alert variant="info">本次还没有冻结的引用快照；生成过一次方案后才能比较更新。</Alert>}
      {snapshot && !check.isLoading && !check.isError && !updated.length && !missing.length && (
        <Alert variant="success" title="没有内容更新">所有引用内容与生成时一致（收藏星标之类的变化不算内容更新）。</Alert>
      )}
      {!!missing.length && (
        <Alert variant="warning" title="有来源已不可用">
          {missing.map((item) => item.title).join('、')} 已被删除或无法读取；历史快照仍然可读，可以继续用旧内容。
        </Alert>
      )}
      <ul className="space-y-2">
        {updated.map((item) => (
          <li key={item.id} className="space-y-2 rounded-lg border border-border-subtle p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <strong className="text-sm text-ink">{item.title}</strong>
              <Badge variant="warning" className="text-xs">内容有更新</Badge>
              {pinned[item.id] && <Badge variant="outline" className="text-xs">已选择继续用旧内容</Badge>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1 rounded border border-border-subtle p-2">
                <p className="text-xs font-medium text-ink">生成时使用的内容</p>
                <p className="line-clamp-4 text-xs text-muted">{item.previousExcerpt}</p>
              </div>
              <div className="space-y-1 rounded border border-border-subtle p-2">
                <p className="text-xs font-medium text-ink">现在的来源内容</p>
                <p className="line-clamp-4 text-xs text-muted">{item.currentExcerpt}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { onPinOld(item.id, item.previousExcerpt); setPinned((current) => ({ ...current, [item.id]: true })); }}>
                继续用旧内容
              </Button>
              <Button size="sm" variant="primary" disabled={refreshed[item.id]} onClick={() => { void onRefresh(item.id, item.currentSourceId).then(() => setRefreshed(current => ({ ...current, [item.id]: true }))).catch(error => setRefreshError(error instanceof Error ? error.message : '更新失败')); }}>
                {refreshed[item.id] ? '已选择新内容' : '使用新内容'}
              </Button>
              <span className="self-center text-xs text-muted">不操作时保留已选内容，更新后需重新生成。</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 补充搜集：先列出缺口问题，用户确认后按专题搜集，结果直接回填到参考资料。 */
export function GapCollectionDialog({ open, onOpenChange, sessionId, works, characters, theme, onAdd }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  works: string[];
  characters: string[];
  theme: string;
  onAdd: (items: AssistantSelection[]) => void;
}) {
  const client = useQueryClient();
  const [questions, setQuestions] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [findings, setFindings] = useState<RunFinding[] | null>(null);

  const gapsQuery = useQuery({
    queryKey: ['knowledge-gaps', sessionId, characters, works, theme],
    queryFn: async () => {
      const params = new URLSearchParams({ sessionId });
      if (theme.trim()) params.set('theme', theme.trim());
      const response = await fetch('/api/admin/knowledge/gaps?' + params.toString());
      if (!response.ok) throw new Error('读取缺口问题失败');
      return (await response.json()) as { items: KnowledgeGap[]; hasReferences: boolean };
    },
    enabled: open && Boolean(sessionId),
    staleTime: 30_000,
  });
  const sourcesQuery = useQuery({ queryKey: ['mcp-sources'], queryFn: fetchMcpSources, enabled: open, staleTime: 30_000 });

  const gaps = useMemo(() => gapsQuery.data?.items ?? [], [gapsQuery.data]);
  const usableSources = (sourcesQuery.data ?? []).filter((source) => source.status === 'enabled' && (source.discoveredTools?.length || source.allowedTools.length));

  const selectedQuestions = [
    ...gaps.filter((gap) => questions[gap.question]).map((gap) => gap.question),
    ...(custom.trim() ? [custom.trim()] : []),
  ];
  // 参考答案：用户可以在弹层里选择要用的资料源（不在这里录入密钥）。
  const [sourceChoice, setSourceChoice] = useState<string>('');
  const effectiveSource = sourceChoice || usableSources[0]?.id || '';

  const collect = async () => {
    setError(null); setNotice(null);
    if (!selectedQuestions.length) { setError('请先选择或填写要补查的问题。'); return; }
    const source = usableSources.find((item) => item.id === effectiveSource);
    if (!source) { setError('没有可用的资料源，请先到公共服务里配置并启用。'); return; }
    const tool = (source.discoveredTools?.[0]?.name) || source.allowedTools[0];
    if (!tool) { setError('该资料源还没有可用工具，请先测试连接。'); return; }
    setBusy(true);
    try {
      const collection = await createCollection({
        name: '企划补查：' + selectedQuestions[0].slice(0, 30),
        goal: selectedQuestions.join('；'),
        works,
        characters,
        // 补查是专题性质，不限制最近时间。
        mode: 'topic',
        sources: [{ sourceId: source.id, searchTool: tool }],
        frequency: 'once',
        enabled: false,
        sessionId,
      });
      const started = await runCollection(collection.id);
      setNotice('已开始补查，正在等待结果…');
      // 轮询执行结果，完成后把发现的内容列出来供用户选择。
      const runId = started.run.id;
      let result: { run: { status: string }; findings: RunFinding[] } | null = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const detail = await fetchCollectionRun(runId);
        if (!['queued', 'running'].includes(detail.run.status)) { result = detail; break; }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      void client.invalidateQueries({ queryKey: ['knowledge-pending'] });
      void client.invalidateQueries({ queryKey: ['knowledge-collections'] });
      if (!result) { setNotice('补查仍在后台运行，可以去「待整理」查看结果。'); return; }
      const pending = result.findings.filter((finding) => finding.state !== 'ignored');
      setFindings(pending);
      setNotice(pending.length
        ? '补查完成：下面是发现的内容，可以加入参考资料；它们同时也可以在「待整理」里整理成资料。'
        : '补查完成，这次没有发现可用的新内容。');
      if (!pending.length) setNotice('补查完成，这次没有发现可用的新内容。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '补查失败。');
    } finally { setBusy(false); }
  };

  const addFindings = async (selected: RunFinding[]) => {
    if (!selected.length) return;
    setBusy(true); setError(null);
    try {
      const drafts = await resolveSelectionDrafts(
        selected.map((finding) => ({ sourceKind: 'collection' as const, sourceId: finding.sourceVersionId, usage: 'background' as const })),
      );
      if (!drafts.length) setError('这些结果暂时读取不到内容。');
      else { onAdd(drafts); onOpenChange(false); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加入参考资料失败。');
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="补充搜集"
      description="先看本地资料够不够，再只补查缺口。补查结果会进入待整理，并回到这里的参考资料。"
      className="max-w-3xl"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>仅用已有资料生成（关闭）</Button>
          <Button variant="primary" disabled={busy || !selectedQuestions.length} onClick={() => void collect()}>
            {busy ? '正在补查…' : <><Search className="h-3.5 w-3.5" />搜集所选问题</>}
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 text-sm">
        {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}
        {gapsQuery.isLoading && <Spinner size="sm" label="正在分析缺口…" />}
        {gapsQuery.isError && <Alert variant="warning" title="无法分析缺口">{gapsQuery.error instanceof Error ? gapsQuery.error.message : '请稍后重试'}；你仍然可以自己填写问题。</Alert>}
        {gapsQuery.data && (
          <p className="text-xs text-muted">
            {gapsQuery.data.hasReferences
              ? '现有资料已在参考资料里列出；下面是本次范围内还没覆盖的方向。'
              : '本次还没有参考资料，下面是最常用的补查方向。'}
          </p>
        )}
        <ul className="space-y-1.5">
          {gaps.map((gap) => (
            <li key={gap.question}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" aria-label={gap.question} checked={Boolean(questions[gap.question])} onChange={(event) => setQuestions((current) => ({ ...current, [gap.question]: event.target.checked }))} />
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{gap.question}</span>
                  <span className="block text-xs text-muted">{gap.reason}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-ink">自行填写问题</span>
          <Textarea aria-label="自行填写问题" rows={2} value={custom} className="text-sm" placeholder="例如：往生堂的日常工作流程" onChange={(event) => setCustom(event.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-ink">使用资料源</span>
          {usableSources.length
            ? (
              <select aria-label="补查资料源" className="h-9 w-full rounded border border-border-control bg-surface-raised px-2 text-sm text-ink" value={effectiveSource} onChange={(event) => setSourceChoice(event.target.value)}>
                {usableSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
              </select>
            )
            : <p className="text-xs text-amber-700">没有可用资料源；补查功能需要先在公共服务里配置。</p>}
        </label>

        {findings && (
          <div className="space-y-2 border-t border-border-subtle pt-3">
            <p className="text-sm font-semibold text-ink">补查结果（{findings.length}）</p>
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {findings.map((finding) => (
                <li key={finding.sourceVersionId} className="space-y-1 rounded-lg border border-border-subtle p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="text-xs text-ink">{finding.title}</strong>
                    <Badge variant={finding.changeType === 'new' ? 'online' : 'warning'} className="text-xs">{finding.changeType === 'new' ? '新增' : '有变化'}</Badge>
                    {finding.truncated && <Badge variant="warning" className="text-xs">仅读取部分内容</Badge>}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted">{finding.excerpt}</p>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void addFindings(findings)}>
              {busy ? '正在加入…' : '把这次结果加入参考资料'}
            </Button>
            <p className="text-xs text-muted">未确认的来源会按社区资料对待；整理成资料后可以再调整参考状态。</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export { resolveSelectionDrafts };
