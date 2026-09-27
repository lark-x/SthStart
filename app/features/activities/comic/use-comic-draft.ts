'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComicDocument } from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { DraftSaveQueue } from '@/app/lib/draft-save-queue';
import { useCreateComicDraft, useSaveComicDraft } from '../mutations';
import { useComicDraftRecord } from '../queries';

type SaveStatus = 'loading' | 'saved' | 'saving' | 'conflict' | 'error';
const backupKey = (activityId: string) => `sthstart:activity-comic-draft:${activityId}`;

export function useComicDraft(activityId: string, contentRevisionId: string) {
  const query = useComicDraftRecord(activityId);
  const { mutateAsync: createDraft } = useCreateComicDraft();
  const { mutateAsync: saveDraft } = useSaveComicDraft();
  const queue = useRef(new DraftSaveQueue<ComicDocument>());
  const versionRef = useRef<number | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializing = useRef(false);
  const [document, setDocument] = useState<ComicDocument | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState<string | null>(null);

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
    if (!incoming || queue.current.dirty || pending.current) return;
    queue.current.document = incoming.document;
    queue.current.version = incoming.draftVersion;
    versionRef.current = incoming.draftVersion;
    setVersion(incoming.draftVersion);
    setDocument(incoming.document);
    try {
      const raw = sessionStorage.getItem(backupKey(activityId));
      if (raw && raw !== JSON.stringify(incoming.document)) {
        const recovered = JSON.parse(raw) as ComicDocument;
        if (recovered.schemaVersion === 1 && recovered.contentRevisionId === incoming.document.contentRevisionId && Array.isArray(recovered.pages) && Array.isArray(recovered.panels)) {
          queue.current.document = recovered;
          queue.current.dirty = true;
          queue.current.blocked = true;
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
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) return pending.current;
    if (queue.current.blocked) return false;
    if (!queue.current.dirty || !queue.current.document || queue.current.version < 1) return true;
    pending.current = (async () => {
      setStatus('saving');
      setError(null);
      const saved = await queue.current.flush(async (snapshot, expectedDraftVersion) => {
        const result = await saveDraft({ activityId, expectedDraftVersion, document: snapshot });
        versionRef.current = result.draftVersion;
        setVersion(result.draftVersion);
        return result.draftVersion;
      }, (reason) => {
        const conflict = (reason instanceof ApiClientError && reason.status === 409) || (reason instanceof Error && /conflict/i.test(reason.message));
        setStatus(conflict ? 'conflict' : 'error');
        setError(conflict ? '服务器漫画草稿已更新。你的输入仍保留；处理冲突前不会继续保存。' : '漫画保存失败，你的输入已保留。可以稍后重试。');
      });
      if (!saved) return false;
      try { sessionStorage.removeItem(backupKey(activityId)); } catch { /* optional recovery */ }
      setStatus('saved');
      return true;
    })().finally(() => { pending.current = null; });
    return pending.current;
  }, [activityId, saveDraft]);

  const update = useCallback((next: ComicDocument) => {
    queue.current.document = next;
    queue.current.dirty = true;
    setDocument(next);
    setStatus('saving');
    setError(null);
    try { sessionStorage.setItem(backupKey(activityId), JSON.stringify(next)); } catch { /* in-memory draft remains available */ }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 600);
  }, [activityId, flush]);

  const resolveConflict = useCallback((keepLocal: boolean) => {
    const incoming = query.data;
    if (!incoming) return;
    queue.current.version = incoming.draftVersion;
    versionRef.current = incoming.draftVersion;
    queue.current.blocked = false;
    setVersion(incoming.draftVersion);
    setError(null);
    if (keepLocal && queue.current.document) {
      queue.current.dirty = true;
      setStatus('saving');
      void flush();
      return;
    }
    queue.current.document = incoming.document;
    queue.current.dirty = false;
    setDocument(incoming.document);
    setStatus('saved');
    try { sessionStorage.removeItem(backupKey(activityId)); } catch { /* optional recovery */ }
  }, [activityId, flush, query.data]);

  const retry = useCallback(() => {
    queue.current.blocked = false;
    void flush();
  }, [flush]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.current.dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  return { document, version, status, error: error ?? (query.error instanceof Error ? query.error.message : null),
    loading: query.isLoading || (query.isSuccess && query.data === null), update, flush,
    getCurrentVersion: () => versionRef.current, resolveConflict, retry };
}
