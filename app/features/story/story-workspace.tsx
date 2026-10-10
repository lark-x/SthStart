'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, FileClock, FolderOpen,
  Plus, Search, Settings2, ShieldCheck, MoreHorizontal, Terminal, UserPlus,
  PanelLeftClose, PanelLeft, Sparkles, Lightbulb,
} from 'lucide-react';
import type { StoryCharacter, StoryDocument, StoryEntry } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { Input } from '@/app/components/ui/input';
import { storyApi } from './api';
import { StoryEntryEditor } from './story-entry-editor';
import { StoryReviewPanel } from './story-review-panel';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { StoryAgentConnectDialog } from './components/story-agent-connect-dialog';
import { StoryWorkCastDialog } from './components/story-work-cast-dialog';
import { StoryDerivativesDialog } from './components/story-derivatives-dialog';
import { fetchCharacters } from '@/app/features/characters/api';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import {CreatePublicationDialog} from './components/create-publication-dialog';

type EntryRow = { kind: 'document'; item: StoryDocument } | { kind: 'character'; item: StoryCharacter };
type NewKind = StoryDocument['kind'] | 'character';
type ReviewTab = 'proposals' | 'revisions' | 'agent' | 'archive';
const groupLabel: Record<NewKind, string> = { outline: '大纲', world: '世界观', scene: '场景', chapter: '章节', character: '角色' };
const getEntryLabel = (kind: NewKind, isRefl = false) => {
  if (isRefl) {
    if (kind === 'outline') return '思考纲要';
    if (kind === 'chapter') return '随笔篇目';
  }
  return groupLabel[kind];
};
const documentOf = (entry: StoryEntry): entry is StoryDocument => !('name' in entry);

