'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMediaQuery } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  FileText,
  Layers,
  MapPin,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import type {
  WorldCopilotReference,
  WorldHub,
  WorldHubDocSummary,
  WorldMcpLookupResponse,
  WorldMcpReadResponse,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Drawer } from '@/app/components/ui/drawer';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { cn } from '@/app/lib/cn';
import { useToast } from '@/app/providers/ui-provider';
import {
  createWorldManuscriptDoc,
  lookupWorldChapterMcp,
  readWorldChapterMcp,
  saveWorldManuscriptDoc,
} from '../api';
import { describeError } from '../hooks/world-format';
import { storyWorldKeys } from '../query-keys';
import { WorldCopilotPanel } from './world-copilot-panel';
import {
  ARC_KIND_LABELS,
  ARC_STATUS_LABELS,
  arcMatchesThread,
  parseOpenThreadsFromDocs,
  splitStoryLines,
} from './world-hub-shared';
import {
  WorldManuscriptEditor,
  type WorldManuscriptEditorHandle,
} from './world-manuscript-editor';

export interface WorldPlanTarget {
  arcId?: string;
  docId?: string;
  rightTab?: 'stage' | 'copilot';
  nonce?: number;
}

export interface WorldPlanWorkspaceProps {
  hub: WorldHub;
  initialTarget?: WorldPlanTarget | null;
  onCreateArc: () => void;
  renderIllustrationPanel?: (input: {
    prompt: string;
    title?: string;
    contextKey?: string;
  }) => React.ReactNode;
}

interface McpReadItemState {
  open: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  data: WorldMcpReadResponse | null;
  text: string;
}

