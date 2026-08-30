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
} from 'lucide-react';
import type { CreativeNote, NoteBlock, NoteKind, NoteStage } from '@sthstart/contracts';
import { useNoteDetail } from '../queries';
import { useCharacters } from '@/app/features/characters/queries';
import { kindLabels, stageLabels, newBlock, summaryFromBlocks } from '../schemas';
import { notebookKeys } from '@/app/lib/query-keys';
import { addLocalAsset, getLocalNote, localAssetId, markLocalNoteDeleted, saveLocalNote, subscribeNotebookLocalChanges } from '../local-store';
import { useLocalNotebookNote } from '../hooks';
import { syncPendingNotebookData } from '../sync';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { TagsInput } from '@/app/components/shared/tags-input';
import { useToast } from '@/app/providers/ui-provider';
import { generateId } from '@/app/lib/uuid';
import { LocalNoteImage } from './local-note-image';

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
}: {
  noteId?: string;
  initialKind?: NoteKind;
  standalone?: boolean;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(!noteId);
  const editVersionRef = useRef(0);
  const saveRequestRef = useRef(0);

  const queryKind = searchParams?.get('kind') as NoteKind | null;
  const allowedKinds = new Set<NoteKind>(['diary', 'idea', 'note', 'story', 'character', 'world']);
  const resolvedInitialKind = queryKind && allowedKinds.has(queryKind) ? queryKind : initialKind;

  const [note, setNote] = useState<CreativeNote>({
    ...initialNote,
    kind: resolvedInitialKind,
  });
  const [effectiveNoteId] = useState(() => noteId ?? generateId());
  const [dirty, setDirty] = useState(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const [online, setOnline] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const { data: detailData, isLoading: detailLoading, error: detailError, refetch: refetchDetail } = useNoteDetail(noteId);
  const { record: localRecord, loaded: localNoteLoaded } = useLocalNotebookNote(effectiveNoteId);
  const { data: charData } = useCharacters();
  const characters = charData?.items ?? [];
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
      return { items: exists ? current.items.map((item) => item.id === saved.id ? saved : item) : [saved, ...current.items] };
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
        setDirty(false);
      }
      if (!noteId && standalone) router.replace("/apps/notebook/" + effectiveNoteId);
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
  }, [effectiveNoteId, note, noteId, online, router, standalone, toast, updateNoteCaches]);

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
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    persistRef.current = persistLocal;
    dirtyRef.current = dirty;
  }, [persistLocal, dirty]);
  useEffect(() => {
    const flushPending = () => {
      if (dirtyRef.current && effectiveNoteId) void persistRef.current(true);
    };
    const handlePageHide = () => flushPending();
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
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
        return changed ? { ...prev, content } : prev;
      });
    });
  }, [effectiveNoteId]);

  const updateNoteState = (updater: (prev: CreativeNote) => CreativeNote) => {
    editVersionRef.current += 1;
    setNote((prev) => updater(prev));
    setDirty(true);
  };

  const handleDelete = async () => {
    if (!effectiveNoteId || !window.confirm('确定删除此条笔记及其本地图片素材吗？')) return;
    try {
      await markLocalNoteDeleted(effectiveNoteId, { ...note, id: effectiveNoteId });
      queryClient.removeQueries({ queryKey: notebookKeys.detail(effectiveNoteId) });
      queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) =>
        current ? { items: current.items.filter((item) => item.id !== effectiveNoteId) } : current);
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
      <MainTag className="notebook-editor-page notebook-editor-shell w-full bg-[#fffdf8] text-[#18201d]">
        {standalone && <h1 className="sr-only">创作笔记编辑器</h1>}
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="font-serif text-lg font-semibold text-[#18201d]">笔记打开失败</p>
          <p className="max-w-sm text-xs text-[#68716d]">
            无法从服务端加载这篇笔记，本机也没有离线副本。为避免覆盖原内容，编辑器已停用。
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => void refetchDetail()}>
              重试
            </Button>
            <Link
              href="/apps/notebook"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] transition-colors"
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
      <MainTag className="notebook-editor-page notebook-editor-shell w-full bg-[#fffdf8] text-[#18201d]">
        {standalone && <h1 className="sr-only">创作笔记编辑器</h1>}
        <header className="notebook-editor-header sticky top-0 z-20 flex items-center justify-between gap-4 px-5 sm:px-8 py-2 bg-[#fffdf8]/95 backdrop-blur-md border-b border-[rgb(24_32_29/8%)]">
          {standalone ? (
            <Link
              href="/apps/notebook"
              className="notebook-back-link inline-flex min-h-[34px] items-center gap-1.5 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回笔记列表</span>
            </Link>
          ) : (
            <span className="notebook-save-status text-xs text-[#68716d]" aria-live="polite">
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
    <MainTag className="notebook-editor-page notebook-editor-shell w-full bg-[#fffdf8] text-[#18201d]">
      {standalone && <h1 className="sr-only">创作笔记编辑器</h1>}
      {/* Top sticky action bar */}
      <header className="notebook-editor-header sticky top-0 z-20 flex items-center justify-between gap-4 px-5 sm:px-8 py-2 bg-[#fffdf8]/95 backdrop-blur-md border-b border-[rgb(24_32_29/8%)]">
        {standalone ? (
          <Link
            href="/apps/notebook"
            className="notebook-back-link inline-flex min-h-[34px] items-center gap-1.5 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回笔记列表</span>
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <span className="notebook-save-status text-xs text-[#68716d] font-medium" aria-live="polite">
              {savingLocal
                ? '🟢 正在保存到本机…'
                : dirty
                ? '🟡 等待本机保存…'
                : localRecord?.status === 'syncing'
                ? '🔵 正在同步…'
                : localRecord?.status === 'pending'
                ? online ? '🟢 本机已保存 · 等待同步' : '⚪ 离线 · 待同步'
                : localRecord?.status === 'error'
                ? '🔴 本机已保存 · 同步失败'
                : localRecord?.status === 'synced'
                ? '🟢 已同步'
                : '🟢 本地笔记'}
            </span>
          </div>
        )}

        {standalone && (
          <span className="notebook-save-status text-xs text-[#68716d]" aria-live="polite">
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
              : localRecord?.status === 'synced'
              ? '已同步'
              : '本地笔记'}
          </span>
        )}

        <div className="notebook-editor-actions flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              updateNoteState((prev) => ({ ...prev, favorite: !prev.favorite }))
            }
            className={"notebook-icon-button rounded-md hover:bg-[rgb(24_32_29/6%)] transition-colors cursor-pointer " + (note.favorite ? "text-[#d0a731]" : "text-[#68716d]")}
            aria-label={note.favorite ? '取消收藏' : '收藏笔记'}
          >
            <Star className={"h-4 w-4 " + (note.favorite ? "fill-current" : "")} />
          </button>

          <Button
            size="sm"
            variant="primary"
            className="notebook-save-button min-h-[30px] px-3 font-bold shadow-xs text-xs"
            onClick={() => void handleSave()}
          >
            <Save className="h-3.5 w-3.5" />
            <span>保存</span>
          </Button>
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

      {/* Editor Structured Document Canvas */}
      <div className="notebook-editor-frame max-w-4xl mx-auto px-5 sm:px-8 py-4 space-y-3.5">
        {/* Layer 1: Compact Meta Bar (元数据属性栏 - 紧凑行内高度) */}
        <section className="notebook-meta-bar flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#f7f4ee]/80 border border-[rgb(24_32_29/8%)]" aria-label="页面属性">
          <div className="flex items-center gap-3">
            <div className="notebook-select-group flex items-center gap-1.5">
              <span className="notebook-field-label text-[11px] font-bold text-[#68716d]">类型</span>
              <select
                value={note.kind}
                aria-label="笔记类型"
                onChange={(e) =>
                  updateNoteState((prev) => ({ ...prev, kind: e.target.value as NoteKind }))
                }
                className="notebook-select h-6 px-2 bg-white border border-[rgb(24_32_29/14%)] rounded text-[11px] font-semibold text-[#18201d] outline-none"
              >
                {Object.entries(kindLabels).map(([val, label]) => (
                  <option value={val} key={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="notebook-select-group flex items-center gap-1.5">
              <span className="notebook-field-label text-[11px] font-bold text-[#68716d]">阶段</span>
              <select
                value={note.stage}
                aria-label="笔记阶段"
                onChange={(e) =>
                  updateNoteState((prev) => ({ ...prev, stage: e.target.value as NoteStage }))
                }
                className="notebook-select h-6 px-2 bg-white border border-[rgb(24_32_29/14%)] rounded text-[11px] font-semibold text-[#18201d] outline-none"
              >
                {Object.entries(stageLabels).map(([val, label]) => (
                  <option value={val} key={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <span className="notebook-local-hint text-[10.5px] text-[#68716d]/70 font-mono">
            自动保存在本机
          </span>
        </section>

        {/* Layer 2: Compact Title & Tags Section */}
        <section className="notebook-heading space-y-1.5" aria-label="笔记标题">
          <div className="flex items-center justify-between">
            <span className="notebook-heading-kicker text-[9.5px] font-bold uppercase tracking-wider text-[#b83b1b]">
              CREATIVE NOTE
            </span>
          </div>
          <label htmlFor="note-title" className="sr-only">笔记标题</label>
          <input
            id="note-title"
            value={note.title}
            onChange={(e) => updateNoteState((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="输入笔记标题…"
            className="notebook-title-input w-full bg-transparent font-serif text-xl sm:text-2xl font-medium text-[#18201d] placeholder:text-[#68716d]/30 outline-none pb-1.5 border-b border-[rgb(24_32_29/10%)] focus:border-[#e45d35]"
          />

          <label className="notebook-tags-field flex items-center gap-1.5 pt-0.5">
            <span className="notebook-field-label text-[#e45d35] font-bold text-xs">#</span>
            <TagsInput
              value={note.tags}
              onChange={(tags) =>
                updateNoteState((prev) => ({ ...prev, tags }))
              }
              placeholder="添加标签（用逗号分隔，如：灵感，第 2 章）…"
              className="notebook-tags-input w-full bg-transparent text-xs text-[#68716d] placeholder:text-[#68716d]/40 outline-none h-6"
            />
          </label>
        </section>

        {/* Layer 3: Main Text Content Focus Area (定高、舒适书写主舞台) */}
        <section className="notebook-content-section space-y-2.5" aria-label="笔记正文">
          <div className="notebook-content-heading flex items-center justify-between pb-1 border-b border-[rgb(24_32_29/8%)]">
            <span className="notebook-section-kicker text-xs font-bold uppercase tracking-wider text-[#18201d]">
              正文内容
            </span>
            <span className="notebook-block-count text-[10px] text-[#68716d] bg-[rgb(24_32_29/5%)] px-2 py-0.5 rounded-full font-medium">
              {note.content.length} 个内容块
            </span>
          </div>

          <div className="notebook-blocks space-y-3">
            {note.content.map((block, index) => (
              <div
                key={block.id}
                className="notebook-block group relative p-3 rounded-xl border border-[rgb(24_32_29/8%)] bg-[#fffdf8] hover:border-[rgb(24_32_29/18%)] shadow-2xs space-y-2 transition-all"
              >
                <div className="notebook-block-header flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#68716d]/70">
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

                  <div className="notebook-block-controls flex items-center gap-0.5 opacity-40 group-hover:opacity-100 max-lg:opacity-100 transition-opacity">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMoveBlock(index, -1)}
                      className="notebook-icon-button text-[#68716d] hover:text-[#18201d] hover:bg-[rgb(24_32_29/6%)] disabled:opacity-20"
                      title="上移"
                      aria-label={"上移第 " + (index + 1) + " 个内容块"}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={index === note.content.length - 1}
                      onClick={() => handleMoveBlock(index, 1)}
                      className="notebook-icon-button text-[#68716d] hover:text-[#18201d] hover:bg-[rgb(24_32_29/6%)] disabled:opacity-20"
                      title="下移"
                      aria-label={"下移第 " + (index + 1) + " 个内容块"}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBlock(block.id)}
                      className="notebook-icon-button text-[#c9674a] hover:bg-[#c9674a]/10"
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
                    value={block.text}
                    onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                    placeholder="写下一段文字记录…"
                    className="notebook-textarea w-full bg-transparent font-serif text-[15.5px] sm:text-[16.5px] leading-[1.8] text-[#18201d] placeholder:text-[#68716d]/40 outline-none p-1"
                  />
                )}

                {block.type === 'image' && (
                  <div className="notebook-image-block space-y-2 pt-1">
                    <div className="notebook-image-preview relative aspect-video w-full max-w-2xl overflow-hidden rounded-[12px] bg-[#e6e4dc] flex items-center justify-center text-[#68716d]">
                      {block.src ? (
                        <LocalNoteImage
                          src={block.src}
                          alt={block.caption || '笔记图片'}
                          priority={index < 2}
                        />
                      ) : (
                        <span className="text-xs">等待选择图片</span>
                      )}
                    </div>
                    <label className="notebook-caption-field flex items-center gap-2">
                      <span className="notebook-field-label text-[11px] text-[#68716d]">说明</span>
                      <input
                        value={block.caption}
                        onChange={(e) => handleUpdateBlock(block.id, { caption: e.target.value })}
                        placeholder="为这张图片写一句说明（可选）"
                        className="notebook-caption-input w-full bg-transparent text-xs text-[#68716d] outline-none"
                      />
                    </label>
                  </div>
                )}

                {block.type === 'link' && (
                  <div className="p-3 rounded-lg bg-[rgb(24_32_29/3%)] border border-[rgb(24_32_29/8%)] space-y-2 mt-1">
                    <input
                      type="url"
                      value={block.url}
                      onChange={(e) => handleUpdateBlock(block.id, { url: e.target.value })}
                      placeholder="https://..."
                      className="w-full bg-transparent text-xs font-mono text-[#18201d] outline-none"
                    />
                    <input
                      value={block.label}
                      onChange={(e) => handleUpdateBlock(block.id, { label: e.target.value })}
                      placeholder="链接标题"
                      className="w-full bg-transparent text-xs font-semibold text-[#18201d] outline-none"
                    />
                    <textarea
                      rows={2}
                      value={block.note}
                      onChange={(e) => handleUpdateBlock(block.id, { note: e.target.value })}
                      placeholder="为什么收藏此链接？"
                      className="w-full bg-transparent text-xs text-[#68716d] outline-none"
                    />
                    {block.url.startsWith('http') && (
                      <a
                        href={block.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#b83b1b] font-medium hover:underline"
                      >
                        <span>打开链接</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}

                {block.type === 'character-reference' && (
                  <div className="p-3.5 rounded-lg bg-[#f3f1e8]/70 border-l-4 border-l-[#b83b1b] border border-[rgb(24_32_29/8%)] space-y-2 mt-1">
                    <select
                      value={block.characterId}
                      onChange={(e) =>
                        handleUpdateBlock(block.id, { characterId: e.target.value })
                      }
                      className="w-full h-8 rounded border border-[rgb(24_32_29/14%)] bg-white px-2.5 text-xs text-[#18201d] outline-none"
                    >
                      <option value="">选择资料库中的角色</option>
                      {characters.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.displayName}
                          {c.draft.work ? (" · " + c.draft.work) : ''}
                        </option>
                      ))}
                    </select>

                    {block.characterId && (
                      <div className="p-2.5 rounded bg-white/80 border border-[rgb(24_32_29/8%)] text-xs space-y-1">
                        <strong className="font-serif text-xs font-semibold text-[#18201d] block">
                          {characters.find((c) => c.id === block.characterId)?.displayName}
                        </strong>
                        <p className="text-[#68716d] line-clamp-2 text-[11px]">
                          {characters.find((c) => c.id === block.characterId)?.draft.summary ||
                            '尚未填写摘要'}
                        </p>
                        <Link
                          href={"/apps/characters/" + block.characterId}
                          className="inline-block text-[#b83b1b] font-medium hover:underline pt-0.5 text-[11px]"
                        >
                          前往角色资料库 →
                        </Link>
                      </div>
                    )}

                    <textarea
                      rows={2}
                      value={block.note}
                      onChange={(e) => handleUpdateBlock(block.id, { note: e.target.value })}
                      placeholder="这条笔记与该角色的关系（可选）"
                      className="w-full bg-transparent text-xs text-[#68716d] outline-none"
                    />
                  </div>
                )}

                {block.type === 'archive-reference' && (
                  <blockquote className="p-3.5 rounded-lg bg-[#eef0f2]/70 border-l-4 border-l-[#4d6684] border border-[rgb(24_32_29/8%)] text-xs space-y-2 mt-1">
                    <p className="font-serif text-xs sm:text-sm text-[#18201d] leading-relaxed italic">
                      “{block.quote}”
                    </p>
                    <Link
                      href={"/apps/narrative?utterance=" + encodeURIComponent(block.targetId)}
                      className="text-[#4d6684] font-semibold inline-flex items-center gap-1 hover:underline text-[11px]"
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
        <section className="notebook-add-panel p-2.5 rounded-lg border border-[rgb(24_32_29/8%)] bg-[#f7f4ee]/70 flex flex-wrap items-center justify-between gap-2" aria-label="添加内容块">
          <span className="notebook-section-kicker text-[10.5px] font-bold text-[#68716d]">
            ＋ 添加内容块
          </span>
          <div className="notebook-add-grid flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="notebook-add-button h-7 px-2.5 text-[11px] bg-white"
              onClick={() => handleAddBlock('text')}
            >
              <Plus className="h-3 w-3" />
              <span>段落文本</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="notebook-add-button h-7 px-2.5 text-[11px] bg-white"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="h-3 w-3" />
              <span>图片素材</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="notebook-add-button h-7 px-2.5 text-[11px] bg-white"
              onClick={() => handleAddBlock('link')}
            >
              <LinkIcon className="h-3 w-3" />
              <span>参考链接</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="notebook-add-button h-7 px-2.5 text-[11px] bg-white"
              onClick={() => handleAddBlock('character-reference')}
            >
              <User className="h-3 w-3" />
              <span>角色引用</span>
            </Button>
          </div>
        </section>

        {/* Layer 5: Danger Zone */}
        {effectiveNoteId && (
          <div className="notebook-delete-row pt-3 pb-8 text-center">
            <button
              type="button"
              onClick={handleDelete}
              className="text-[11px] text-[#c9674a] hover:underline cursor-pointer"
            >
              删除这条笔记
            </button>
          </div>
        )}
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
