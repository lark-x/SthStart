'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, FileClock, FolderOpen, Plus, Search, Settings2, ShieldCheck, MoreHorizontal } from 'lucide-react';
import type { StoryCharacter, StoryDocument, StoryEntry } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { Input } from '@/app/components/ui/input';
import { storyApi } from './api';
import { StoryEntryEditor } from './story-entry-editor';
import { StoryReviewPanel } from './story-review-panel';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';

type EntryRow = { kind: 'document'; item: StoryDocument } | { kind: 'character'; item: StoryCharacter };
type NewKind = StoryDocument['kind'] | 'character';
type ReviewTab = 'proposals' | 'revisions' | 'dsh' | 'archive';
const groupLabel: Record<NewKind, string> = { outline: '大纲', world: '世界观', scene: '场景', chapter: '章节', character: '角色' };
const documentOf = (entry: StoryEntry): entry is StoryDocument => !('name' in entry);

export function StoryWorkspace({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const project = useQuery({ queryKey: ['story', projectId, 'project'], queryFn: () => storyApi.getProject(projectId) });
  const documents = useQuery({ queryKey: ['story', projectId, 'documents'], queryFn: () => storyApi.listDocuments(projectId) });
  const characters = useQuery({ queryKey: ['story', projectId, 'characters'], queryFn: () => storyApi.listCharacters(projectId) });
  const proposals = useQuery({ queryKey: ['story', projectId, 'proposals'], queryFn: () => storyApi.listProposals(projectId), refetchInterval: 20_000 });
  const bridge = useQuery({ queryKey: ['story', projectId, 'bridge-status'], queryFn: () => storyApi.bridgeStatus(projectId), refetchInterval: 20_000 });
  const [selected, setSelected] = useState<{ kind: 'document' | 'character'; id: string } | null>(null);
  const [search, setSearch] = useState('');
  const [newKind, setNewKind] = useState<NewKind | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [createError, setCreateError] = useState('');
  const [notice, setNotice] = useState('');
  const [treeOpen, setTreeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTab>('proposals');
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectToolsOpen, setProjectToolsOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectSummary, setProjectSummary] = useState('');
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  const entries = useMemo<EntryRow[]>(() => [
    ...(documents.data?.items ?? []).map((item) => ({ kind: 'document' as const, item })),
    ...(characters.data?.items ?? []).map((item) => ({ kind: 'character' as const, item })),
  ], [documents.data, characters.data]);
  const activeEntry = entries.find((entry) => entry.kind === selected?.kind && entry.item.id === selected.id)?.item
    ?? entries[0]?.item ?? null;
  const activeId = activeEntry?.id;
  const activeKind = activeEntry ? documentOf(activeEntry) ? 'document' : 'character' : null;
  const pendingProposalCount = proposals.data?.items.filter((item) => item.status === 'pending').length ?? 0;
  const searchResults = useQuery({ queryKey: ['story', projectId, 'search', search.trim()],
    queryFn: () => storyApi.searchEntries(projectId, search.trim()), enabled: search.trim().length >= 2 });

  const flushCurrent = useCallback(() => flushRef.current(), []);
  const registerFlush = useCallback((flush: () => Promise<boolean>) => { flushRef.current = flush; }, []);
  const refreshEntry = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['story', projectId, 'documents'] }),
      client.invalidateQueries({ queryKey: ['story', projectId, 'characters'] }),
      client.invalidateQueries({ queryKey: ['story', projectId, 'project'] }),
    ]);
  }, [client, projectId]);
  const onSaved = useCallback((entry: StoryEntry) => {
    if (documentOf(entry)) {
      client.setQueryData<{ items: StoryDocument[] }>(['story', projectId, 'documents'], (old) => old && ({ items: old.items.map((item) => item.id === entry.id ? entry : item) }));
    } else {
      client.setQueryData<{ items: StoryCharacter[] }>(['story', projectId, 'characters'], (old) => old && ({ items: old.items.map((item) => item.id === entry.id ? entry : item) }));
    }
    void client.invalidateQueries({ queryKey: ['story', projectId, 'proposals'] });
  }, [client, projectId]);
  const onConflict = useCallback(() => { void refreshEntry(); }, [refreshEntry]);

  const chooseEntry = async (row: EntryRow) => {
    if (row.item.id === activeId) { setTreeOpen(false); return; }
    if (!await flushCurrent()) { setNotice('当前文本尚未保存成功。处理保存状态后再切换条目。'); return; }
    setSelected({ kind: row.kind, id: row.item.id });
    setNotice('');
    setTreeOpen(false);
  };

  const createEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newKind || !newTitle.trim()) return;
    if (!await flushCurrent()) { setCreateError('请先解决当前条目的保存状态。'); return; }
    setCreateError('');
    try {
      let created: StoryDocument | StoryCharacter;
      if (newKind === 'character') created = await storyApi.createCharacter(projectId, { name: newTitle.trim(), notes: newBody });
      else created = await storyApi.createDocument(projectId, { kind: newKind, title: newTitle.trim(), body: newBody });
      await refreshEntry();
      setSelected({ kind: newKind === 'character' ? 'character' : 'document', id: created.id });
      setNewKind(null); setNewTitle(''); setNewBody('');
      setTreeOpen(false);
      setNotice(`${groupLabel[newKind]}已创建。`);
    } catch (cause) { setCreateError(cause instanceof Error ? cause.message : '创建失败。'); }
  };

  const reorderChapter = async (chapterId: string, direction: -1 | 1) => {
    if (!project.data || !await flushCurrent()) return;
    const chapters = (documents.data?.items ?? []).filter((item) => item.kind === 'chapter').sort((a, b) => a.position - b.position);
    const index = chapters.findIndex((chapter) => chapter.id === chapterId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= chapters.length) return;
    const ids = chapters.map((chapter) => chapter.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    try {
      const updated = await storyApi.reorderChapters(projectId, project.data.revision, ids);
      client.setQueryData(['story', projectId, 'project'], updated);
      await client.invalidateQueries({ queryKey: ['story', projectId, 'documents'] });
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '章节顺序更新失败。'); }
  };

  const openReview = (tab: ReviewTab) => { setReviewTab(tab); setReviewOpen(true); };
  const openCreate = (kind: NewKind) => { setNewKind(kind); setNewTitle(''); setNewBody(''); setCreateError(''); };
  const saveProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project.data) return;
    try {
      const updated = await storyApi.updateProject(projectId, project.data.revision, { title: projectTitle.trim(), summary: projectSummary });
      client.setQueryData(['story', projectId, 'project'], updated);
      setProjectSettingsOpen(false); setNotice('项目资料已保存。');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '项目保存失败。'); }
  };

  if (project.isLoading) return <div className="p-8 text-muted">正在打开剧情项目…</div>;
  if (!project.data) return <div className="p-8 text-red-700">无法打开剧情项目：{project.error?.message}</div>;
  const groups: Array<{ kind: NewKind; rows: EntryRow[] }> = [
    { kind: 'outline', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'outline') },
    { kind: 'world', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'world') },
    { kind: 'scene', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'scene') },
    { kind: 'character', rows: entries.filter((entry) => entry.kind === 'character') },
    { kind: 'chapter', rows: entries.filter((entry): entry is Extract<EntryRow, { kind: 'document' }> => entry.kind === 'document' && entry.item.kind === 'chapter').sort((a, b) => a.item.position - b.item.position) },
  ];
  const filtered = (row: EntryRow) => !search.trim() || `${'name' in row.item ? row.item.name : row.item.title}\n${'notes' in row.item ? row.item.notes : row.item.body}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const treePanel = <div className="story-tree-panel flex h-full min-h-0 flex-col">
    <div className="story-tree-header shrink-0 p-3"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" /><Input aria-label="搜索正式资料" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" placeholder="搜索标题与正文…" /></div>
      <p className="mt-2 text-xs text-muted">项目资料 · {entries.length} 项</p></div>
    <nav aria-label="正式剧情资料树" className="min-h-0 flex-1 overflow-y-auto p-3" data-autohide-scroll>
      {search.trim().length >= 2 && <section className="mb-4 border-b border-border-default pb-3"><h2 className="mb-2 text-xs font-semibold text-muted">搜索结果</h2>
        {searchResults.isLoading && <p className="text-xs text-muted">搜索中…</p>}
        {searchResults.data?.items.map((result) => {
          const row = entries.find((entry) => entry.item.id === result.id);
          return <button key={`${result.kind}-${result.id}`} type="button" onClick={() => row && void chooseEntry(row)} className="mb-1 block w-full rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-surface-hover">
            <span className="block truncate text-sm font-medium">{result.title}</span><span className="line-clamp-2 text-xs text-muted">{groupLabel[result.kind]} · {result.excerpt}</span>
          </button>;
        })}
        {searchResults.data?.items.length === 0 && <p className="text-xs text-muted">没有匹配内容。</p>}
      </section>}
      {groups.map(({ kind, rows }) => {
        const visible = rows.filter(filtered);
        return <section key={kind} className="mb-4">
          <div className="mb-1 flex items-center justify-between"><h2 className="text-xs font-semibold tracking-wide text-muted">{groupLabel[kind]} <span className="font-normal">{rows.length}</span></h2>
            {(kind !== 'outline' || rows.length === 0) && <button type="button" aria-label={`新增${groupLabel[kind]}`} title={`新增${groupLabel[kind]}`} onClick={() => { openCreate(kind); setTreeOpen(false); }} className="rounded p-1 text-muted hover:bg-surface-hover hover:text-accent"><Plus className="size-4" /></button>}
          </div>
          {visible.map((row) => {
            const active = activeId === row.item.id;
            return <div key={row.item.id} className={`group mb-1 flex min-w-0 items-center rounded-[var(--radius-control)] ${active ? 'bg-accent/10 text-accent' : 'hover:bg-surface-hover'}`}>
              <button type="button" onClick={() => void chooseEntry(row)} aria-current={active ? 'true' : undefined} className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm font-medium">
                <span className="block truncate">{'name' in row.item ? row.item.name : row.item.title}</span>
                {row.kind === 'document' && row.item.kind === 'chapter' && <span className="block text-[11px] font-normal text-muted">第 {row.item.position + 1} 章 · v{row.item.revision}</span>}
              </button>
              {kind === 'chapter' && <span className="mr-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"><button disabled={visible[0]?.item.id === row.item.id} title="上移章节" onClick={() => void reorderChapter(row.item.id, -1)} className="rounded p-1 disabled:opacity-30"><ArrowUp className="size-3.5" /></button><button disabled={visible.at(-1)?.item.id === row.item.id} title="下移章节" onClick={() => void reorderChapter(row.item.id, 1)} className="rounded p-1 disabled:opacity-30"><ArrowDown className="size-3.5" /></button></span>}
            </div>;
          })}
          {rows.length === 0 && kind === 'outline' && <button className="rounded px-2.5 py-2 text-left text-sm text-muted hover:bg-surface-hover" onClick={() => { openCreate('outline'); setTreeOpen(false); }}>创建项目大纲…</button>}
          {rows.length > 0 && visible.length === 0 && search && <p className="px-2 py-1 text-xs text-muted">无匹配条目</p>}
        </section>;
      })}
    </nav>
    <div className="story-tree-footer shrink-0 p-3 text-xs text-muted">DSH 只读取正式资料并提交提案；不会直接改写此处内容。</div>
  </div>;

  return <main className="story-workspace-root flex h-full min-h-0 min-w-0 flex-col bg-paper text-ink">
    <header className="story-workspace-header flex shrink-0 flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3"><Link href="/apps/story" aria-label="返回剧情项目列表" className="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-ink"><ArrowLeft className="size-4" /></Link>
        <BookOpen className="size-5 shrink-0 text-accent" /><div className="min-w-0"><h1 className="truncate font-semibold">{project.data.title}</h1><p className="truncate text-xs text-muted">正式资料由 SthStart 保存 · AI 建议必须人工审阅</p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setTreeOpen(true)}><FolderOpen className="size-4" />资料</Button>
        <span className={`hidden rounded-full px-2 py-1 text-xs sm:inline-flex ${bridge.data?.running ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-muted text-muted'}`}>{bridge.data?.running ? 'DSH 在线' : bridge.data?.paired ? 'DSH 已配对' : 'DSH 未配对'}</span>
        <Button size="sm" variant="outline" onClick={() => openReview('dsh')}><ShieldCheck className="size-4" /> DSH 配对</Button>
        <Button size="sm" variant={pendingProposalCount ? 'accent' : 'outline'} onClick={() => openReview('proposals')}>
          <Check className="size-4" />提案审阅{pendingProposalCount > 0 ? ` · ${pendingProposalCount}` : ''}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setProjectToolsOpen(true)}><MoreHorizontal className="size-4" />更多</Button>
      </div>
    </header>
    {notice && <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default bg-surface-muted px-4 py-2 text-sm"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}

    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside aria-label="正式剧情资料树" className="story-tree-aside hidden min-h-0 min-w-0 bg-surface lg:block">{treePanel}</aside>

      <section aria-label="正式写作工作台" className="min-h-0 min-w-0 overflow-hidden p-3 sm:p-5 lg:p-7">
        {activeEntry ? <div className="story-editor-frame mx-auto h-full min-h-0 max-w-6xl rounded-[var(--radius-panel)] bg-surface p-4 sm:p-5 lg:p-7">
          <StoryEntryEditor key={`${activeKind}:${activeId}`} projectId={projectId} entry={activeEntry} onSaved={onSaved} onConflict={onConflict} onRegisterFlush={registerFlush} />
        </div> : <div className="story-empty-state flex h-full min-h-0 items-center justify-center rounded-[var(--radius-panel)] bg-surface p-8 text-center">
          <div className="max-w-md"><BookOpen className="mx-auto size-10 text-accent/60" /><h2 className="mt-4 text-xl font-semibold">从正式资料开始创作</h2><p className="mt-2 text-sm leading-6 text-muted">先建立大纲、世界观、场景、角色或章节。AI 讨论发生在原生 DSH 中，讨论结果通过提案返回这里审阅。</p><Button className="mt-5" onClick={() => openCreate('outline')}><Plus className="size-4" />创建项目大纲</Button></div>
        </div>}
      </section>
    </div>

    <Drawer open={treeOpen} onOpenChange={setTreeOpen} title="项目资料" description="选择条目后回到宽幅正文编辑。">
      <div className="h-full min-h-0">{treePanel}</div>
    </Drawer>

    <StoryReviewPanel open={reviewOpen} onOpenChange={setReviewOpen} projectId={projectId} entries={entries} activeEntry={activeEntry}
      flushEditor={flushCurrent} onRefreshEntry={refreshEntry} tab={reviewTab} onTabChange={setReviewTab} />

    <ResponsiveEditOverlay open={projectToolsOpen} onOpenChange={setProjectToolsOpen} title="项目工具" description="正文创作留在工作区；版本、旧会话与配对状态按需查看。" footer={<Button type="button" onClick={() => setProjectToolsOpen(false)}>完成</Button>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" className="justify-start" onClick={() => { setProjectToolsOpen(false); openReview('archive'); }}><FolderOpen className="size-4" />查看旧会话归档</Button>
        <Button variant="outline" className="justify-start" onClick={() => { setProjectToolsOpen(false); openReview('revisions'); }}><FileClock className="size-4" />查看版本历史</Button>
        <Button variant="outline" className="justify-start" onClick={() => { setProjectToolsOpen(false); openReview('dsh'); }}><ShieldCheck className="size-4" />DSH 配对与状态</Button>
        <Button variant="outline" className="justify-start" onClick={() => { setProjectTitle(project.data.title); setProjectSummary(project.data.summary); setProjectToolsOpen(false); setProjectSettingsOpen(true); }}><Settings2 className="size-4" />编辑项目名称与简介</Button>
      </div>
    </ResponsiveEditOverlay>

    <Dialog open={Boolean(newKind)} onOpenChange={(open) => { if (!open) { setNewKind(null); setCreateError(''); } }} title={newKind ? `新建${groupLabel[newKind]}` : '新建资料'} description="创建的内容会成为正式项目资料，并从 v1 开始记录修订。" size="md"
      footer={<><Button variant="outline" onClick={() => setNewKind(null)}>取消</Button><Button disabled={!newTitle.trim()} onClick={(event) => { void createEntry(event as unknown as React.FormEvent); }}><Plus className="size-4" />创建正式资料</Button></>}>
      <form className="space-y-3" onSubmit={(event) => void createEntry(event)}>
        <label className="block text-sm font-medium">{newKind === 'character' ? '角色名称' : '条目标题'}<Input autoFocus value={newTitle} maxLength={120} onChange={(event) => setNewTitle(event.target.value)} className="mt-1" placeholder={`例如：${newKind === 'chapter' ? '第一章' : newKind === 'character' ? '主角姓名' : '核心设定'}`} /></label>
        <label className="block text-sm font-medium">初始正文（可选）<textarea value={newBody} maxLength={100000} onChange={(event) => setNewBody(event.target.value)} className="mt-1 min-h-48 w-full rounded-[var(--radius-control)] border border-border-control bg-surface p-3 font-mono text-sm leading-6 outline-none focus:border-accent" placeholder="Markdown 正文…" /></label>
        {createError && <p role="alert" className="text-sm text-red-700">{createError}</p>}
      </form>
    </Dialog>

    <Dialog open={projectSettingsOpen} onOpenChange={setProjectSettingsOpen} title="项目资料" description="项目简介会提供给 DSH 项目上下文与搜索摘要。" size="md"
      footer={<><Button variant="outline" onClick={() => setProjectSettingsOpen(false)}>取消</Button><Button disabled={!projectTitle.trim()} onClick={(event) => { void saveProject(event as unknown as React.FormEvent); }}>保存项目资料</Button></>}>
      <form className="space-y-3" onSubmit={(event) => void saveProject(event)}><label className="block text-sm font-medium">项目名称<Input value={projectTitle} maxLength={120} onChange={(event) => setProjectTitle(event.target.value)} className="mt-1" /></label><label className="block text-sm font-medium">项目简介<textarea value={projectSummary} maxLength={4000} onChange={(event) => setProjectSummary(event.target.value)} className="mt-1 min-h-32 w-full rounded-[var(--radius-control)] border border-border-control bg-surface p-3 text-sm leading-6" /></label></form>
    </Dialog>
  </main>;
}