export function WorldPlanWorkspace({
  hub,
  initialTarget,
  onCreateArc,
  renderIllustrationPanel,
}: WorldPlanWorkspaceProps) {
  const { world, activeBranch, definition, storyLines, linkedProjects, characterCards, scopePolicy, mcpSources } = hub;
  const queryClient = useQueryClient();
  const toast = useToast();
  const narrow = useMediaQuery('(max-width: 1023px)', false);

  const primaryProject = linkedProjects[0] ?? null;
  const [resolvedProjectId, setResolvedProjectId] = useState<string>(() => primaryProject?.project.id ?? '');
  const effectiveProjectId = primaryProject?.project.id || resolvedProjectId;

  useEffect(() => {
    if (primaryProject?.project.id) {
      setResolvedProjectId(primaryProject.project.id);
    }
  }, [primaryProject?.project.id]);

  // 本地乐观手稿文档映射（用于在新建/保存后立即同步显示，不等待 refetch 完成）
  const [localDocsById, setLocalDocsById] = useState<Record<string, WorldHubDocSummary>>({});

  const { canonChapters, customArcs } = useMemo(() => splitStoryLines(storyLines), [storyLines]);

  const { outlineDoc, chapterDocs, allDocs } = useMemo(() => {
    const baseOutline = primaryProject?.outline ?? null;
    const mergedOutline = baseOutline ? (localDocsById[baseOutline.id] ?? baseOutline) : null;

    const baseChapters = primaryProject?.chapters ?? [];
    const seen = new Set<string>();
    const chapters: WorldHubDocSummary[] = [];
    for (const ch of baseChapters) {
      seen.add(ch.id);
      chapters.push(localDocsById[ch.id] ?? ch);
    }
    for (const extra of Object.values(localDocsById)) {
      if (extra.id !== mergedOutline?.id && !seen.has(extra.id) && (extra.kind === 'chapter' || extra.kind === 'scene')) {
        seen.add(extra.id);
        chapters.push(extra);
      }
    }
    chapters.sort((a, b) => a.position - b.position || a.updatedAt.localeCompare(b.updatedAt));

    const combined = [
      ...(mergedOutline ? [mergedOutline] : []),
      ...chapters,
    ];
    return { outlineDoc: mergedOutline, chapterDocs: chapters, allDocs: combined };
  }, [primaryProject, localDocsById]);

  const defaultArcId = initialTarget?.arcId ?? canonChapters[0]?.id ?? customArcs[0]?.id ?? '';
  const [selectedArcId, setSelectedArcId] = useState<string>(defaultArcId);
  const [selectedDocId, setSelectedDocId] = useState<string>(() => initialTarget?.docId ?? '');
  const [viewKind, setViewKind] = useState<'chapter' | 'doc'>(
    () => (initialTarget?.docId ? 'doc' : 'chapter'),
  );
  const [rightTab, setRightTab] = useState<'stage' | 'copilot'>(
    () => initialTarget?.rightTab ?? 'stage',
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [illustrationOpen, setIllustrationOpen] = useState(false);
  const [expandedActorId, setExpandedActorId] = useState<string | null>(null);

  // 手稿创建与插入状态
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [docActionError, setDocActionError] = useState('');
  const [liveDocDraft, setLiveDocDraft] = useState<{
    docId: string;
    title: string;
    body: string;
    dirty: boolean;
  } | null>(null);
  const editorRef = useRef<WorldManuscriptEditorHandle | null>(null);

  // MCP 检索、全文精读与参考篮状态
  const [mcpSourceId, setMcpSourceId] = useState<string>(() => mcpSources?.[0]?.id ?? '');
  const [mcpQuery, setMcpQuery] = useState<string>('');
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string>('');
  const [mcpResult, setMcpResult] = useState<WorldMcpLookupResponse | null>(null);
  const [mcpReadStates, setMcpReadStates] = useState<Record<string, McpReadItemState>>({});
  const [references, setReferences] = useState<WorldCopilotReference[]>([]);
  const [highlightReferences, setHighlightReferences] = useState(false);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!initialTarget) return;
    if (initialTarget.arcId) {
      setSelectedArcId(initialTarget.arcId);
      if (!initialTarget.docId) setViewKind('chapter');
    }
    if (initialTarget.docId) {
      setSelectedDocId(initialTarget.docId);
      setViewKind('doc');
    }
    if (initialTarget.rightTab) {
      setRightTab(initialTarget.rightTab);
    }
  }, [initialTarget]);

  const activeArc = storyLines.find((line) => line.id === selectedArcId)
    ?? canonChapters[0]
    ?? customArcs[0]
    ?? null;
  const activeArcId = activeArc?.id ?? '';
  const activeArcTitle = activeArc?.title ?? '';
  const activeArcHint = activeArc?.mcpQueryHint ?? '';
  const activeDoc = allDocs.find((doc) => doc.id === selectedDocId) ?? allDocs[0] ?? null;

  useEffect(() => {
    if (!activeArcId) return;
    setMcpQuery(activeArcTitle || activeArcHint || '');
    setMcpResult(null);
    setMcpError('');
    setMcpReadStates({});
  }, [activeArcId, activeArcTitle, activeArcHint]);

  useEffect(() => {
    if (!mcpSourceId && mcpSources?.[0]?.id) {
      setMcpSourceId(mcpSources[0].id);
    }
  }, [mcpSourceId, mcpSources]);

  // Ctrl/Cmd + B 折叠左目录树（带 CJK 输入法互锁守卫）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const actorById = useMemo(
    () => new Map((definition?.actors ?? []).map((actor) => [actor.id, actor])),
    [definition],
  );
  const locationById = useMemo(
    () => new Map((definition?.locations ?? []).map((loc) => [loc.id, loc])),
    [definition],
  );
  const cardByCharId = useMemo(
    () => new Map(characterCards.map((card) => [card.id, card])),
    [characterCards],
  );
  const openThreads = useMemo(
    () => parseOpenThreadsFromDocs(primaryProject?.worldDocs ?? []),
    [primaryProject],
  );

  const arcCast = useMemo(() => {
    if (!activeArc) return definition?.actors ?? [];
    const list = activeArc.actorIds
      .map((id) => actorById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    return list.length > 0 ? list : (definition?.actors ?? []);
  }, [activeArc, actorById, definition]);

  const arcLocations = useMemo(() => {
    if (!activeArc?.locationIds?.length) {
      const seen = new Set(arcCast.map((actor) => actor.locationId));
      return (definition?.locations ?? []).filter((loc) => seen.has(loc.id));
    }
    return activeArc.locationIds
      .map((id) => locationById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [activeArc, arcCast, definition, locationById]);

  const relevantThreads = useMemo(() => {
    if (!activeArc) return openThreads;
    const names = arcCast.map((actor) => actor.name);
    const matched = openThreads.filter((thread) => arcMatchesThread(activeArc, thread, names));
    return matched.length > 0 ? matched : openThreads.slice(0, 3);
  }, [activeArc, arcCast, openThreads]);

  const syncDocIntoCache = (document: WorldHubDocSummary, projectId?: string) => {
    if (projectId) setResolvedProjectId(projectId);
    setLocalDocsById((prev) => ({ ...prev, [document.id]: document }));

    queryClient.setQueryData<WorldHub>(
      storyWorldKeys.hub(world.id, activeBranch?.id),
      (prev) => {
        if (!prev) return prev;
        const targetProjectId = projectId || prev.linkedProjects[0]?.project.id;
        if (!targetProjectId) return prev;

        const existingIndex = prev.linkedProjects.findIndex((p) => p.project.id === targetProjectId);
        if (existingIndex === -1) {
          return {
            ...prev,
            linkedProjects: [
              ...prev.linkedProjects,
              {
                project: {
                  id: targetProjectId,
                  title: `${world.title} · 创作手稿`,
                  summary: world.summary.slice(0, 500),
                  workId: world.title,
                  projectType: 'fiction',
                  revision: 1,
                  updatedAt: document.updatedAt,
                },
                bindingRevision: 1,
                outline: document.kind === 'outline' ? document : null,
                chapters: document.kind === 'chapter' || document.kind === 'scene' ? [document] : [],
                worldDocs: [],
              },
            ],
          };
        }

        const nextProjects = prev.linkedProjects.map((entry, idx) => {
          if (idx !== existingIndex) return entry;
          if (entry.outline?.id === document.id) {
            return { ...entry, outline: document };
          }
          const existsInChapters = entry.chapters.some((ch) => ch.id === document.id);
          return {
            ...entry,
            chapters: existsInChapters
              ? entry.chapters.map((ch) => (ch.id === document.id ? document : ch))
              : [...entry.chapters, document],
          };
        });
        return { ...prev, linkedProjects: nextProjects };
      },
    );

    void queryClient.invalidateQueries({ queryKey: [...storyWorldKeys.all, 'hub', world.id] });
    void queryClient.invalidateQueries({ queryKey: storyWorldKeys.overview(world.id) });
  };

  const handleDocDeleted = (deletedDocId: string) => {
    setLocalDocsById((prev) => {
      if (!(deletedDocId in prev)) return prev;
      const next = { ...prev };
      delete next[deletedDocId];
      return next;
    });

    const remaining = allDocs.filter((doc) => doc.id !== deletedDocId);
    if (remaining.length > 0) {
      setSelectedDocId(remaining[0].id);
      setViewKind('doc');
    } else {
      setSelectedDocId('');
      setViewKind('chapter');
    }

    queryClient.setQueryData<WorldHub>(
      storyWorldKeys.hub(world.id, activeBranch?.id),
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          linkedProjects: prev.linkedProjects.map((entry) => ({
            ...entry,
            chapters: entry.chapters.filter((ch) => ch.id !== deletedDocId),
          })),
        };
      },
    );

    void queryClient.invalidateQueries({ queryKey: [...storyWorldKeys.all, 'hub', world.id] });
    void queryClient.invalidateQueries({ queryKey: storyWorldKeys.overview(world.id) });
  };

  const handleCreateManuscript = async (
    title: string,
    body = '',
    options?: { openCopilot?: boolean },
  ) => {
    if (creatingDoc) return;
    setCreatingDoc(true);
    setDocActionError('');
    try {
      const res = await createWorldManuscriptDoc(world.id, {
        branchId: activeBranch?.id,
        projectId: effectiveProjectId || undefined,
        kind: 'chapter',
        title: title.trim().slice(0, 120) || '未命名章节',
        body,
      });
      syncDocIntoCache(res.document, res.projectId);
      setSelectedDocId(res.document.id);
      setViewKind('doc');
      setMobileTreeOpen(false);
      if (options?.openCopilot) {
        setRightTab('copilot');
      }
      toast.success('已创建新章节', res.document.title);
    } catch (err) {
      const message = describeError(err);
      setDocActionError(message);
      toast.error('新建章节失败', message);
      throw err;
    } finally {
      setCreatingDoc(false);
    }
  };

  const handleMcpLookup = async () => {
    if (!mcpQuery.trim() || mcpBusy) return;
    setMcpBusy(true);
    setMcpError('');
    setMcpReadStates({});
    try {
      const res = await lookupWorldChapterMcp(world.id, {
        sourceId: mcpSourceId || undefined,
        query: mcpQuery.trim(),
        chapterTitle: activeArc?.title,
      });
      setMcpResult(res);
    } catch (err) {
      setMcpError(describeError(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const handleToggleMcpRead = async (itemKey: string, locator: string) => {
    const current = mcpReadStates[itemKey];
    if (current?.data) {
      setMcpReadStates((prev) => ({
        ...prev,
        [itemKey]: { ...current, open: !current.open },
      }));
      return;
    }
    if (current?.loading) return;

    setMcpReadStates((prev) => ({
      ...prev,
      [itemKey]: {
        open: true,
        loading: true,
        loadingMore: false,
        error: '',
        data: null,
        text: '',
      },
    }));

    try {
      const res = await readWorldChapterMcp(world.id, {
        sourceId: mcpResult?.sourceId || mcpSourceId || undefined,
        locator,
        limit: 80,
      });
      setMcpReadStates((prev) => ({
        ...prev,
        [itemKey]: {
          open: true,
          loading: false,
          loadingMore: false,
          error: '',
          data: res,
          text: res.content,
        },
      }));
    } catch (err) {
      setMcpReadStates((prev) => ({
        ...prev,
        [itemKey]: {
          open: true,
          loading: false,
          loadingMore: false,
          error: describeError(err),
          data: null,
          text: '',
        },
      }));
    }
  };

  const handleLoadMoreMcpRead = async (itemKey: string, locator: string) => {
    const current = mcpReadStates[itemKey];
    if (!current?.data || !current.data.hasMore || current.loadingMore) return;

    setMcpReadStates((prev) => ({
      ...prev,
      [itemKey]: { ...current, loadingMore: true, error: '' },
    }));

    try {
      const nextOffset = current.data.endOffset + 1;
      const res = await readWorldChapterMcp(world.id, {
        sourceId: mcpResult?.sourceId || mcpSourceId || undefined,
        locator,
        offset: nextOffset,
        limit: 80,
      });
      setMcpReadStates((prev) => {
        const latest = prev[itemKey];
        const prevText = latest?.text ?? current.text;
        const nextText = prevText && res.content
          ? `${prevText.replace(/\s+$/, '')}\n${res.content}`
          : (prevText || res.content);
        return {
          ...prev,
          [itemKey]: {
            open: true,
            loading: false,
            loadingMore: false,
            error: '',
            data: res,
            text: nextText,
          },
        };
      });
    } catch (err) {
      setMcpReadStates((prev) => ({
        ...prev,
        [itemKey]: {
          ...(prev[itemKey] ?? current),
          loadingMore: false,
          error: describeError(err),
        },
      }));
    }
  };

  const handlePinReference = (item: { title: string; locator?: string; excerpt: string }, expandedText?: string) => {
    const excerpt = (expandedText?.trim() || item.excerpt).slice(0, 8000);
    const title = item.title.slice(0, 300);
    const locator = item.locator ? item.locator.slice(0, 500) : undefined;

    setReferences((prev) => {
      const matchIndex = prev.findIndex((entry) =>
        locator ? entry.locator === locator : entry.title === title,
      );
      if (matchIndex >= 0) {
        return prev.map((entry, idx) =>
          idx === matchIndex ? { title, ...(locator ? { locator } : {}), excerpt } : entry,
        );
      }
      if (prev.length >= 10) {
        toast.warning('参考篮已满 10 条', '已替换最早一条参考片段。');
        return [...prev.slice(1), { title, ...(locator ? { locator } : {}), excerpt }];
      }
      return [...prev, { title, ...(locator ? { locator } : {}), excerpt }];
    });

    setRightTab('copilot');
    if (narrow) setMobileInspectorOpen(true);
    setHighlightReferences(true);
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightReferences(false), 1600);
    toast.success('已加入参考篮', title);
  };

  const handleInsertProseIntoActiveDoc = async (prose: string) => {
    if (!activeDoc || !effectiveProjectId) {
      toast.warning('尚未选定手稿章节', '请先在左侧选择或新建一个章节。');
      return;
    }
    if (viewKind === 'doc' && editorRef.current) {
      editorRef.current.insertProse(prose);
      toast.success('已插入当前章节草稿', '可继续修改并按 Ctrl+S 保存。');
      return;
    }
    const snippet = prose.trim();
    if (!snippet) return;
    const nextBody = activeDoc.body.trim()
      ? `${activeDoc.body.replace(/\s+$/, '')}\n\n${snippet}`
      : snippet;
    const res = await saveWorldManuscriptDoc(world.id, activeDoc.id, {
      projectId: effectiveProjectId,
      expectedRevision: activeDoc.revision,
      title: activeDoc.title,
      body: nextBody,
    });
    syncDocIntoCache(res.document, res.projectId);
    setSelectedDocId(res.document.id);
    setViewKind('doc');
    toast.success('已插入并保存至章节', res.document.title);
  };

  const currentDocTitle = (
    activeDoc && liveDocDraft?.docId === activeDoc.id ? liveDocDraft.title : activeDoc?.title
  ) ?? '';
  const currentDocBody = (
    activeDoc && liveDocDraft?.docId === activeDoc.id ? liveDocDraft.body : activeDoc?.body
  ) ?? '';

  const builtIllustrationPrompt = useMemo(() => {
    const parts: string[] = [];
    const title = currentDocTitle || activeArc?.title;
    if (title) parts.push(`章节主题：${title}`);
    if (arcLocations[0]?.name) {
      parts.push(
        `舞台地点：${arcLocations[0].name}${arcLocations[0].description ? `（${arcLocations[0].description.slice(0, 100)}）` : ''}`,
      );
    }
    if (arcCast.length > 0) {
      parts.push(`出场人物：${arcCast.slice(0, 4).map((actor) => actor.name).join('、')}`);
    }
    const snippetSource = (currentDocBody || activeArc?.description || '').trim();
    if (snippetSource) {
      parts.push(`画面情境：${snippetSource.slice(0, 260)}`);
    }
    if (definition?.visualStyle?.trim()) {
      parts.push(`画风基调：${definition.visualStyle.trim()}`);
    }
    return parts.join('\n');
  }, [activeArc, arcCast, arcLocations, currentDocBody, currentDocTitle, definition?.visualStyle]);

  // 选中项统一使用方案 A（洁白抬升卡片 + 极细发丝框线，无左侧亮条）
  const navRowClass = (selected: boolean) =>
    cn(
      'flex w-full flex-col rounded-[var(--radius-control)] px-3 py-2 text-left transition-colors',
      selected
        ? 'bg-surface-raised text-ink font-semibold shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]'
        : 'text-muted hover:bg-surface-hover hover:text-ink',
    );

  const treeContent = (
    <div className="space-y-5 p-3">
      {/* 第一区：我的创作卷章（直接新建并原地内嵌编辑） */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-semibold text-muted">
            我的创作卷章 ({allDocs.length})
          </span>
          <Button
            size="sm"
            variant="ghost"
            loading={creatingDoc}
            onClick={() => void handleCreateManuscript(`第 ${chapterDocs.length + 1} 章`)}
          >
            {!creatingDoc && <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            新建章节
          </Button>
        </div>

        {allDocs.length === 0 ? (
          <p className="px-2 text-xs leading-relaxed text-muted">
            还没有手稿章节，点击上方「新建章节」即可直接在画布中开始写作。
          </p>
        ) : (
          <div className="space-y-1">
            {outlineDoc && (
              <button
                key={outlineDoc.id}
                type="button"
                onClick={() => {
                  setSelectedDocId(outlineDoc.id);
                  setViewKind('doc');
                  setMobileTreeOpen(false);
                }}
                className={navRowClass(activeDoc?.id === outlineDoc.id && viewKind === 'doc')}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate text-sm">{outlineDoc.title}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">主线大纲</span>
                </span>
              </button>
            )}

            {chapterDocs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => {
                  setSelectedDocId(doc.id);
                  setViewKind('doc');
                  setMobileTreeOpen(false);
                }}
                className={navRowClass(activeDoc?.id === doc.id && viewKind === 'doc')}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate text-sm">{doc.title}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{doc.wordCount}字</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 第二区：正史章节序 */}
      {canonChapters.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <div className="mb-2 px-1">
            <span className="text-xs font-semibold text-muted">正史章节序 ({canonChapters.length})</span>
          </div>
          <div className="space-y-1">
            {canonChapters.map((line, index) => (
              <button
                key={line.id}
                type="button"
                onClick={() => {
                  setSelectedArcId(line.id);
                  setViewKind('chapter');
                  setMobileTreeOpen(false);
                }}
                className={navRowClass(activeArc?.id === line.id && viewKind === 'chapter')}
              >
                <span className="text-xs text-muted">{line.chapterCode || `第 ${index + 1} 节`}</span>
                <span className="truncate text-sm">{line.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 第三区：分支 / 衍生篇章 */}
      <div className="border-t border-hairline pt-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-muted">分支 / 衍生篇章</span>
          <Button size="sm" variant="ghost" onClick={onCreateArc}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            新建
          </Button>
        </div>
        {customArcs.length === 0 ? (
          <p className="px-2 text-xs text-muted">暂无自定义篇章</p>
        ) : (
          <div className="space-y-1">
            {customArcs.map((line) => (
              <button
                key={line.id}
                type="button"
                onClick={() => {
                  setSelectedArcId(line.id);
                  setViewKind('chapter');
                  setMobileTreeOpen(false);
                }}
                className={navRowClass(activeArc?.id === line.id && viewKind === 'chapter')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{line.title}</span>
                  <span className="shrink-0 text-xs text-muted">{line.actorIds.length} 人</span>
                </div>
                {line.timeWindowLabel && (
                  <span className="mt-0.5 truncate text-xs text-muted">{line.timeWindowLabel}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const stageContent = (
    <div className="space-y-5 p-4">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          本章出场角色 ({arcCast.length})
        </h3>
        <div className="space-y-2">
          {arcCast.map((actor) => {
            const expanded = expandedActorId === actor.id;
            const card = actor.characterId ? cardByCharId.get(actor.characterId) : undefined;
            const voice = scopePolicy?.characterVoices?.[actor.id];
            return (
              <div
                key={actor.id}
                className="rounded-[var(--radius-control)] bg-surface-raised p-3 shadow-[0_0_0_1px_var(--hairline)]"
              >
                <button
                  type="button"
                  onClick={() => setExpandedActorId(expanded ? null : actor.id)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-ink">{actor.name}</span>
                      {actor.faction && <Badge variant="secondary">{actor.faction}</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                      {actor.goals[0] || actor.personality}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-accent">{expanded ? '收起' : '声纹'}</span>
                </button>
                {expanded && (
                  <div className="mt-2.5 space-y-2 border-t border-hairline pt-2.5 text-xs leading-relaxed">
                    <p className="text-ink">{card?.summary || actor.background}</p>
                    {voice?.voiceSamples?.length ? (
                      <div className="space-y-1 rounded bg-surface-sunken p-2">
                        <p className="font-medium text-muted">台词声纹参考</p>
                        {voice.voiceSamples.slice(0, 2).map((sample, idx) => (
                          <p key={idx} className="text-ink">{sample}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {arcLocations.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            涉及舞台地点
          </h3>
          <div className="space-y-2">
            {arcLocations.map((loc) => (
              <div key={loc.id} className="rounded-[var(--radius-control)] bg-surface-sunken/60 p-2.5 text-xs">
                <p className="font-medium text-ink">
                  {loc.region && !loc.name.startsWith(loc.region.split('·')[0].trim())
                    ? `${loc.region} · ${loc.name}`
                    : loc.name}
                </p>
                <p className="mt-1 line-clamp-2 text-muted">{loc.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {relevantThreads.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <h3 className="mb-2 text-xs font-semibold text-muted">关联伏笔提示</h3>
          <div className="space-y-2">
            {relevantThreads.map((thread) => (
              <div key={thread.id} className="rounded-[var(--radius-control)] bg-surface-sunken/60 p-2.5 text-xs">
                <p className="font-medium text-ink">{thread.title}</p>
                <p className="mt-1 line-clamp-2 text-muted">{thread.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-hairline pt-4">
        <Button
          variant="primary"
          size="md"
          className="w-full"
          onClick={() => setRightTab('copilot')}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          打开 AI 写作助手
        </Button>
      </div>
    </div>
  );

  const inspectorContent = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-hairline bg-surface px-3 py-2">
        <div
          role="tablist"
          aria-label="右侧辅助栏切换"
          className="grid grid-cols-2 rounded-[var(--radius-control)] bg-surface-sunken p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'stage'}
            onClick={() => setRightTab('stage')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-[var(--radius-xs)] px-2.5 py-1.5 text-sm font-medium transition-colors',
              rightTab === 'stage'
                ? 'bg-surface-raised text-ink shadow-xs'
                : 'text-muted hover:text-ink',
            )}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>角色与舞台</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'copilot'}
            onClick={() => setRightTab('copilot')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-[var(--radius-xs)] px-2.5 py-1.5 text-sm font-medium transition-colors',
              rightTab === 'copilot'
                ? 'bg-surface-raised text-ink shadow-xs'
                : 'text-muted hover:text-ink',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>AI 写作助手</span>
            {references.length > 0 && (
              <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-xs font-semibold text-ink">
                {references.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rightTab === 'stage' ? (
          stageContent
        ) : (
          <WorldCopilotPanel
            worldId={world.id}
            branchId={activeBranch?.id}
            activeArc={activeArc}
            activeDoc={activeDoc}
            liveDocTitle={currentDocTitle}
            liveDocBody={currentDocBody}
            cast={arcCast}
            location={arcLocations[0] ?? null}
            scopePolicy={scopePolicy}
            characterCards={characterCards}
            references={references}
            highlightReferences={highlightReferences}
            onRemoveReference={(index) =>
              setReferences((prev) => prev.filter((_, idx) => idx !== index))
            }
            onInsertProse={handleInsertProseIntoActiveDoc}
            onCreateChapterFromProse={(title, prose) =>
              handleCreateManuscript(title, prose, { openCopilot: true })
            }
          />
        )}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 min-w-0 overflow-hidden',
        sidebarCollapsed
          ? 'lg:grid-cols-[minmax(0,1fr)_360px]'
          : 'lg:grid-cols-[272px_minmax(0,1fr)_360px]',
      )}
    >
      {!sidebarCollapsed && (
        <aside className="hidden min-h-0 overflow-y-auto border-r border-hairline bg-surface/60 lg:block">
          {treeContent}
        </aside>
      )}

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-app">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="hidden lg:inline-flex"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              title={sidebarCollapsed ? '展开章节目录 (Ctrl+B)' : '收起章节目录 (Ctrl+B)'}
            >
              {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setMobileTreeOpen(true)}>
              <Layers className="h-4 w-4" aria-hidden="true" />
              目录
            </Button>
            <span className="truncate text-xs font-medium text-muted">
              {viewKind === 'doc' && activeDoc
                ? currentDocTitle || activeDoc.title
                : (activeArc?.chapterCode || activeArc?.title || '剧情章节')}
            </span>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRightTab('stage');
                setMobileInspectorOpen(true);
              }}
            >
              角色与舞台
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRightTab('copilot');
                setMobileInspectorOpen(true);
              }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              助手
              {references.length > 0 && ` (${references.length})`}
            </Button>
          </div>
        </div>

        {docActionError && (
          <div className="shrink-0 px-4 pt-3 sm:px-6">
            <Alert variant="danger" title="章节操作失败" onDismiss={() => setDocActionError('')}>
              {docActionError}
            </Alert>
          </div>
        )}

        {viewKind === 'doc' && activeDoc && effectiveProjectId ? (
          <WorldManuscriptEditor
            key={activeDoc.id}
            ref={editorRef}
            worldId={world.id}
            projectId={effectiveProjectId}
            doc={activeDoc}
            onDocSaved={(updated) => syncDocIntoCache(updated, effectiveProjectId)}
            onDocDeleted={handleDocDeleted}
            onOpenIllustration={renderIllustrationPanel ? () => setIllustrationOpen(true) : undefined}
            onOpenCopilot={() => {
              setRightTab('copilot');
              if (narrow) setMobileInspectorOpen(true);
            }}
            onDraftChange={setLiveDocDraft}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {viewKind === 'chapter' && activeArc ? (
              <div className="mx-auto max-w-3xl space-y-5">
                {/* 章节剧情梗概卡（不含对话） */}
                <article className="rounded-[var(--radius-panel)] bg-surface p-6 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
                  <div className="flex flex-wrap items-center gap-2">
                    {activeArc.chapterCode && <Badge variant="tone">{activeArc.chapterCode}</Badge>}
                    {activeArc.arcKind && <Badge variant="outline">{ARC_KIND_LABELS[activeArc.arcKind]}</Badge>}
                    {activeArc.status && <Badge variant="secondary">{ARC_STATUS_LABELS[activeArc.status]}</Badge>}
                    {activeArc.timeWindowLabel && (
                      <span className="text-xs text-muted">{activeArc.timeWindowLabel}</span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                    <h2 className="min-w-0 flex-1 text-xl font-semibold text-ink">{activeArc.title}</h2>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={creatingDoc}
                      onClick={() =>
                        void handleCreateManuscript(`续写 · ${activeArc.title}`, '', { openCopilot: true })
                      }
                      className="shrink-0"
                    >
                      {!creatingDoc && <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
                      基于本章新建续写
                    </Button>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap font-serif text-base leading-loose text-ink">
                    {activeArc.description}
                  </p>
                </article>

                {/* 按需 MCP 原文/对白检索面板 */}
                <section className="space-y-3 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-ink">通过 MCP 按需检索详细原文 / 对白</h3>
                      <p className="text-xs text-muted">
                        检索命中后可展开精读原著全文，并将关键片段加入右侧「参考篮」供 AI 写作助手引用。
                      </p>
                    </div>
                    <Link
                      href="/settings/public-services"
                      className="shrink-0 text-xs font-medium text-accent hover:underline"
                    >
                      管理 MCP 资料源
                    </Link>
                  </div>

                  {(mcpSources?.length ?? 0) === 0 ? (
                    <Alert variant="warning" title="暂未配置适用于本作品的 MCP 资料源">
                      前往「系统设置 → 模型与连接」添加或启用支持本作品的 MCP 服务（如虚空终端、zlb 等）即可在此按章检索详细内容。
                    </Alert>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                        <Select
                          aria-label="选择 MCP 资料源"
                          value={mcpSourceId}
                          onChange={(event) => setMcpSourceId(event.target.value)}
                        >
                          {mcpSources!.map((src) => (
                            <option key={src.id} value={src.id}>{src.name}</option>
                          ))}
                        </Select>
                        <Input
                          value={mcpQuery}
                          onChange={(event) => setMcpQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                            if (event.key === 'Enter') void handleMcpLookup();
                          }}
                          placeholder="输入章节名、任务名或关键词…"
                        />
                        <Button
                          variant="secondary"
                          loading={mcpBusy}
                          disabled={mcpBusy || !mcpQuery.trim()}
                          onClick={() => void handleMcpLookup()}
                        >
                          {!mcpBusy && <Search className="h-4 w-4" aria-hidden="true" />}
                          检索详情
                        </Button>
                      </div>

                      {mcpError && <Alert variant="danger" title="MCP 检索失败">{mcpError}</Alert>}

                      {mcpResult && (
                        <div className="space-y-3 border-t border-hairline pt-3">
                          <div className="flex items-center justify-between text-xs text-muted">
                            <span>来自：{mcpResult.sourceName} · 工具 <code className="font-mono">{mcpResult.toolUsed}</code></span>
                            <span>命中 {mcpResult.items.length} 条</span>
                          </div>
                          {mcpResult.items.length === 0 ? (
                            <p className="text-xs text-muted">未匹配到条目，可尝试简化关键词（如仅填任务名）。</p>
                          ) : (
                            <div className="space-y-3">
                              {mcpResult.items.map((item, idx) => {
                                const itemKey = `${idx}:${item.locator || item.title}`;
                                const readState = mcpReadStates[itemKey];
                                return (
                                  <div
                                    key={itemKey}
                                    className="space-y-2 rounded-[var(--radius-control)] bg-surface-sunken/60 p-3.5 text-xs"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-ink">{item.title}</p>
                                        {item.locator && (
                                          <p className="mt-0.5 truncate text-xs text-muted">{item.locator}</p>
                                        )}
                                      </div>

                                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                                        {item.locator && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            loading={readState?.loading}
                                            onClick={() => void handleToggleMcpRead(itemKey, item.locator!)}
                                          >
                                            {!readState?.loading && (
                                              readState?.open && readState.data ? (
                                                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                                              ) : (
                                                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                                              )
                                            )}
                                            {readState?.open && readState.data ? '收起原文' : '展开原文'}
                                          </Button>
                                        )}
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => handlePinReference(item, readState?.text)}
                                        >
                                          <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                                          加入参考篮
                                        </Button>
                                      </div>
                                    </div>

                                    <p className="whitespace-pre-wrap leading-relaxed text-muted">{item.excerpt}</p>

                                    {readState?.open && (
                                      <div className="space-y-2 border-t border-hairline pt-2.5">
                                        {readState.error && (
                                          <Alert variant="danger" title="原文读取失败">{readState.error}</Alert>
                                        )}
                                        {readState.data && (
                                          <>
                                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                                              <span>
                                                原文范围：第 {readState.data.startOffset}–{readState.data.endOffset} 行
                                                {readState.data.totalLines != null ? ` / 共 ${readState.data.totalLines} 行` : ''}
                                              </span>
                                              <span>工具：{readState.data.toolUsed}</span>
                                            </div>
                                            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-hairline bg-surface p-3 font-serif text-sm leading-relaxed text-ink">
                                              {readState.text || '（本段未返回正文文本）'}
                                            </div>
                                            {readState.data.hasMore && item.locator && (
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                loading={readState.loadingMore}
                                                onClick={() => void handleLoadMoreMcpRead(itemKey, item.locator!)}
                                              >
                                                加载下一段
                                              </Button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>
            ) : (
              <EmptyState
                icon={BookOpen}
                title="还没有剧情章节或大纲"
                description="可以直接点击左侧「新建章节」进入编辑器，或在右侧使用 AI 写作助手生成首章草稿。"
                actions={(
                  <Button
                    variant="primary"
                    loading={creatingDoc}
                    onClick={() => void handleCreateManuscript('第一章')}
                  >
                    {!creatingDoc && <Plus className="h-4 w-4" aria-hidden="true" />}
                    新建第一章
                  </Button>
                )}
              />
            )}
          </div>
        )}
      </section>

      <aside className="hidden min-h-0 flex-col overflow-hidden border-l border-hairline bg-surface/60 lg:flex">
        {inspectorContent}
      </aside>

      <Drawer open={mobileTreeOpen} onOpenChange={setMobileTreeOpen} title="章节与手稿目录">
        {treeContent}
      </Drawer>

      <Drawer open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen} title="角色舞台与 AI 写作助手">
        {inspectorContent}
      </Drawer>

      <Drawer
        open={illustrationOpen}
        onOpenChange={setIllustrationOpen}
        title={currentDocTitle || activeArc?.title ? `本章配图 · ${currentDocTitle || activeArc?.title}` : '本章配图'}
        description="已带入当前章节、舞台地点与出场人物，可直接调整提示词并提交生图任务。"
        position="right"
      >
        {renderIllustrationPanel ? (
          renderIllustrationPanel({
            title: currentDocTitle || activeArc?.title,
            prompt: builtIllustrationPrompt,
            contextKey: `story-worlds:illustration:${world.id}:${activeDoc?.id || activeArc?.id || 'chapter'}`,
          })
        ) : (
          <Alert variant="info" title="配图面板未挂载">
            当前工作台未传入生图面板渲染器，请从「自由生成」页面进入生图。
          </Alert>
        )}
      </Drawer>
    </div>
  );
}
