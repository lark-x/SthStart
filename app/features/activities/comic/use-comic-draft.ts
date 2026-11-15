'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComicDocument } from '@sthstart/contracts';
import {
  DraftSaveController,
  createSessionStorageAdapter,
  attachBeforeUnload,
} from '@/app/lib/drafts';
import { useCreateComicDraft, useSaveComicDraft } from '@/app/features/activities/mutations/comic';
import { useComicDraftRecord } from '@/app/features/activities/queries/comic';

type SaveStatus = 'loading' | 'saved' | 'saving' | 'conflict' | 'error';
const backupKey = (activityId: string) => `sthstart:activity-comic-draft:${activityId}`;

export function useComicDraft(activityId: string, contentRevisionId: string) {
  const query = useComicDraftRecord(activityId);
  const { mutateAsync: createDraft } = useCreateComicDraft();
  const { mutateAsync: saveDraft } = useSaveComicDraft();
  const controller = useRef(new DraftSaveController<ComicDocument>());
  const versionRef = useRef<number | null>(null);
  const initializing = useRef(false);
  const [document, setDocument] = useState<ComicDocument | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const storage = useRef(createSessionStorageAdapter<ComicDocument>(backupKey(activityId)));

  useEffect(() => {
    storage.current = createSessionStorageAdapter<ComicDocument>(backupKey(activityId));
  }, [activityId]);

  useEffect(() => {
    if (!query.isSuccess || query.data !== null || initializing.current || !contentRevisionId) return;
    initializing.current = true;
    void createDraft({ activityId, contentRevisionId }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '创建漫画草稿失败。');
      setStatus('error');
    }).finally(() => { initializing.current = false; });
  }, [activityId, contentRevisionId, createDraft, query.data, query.isSuccess]);

  useEffect(() => {
    const incoming = query.data;
    const ctrl = controller.current;
    if (!incoming || ctrl.dirty || ctrl.saving) return;
    ctrl.document = incoming.document;
    ctrl.version = incoming.draftVersion;
    versionRef.current = incoming.draftVersion;
    setVersion(incoming.draftVersion);
    setDocument(incoming.document);
    try {
      const recovered = storage.current.get();
      if (recovered && JSON.stringify(recovered) !== JSON.stringify(incoming.document)) {
        if (
          recovered.schemaVersion === 1 &&
          recovered.contentRevisionId === incoming.document.contentRevisionId &&
          Array.isArray(recovered.pages) &&
          Array.isArray(recovered.panels)
        ) {
          ctrl.document = recovered;
          ctrl.dirty = true;
          ctrl.blocked = true;
          setDocument(recovered);
          setStatus('conflict');
          setError('已恢复上次离开前的漫画输入。比较后选择保留本地或使用服务器版本。');
          return;
        }
      }
    } catch { /* malformed or unavailable session recovery should not block the server draft */ }
    setStatus('saved');
  }, [activityId, contentRevisionId, query.data]);

  const flush = useCallback(async () => {
    const ctrl = controller.current;
    ctrl.cancelSchedule();
    if (ctrl.pendingPromise) return ctrl.pendingPromise;
    if (ctrl.blocked) return false;
    if (!ctrl.dirty || !ctrl.document || ctrl.version < 1) return true;
    return ctrl.flush(
      async (snapshot, expectedDraftVersion) => {
        const result = await saveDraft({ activityId, expectedDraftVersion, document: snapshot });
        versionRef.current = result.draftVersion;
        setVersion(result.draftVersion);
        return result.draftVersion;
      },
      (_reason, conflict) => {
        setStatus(conflict ? 'conflict' : 'error');
        setError(conflict ? '服务器漫画草稿已更新。你的输入仍保留；处理冲突前不会继续保存。' : '漫画保存失败，你的输入已保留。可以稍后重试。');
      },
      {
        onStart: () => {
          setStatus('saving');
          setError(null);
        },
        onSuccess: () => {
          storage.current.remove();
          setStatus('saved');
        },
      }
    );
  }, [activityId, saveDraft]);

  const update = useCallback((next: ComicDocument) => {
    const ctrl = controller.current;
    ctrl.document = next;
    ctrl.dirty = true;
    setDocument(next);
    setStatus('saving');
    setError(null);
    storage.current.set(next);
    ctrl.schedule(() => { void flush(); }, 600);
  }, [flush]);

  const resolveConflict = useCallback((keepLocal: boolean) => {
    const incoming = query.data;
    if (!incoming) return;
    const ctrl = controller.current;
    ctrl.version = incoming.draftVersion;
    versionRef.current = incoming.draftVersion;
    ctrl.unblock();
    setVersion(incoming.draftVersion);
    setError(null);
    if (keepLocal && ctrl.document) {
      ctrl.dirty = true;
      setStatus('saving');
      void flush();
      return;
    }
    ctrl.document = incoming.document;
    ctrl.dirty = false;
    setDocument(incoming.document);
    setStatus('saved');
    storage.current.remove();
  }, [flush, query.data]);

  const retry = useCallback(() => {
    controller.current.unblock();
    void flush();
  }, [flush]);

  useEffect(() => {
    const current = controller.current;
    const detach = attachBeforeUnload(() => current.dirty);
    return () => { current.dispose(); detach(); };
  }, []);

  return {
    document,
    version,
    status,
    error: error ?? (query.error instanceof Error ? query.error.message : null),
    loading: query.isLoading || (query.isSuccess && query.data === null),
    update,
    flush,
    getCurrentVersion: () => versionRef.current,
    resolveConflict,
    retry,
  };
}
