'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, ChevronDown, ChevronRight, Pencil, Play, Plus, RotateCcw, Square, Trash2,
} from 'lucide-react';
import type { KnowledgeCollection } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { Textarea } from '@/app/components/ui/textarea';
import { EmptyState } from '@/app/components/ui/empty-state';
import { formatTopicTime } from '@/app/features/topics/components/topic-card';
import { fetchMcpSources } from '@/app/features/mcp-sources/api';
import { browseCharacters } from '@/app/features/characters/api';
import { useNotes } from '@/app/features/notebook/queries';
import {
  cancelCollectionRun, createCollection, deleteCollection, fetchCollectionRun, fetchCollections,
  runCollection, setCollectionEnabled, updateCollection, type CollectionSaveInput, type RunFinding,
} from '../api';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const RUN_STATE_LABEL: Record<string, string> = {
  queued: '排队中', running: '执行中', succeeded: '完成', partial: '部分完成',
  failed: '失败', cancelled: '已取消', interrupted: '已中断',
};

interface DraftFields {
  id?: string;
  name: string;
  goal: string;
  works: string[];
  characters: string[];
  mode: 'topic' | 'recent';
  windowDays: number;
  sourceBindings: Array<{ sourceId: string; searchTool: string; readTool?: string }>;
  targetNoteIds: string[];
  frequency: 'once' | 'daily' | 'weekly';
  dailyTime: string;
  weekday: number;
}

const EMPTY_DRAFT: DraftFields = {
  name: '', goal: '', works: [], characters: [], mode: 'topic', windowDays: 7,
  sourceBindings: [], targetNoteIds: [], frequency: 'once', dailyTime: '09:00', weekday: 1,
};

function draftFrom(collection: KnowledgeCollection): DraftFields {
  return {
    id: collection.id,
    name: collection.name,
    goal: collection.goal,
    works: collection.works,
    characters: collection.characters,
    mode: collection.mode,
    windowDays: collection.windowDays || 7,
    sourceBindings: collection.sources,
    targetNoteIds: collection.targetNoteIds,
    frequency: collection.frequency,
    dailyTime: collection.dailyTime,
    weekday: collection.weekday ?? 1,
  };
}

/**
 * 搜集任务：任务定义与执行记录分开呈现。
 * 「保存任务」不会联网；只有「立即执行」或到点调度才会真正访问资料源。
 */
