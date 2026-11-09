'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Star,
  Save,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
  Link as LinkIcon,
  User,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import type { CreativeNote, NoteBlock, NoteKind, NoteStage } from '@sthstart/contracts';
import { useNoteDetail } from '../queries';
import { useCharacterDetail } from '@/app/features/characters/queries';
import { useCharacterBrowser } from '@/app/features/characters/components/character-filters';
import { kindLabels, stageLabels, newBlock, summaryFromBlocks } from '../schemas';
import { notebookKeys } from '@/app/lib/query-keys';
import { addLocalAsset, getLocalNote, localAssetId, markLocalNoteDeleted, saveLocalNote, subscribeNotebookLocalChanges, preserveConflictCopy, removeLocalAsset } from '../local-store';
import { fetchNoteDetail, fetchNoteAssetBlob } from '../api';
import { ApiClientError } from '@/app/lib/api-client';
import { useLocalNotebookNote } from '../hooks';
import { syncPendingNotebookData } from '../sync';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { Pagination } from '@/app/components/ui/pagination';
import { Input } from '@/app/components/ui/input';
import { TagsInput } from '@/app/components/shared/tags-input';
import { useToast } from '@/app/providers/ui-provider';
import { generateId } from '@/app/lib/uuid';
import { LocalNoteImage } from './local-note-image';
import { NoteKnowledgePanel } from './note-knowledge-panel';
import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';
import './notebook-layout.css';

const initialNote: CreativeNote = {
  title: '',
  kind: 'note',
  summary: '',
  content: [newBlock('text')],
  tags: [],
  stage: 'draft',
  favorite: false,
};