export function StoryWorkspace({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const project = useQuery({ queryKey: ['story', projectId, 'project'], queryFn: () => storyApi.getProject(projectId) });
  const documents = useQuery({ queryKey: ['story', projectId, 'documents'], queryFn: () => storyApi.listDocuments(projectId) });
  const characters = useQuery({ queryKey: ['story', projectId, 'characters'], queryFn: () => storyApi.listCharacters(projectId) });
  const charactersLibrary = useQuery({
    queryKey: ['characters', 'all-for-cast'],
    queryFn: () => fetchCharacters(),
    staleTime: 60_000,
  });
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
  const [projectWorkId, setProjectWorkId] = useState('');
  const [zenMode, setZenMode] = useState(false);
  const [agentConnectOpen, setAgentConnectOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('sthstart_story_sidebar_collapsed') === 'true';
      } catch {}
    }
    return false;
  });
  const [workCastOpen, setWorkCastOpen] = useState(false);
  const [derivativesOpen, setDerivativesOpen] = useState(false);
  const [navTab, setNavTab] = useState<'chapters' | 'bible'>('chapters');
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const [publicationOpen,setPublicationOpen]=useState(false);

  // Ctrl/Cmd + B 快捷切换左栏大纲
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed((prev) => {
          const next = !prev;
          try { localStorage.setItem('sthstart_story_sidebar_collapsed', String(next)); } catch {}
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const libraryMap = useMemo(() => {
    const map = new Map<string, { avatarUrl?: string | null; work?: string | null; displayName?: string }>();
    for (const char of charactersLibrary.data?.items ?? []) {
      const info = {
        avatarUrl: char.avatarUrl || null,
        work: char.draft?.work?.trim() || null,
        displayName: char.displayName || char.draft?.displayName || '',
      };
      if (char.id) map.set(char.id, info);
      if (info.displayName) map.set(info.displayName, info);
    }
    return map;
  }, [charactersLibrary.data]);

  const castList = useMemo(() => {
    return (characters.data?.items ?? []).map((c) => {
      const lib = (c.sourceCharacterId ? libraryMap.get(c.sourceCharacterId) : null) || libraryMap.get(c.name);
      return {
        id: c.id,
        name: c.name,
        avatarUrl: lib?.avatarUrl || null,
        work: lib?.work || null,
        notes: c.notes,
      };
    });
  }, [characters.data, libraryMap]);

  const entries = useMemo<EntryRow[]>(() => [
    ...(documents.data?.items ?? []).map((item) => ({ kind: 'document' as const, item })),
    ...(characters.data?.items ?? []).map((item) => ({ kind: 'character' as const, item })),
  ], [documents.data, characters.data]);
  const isReflection = project.data?.projectType === 'reflection';
  const outlineDoc = useMemo(() => {
    return (documents.data?.items ?? []).find((item) => item.kind === 'outline');
  }, [documents.data]);
  const activeEntry = entries.find((entry) => entry.kind === selected?.kind && entry.item.id === selected.id)?.item
    ?? (isReflection ? (outlineDoc ?? entries[0]?.item ?? null) : (entries[0]?.item ?? null));
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
    if (!isReflection) {
      if (row.kind === 'document' && row.item.kind === 'chapter') {
        setNavTab('chapters');
      } else {
        setNavTab('bible');
      }
    }
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
      if (!isReflection) {
        setNavTab(newKind === 'chapter' ? 'chapters' : 'bible');
      }
      setNewKind(null); setNewTitle(''); setNewBody('');
      setTreeOpen(false);
      setNotice(`${getEntryLabel(newKind, isReflection)}已创建。`);
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
      const updated = await storyApi.updateProject(projectId, project.data.revision, {
        title: projectTitle.trim(),
        summary: projectSummary,
        workId: projectWorkId.trim() || null,
      });
      client.setQueryData(['story', projectId, 'project'], updated);
      setProjectSettingsOpen(false); setNotice('项目资料已保存。');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '项目保存失败。'); }
  };

  // 章节前后索引与平滑翻页切换
  const chapters = useMemo(() => {
    return (documents.data?.items ?? [])
      .filter((item): item is StoryDocument => item.kind === 'chapter')
      .sort((a, b) => a.position - b.position);
  }, [documents.data]);

  const totalChapterWords = useMemo(() => {
    return chapters.reduce((sum, c) => sum + [...c.body.trim()].length, 0);
  }, [chapters]);

  const bibleCount = useMemo(() => {
    return entries.filter((e) => !(e.kind === 'document' && e.item.kind === 'chapter')).length;
  }, [entries]);

  const bibleGroups: Array<{ kind: Exclude<NewKind, 'chapter'>; rows: EntryRow[] }> = [
    { kind: 'outline', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'outline') },
    { kind: 'character', rows: entries.filter((entry) => entry.kind === 'character') },
    { kind: 'world', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'world') },
    { kind: 'scene', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'scene') },
  ];

  const filteredChapters = useMemo(() => {
    if (!search.trim()) return chapters;
    const q = search.trim().toLowerCase();
    return chapters.filter((c) => `${c.title}\n${c.body}`.toLowerCase().includes(q));
  }, [chapters, search]);

  const currentChapterIndex = useMemo(() => {
    if (!activeEntry || !('kind' in activeEntry) || activeEntry.kind !== 'chapter') return -1;
    return chapters.findIndex((c) => c.id === activeEntry.id);
  }, [chapters, activeEntry]);

  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1 ? chapters[currentChapterIndex + 1] : null;

  const handleSwitchChapter = useCallback(async (targetId: string) => {
    const target = chapters.find((c) => c.id === targetId);
    if (!target) return;
    await chooseEntry({ kind: 'document', item: target });
  }, [chapters, chooseEntry]);

  const handleCreateNextChapter = useCallback(() => {
    openCreate('chapter');
  }, []);

  if (project.isLoading) return <div className="p-8 text-muted">正在打开剧情项目…</div>;
  if (!project.data) return <div className="p-8 text-red-700">无法打开剧情项目：{project.error?.message}</div>;

  const filtered = (row: EntryRow) => !search.trim() || `${'name' in row.item ? row.item.name : row.item.title}\n${'notes' in row.item ? row.item.notes : row.item.body}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());

  const treePanel = (
    <div className="story-tree-panel flex h-full min-h-0 flex-col bg-surface">
      {/* 顶部搜索与项目概要 */}
      <div className="story-tree-header shrink-0 p-3 border-b border-border-default/60">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input
            aria-label={isReflection ? '搜索纲要或随笔' : '搜索正文或设定'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8 text-xs h-8"
            placeholder={isReflection ? '搜索纲要或随笔…' : '搜索正文或设定…'}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted font-mono">
            {isReflection
              ? `${chapters.length} 篇随笔 · ${totalChapterWords.toLocaleString('zh-CN')} 字`
              : `${chapters.length} 章节 · ${totalChapterWords.toLocaleString('zh-CN')} 字`}
          </span>
          {project.data?.workId ? (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent">
              {project.data.workId}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (project.data) {
                  setProjectTitle(project.data.title);
                  setProjectSummary(project.data.summary);
                  setProjectWorkId('');
                  setProjectSettingsOpen(true);
                }
              }}
              className="text-muted hover:text-accent underline"
            >
              {isReflection ? '设置主题' : '绑定作品'}
            </button>
          )}
        </div>

        {/* 核心双模切换：章节正文 vs 故事设定集（仅剧情项目） */}
        {!isReflection && (
          <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-surface-muted/80 p-0.5" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={navTab === 'chapters'}
              onClick={() => setNavTab('chapters')}
              className={`flex items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-all ${
                navTab === 'chapters'
                  ? 'bg-surface font-semibold text-accent shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <BookOpen className="size-3.5" />
              <span>章节目录 ({chapters.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={navTab === 'bible'}
              onClick={() => setNavTab('bible')}
              className={`flex items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-all ${
                navTab === 'bible'
                  ? 'bg-surface font-semibold text-accent shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Sparkles className="size-3.5" />
              <span>设定集 ({bibleCount})</span>
            </button>
          </div>
        )}
      </div>

      {/* 滚动内容区 */}
      <nav aria-label={isReflection ? '思考与随笔目录' : '正式剧情资料树'} className="min-h-0 flex-1 overflow-y-auto p-3" data-autohide-scroll>
        {/* 全文搜索结果 */}
        {search.trim().length >= 2 && (
          <section className="mb-4 border-b border-border-default pb-3">
            <h2 className="mb-2 text-xs font-semibold text-muted">搜索结果</h2>
            {searchResults.isLoading && <p className="text-xs text-muted">搜索中…</p>}
            {searchResults.data?.items.map((result) => {
              const row = entries.find((entry) => entry.item.id === result.id);
              return (
                <button
                  key={`${result.kind}-${result.id}`}
                  type="button"
                  onClick={() => row && void chooseEntry(row)}
                  className="mb-1 block w-full rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-surface-hover"
                >
                  <span className="block truncate text-sm font-medium">{result.title}</span>
                  <span className="line-clamp-2 text-xs text-muted">
                    {getEntryLabel(result.kind, isReflection)} · {result.excerpt}
                  </span>
                </button>
              );
            })}
            {searchResults.data?.items.length === 0 && <p className="text-xs text-muted">没有匹配内容。</p>}
          </section>
        )}

        {/* 聚焦模式：感想随笔项目（仅思考纲要 + 感想随笔列表） */}
        {isReflection ? (
          <div className="space-y-4">
            {/* 顶栏：思考纲要 */}
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wide text-muted">思考纲要</h2>
                {!outlineDoc && (
                  <button
                    type="button"
                    aria-label="新增思考纲要"
                    title="新增思考纲要"
                    onClick={() => { openCreate('outline'); setTreeOpen(false); }}
                    className="rounded p-1 text-muted hover:bg-surface-hover hover:text-accent"
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
              {outlineDoc ? (
                <div
                  className={`group flex min-w-0 items-center rounded-[var(--radius-control)] border transition-all ${
                    activeId === outlineDoc.id
                      ? 'border-accent/50 bg-accent/10 text-accent shadow-xs'
                      : 'border-transparent hover:border-border-default/60 hover:bg-surface-hover'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void chooseEntry({ kind: 'document', item: outlineDoc })}
                    aria-current={activeId === outlineDoc.id ? 'true' : undefined}
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate text-sm font-medium text-ink">
                        {outlineDoc.title || '思考纲要'}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted font-mono">
                        {[...outlineDoc.body.trim()].length}字
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      v{outlineDoc.revision} · 顶层思考与框架梳理
                    </div>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="rounded border border-dashed border-border-default/80 w-full px-2.5 py-2 text-center text-xs text-muted hover:border-accent hover:text-accent"
                  onClick={() => { openCreate('outline'); setTreeOpen(false); }}
                >
                  + 创建思考纲要
                </button>
              )}
            </section>

            {/* 随笔篇目列表 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-muted">
                  感想随笔 ({chapters.length})
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { openCreate('chapter'); setTreeOpen(false); }}
                  className="h-7 text-xs gap-1 text-accent border-accent/30 hover:bg-accent/10"
                >
                  <Plus className="size-3.5" />
                  <span>新建随笔</span>
                </Button>
              </div>

              {filteredChapters.length === 0 ? (
                <div className="rounded-[var(--radius-panel)] border border-dashed border-border-default p-4 text-center">
                  <p className="text-xs text-muted">尚未记录对话感想。</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { openCreate('chapter'); setTreeOpen(false); }}
                    className="mt-2 text-xs gap-1 text-accent"
                  >
                    <Plus className="size-3" />写下第一篇随笔
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredChapters.map((chapter) => {
                    const active = activeId === chapter.id;
                    const wordCount = chapter.body.trim().length;
                    const wordLabel = wordCount >= 1000 ? `${(wordCount / 1000).toFixed(1)}k字` : `${wordCount}字`;

                    return (
                      <div
                        key={chapter.id}
                        className={`group flex min-w-0 items-center rounded-[var(--radius-control)] border transition-all ${
                          active
                            ? 'border-accent/50 bg-accent/10 text-accent shadow-xs'
                            : 'border-transparent hover:border-border-default/60 hover:bg-surface-hover'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void chooseEntry({ kind: 'document', item: chapter })}
                          aria-current={active ? 'true' : undefined}
                          className="min-w-0 flex-1 px-2.5 py-2 text-left"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="truncate text-sm font-medium text-ink">
                              第 {chapter.position + 1} 篇 · {chapter.title}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted font-mono">
                              {wordLabel}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                            <span>v{chapter.revision}</span>
                            <span className="truncate">更新于 {new Date(chapter.updatedAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </button>

                        <span className="mr-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            disabled={filteredChapters[0]?.id === chapter.id}
                            title="上移篇目"
                            onClick={() => void reorderChapter(chapter.id, -1)}
                            className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
                          >
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button
                            disabled={filteredChapters.at(-1)?.id === chapter.id}
                            title="下移篇目"
                            onClick={() => void reorderChapter(chapter.id, 1)}
                            className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
                          >
                            <ArrowDown className="size-3.5" />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* 剧情模式：原有两模切换 */
          <>
            {navTab === 'chapters' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wide text-muted">章节列表</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { openCreate('chapter'); setTreeOpen(false); }}
                    className="h-7 text-xs gap-1 text-accent border-accent/30 hover:bg-accent/10"
                  >
                    <Plus className="size-3.5" />
                    <span>新建章节</span>
                  </Button>
                </div>

                {filteredChapters.length === 0 ? (
                  <div className="rounded-[var(--radius-panel)] border border-dashed border-border-default p-4 text-center">
                    <p className="text-xs text-muted">尚未创建小说章节。</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { openCreate('chapter'); setTreeOpen(false); }}
                      className="mt-2 text-xs gap-1 text-accent"
                    >
                      <Plus className="size-3" />开始第一章
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filteredChapters.map((chapter) => {
                      const active = activeId === chapter.id;
                      const wordCount = chapter.body.trim().length;
                      const wordLabel = wordCount >= 1000 ? `${(wordCount / 1000).toFixed(1)}k字` : `${wordCount}字`;
                      const statusInfo = wordCount === 0
                        ? { label: '构思', bg: 'bg-sky-500/10 text-sky-600 border-sky-500/20' }
                        : wordCount < 1000
                          ? { label: '草稿', bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20' }
                          : { label: '定稿', bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' };

                      return (
                        <div
                          key={chapter.id}
                          className={`group flex min-w-0 items-center rounded-[var(--radius-control)] border transition-all ${
                            active
                              ? 'border-accent/50 bg-accent/10 text-accent shadow-xs'
                              : 'border-transparent hover:border-border-default/60 hover:bg-surface-hover'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void chooseEntry({ kind: 'document', item: chapter })}
                            aria-current={active ? 'true' : undefined}
                            className="min-w-0 flex-1 px-2.5 py-2 text-left"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="truncate text-sm font-medium text-ink">
                                第 {chapter.position + 1} 章 · {chapter.title}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted font-mono">
                                {wordLabel}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                              <span className={`rounded-sm border px-1 py-0.2 text-[9px] font-medium ${statusInfo.bg}`}>
                                {statusInfo.label}
                              </span>
                              <span>v{chapter.revision}</span>
                            </div>
                          </button>

                          <span className="mr-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <button
                              disabled={filteredChapters[0]?.id === chapter.id}
                              title="上移章节"
                              onClick={() => void reorderChapter(chapter.id, -1)}
                              className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
                            >
                              <ArrowUp className="size-3.5" />
                            </button>
                            <button
                              disabled={filteredChapters.at(-1)?.id === chapter.id}
                              title="下移章节"
                              onClick={() => void reorderChapter(chapter.id, 1)}
                              className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
                            >
                              <ArrowDown className="size-3.5" />
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {navTab === 'bible' && (
              <div className="space-y-4">
                {bibleGroups.map(({ kind, rows }) => {
                  const visible = rows.filter(filtered);
                  return (
                    <section key={kind} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-semibold tracking-wide text-muted">
                          {groupLabel[kind]} <span className="font-normal font-mono">({rows.length})</span>
                        </h2>
                        <div className="flex items-center gap-1">
                          {kind === 'character' && (
                            <button
                              type="button"
                              aria-label="从角色库引入"
                              title="从已有角色库按作品引入角色"
                              onClick={() => setWorkCastOpen(true)}
                              className="rounded p-1 text-muted hover:bg-surface-hover hover:text-accent"
                            >
                              <UserPlus className="size-3.5" />
                            </button>
                          )}
                          {(kind !== 'outline' || rows.length === 0) && (
                            <button
                              type="button"
                              aria-label={`新增${groupLabel[kind]}`}
                              title={`新增${groupLabel[kind]}`}
                              onClick={() => { openCreate(kind); setTreeOpen(false); }}
                              className="rounded p-1 text-muted hover:bg-surface-hover hover:text-accent"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {visible.map((row) => {
                        const active = activeId === row.item.id;
                        const isChar = row.kind === 'character';
                        const charInfo = isChar ? castList.find((c) => c.id === row.item.id || c.name === row.item.name) : null;

                        return (
                          <div
                            key={row.item.id}
                            className={`group flex min-w-0 items-center rounded-[var(--radius-control)] border transition-all ${
                              active
                                ? 'border-accent/50 bg-accent/10 text-accent shadow-xs'
                                : 'border-transparent hover:border-border-default/60 hover:bg-surface-hover'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => void chooseEntry(row)}
                              aria-current={active ? 'true' : undefined}
                              className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isChar && (
                                  <div className="size-6 shrink-0 rounded-full overflow-hidden border border-border-default/80 bg-surface-muted flex items-center justify-center text-[11px] font-bold text-accent">
                                    {charInfo?.avatarUrl ? (
                                      <img src={charInfo.avatarUrl} alt="" className="size-full object-cover" />
                                    ) : (
                                      row.item.name.slice(0, 1)
                                    )}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className="truncate block text-sm font-medium text-ink">
                                    {'name' in row.item ? row.item.name : row.item.title}
                                  </span>
                                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                                    {isChar && charInfo?.work && (
                                      <span className="truncate rounded border border-border-default/60 bg-surface-muted px-1 py-0.2 text-[9px]">
                                        {charInfo.work}
                                      </span>
                                    )}
                                    <span>v{row.item.revision}</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })}

                      {rows.length === 0 && kind === 'outline' && (
                        <button
                          type="button"
                          className="rounded border border-dashed border-border-default/80 w-full px-2.5 py-2 text-center text-xs text-muted hover:border-accent hover:text-accent"
                          onClick={() => { openCreate('outline'); setTreeOpen(false); }}
                        >
                          + 创建项目主线大纲
                        </button>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </nav>

      {/* 底部全书统计与即时保存状态 */}
      <div className="story-tree-footer shrink-0 border-t border-border-default/60 p-2.5 text-center text-[11px] text-muted font-mono">
        {isReflection ? '对话感想空间 · 自动即时保存' : '本地私密创作空间 · 自动即时保存'}
      </div>
    </div>
  );

  return <main className="story-workspace-root flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-paper text-ink">
    {!isReflection && (
      <CreatePublicationDialog open={publicationOpen} onOpenChange={setPublicationOpen} projectId={projectId}
        chapters={(documents.data?.items??[]).filter(d=>d.kind==='chapter')} activeId={activeId} flush={flushCurrent}/>
    )}
    <WorkspaceHeader
      title={project.data.title}
      backHref="/apps/story"
      backLabel={isReflection ? '全部项目' : '剧情项目'}
      status={
        <div className="flex items-center gap-1.5">
          <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
            isReflection
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'bg-accent/10 text-accent'
          }`}>
            {isReflection ? (project.data.workId || '对话感想') : (project.data.workId || '剧情创作')}
          </span>
          <span className="hidden xl:inline text-xs text-muted">
            {isReflection ? '思考纲要 · 对话随笔 · 认知洞察' : '结构化大纲 · 章节正文 · 剧本流'}
          </span>
        </div>
      }
      actions={
        <>
          {!isReflection && (
            <Button size="sm" variant="primary" onClick={()=>setPublicationOpen(true)}>制作作品</Button>
          )}
          {/* 左栏大纲折叠/展开切换按钮 */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSidebarCollapsed((prev) => {
                const next = !prev;
                try { localStorage.setItem('sthstart_story_sidebar_collapsed', String(next)); } catch {}
                return next;
              });
            }}
            className="hidden lg:flex p-1.5 text-muted hover:text-ink"
            title={sidebarCollapsed ? '展开大纲资料树 (Ctrl+B)' : '收起大纲资料树 (Ctrl+B)'}
          >
            {sidebarCollapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>

          <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setTreeOpen(true)}>
            <FolderOpen className="size-4" />资料
          </Button>

          {/* AI 协作与 MCP 基础设施入口 */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAgentConnectOpen(true)}
            className="gap-1.5"
            title="打开 AI 智能体协作与 MCP 基础设施向导"
          >
            <Sparkles className="size-4 text-accent" />
            <span className="hidden sm:inline">AI 协作 (MCP)</span>
            <span className={`size-2 rounded-full ${bridge.data?.paired ? 'bg-emerald-500' : 'bg-muted/50'}`} />
          </Button>

          <Button size="sm" variant={pendingProposalCount ? 'accent' : 'outline'} onClick={() => openReview('proposals')}>
            <Check className="size-4" />
            <span className="hidden sm:inline">提案审阅</span>
            {pendingProposalCount > 0 ? ` · ${pendingProposalCount}` : ''}
          </Button>

          <Button size="sm" variant="outline" onClick={() => setProjectToolsOpen(true)} title="更多项目工具">
            <MoreHorizontal className="size-4" />
          </Button>
        </>
      }
    />

    {notice && <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default bg-surface-muted px-4 py-2 text-sm"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}

    {/* 三栏式视口锁高工作台主体 */}
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden relative">
      {/* 左栏：项目大纲、世界观与出场角色 */}
      <aside aria-label="正式剧情资料树" className={`story-tree-aside w-64 shrink-0 h-full min-h-0 border-r border-border-default bg-surface transition-all ${zenMode || sidebarCollapsed ? 'hidden' : 'hidden lg:block'}`}>
        {treePanel}
      </aside>

      {/* 中栏：核心小说正文大画布（支持自适应宽屏排版） */}
      <section aria-label="正式写作工作台" className="flex-1 min-h-0 min-w-0 h-full overflow-hidden p-2 sm:p-4 flex flex-col">
        {activeEntry ? (
          <div className={`story-editor-frame mx-auto h-full w-full min-h-0 ${zenMode ? 'zen-workspace max-w-4xl' : 'max-w-6xl'} rounded-[var(--radius-panel)] bg-surface p-3 sm:p-5 transition-all`}>
            <StoryEntryEditor
              key={`${activeKind}:${activeId}`}
              projectId={projectId}
              entry={activeEntry}
              castList={isReflection ? [] : castList}
              prevChapter={prevChapter}
              nextChapter={nextChapter}
              onSwitchChapter={handleSwitchChapter}
              onCreateNextChapter={handleCreateNextChapter}
              onSaved={onSaved}
              onConflict={onConflict}
              onRegisterFlush={registerFlush}
              zenMode={zenMode}
              onToggleZen={() => setZenMode((prev) => !prev)}
              onOpenDerivatives={isReflection ? undefined : () => setDerivativesOpen(true)}
              isReflection={isReflection}
            />
          </div>
        ) : (
          <div className="story-empty-state flex h-full min-h-0 items-center justify-center rounded-[var(--radius-panel)] bg-surface p-8 text-center">
            {isReflection ? (
              <div className="max-w-md">
                <Lightbulb className="mx-auto size-10 text-amber-500/80" />
                <h2 className="mt-4 text-xl font-semibold">开始记录对话感想与思考</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  左侧建立思考纲要或记录随笔篇目。可通过外部智能体（Antigravity、Cursor）借助标准 MCP 协议随时追加、查阅或提炼感想。
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Button onClick={() => openCreate('outline')}>
                    <Plus className="size-4" />创建思考纲要
                  </Button>
                  <Button variant="outline" onClick={() => openCreate('chapter')}>
                    <Plus className="size-4" />写下第一篇随笔
                  </Button>
                  <Button variant="outline" onClick={() => setAgentConnectOpen(true)}>
                    <Sparkles className="size-4 text-accent" />配置 AI 协作 (MCP)
                  </Button>
                </div>
              </div>
            ) : (
              <div className="max-w-md">
                <BookOpen className="mx-auto size-10 text-accent/60" />
                <h2 className="mt-4 text-xl font-semibold">从纯文字小说正文开始创作</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  左侧建立大纲、世界观或从既有作品引入角色。可通过外部智能体（Antigravity、Cursor）借助标准 MCP 协议协同构思，构思完成后一键生成剧本工程或活动对白流。
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Button onClick={() => openCreate('outline')}>
                    <Plus className="size-4" />创建项目大纲
                  </Button>
                  <Button variant="outline" onClick={() => setAgentConnectOpen(true)}>
                    <Sparkles className="size-4 text-accent" />配置 AI 协作 (MCP)
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>

    {/* 抽屉导航（小屏幕模式） */}
    <Drawer open={treeOpen} onOpenChange={setTreeOpen} title="项目资料" description="选择条目后回到正文编辑。">
      <div className="h-full min-h-0">{treePanel}</div>
    </Drawer>

    {/* 审阅面板 */}
    <StoryReviewPanel
      open={reviewOpen}
      onOpenChange={setReviewOpen}
      projectId={projectId}
      entries={entries}
      activeEntry={activeEntry}
      flushEditor={flushCurrent}
      onRefreshEntry={refreshEntry}
      tab={reviewTab}
      onTabChange={setReviewTab}
    />

    {/* 从角色库按作品引入角色弹窗 */}
    <StoryWorkCastDialog
      open={workCastOpen}
      onOpenChange={setWorkCastOpen}
      projectId={projectId}
      defaultWorkId={project.data.workId}
      existingNames={new Set(characters.data?.items.map((c) => c.name) ?? [])}
      onCharacterAdded={() => void refreshEntry()}
    />

    {/* 衍生产物与剧本工程导出弹窗 */}
    <StoryDerivativesDialog
      open={derivativesOpen}
      onOpenChange={setDerivativesOpen}
      projectId={projectId}
      projectTitle={project.data.title}
      chapterTitle={'title' in (activeEntry ?? {}) ? (activeEntry as StoryDocument).title : '本章'}
      chapterBody={'body' in (activeEntry ?? {}) ? (activeEntry as StoryDocument).body : ('notes' in (activeEntry ?? {}) ? (activeEntry as StoryCharacter).notes : '')}
    />

    {/* AI 协作与 MCP 基础设施向导弹窗 */}
    <StoryAgentConnectDialog
      open={agentConnectOpen}
      onOpenChange={setAgentConnectOpen}
      projectId={projectId}
      projectTitle={project.data.title}
      onOpenProposals={() => openReview('proposals')}
      pendingProposalsCount={pendingProposalCount}
    />

    {/* 更多项目工具 */}
    <ResponsiveEditOverlay open={projectToolsOpen} onOpenChange={setProjectToolsOpen} title="项目工具" description="正文创作留在工作区；版本、旧会话与配对状态按需查看。" footer={<Button type="button" onClick={() => setProjectToolsOpen(false)}>完成</Button>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" className="justify-start" onClick={() => { setProjectToolsOpen(false); openReview('archive'); }}><FolderOpen className="size-4" />查看旧会话归档</Button>
        <Button variant="outline" className="justify-start" onClick={() => { setProjectToolsOpen(false); openReview('revisions'); }}><FileClock className="size-4" />查看版本历史</Button>
        <Button variant="outline" className="justify-start" onClick={() => { setProjectToolsOpen(false); setAgentConnectOpen(true); }}><ShieldCheck className="size-4" />MCP 与 AI 连接向导</Button>
        <Button variant="outline" className="justify-start" onClick={() => { setProjectTitle(project.data.title); setProjectSummary(project.data.summary); setProjectWorkId(project.data.workId || ''); setProjectToolsOpen(false); setProjectSettingsOpen(true); }}><Settings2 className="size-4" />编辑项目名称与简介</Button>
      </div>
    </ResponsiveEditOverlay>

    {/* 新建条目弹窗 */}
    <Dialog open={Boolean(newKind)} onOpenChange={(open) => { if (!open) { setNewKind(null); setCreateError(''); } }} title={newKind ? `新建${getEntryLabel(newKind, isReflection)}` : '新建资料'} description="创建的内容会成为正式项目资料，并从 v1 开始记录修订。" size="md"
      footer={<><Button variant="outline" onClick={() => setNewKind(null)}>取消</Button><Button disabled={!newTitle.trim()} onClick={(event) => { void createEntry(event as unknown as React.FormEvent); }}><Plus className="size-4" />创建正式资料</Button></>}>
      <form className="space-y-3" onSubmit={(event) => void createEntry(event)}>
        <label className="block text-sm font-medium">
          {newKind === 'character' ? '角色名称' : isReflection ? (newKind === 'outline' ? '纲要标题' : '随笔标题') : '条目标题'}
          <Input autoFocus value={newTitle} maxLength={120} onChange={(event) => setNewTitle(event.target.value)} className="mt-1"
            placeholder={newKind === 'character' ? '主角姓名' : isReflection ? (newKind === 'chapter' ? '例如：关于智能体认知的若干反思' : '例如：核心思考脉络') : (newKind === 'chapter' ? '第一章' : '核心设定')} />
        </label>
        <label className="block text-sm font-medium">初始正文（可选）<textarea value={newBody} maxLength={100000} onChange={(event) => setNewBody(event.target.value)} className="mt-1 min-h-48 w-full rounded-[var(--radius-control)] border border-border-control bg-surface p-3 font-mono text-sm leading-6 outline-none focus:border-accent" placeholder="Markdown 正文…" /></label>
        {createError && <p role="alert" className="text-sm text-red-700">{createError}</p>}
      </form>
    </Dialog>

    {/* 项目设置与作品绑定弹窗 */}
    <Dialog open={projectSettingsOpen} onOpenChange={setProjectSettingsOpen}
      title={isReflection ? '项目资料与主题设置' : '项目资料与作品绑定'}
      description={isReflection ? '项目简介与主题标签会提供给 AI 智能体提炼与查阅上下文。' : '项目简介与作品信息会提供给 AI 智能体创作上下文，并用于角色库筛选。'}
      size="md"
      footer={<><Button variant="outline" onClick={() => setProjectSettingsOpen(false)}>取消</Button><Button disabled={!projectTitle.trim()} onClick={(event) => { void saveProject(event as unknown as React.FormEvent); }}>保存项目资料</Button></>}>
      <form className="space-y-3" onSubmit={(event) => void saveProject(event)}>
        <label className="block text-sm font-medium">项目名称<Input value={projectTitle} maxLength={120} onChange={(event) => setProjectTitle(event.target.value)} className="mt-1" /></label>
        <label className="block text-sm font-medium">
          {isReflection ? '关联主题标签' : '所属作品'}
          <Input value={projectWorkId} maxLength={120} onChange={(event) => setProjectWorkId(event.target.value)} className="mt-1"
            placeholder={isReflection ? '例如：智能体对话、系统架构哲学' : '例如：原神、崩坏：星穹铁道，或留空'} />
        </label>
        <label className="block text-sm font-medium">项目简介<textarea value={projectSummary} maxLength={4000} onChange={(event) => setProjectSummary(event.target.value)} className="mt-1 min-h-32 w-full rounded-[var(--radius-control)] border border-border-control bg-surface p-3 text-sm leading-6" /></label>
      </form>
    </Dialog>
  </main>;
}