export function CollectionManager({ onOpenPending }: { onOpenPending?: () => void }) {
  const client = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runDetailId, setRunDetailId] = useState<string | null>(null);

  const collectionsQuery = useQuery({ queryKey: ['knowledge-collections'], queryFn: fetchCollections, staleTime: 10_000 });
  const sourcesQuery = useQuery({ queryKey: ['mcp-sources'], queryFn: fetchMcpSources, staleTime: 30_000 });
  const worksQuery = useQuery({
    queryKey: ['characters', 'works-facets'],
    queryFn: () => browseCharacters({ page: 1, pageSize: 1 }),
    staleTime: 60_000,
  });
  const notesQuery = useNotes({ pageSize: 100 });
  // 有执行在跑时轮询，页面能自己更新状态。
  const activeRuns = (collectionsQuery.data?.runs ?? []).filter((run) => run.status === 'queued' || run.status === 'running');
  useQuery({
    queryKey: ['knowledge-collections', 'poll', activeRuns.map((run) => run.id).join(',')],
    queryFn: async () => { await collectionsQuery.refetch(); return null; },
    enabled: activeRuns.length > 0,
    refetchInterval: 2_500,
  });

  const collections = collectionsQuery.data?.items ?? [];
  const runs = collectionsQuery.data?.runs ?? [];
  const enabledSources = (sourcesQuery.data ?? []).filter((source) => source.status === 'enabled');
  const workOptions = (worksQuery.data?.facets.works ?? []).map((work) => work.name);
  const noteOptions = (notesQuery.data?.items ?? []).filter((note) => note.id);

  const openNew = () => { setDraft(EMPTY_DRAFT); setError(null); setEditorOpen(true); };
  const openEdit = (collection: KnowledgeCollection) => { setDraft(draftFrom(collection)); setError(null); setEditorOpen(true); };

  const save = async (runAfterSave: boolean) => {
    setError(null); setNotice(null);
    if (!draft.goal.trim() && !draft.name.trim()) { setError('请填写任务名称或搜集目标。'); return; }
    setBusy(true);
    try {
      const payload: CollectionSaveInput = {
        // 名称可自动从目标推导，用户仍可修改。
        name: draft.name.trim() || draft.goal.trim().slice(0, 40) || '资料搜集任务',
        goal: draft.goal.trim(),
        works: draft.works,
        characters: draft.characters,
        mode: draft.mode,
        ...(draft.mode === 'recent' ? { windowDays: draft.windowDays } : {}),
        sources: draft.sourceBindings.filter((binding) => binding.sourceId && binding.searchTool),
        targetNoteIds: draft.targetNoteIds,
        frequency: draft.frequency,
        dailyTime: draft.dailyTime,
        ...(draft.frequency === 'weekly' ? { weekday: draft.weekday } : {}),
      };
      const saved = draft.id ? await updateCollection(draft.id, payload) : await createCollection(payload);
      setEditorOpen(false);
      void client.invalidateQueries({ queryKey: ['knowledge-collections'] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
      if (saved.pausedReason) setNotice('任务已保存，但' + saved.pausedReason);
      else if (!runAfterSave) setNotice('任务已保存' + (saved.nextRunAt ? '；下次执行：' + formatTopicTime(saved.nextRunAt) : '；一次性任务不会自动安排下一次') + '。');
      if (runAfterSave) {
        if (!saved.sources.length) { setError('该任务还没有资料源，无法立即执行。'); return; }
        const started = await runCollection(saved.id);
        setNotice(started.reused ? '已有一次执行正在进行，已显示该执行的进度。' : '已开始执行，页面会自动更新进度。');
        void client.invalidateQueries({ queryKey: ['knowledge-collections'] });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存任务失败。');
    } finally { setBusy(false); }
  };

  const execute = async (collection: KnowledgeCollection, retryRunId?: string) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      const started = await runCollection(collection.id, retryRunId ? { retryRunId } : {});
      setNotice(started.reused
        ? '已有一次执行正在进行，已显示该执行的进度。'
        : retryRunId ? '已用上次保存的来源重试整理，不会重新搜索资料源。' : '已开始执行，页面会自动更新进度。');
      setExpandedId(collection.id);
      void client.invalidateQueries({ queryKey: ['knowledge-collections'] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '启动执行失败。');
    } finally { setBusy(false); }
  };

  const toggleEnabled = async (collection: KnowledgeCollection) => {
    setError(null);
    try {
      await setCollectionEnabled(collection.id, !collection.enabled);
      void client.invalidateQueries({ queryKey: ['knowledge-collections'] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '切换状态失败。');
    }
  };

  const remove = async (collection: KnowledgeCollection) => {
    if (!window.confirm('删除任务“' + collection.name + '”？已保存的资料和来源会保留，只移除任务与执行记录。')) return;
    setError(null);
    try {
      await deleteCollection(collection.id);
      setNotice('任务已删除；已保存的资料与来源仍然保留。');
      void client.invalidateQueries({ queryKey: ['knowledge-collections'] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除任务失败。');
    }
  };

  const runsOf = (collectionId: string) => runs.filter((run) => run.collectionId === collectionId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">搜集任务（{collections.length}）</h2>
          <p className="text-sm text-muted">任务定义与执行记录分开；「保存任务」不会联网，只有执行或到点调度才访问资料源。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenPending && <Button size="sm" variant="outline" onClick={onOpenPending}>查看待整理</Button>}
          <Button size="sm" variant="primary" onClick={openNew}><Plus className="h-3.5 w-3.5" />新建任务</Button>
        </div>
      </div>

      {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
      {notice && <Alert variant="info">{notice}</Alert>}
      {/* 批量导入入口：复用现有叙事档案的规范化 JSON 导入流程，不在资料库里另做一套导入。 */}
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-dashed border-border-default bg-surface px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">从叙事档案批量导入</p>
          <p className="text-xs text-muted">导入规范化 JSON 后，原文会进入本地检索；可以挑选片段整理成资料。重复导入同一份数据不会重复建资料。</p>
        </div>
        <Link href="/apps/narrative" className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-hover">打开叙事档案</Link>
      </section>

      {collectionsQuery.isError && <Alert variant="warning" title="任务加载失败">{collectionsQuery.error instanceof Error ? collectionsQuery.error.message : '请稍后重试'}</Alert>}
      {collectionsQuery.isLoading && <Spinner size="sm" label="正在加载任务…" />}

      {!collectionsQuery.isLoading && !collections.length && (
        <EmptyState
          icon={CalendarClock}
          title="还没有搜集任务"
          description="建立一个任务，按专题或近期范围去已配置的资料源里搜集，结果会进入「待整理」。"
          actions={<Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5" />新建任务</Button>}
        />
      )}

      <ul className="space-y-2">
        {collections.map((collection) => {
          const collectionRuns = runsOf(collection.id);
          const latest = collectionRuns[0];
          const expanded = expandedId === collection.id;
          return (
            <li key={collection.id} className="space-y-2 rounded-[var(--radius-panel)] border border-border-default bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="text-sm font-semibold text-ink">{collection.name}</strong>
                    <Badge variant={collection.enabled ? 'online' : 'stopped'} className="text-xs">{collection.enabled ? '已启用' : '已暂停'}</Badge>
                    <Badge variant="outline" className="text-xs">{collection.mode === 'recent' ? '近期（' + collection.windowDays + ' 天）' : '专题（不限时间）'}</Badge>
                    <Badge variant="secondary" className="text-xs">
                      {collection.frequency === 'once' ? '一次' : collection.frequency === 'daily' ? '每天 ' + collection.dailyTime : '每周' + WEEKDAYS[collection.weekday ?? 1] + ' ' + collection.dailyTime}
                    </Badge>
                  </div>
                  {collection.goal && <p className="text-sm text-muted">目标：{collection.goal}</p>}
                  <p className="text-xs text-muted">
                    资料源 {collection.sources.length} 个
                    {collection.works.length ? ' · 作品：' + collection.works.join('、') : ''}
                    {collection.characters.length ? ' · 角色：' + collection.characters.join('、') : ''}
                  </p>
                  <p className="text-xs text-muted">
                    下次执行：{collection.nextRunAt ? formatTopicTime(collection.nextRunAt) : collection.frequency === 'once' ? '一次性任务不自动执行' : '未安排'}
                    {latest ? ' · 最近一次：' + (RUN_STATE_LABEL[latest.status] ?? latest.status) + '（新增 ' + latest.newCount + '，有变化 ' + latest.changedCount + '，重复 ' + latest.duplicateCount + '）' : ' · 还没有执行记录'}
                  </p>
                  {collection.pausedReason && <p className="text-xs text-amber-700">{collection.pausedReason}</p>}
                  {latest?.errorMessage && <p className="text-xs text-amber-700">上次提示：{latest.errorMessage}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy || !collection.sources.length} onClick={() => void execute(collection)}><Play className="h-3.5 w-3.5" />立即执行</Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleEnabled(collection)}>{collection.enabled ? <><Square className="h-3.5 w-3.5" />暂停</> : <><Play className="h-3.5 w-3.5" />恢复</>}</Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(collection)}><Pencil className="h-3.5 w-3.5" />编辑</Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(collection)}><Trash2 className="h-3.5 w-3.5" />删除</Button>
                </div>
              </div>

              <button type="button" className="flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => setExpandedId(expanded ? null : collection.id)}>
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                执行记录（{collectionRuns.length}）
              </button>
              {expanded && (
                <ul className="space-y-1.5 border-t border-border-subtle pt-2">
                  {!collectionRuns.length && <li className="text-xs text-muted">还没有执行记录。</li>}
                  {collectionRuns.map((run) => (
                    <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle px-2 py-1.5 text-xs">
                      <span className="text-muted">
                        {formatTopicTime(run.createdAt)} · {RUN_STATE_LABEL[run.status] ?? run.status}
                        {run.progressLabel ? ' · ' + run.progressLabel : ''}
                        {' · 新增 ' + run.newCount + '/变化 ' + run.changedCount + '/重复 ' + run.duplicateCount}
                      </span>
                      <span className="flex flex-wrap gap-2">
                        <button type="button" className="text-accent hover:underline" onClick={() => setRunDetailId(run.id)}>查看结果</button>
                        {(run.status === 'queued' || run.status === 'running') && (
                          <button type="button" className="text-amber-700 hover:underline" onClick={() => void cancelRun(run.id)}>取消</button>
                        )}
                        {(run.status === 'failed' || run.status === 'partial' || run.status === 'interrupted') && (
                          <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => void execute(collection, run.id)}>
                            <RotateCcw className="h-3 w-3" />重试整理
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={draft.id ? '编辑搜集任务' : '新建搜集任务'}
        description="任务只负责搜集与保存来源；不会覆盖关联资料的正文。"
        className="max-w-2xl"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setEditorOpen(false)}>取消</Button>
            <Button variant="outline" disabled={busy} onClick={() => void save(false)}>保存任务</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save(true)}>{busy ? '处理中…' : '保存并立即搜集'}</Button>
          </div>
        )}
      >
        <CollectionForm
          draft={draft}
          onChange={setDraft}
          sources={enabledSources}
          workOptions={workOptions}
          noteOptions={noteOptions.map((note) => ({ id: String(note.id), title: note.title || '未命名资料' }))}
        />
      </Dialog>

      <Dialog
        open={Boolean(runDetailId)}
        onOpenChange={(open) => { if (!open) setRunDetailId(null); }}
        title="执行结果"
        description="这次执行实际发现的内容；重复发现也表示出来，方便判断是否需要重新整理。"
        className="max-w-3xl"
        footer={<Button variant="outline" onClick={() => setRunDetailId(null)}>关闭</Button>}
      >
        {runDetailId && <RunDetail runId={runDetailId} onRetry={async (collectionId) => {
          const collection = collections.find((item) => item.id === collectionId);
          if (collection) await execute(collection, runDetailId);
        }} />}
      </Dialog>
    </div>
  );

  async function cancelRun(runId: string) {
    setError(null);
    try {
      await cancelCollectionRun(runId);
      void client.invalidateQueries({ queryKey: ['knowledge-collections'] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '取消失败。');
    }
  }
}

/** 任务表单：资料源与工具只从已配置的 MCP 中选择，不在这里重复录入密钥。 */
function CollectionForm({ draft, onChange, sources, workOptions, noteOptions }: {
  draft: DraftFields;
  onChange: (next: DraftFields) => void;
  sources: Array<{ id: string; name: string; purpose: string; url: string; discoveredTools?: Array<{ name: string }> }>;
  workOptions: string[];
  noteOptions: Array<{ id: string; title: string }>;
}) {
  const patch = (changes: Partial<DraftFields>) => onChange({ ...draft, ...changes });
  const toolsFor = (sourceId: string) => sources.find((source) => source.id === sourceId)?.discoveredTools ?? [];
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">任务名称</span>
        <Input aria-label="任务名称" value={draft.name} placeholder="留空会按搜集目标自动命名" className="h-9 text-sm" onChange={(event) => patch({ name: event.target.value })} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">搜集目标</span>
        <Textarea aria-label="搜集目标" rows={2} value={draft.goal} placeholder="例如：整理钟离与胡桃的人物关系、往生堂相关设定" className="text-sm" onChange={(event) => patch({ goal: event.target.value })} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-semibold text-ink">模式</span>
          <Select aria-label="搜集模式" value={draft.mode} className="h-9 text-sm" onChange={(event) => patch({ mode: event.target.value as 'topic' | 'recent' })}>
            <option value="topic">专题资料（不限时间）</option>
            <option value="recent">近期动态</option>
          </Select>
        </label>
        {draft.mode === 'recent' && (
          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-ink">时间范围</span>
            <Select aria-label="时间范围" value={String(draft.windowDays)} className="h-9 text-sm" onChange={(event) => patch({ windowDays: Number(event.target.value) })}>
              {[7, 14, 30, 90].map((days) => <option key={days} value={days}>最近 {days} 天</option>)}
            </Select>
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-semibold text-ink">关注作品（可选）</span>
        {workOptions.length ? (
          <div className="flex flex-wrap gap-1.5">
            {workOptions.map((work) => {
              const selected = draft.works.includes(work);
              return (
                <button key={work} type="button" aria-pressed={selected} className={'rounded-full border px-2 py-0.5 text-xs ' + (selected ? 'border-accent bg-accent/10 text-accent-dark' : 'border-border-default text-muted')} onClick={() => patch({ works: selected ? draft.works.filter((item) => item !== work) : [...draft.works, work] })}>
                  {work}
                </button>
              );
            })}
          </div>
        ) : <p className="text-xs text-muted">角色库里还没有作品记录，可以先跳过。</p>}
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">关注角色（可选，逗号分隔）</span>
        <Input aria-label="关注角色" value={draft.characters.join('、')} placeholder="例如：钟离、胡桃" className="h-9 text-sm" onChange={(event) => patch({ characters: event.target.value.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 20) })} />
      </label>

      <div className="space-y-2">
        <span className="text-sm font-semibold text-ink">资料源</span>
        <p className="text-xs text-muted">只列出已启用且可用的资料源；密钥在公共服务里配置，这里不重复录入。</p>
        {!sources.length && <p className="text-xs text-amber-700">还没有启用的 MCP 资料源；现在保存会得到一个暂停任务。</p>}
        <ul className="space-y-2">
          {sources.map((source) => {
            const binding = draft.sourceBindings.find((item) => item.sourceId === source.id);
            const tools = toolsFor(source.id);
            return (
              <li key={source.id} className="space-y-2 rounded-lg border border-border-subtle p-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    aria-label={'使用资料源 ' + source.name}
                    checked={Boolean(binding)}
                    onChange={(event) => patch({
                      sourceBindings: event.target.checked
                        ? [...draft.sourceBindings, { sourceId: source.id, searchTool: tools[0]?.name ?? '' }]
                        : draft.sourceBindings.filter((item) => item.sourceId !== source.id),
                    })}
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
                      <Select aria-label={source.name + ' 检索工具'} value={binding.searchTool} className="h-8 text-sm" onChange={(event) => patch({ sourceBindings: draft.sourceBindings.map((item) => item.sourceId === source.id ? { ...item, searchTool: event.target.value } : item) })}>
                        <option value="">请选择</option>
                        {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
                      </Select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted">读取工具（可选）</span>
                      <Select aria-label={source.name + ' 读取工具'} value={binding.readTool ?? ''} className="h-8 text-sm" onChange={(event) => patch({ sourceBindings: draft.sourceBindings.map((item) => item.sourceId === source.id ? { ...item, readTool: event.target.value || undefined } : item) })}>
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

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-sm font-semibold text-ink">频率</span>
          <Select aria-label="执行频率" value={draft.frequency} className="h-9 text-sm" onChange={(event) => patch({ frequency: event.target.value as DraftFields['frequency'] })}>
            <option value="once">一次</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </Select>
        </label>
        {draft.frequency !== 'once' && (
          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-ink">执行时刻</span>
            <Input aria-label="执行时刻" type="time" value={draft.dailyTime} className="h-9 text-sm" onChange={(event) => patch({ dailyTime: event.target.value })} />
          </label>
        )}
        {draft.frequency === 'weekly' && (
          <label className="space-y-1.5">
            <span className="text-sm font-semibold text-ink">星期</span>
            <Select aria-label="执行星期" value={String(draft.weekday)} className="h-9 text-sm" onChange={(event) => patch({ weekday: Number(event.target.value) })}>
              {WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}
            </Select>
          </label>
        )}
      </div>
      <p className="text-xs text-muted">
        {draft.frequency === 'once'
          ? '一次性任务只在点击执行时运行，不安排下一次。'
          : '按当地时间计算；浏览器关闭不影响执行，但后端停止时不会运行，恢复后每个任务最多补跑一次。'}
      </p>

      <div className="space-y-1.5">
        <span className="text-sm font-semibold text-ink">关联资料（可选）</span>
        <p className="text-xs text-muted">只把结果关联到这些资料，方便回看；不会自动改写它们的正文。</p>
        <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border-subtle p-2">
          {!noteOptions.length && <p className="text-xs text-muted">还没有可关联的资料。</p>}
          {noteOptions.slice(0, 40).map((note) => (
            <label key={note.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={'关联资料 ' + note.title}
                checked={draft.targetNoteIds.includes(note.id)}
                onChange={(event) => patch({ targetNoteIds: event.target.checked ? [...draft.targetNoteIds, note.id] : draft.targetNoteIds.filter((id) => id !== note.id) })}
              />
              <span className="truncate">{note.title}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 执行详情：列出本次发现（含重复），并允许对失败/部分完成重试整理。 */
function RunDetail({ runId, onRetry }: { runId: string; onRetry: (collectionId: string) => Promise<void> }) {
  const detail = useQuery({ queryKey: ['knowledge-run', runId], queryFn: () => fetchCollectionRun(runId), staleTime: 5_000 });
  const [busy, setBusy] = useState(false);
  const run = detail.data?.run;
  const findings: RunFinding[] = detail.data?.findings ?? [];
  const retryable = run && ['failed', 'partial', 'interrupted'].includes(run.status) && findings.length > 0;

  return (
    <div className="space-y-3 text-sm">
      {detail.isLoading && <Spinner size="sm" label="正在读取执行结果…" />}
      {detail.isError && <Alert variant="warning" title="读取失败">{detail.error instanceof Error ? detail.error.message : '请稍后重试'}</Alert>}
      {run && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={run.status === 'succeeded' ? 'online' : run.status === 'partial' ? 'warning' : run.status === 'failed' ? 'error' : 'outline'} className="text-xs">{RUN_STATE_LABEL[run.status] ?? run.status}</Badge>
            <span className="text-xs text-muted">{formatTopicTime(run.createdAt)} · {run.trigger === 'scheduled' ? '定时执行' : run.trigger === 'retry' ? '重试整理' : '手动执行'}</span>
            {run.progressLabel && <span className="text-xs text-muted">· {run.progressLabel}</span>}
          </div>
          <p className="text-xs text-muted">新增 {run.newCount} · 有变化 {run.changedCount} · 重复 {run.duplicateCount} · 工具调用 {run.usedToolCalls}/{run.budgetToolCalls}</p>
          {run.errorMessage && <Alert variant="warning" title="执行提示">{run.errorMessage}</Alert>}
          {retryable && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setBusy(true); void onRetry(run.collectionId).finally(() => setBusy(false)); }}>
              <RotateCcw className="h-3.5 w-3.5" />用已保存的来源重试整理
            </Button>
          )}
          <ul className="space-y-2">
            {!findings.length && <li className="text-sm text-muted">这次执行没有发现可用的新内容。</li>}
            {findings.map((finding) => (
              <li key={finding.sourceVersionId} className="space-y-1 rounded-lg border border-border-subtle p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <strong className="text-sm text-ink">{finding.title}</strong>
                  <Badge variant={finding.changeType === 'new' ? 'online' : finding.changeType === 'changed' ? 'warning' : 'stopped'} className="text-xs">
                    {finding.changeType === 'new' ? '新增' : finding.changeType === 'changed' ? '有变化' : '重复发现'}
                  </Badge>
                  {finding.state === 'ignored' && <Badge variant="stopped" className="text-xs">已忽略</Badge>}
                  {finding.state === 'organized' && <Badge variant="accent" className="text-xs">已整理</Badge>}
                  {finding.truncated && <Badge variant="warning" className="text-xs">仅读取部分内容</Badge>}
                </div>
                <p className="text-xs text-muted">{finding.sourceName} · 发布时间：{finding.publishedAt ? formatTopicTime(finding.publishedAt) : '未知'} · 获取于 {formatTopicTime(finding.retrievedAt)}</p>
                <p className="line-clamp-3 text-xs text-muted">{finding.excerpt}</p>
                {finding.url && <a href={finding.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">打开来源</a>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