export function NoteEditor({
  noteId,
  initialKind = 'note',
  standalone = true,
  onDeleted,
  onPersisted,
  listActions,
}: {
  noteId?: string;
  initialKind?: NoteKind;
  standalone?: boolean;
  onDeleted?: () => void;
  onPersisted?: (id: string) => void;
  listActions?: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(!noteId);
  const editVersionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const queryKind = searchParams?.get('kind') as NoteKind | null;
  const allowedKinds = new Set<NoteKind>(['diary', 'idea', 'note', 'story', 'character', 'world']);
  const resolvedInitialKind = queryKind && allowedKinds.has(queryKind) ? queryKind : initialKind;

  const [note, setNote] = useState<CreativeNote>({
    ...initialNote,
    kind: resolvedInitialKind,
  });
  const [effectiveNoteId] = useState(() => noteId ?? generateId());
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const [online, setOnline] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const resolvingRef = useRef(false);
  const [preservedCopyId, setPreservedCopyId] = useState<string | null>(null);
  const [zenMode, setZenMode] = useState(false);

  const { data: detailData, isLoading: detailLoading, error: detailError, refetch: refetchDetail } = useNoteDetail(noteId);
  const { record: localRecord, loaded: localNoteLoaded } = useLocalNotebookNote(effectiveNoteId);
  const detailFailed = Boolean(noteId && detailError);
  const editorReady = !noteId || (localNoteLoaded && (Boolean(localRecord) || (!detailLoading && !detailFailed)));

  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  const updateNoteCaches = useCallback((saved: CreativeNote) => {
    if (!saved.id) return;
    queryClient.setQueryData(notebookKeys.detail(saved.id), saved);
    queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) => {
      if (!current) return current;
      const exists = current.items.some((item) => item.id === saved.id);
      // Keep each server page and its count intact. Local drafts are merged by the list.
      return exists ? { ...current, items: current.items.map((item) => item.id === saved.id ? saved : item) } : current;
    });
  }, [queryClient]);

  const persistLocal = useCallback(async (quiet = false) => {
    if (!effectiveNoteId) return null;
    const editVersion = editVersionRef.current;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setSavingLocal(true);
    setErrorMessage('');
    const payload: CreativeNote = {
      ...note,
      id: effectiveNoteId,
      title: note.title.trim() || '未命名笔记',
      summary: summaryFromBlocks(note.content),
    };
    try {
      const record = await saveLocalNote(payload);
      if (editVersionRef.current === editVersion) {
        updateNoteCaches(record.note);
        dirtyRef.current = false;
        setDirty(false);
      }
      if (mountedRef.current && !noteId && standalone) router.replace("/apps/notebook/" + effectiveNoteId);
      if (mountedRef.current && !standalone) onPersisted?.(effectiveNoteId);
      if (!quiet && editVersionRef.current === editVersion) {
        toast.success('已保存到本机', online ? '正在后台同步。' : '联网后会自动同步。');
      }
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (editVersionRef.current === editVersion) {
        setErrorMessage(message);
        if (!quiet) toast.error('本机保存失败', message);
      }
      return null;
    } finally {
      if (saveRequestRef.current === requestId) setSavingLocal(false);
    }
  }, [effectiveNoteId, note, noteId, online, router, standalone, toast, updateNoteCaches, onPersisted]);

  const handleSave = useCallback(async (quiet = false) => {
    const record = await persistLocal(quiet);
    if (record) void syncPendingNotebookData(queryClient, { force: true, noteId: record.noteId });
    return record?.noteId ?? null;
  }, [persistLocal, queryClient]);

  useEffect(() => {
    if (!localNoteLoaded) return;
    if (hydratedRef.current) return;
    if (editVersionRef.current > 0) {
      hydratedRef.current = true;
      return;
    }
    if (localRecord) {
      hydratedRef.current = true;
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- 首次挂载时把本地 IndexedDB 记录水合进编辑器（外部状态）。 */
      setNote(localRecord.note);
      return;
    }
    if (detailData && !hydratedRef.current) {
      hydratedRef.current = true;
      setNote(detailData);
      void saveLocalNote(detailData, 'synced');
    }
  }, [detailData, localNoteLoaded, localRecord]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [handleSave]);

  useEffect(() => {
    if (!dirty || !effectiveNoteId) return;
    const timer = setTimeout(() => {
      void persistLocal(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [dirty, effectiveNoteId, persistLocal]);

  // 编辑器随笔记切换/返回列表而重挂载，防抖定时器在卸载时被取消，
  // 因此卸载和页面隐藏时必须把未落盘的修改立即写入 IndexedDB。
  const persistRef = useRef(persistLocal);
  useEffect(() => {
    persistRef.current = persistLocal;
    dirtyRef.current = dirty;
  }, [persistLocal, dirty]);
  useEffect(() => {
    const flushPending = () => {
      if (dirtyRef.current && effectiveNoteId) void persistRef.current(true);
    };
    const handlePageHide = () => flushPending();
    const protectPending = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      flushPending();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', protectPending);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', protectPending);
      flushPending();
    };
  }, [effectiveNoteId]);

  // 后台同步会把图片块的 notebook-local:// 引用替换为远端 URL，但不会
  // 触碰编辑器的内存态；监听本地变更，仅按块 ID 回填图片 src，避免用户
  // 的下一次自动保存把已失效的本地引用写回 IndexedDB。
  useEffect(() => {
    if (!effectiveNoteId) return;
    return subscribeNotebookLocalChanges(async (changedNoteId) => {
      if (changedNoteId !== effectiveNoteId) return;
      const record = await getLocalNote(effectiveNoteId);
      if (!record) return;
      setNote((prev) => {
        let changed = false;
        const content = prev.content.map((block) => {
          if (block.type !== 'image') return block;
          const remote = record.note.content.find((item) => item.id === block.id);
          if (remote?.type !== 'image' || !remote.src || remote.src === block.src) return block;
          if (localAssetId(block.src) && !localAssetId(remote.src)) {
            changed = true;
            return { ...block, src: remote.src };
          }
          return block;
        });
        const sameContent = record.note.title === (prev.title.trim() || '未命名笔记')
          && record.note.kind === prev.kind && record.note.stage === prev.stage && record.note.favorite === prev.favorite
          && JSON.stringify(record.note.tags) === JSON.stringify(prev.tags)
          && JSON.stringify(record.note.content) === JSON.stringify(content);
        const revision = sameContent && record.status !== 'conflict' ? record.note.revision : prev.revision;
        return changed || revision !== prev.revision ? { ...prev, content, revision } : prev;
      });
    });
  }, [effectiveNoteId]);

  const updateNoteState = (updater: (prev: CreativeNote) => CreativeNote) => {
    editVersionRef.current += 1;
    dirtyRef.current = true;
    setNote((prev) => updater(prev));
    setDirty(true);
  };

  const resolveConflict = async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolvingConflict(true);
    const copiedAssets: string[] = [];
    let preserved = false;
    try {
      const saved = await persistLocal(true);
      if (!saved) return;
      let remote: CreativeNote | null;
      try { remote = await fetchNoteDetail(effectiveNoteId, AbortSignal.timeout(30_000)); }
      catch (error) {
        if (error instanceof ApiClientError && error.status === 404) remote = null;
        else throw error;
      }
      const copyId = generateId();
      const content: CreativeNote['content'] = [];
      for (const block of saved.note.content) {
        const match = block.type === 'image' ? block.src.match(/^\/api\/(?:v1\/)?admin\/notebook\/assets\/([A-Za-z0-9_-]+)$/) : null;
        if (block.type === 'image' && match) {
          const src = await addLocalAsset(copyId, await fetchNoteAssetBlob(match[1]), 'preserved-note-image');
          copiedAssets.push(localAssetId(src)!);
          content.push({ ...block, src });
        } else content.push(block);
      }
      const copy = await preserveConflictCopy(effectiveNoteId, saved.localVersion, copyId, remote, content);
      preserved = true;
      dirtyRef.current = false;
      setDirty(false);
      setPreservedCopyId(copy.id!);
      if (remote) { setNote(remote); updateNoteCaches(remote); }
      else router.replace(`/apps/notebook/${copy.id}`);
      void syncPendingNotebookData(queryClient, { force: true, noteId: copy.id });
      toast.success('本机草稿已另存为副本', remote ? '当前页面已载入服务端版本。' : '原笔记已删除，已打开本机副本。');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!preserved) await Promise.allSettled(copiedAssets.map(id => removeLocalAsset(id)));
      resolvingRef.current = false;
      setResolvingConflict(false);
    }
  };

  const handleDelete = async () => {
    if (!effectiveNoteId || !window.confirm('确定删除此条笔记及其本地图片素材吗？')) return;
    try {
      await markLocalNoteDeleted(effectiveNoteId, { ...note, id: effectiveNoteId });
      dirtyRef.current = false;
      setDirty(false);
      queryClient.removeQueries({ queryKey: notebookKeys.detail(effectiveNoteId) });
      queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) =>
        current ? { ...current, items: current.items.filter((item) => item.id !== effectiveNoteId) } : current);
      void syncPendingNotebookData(queryClient, { force: true, noteId: effectiveNoteId });
      toast.success('已从本机移除', online ? '正在后台同步删除。' : '联网后会自动同步删除。');
      // 嵌入工作台时删除后交回父组件清除选中态；router.push 会整页跳走，
      // 工作台的筛选与列表状态全部丢失。
      if (!standalone && onDeleted) onDeleted();
      else router.push('/apps/notebook');
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddBlock = (type: NoteBlock['type']) => {
    updateNoteState((prev) => ({
      ...prev,
      content: [...prev.content, newBlock(type)],
    }));
  };

  const handleUpdateBlock = (id: string, patch: Partial<NoteBlock>) => {
    updateNoteState((prev) => ({
      ...prev,
      content: prev.content.map((b) => (b.id === id ? ({ ...b, ...patch } as NoteBlock) : b)),
    }));
  };

  const handleMoveBlock = (index: number, direction: -1 | 1) => {
    updateNoteState((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.content.length) return prev;
      const content = [...prev.content];
      [content[index], content[target]] = [content[target], content[index]];
      return { ...prev, content };
    });
  };

  const handleDeleteBlock = (id: string) => {
    // 不在这里删除本地资产：笔记内容要等防抖落盘，若保存丢失会留下悬空
    // 引用导致同步永久失败；未引用的上传资产由同步结束后的 prune 统一回收。
    updateNoteState((prev) => ({
      ...prev,
      content: prev.content.filter((b) => b.id !== id),
    }));
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      toast.error('图片过大', '单张图片大小不能超过 8MB');
      return;
    }

    if (!effectiveNoteId) return;

    try {
      const localUrl = await addLocalAsset(effectiveNoteId, file, file.name);
      updateNoteState((prev) => ({
        ...prev,
        content: [
          ...prev.content,
          {
            id: generateId(),
            type: 'image',
            src: localUrl,
            caption: '',
          },
        ],
      }));
      toast.success('图片已保存到本机', online ? '将由后台上传。' : '联网后会自动上传。');
    } catch (err) {
      const message = err instanceof Error && err.message === 'local_asset_quota_exceeded'
        ? '待同步图片已达到 100MB，请先联网完成同步。'
        : err instanceof Error ? err.message : String(err);
      toast.error('图片保存失败', message);
    }
  };

  const MainTag = standalone ? 'main' : 'div';

  // 服务端笔记加载失败且本机没有副本时，绝不渲染空白编辑器——否则用户
  // 一输入就会以空内容整体覆盖服务端的原始笔记。
  if (detailFailed && localNoteLoaded && !localRecord) {
    return (
      <MainTag className="notebook-editor-page notebook-editor-shell w-full bg-surface text-ink">
        {standalone && <h1 className="sr-only">创作资料库编辑器</h1>}
        <div className="flex items-center gap-2 px-4 py-2">{listActions}</div>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-semibold text-ink">笔记打开失败</p>
          <p className="max-w-sm text-sm text-muted">
            无法从服务端加载这篇笔记，本机也没有离线副本。为避免覆盖原内容，编辑器已停用。
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => void refetchDetail()}>
              重试
            </Button>
            <Link
              href="/apps/notebook"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回笔记列表</span>
            </Link>
          </div>
        </div>
      </MainTag>
    );
  }

  if (!editorReady) {
    return (
      <MainTag className="notebook-editor-page notebook-editor-shell w-full bg-surface text-ink">
        {standalone && <h1 className="sr-only">创作资料库编辑器</h1>}
        <header className="notebook-editor-header sticky top-0 z-20 flex items-center justify-between gap-4 px-5 sm:px-8 py-2 bg-surface/95 backdrop-blur-md border-b border-border-subtle">
          {listActions}
          {standalone ? (
            <Link
              href="/apps/notebook"
              className="notebook-back-link inline-flex min-h-[34px] items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回笔记列表</span>
            </Link>
          ) : (
            <span className="notebook-save-status text-sm text-muted" aria-live="polite">
              正在打开笔记…
            </span>
          )}
          <span className="h-8 w-16" aria-hidden="true" />
        </header>
        <div className="notebook-editor-frame max-w-4xl mx-auto px-5 sm:px-8 py-6 space-y-4">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainTag>
    );
  }

  return (
    <MainTag inert={resolvingConflict} aria-busy={resolvingConflict} className="notebook-editor-page notebook-editor-shell notebook-editor-compact w-full bg-surface text-ink">
      {standalone && <h1 className="sr-only">创作资料库编辑器</h1>}
      {/* Top sticky action bar */}
      <header className="notebook-editor-header sticky top-0 z-20 flex items-center justify-between gap-4 px-5 sm:px-8 py-2 bg-surface/95 backdrop-blur-md border-b border-border-subtle">
        <div className="notebook-editor-leading flex min-w-0 flex-1 items-center gap-2">
        {listActions}
        {standalone && (
          <Link
            href="/apps/notebook"
            className="notebook-back-link inline-flex min-h-[34px] items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回笔记列表</span>
          </Link>
        )}
            <span className="notebook-save-status flex items-center gap-1.5 text-sm text-muted font-medium" aria-live="polite">
              <span className={`inline-block h-2 w-2 rounded-full ${
                savingLocal
                  ? 'bg-accent animate-pulse'
                  : dirty
                  ? 'bg-warning'
                  : localRecord?.status === 'syncing'
                  ? 'bg-accent animate-pulse'
                  : localRecord?.status === 'pending'
                  ? online ? 'bg-success' : 'bg-muted'
                  : localRecord?.status === 'error'
                  ? 'bg-danger'
                  : localRecord?.status === 'conflict'
                  ? 'bg-warning'
                  : 'bg-success'
              }`} />
              <span>
                {savingLocal
                  ? '正在保存到本机…'
                  : dirty
                  ? '等待本机保存…'
                  : localRecord?.status === 'syncing'
                  ? '正在同步…'
                  : localRecord?.status === 'pending'
                  ? online ? '本机已保存 · 等待同步' : '离线 · 待同步'
                  : localRecord?.status === 'error'
                  ? '本机已保存 · 同步失败'
                  : localRecord?.status === 'conflict'
                  ? '本机已保存 · 版本冲突'
                  : localRecord?.status === 'synced'
                  ? '已同步'
                  : '本地笔记'}
              </span>
            </span>
        </div>

        <div className="notebook-editor-actions flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={zenMode ? 'secondary' : 'ghost'}
            className="h-8 px-2.5 text-sm"
            onClick={() => setZenMode((prev) => !prev)}
            title={zenMode ? '退出专注模式' : '进入专注模式'}
            aria-pressed={zenMode}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{zenMode ? '退出专注' : '专注'}</span>
          </Button>

          <NoteKnowledgePanel
            note={{ ...note, id: note.id ?? (localRecord?.status === 'synced' ? effectiveNoteId : undefined) }}
            knowledge={note.knowledge}
            onChange={(knowledge) => updateNoteState((prev) => ({ ...prev, knowledge }))}
          />
          <AdoptIntoProject source={{ kind: 'note', id: effectiveNoteId }} disabled={dirty || savingLocal || !online || localRecord?.status !== 'synced'} />

          <Button
            size="sm"
            variant="ghost"
            className="notebook-save-button min-h-[30px] px-3 font-semibold text-sm"
            onClick={() => void handleSave()}
          >
            <Save className="h-3.5 w-3.5" />
            <span>保存</span>
          </Button>
          <RowActionsMenu label="更多笔记操作" className="notebook-more-actions" items={[
            { label: note.favorite ? '取消收藏' : '收藏笔记', icon: <Star className={`h-4 w-4 ${note.favorite ? 'fill-current text-warning' : ''}`} aria-hidden="true" />, onSelect: () => updateNoteState(prev => ({ ...prev, favorite: !prev.favorite })) },
            { label: '删除笔记', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, tone: 'danger', separatorBefore: true, onSelect: () => void handleDelete() },
          ]} />
        </div>
      </header>

      {errorMessage && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="danger" onDismiss={() => setErrorMessage('')}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {localRecord?.status === 'error' && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="warning" title="内容已保存在本机，但后台同步失败">
            <span>{localRecord.error || '网络恢复后会自动重试。'}</span>
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => void syncPendingNotebookData(queryClient, { force: true, noteId: effectiveNoteId })}
            >
              立即重试
            </button>
          </Alert>
        </div>
      )}

      {localRecord?.status === 'conflict' && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="warning" title="笔记版本冲突，本机内容已保留">
            <p>{localRecord.error} 自动同步已暂停；继续编辑不会覆盖服务端内容。</p>
            <Button className="mt-2" size="sm" variant="outline" loading={resolvingConflict} onClick={() => void resolveConflict()}>
              保留本机副本并载入服务端版本
            </Button>
          </Alert>
        </div>
      )}
      {preservedCopyId && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="info" title="本机草稿已保留为独立笔记">
            <Link className="underline" href={`/apps/notebook/${preservedCopyId}`}>打开保留的副本</Link>
          </Alert>
        </div>
      )}

      {/* Editor Structured Document Canvas */}
      <div className={`notebook-editor-frame mx-auto px-5 sm:px-8 py-4 space-y-3.5 transition-all ${zenMode ? 'zen-workspace max-w-3xl' : 'max-w-3xl'}`}>
        {/* Document Header Canvas: Direct Inline Title & Attributes */}
        <section className="notebook-doc-header space-y-2 pb-3 border-b border-border-subtle" aria-label="文档标题与元信息">
          {!zenMode && (
            <div className="notebook-doc-metadata flex flex-wrap items-center gap-2">
              {/* Kind Selector */}
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="资料分类"
                  value={note.kind}
                  onChange={(e) => updateNoteState((prev) => ({ ...prev, kind: e.target.value as NoteKind }))}
                  className="rounded-control border-0 bg-surface-sunken px-2 py-1 text-base sm:text-sm text-ink outline-none"
                >
                  {Object.entries(kindLabels).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Stage Selector */}
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="阶段状态"
                  value={note.stage}
                  onChange={(e) => updateNoteState((prev) => ({ ...prev, stage: e.target.value as NoteStage }))}
                  className="rounded-control border-0 bg-surface-sunken px-2 py-1 text-base sm:text-sm text-ink outline-none"
                >
                  {Object.entries(stageLabels).map(([s, label]) => (
                    <option key={s} value={s}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Tags Input */}
              <div className="notebook-doc-tags min-w-0 flex-1">
                <TagsInput
                  value={note.tags}
                  onChange={(newTags) => updateNoteState((prev) => ({ ...prev, tags: newTags }))}
                  placeholder="添加标签，用逗号分隔…"
                  aria-label="资料标签"
                  className="w-full rounded-control border-0 bg-surface-sunken px-2 py-1 text-base sm:text-sm text-ink outline-none placeholder:text-fg-subtle"
                />
              </div>
            </div>
          )}
          <input
            type="text"
            value={note.title}
            onChange={(e) => updateNoteState((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="无标题笔记"
            aria-label="笔记标题"
            className="w-full text-2xl sm:text-[28px] font-semibold tracking-tight bg-transparent border-0 outline-none text-ink placeholder:text-muted py-1"
          />
        </section>

        {/* Main Text Content Focus Area (定高、舒适书写主舞台) */}
        <section className="notebook-content-section space-y-2.5" aria-label="笔记正文">
          <div className="notebook-blocks">
            {note.content.map((block, index) => (
              <div
                key={block.id}
                className="notebook-block group relative py-3 first:pt-1"
              >
                <div className="notebook-block-header">
                  <span className="sr-only">
                    {block.type === 'text'
                      ? '段落文本'
                      : block.type === 'image'
                      ? '图片素材'
                      : block.type === 'link'
                      ? '参考链接'
                      : block.type === 'character-reference'
                      ? '角色资料引用'
                      : '叙事档案引用'}
                  </span>

                  <div className="notebook-block-controls flex items-center gap-1 transition-opacity">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMoveBlock(index, -1)}
                      className="notebook-icon-button text-muted hover:text-ink hover:bg-ink/6 disabled:opacity-20"
                      title="上移"
                      aria-label={"上移第 " + (index + 1) + " 个内容块"}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={index === note.content.length - 1}
                      onClick={() => handleMoveBlock(index, 1)}
                      className="notebook-icon-button text-muted hover:text-ink hover:bg-ink/6 disabled:opacity-20"
                      title="下移"
                      aria-label={"下移第 " + (index + 1) + " 个内容块"}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBlock(block.id)}
                      className="notebook-icon-button text-danger hover:bg-danger/10"
                      title="删除此块"
                      aria-label={"删除第 " + (index + 1) + " 个内容块"}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Block Types */}
                {block.type === 'text' && (
                  <textarea
                    data-reading-surface
                    aria-label={`第 ${index + 1} 段正文`}
                    value={block.text}
                    onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                    placeholder="写下一段文字记录…"
                    className="notebook-textarea w-full bg-transparent text-base leading-[1.85] text-ink placeholder:text-muted outline-none p-0"
                  />
                )}

                {block.type === 'image' && (
                  <div className="notebook-image-block space-y-2 pt-1">
                    <div className="notebook-image-preview relative aspect-video w-full max-w-2xl overflow-hidden rounded-[12px] bg-surface-muted flex items-center justify-center text-muted">
                      {block.src ? (
                        <LocalNoteImage
                          src={block.src}
                          alt={block.caption || '笔记图片'}
                          priority={index < 2}
                        />
                      ) : (
                        <span className="text-sm">等待选择图片</span>
                      )}
                    </div>
                    <label className="notebook-caption-field flex items-center gap-2">
                      <span className="notebook-field-label text-sm text-muted">说明</span>
                      <input
                        value={block.caption}
                        onChange={(e) => handleUpdateBlock(block.id, { caption: e.target.value })}
                        placeholder="为这张图片写一句说明（可选）"
                        className="notebook-caption-input w-full bg-transparent text-sm text-muted outline-none"
                      />
                    </label>
                  </div>
                )}

                {block.type === 'link' && (
                  <div className="p-3 rounded-lg bg-ink/3 border border-border-subtle space-y-2 mt-1">
                    <input
                      type="url"
                      value={block.url}
                      onChange={(e) => handleUpdateBlock(block.id, { url: e.target.value })}
                      placeholder="https://..."
                      className="w-full bg-transparent text-sm font-mono text-ink outline-none"
                    />
                    <input
                      value={block.label}
                      onChange={(e) => handleUpdateBlock(block.id, { label: e.target.value })}
                      placeholder="链接标题"
                      className="w-full bg-transparent text-sm font-semibold text-ink outline-none"
                    />
                    <textarea
                      rows={2}
                      value={block.note}
                      onChange={(e) => handleUpdateBlock(block.id, { note: e.target.value })}
                      placeholder="为什么收藏此链接？"
                      className="w-full bg-transparent text-sm text-muted outline-none"
                    />
                    {block.url.startsWith('http') && (
                      <a
                        href={block.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-accent-dark font-medium hover:underline"
                      >
                        <span>打开链接</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}

                {block.type === 'character-reference' && (
                  <CharacterReferenceBlock
                    block={block}
                    onChange={(patch) => handleUpdateBlock(block.id, patch)}
                  />
                )}

                {block.type === 'archive-reference' && (
                  <blockquote className="p-4 rounded-control bg-info-bg/70 border border-border-subtle text-sm space-y-2 mt-1">
                    <p className="text-sm sm:text-sm text-ink leading-relaxed italic">
                      “{block.quote}”
                    </p>
                    <Link
                      href={"/apps/narrative?utterance=" + encodeURIComponent(block.targetId)}
                      className="text-info font-semibold inline-flex items-center gap-1 hover:underline text-sm"
                    >
                      <span>{block.locator || '查看叙事档案'}</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </blockquote>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Layer 4: Compact Action Dock (添加内容工具坞 - 紧凑小药丸) */}
        <section className="notebook-add-panel flex flex-wrap items-center gap-1.5 pt-1" aria-label="插入内容">
          <div className="notebook-add-grid flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="notebook-add-button h-7 px-2.5 text-sm"
              onClick={() => handleAddBlock('text')}
            >
              <Plus className="h-3 w-3" />
              <span>段落</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="notebook-add-button h-7 px-2.5 text-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="h-3 w-3" />
              <span>图片</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="notebook-add-button h-7 px-2.5 text-sm"
              onClick={() => handleAddBlock('link')}
            >
              <LinkIcon className="h-3 w-3" />
              <span>链接</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="notebook-add-button h-7 px-2.5 text-sm"
              onClick={() => handleAddBlock('character-reference')}
            >
              <User className="h-3 w-3" />
              <span>角色引用</span>
            </Button>
          </div>
        </section>

      </div>

      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="上传笔记图片"
        onChange={handleUploadImage}
      />
    </MainTag>
  );
}

type CharacterReferenceBlockModel = Extract<NoteBlock, { type: 'character-reference' }>;

/** 角色引用使用服务端分页搜索；已选角色的详情独立于当前搜索结果。 */
function CharacterReferenceBlock({
  block,
  onChange,
}: {
  block: CharacterReferenceBlockModel;
  onChange: (patch: Partial<CharacterReferenceBlockModel>) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const composingRef = useRef(false);
  const browser = useCharacterBrowser({}, pickerOpen);
  const selected = useCharacterDetail(block.characterId || undefined);
  const isPageTransition = browser.isFetching && browser.isPlaceholderData;
  const items = browser.data?.items ?? [];

  return (
    <div className="p-4 rounded-control bg-surface-muted/70 border border-border-subtle space-y-2 mt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">角色资料</span>
        <div className="flex items-center gap-1.5">
          {block.characterId && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ characterId: '' })}>清除引用</Button>
          )}
          <Button size="sm" variant="outline" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
            {block.characterId ? '更换角色' : '选择角色'}
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <div className="space-y-2 rounded-control border border-border-default bg-surface p-2.5">
          <Input
            aria-label="搜索可引用角色"
            placeholder="搜索姓名、作品或标签…"
            value={searchText}
            onChange={(event) => {
              const value = event.target.value;
              setSearchText(value);
              if (!composingRef.current) browser.change({ q: value });
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const value = event.currentTarget.value;
              setSearchText(value);
              browser.change({ q: value });
            }}
            className="h-9 text-sm"
          />

          {browser.isError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-danger/20 bg-danger/10 px-2.5 py-2 text-xs text-danger-fg">
              <span>{browser.error instanceof Error ? browser.error.message : '角色搜索失败'}</span>
              <Button size="sm" variant="outline" onClick={() => void browser.refetch()}>重试</Button>
            </div>
          )}
          {isPageTransition && <p role="status" className="text-xs text-muted">搜索条件已更新，当前仍显示上一次结果…</p>}
          {browser.isLoading ? (
            <p role="status" className="py-3 text-center text-xs text-muted">正在读取角色…</p>
          ) : items.length ? (
            <ul className="max-h-48 divide-y divide-border-subtle overflow-y-auto border-y border-border-subtle">
              {items.map((character) => (
                <li key={character.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-surface-hover"
                    onClick={() => {
                      onChange({ characterId: character.id });
                      setPickerOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{character.displayName}</span>
                      <span className="block truncate text-xs text-muted">
                        {character.draft.work || '未分类'}{character.tags.length ? ' · ' + character.tags.slice(0, 2).join('、') : ''}
                      </span>
                    </span>
                    {character.id === block.characterId && <span className="shrink-0 text-xs text-accent">当前</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : !browser.isError ? (
            <p className="py-3 text-center text-xs text-muted">没有匹配角色，请调整搜索条件。</p>
          ) : null}

          {browser.data && (
            <Pagination
              total={browser.data.total}
              page={browser.data.page}
              pageSize={browser.data.pageSize}
              onPageChange={(page) => browser.change({ page })}
              onPageSizeChange={(pageSize) => browser.change({ pageSize, page: 1 })}
              pageSizeOptions={[20, 50, 100]}
              loading={isPageTransition}
              compact
            />
          )}
        </div>
      )}

      {block.characterId ? (
        <div className="p-2.5 rounded bg-surface-raised/80 border border-border-subtle text-sm space-y-1">
          {selected.isLoading ? (
            <p role="status" className="text-xs text-muted">正在读取已选角色…</p>
          ) : selected.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs text-danger-fg">
              <span>{selected.error instanceof Error ? selected.error.message : '已选角色详情读取失败'}</span>
              <Button size="sm" variant="outline" onClick={() => void selected.refetch()}>重试</Button>
            </div>
          ) : selected.data ? (
            <>
              <strong className="text-sm font-semibold text-ink block">{selected.data.displayName}</strong>
              <p className="text-xs text-muted">
                {selected.data.draft.work || '未分类'}
              </p>
              <p className="text-muted line-clamp-2 text-sm">
                {selected.data.draft.summary || '尚未填写摘要'}
              </p>
              <Link
                href={'/apps/characters/' + selected.data.id}
                className="inline-block text-accent-dark font-medium hover:underline pt-0.5 text-sm"
              >
                前往角色资料库 →
              </Link>
            </>
          ) : (
            <p className="text-xs text-muted">角色资料当前不可用，仍保留引用 ID。</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">尚未选择角色。</p>
      )}

      <textarea
        rows={2}
        value={block.note}
        onChange={(event) => onChange({ note: event.target.value })}
        placeholder="这条笔记与该角色的关系（可选）"
        className="w-full bg-transparent text-sm text-muted outline-none"
      />
    </div>
  );
}
