'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentDocument } from '@sthstart/contracts';
import { saveDraft } from '../api';
import { ApiClientError } from '@/app/lib/api-client';
import { DraftSaveQueue } from '@/app/lib/draft-save-queue';

/** One writer per mounted editor. Refetches never replace pending input. */
export function useStudioDraft(id: string, incoming?: { document: ContentDocument; draftVersion: number }) {
  const [document, setDocument] = useState<ContentDocument | null>(null);
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'>('saved');
  const [error, setError] = useState<string | null>(null);
  const state = useRef(new DraftSaveQueue<ContentDocument>());
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backupKey = `sthstart:activity-draft:${id}`;

  useEffect(() => {
    if (!incoming || state.current.dirty || pending.current) return;
    state.current.document = incoming.document;
    state.current.version = incoming.draftVersion;
    setDocument(incoming.document);
    try {
      const raw = sessionStorage.getItem(backupKey);
      if (raw && raw !== JSON.stringify(incoming.document)) {
        const recovered = JSON.parse(raw) as ContentDocument;
        if (recovered.schemaVersion === 1 && Array.isArray(recovered.stages)) {
          state.current.document = recovered;
          state.current.dirty = true;
          state.current.blocked = true;
          setDocument(recovered);
          setStatus('conflict');
          setError('已找回离开前未保存的输入，请与服务器草稿比较后继续。');
        }
      }
    } catch { /* unavailable device storage does not block editing */ }
  }, [incoming, backupKey]);

  function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) return pending.current;
    if (state.current.blocked) return Promise.resolve(false);
    pending.current = (async () => {
      setStatus('saving');
      setError(null);
      const saved = await state.current.flush(async (snapshot, version) => {
        const result = await saveDraft(id, version, snapshot);
        return result.draftVersion;
      }, (err) => {
        const message = err instanceof Error ? err.message : String(err);
        const conflict = (err instanceof ApiClientError && err.status === 409) || message.includes('conflict');
        setStatus(conflict ? 'conflict' : 'error');
        setError(conflict ? '服务器草稿已更新。你的输入仍保留在此页面。' : '保存失败，你的输入已保留。请重试。');
      });
      if (!saved) return false;
      try { sessionStorage.removeItem(backupKey); } catch { /* optional recovery */ }
      setStatus('saved');
      return true;
    })().finally(() => { pending.current = null; });
    return pending.current;
  }

  function update(next: ContentDocument) {
    state.current.document = next;
    state.current.dirty = true;
    setDocument(next);
    if (!state.current.blocked) setStatus('unsaved');
    try { sessionStorage.setItem(backupKey, JSON.stringify(next)); } catch { /* retain in memory */ }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  }

  function resolve(server: { document: ContentDocument; draftVersion: number }, keepLocal: boolean) {
    state.current.version = server.draftVersion;
    state.current.blocked = false;
    setError(null);
    if (keepLocal && state.current.document) { update(state.current.document); return; }
    state.current.document = server.document;
    state.current.dirty = false;
    setDocument(server.document);
    setStatus('saved');
    try { sessionStorage.removeItem(backupKey); } catch { /* optional recovery */ }
  }

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (state.current.dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { if (timer.current) clearTimeout(timer.current); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  return { document, status, error, update, flush, resolve, version: () => state.current.version,
    retry: () => { state.current.blocked = false; void flush(); } };
}
