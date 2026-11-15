'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { CreativeNote, NoteKind } from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { generateId } from '@/app/lib/uuid';
import { notebookKeys } from '@/app/lib/query-keys';
import { useNoteDetail } from '../queries';
import { useLocalNotebookNote } from '../hooks';
import {
  getLocalNote,
  localAssetId,
  saveLocalNote,
  subscribeNotebookLocalChanges,
} from '../local-store';
import { syncPendingNotebookData } from '../sync';
import { createInitialNote, noteSavePayload, resolveInitialNoteKind } from '../model/note-content';

export interface NoteDraftSessionOptions {
  noteId?: string;
  initialKind?: NoteKind;
  standalone?: boolean;
  onPersisted?: (id: string) => void;
}

/**
 * 笔记编辑会话：本机优先的草稿、自动保存、缓存、卸载落盘与后台同步接入。
 * 不负责内容块视图操作，也不并入 Story 的版本化保存流程。
 */
export function useNoteDraftSession({
  noteId,
  initialKind = 'note',
  standalone = true,
  onPersisted,
}: NoteDraftSessionOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const resolvedInitialKind = resolveInitialNoteKind(searchParams?.get('kind'), initialKind);
  const [note, setNote] = useState<CreativeNote>(() => createInitialNote(resolvedInitialKind));
  const [effectiveNoteId] = useState(() => noteId ?? generateId());
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const [online, setOnline] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const hydratedRef = useRef(!noteId);
  const editVersionRef = useRef(0);
  const saveRequestRef = useRef(0);

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
    const payload = noteSavePayload(note, effectiveNoteId);
    try {
      const record = await saveLocalNote(payload);
      if (editVersionRef.current === editVersion) {
        updateNoteCaches(record.note);
        dirtyRef.current = false;
        setDirty(false);
      }
      if (mountedRef.current && !noteId && standalone) router.replace('/apps/notebook/' + effectiveNoteId);
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

  const updateNoteState = useCallback((updater: (prev: CreativeNote) => CreativeNote) => {
    editVersionRef.current += 1;
    dirtyRef.current = true;
    setNote((prev) => updater(prev));
    setDirty(true);
  }, []);

  const markClean = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const retrySync = useCallback(() => {
    void syncPendingNotebookData(queryClient, { force: true, noteId: effectiveNoteId });
  }, [queryClient, effectiveNoteId]);

  return {
    note,
    setNote,
    effectiveNoteId,
    dirty,
    savingLocal,
    online,
    errorMessage,
    setErrorMessage,
    localRecord,
    localNoteLoaded,
    detailFailed,
    refetchDetail,
    editorReady,
    updateNoteState,
    updateNoteCaches,
    persistLocal,
    handleSave,
    markClean,
    retrySync,
  };
}
