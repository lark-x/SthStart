'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoryDocument, StoryEntry } from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { DraftSaveQueue } from '@/app/lib/draft-save-queue';
import { readStoryLocalDraft, removeStoryLocalDraft, writeStoryLocalDraft } from './entry-draft-store';
import { storyApi } from './api';

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'local-only' | 'conflict' | 'error';
type EntryKind = StoryDocument['kind'] | 'character';
const localKey = (projectId: string, kind: EntryKind, id: string) => `${projectId}:${kind}:${id}`;
const titleOf = (entry: StoryEntry) => 'name' in entry ? entry.name : entry.title;
const bodyOf = (entry: StoryEntry) => 'notes' in entry ? entry.notes : entry.body;

export function useStoryEntryDraft(projectId: string, entry: StoryEntry, onSaved: (entry: StoryEntry) => void,
  onConflict?: () => void) {
  const kind: EntryKind = 'name' in entry ? 'character' : entry.kind;
  const key = localKey(projectId, kind, entry.id);
  const queue = useRef(new DraftSaveQueue<{ title: string; body: string }>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseRevision = useRef(entry.revision);
  const values = useRef({ title: titleOf(entry), body: bodyOf(entry) });
  const initializing = useRef(true);
  const [title, setTitle] = useState(titleOf(entry));
  const [body, setBody] = useState(bodyOf(entry));
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);

  useEffect(() => {
    baseRevision.current = entry.revision;
    values.current = { title: titleOf(entry), body: bodyOf(entry) };
    queue.current.document = values.current;
    queue.current.version = entry.revision;
    queue.current.dirty = false;
    queue.current.blocked = false;
    setTitle(values.current.title);
    setBody(values.current.body);
    setStatus('saved');
    setError('');
    setRecoveryAvailable(false);
    let active = true;
    initializing.current = true;
    void readStoryLocalDraft(key).then((saved) => {
      if (!active || !saved) return;
      if (saved.title !== values.current.title || saved.body !== values.current.body) setRecoveryAvailable(true);
    }).catch(() => {}).finally(() => { initializing.current = false; });
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
  // Each entry identity is a new editor. Same-entry query refreshes are handled through onSaved below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (entry.revision === baseRevision.current) return;
    if (queue.current.dirty) {
      queue.current.blocked = true;
      setStatus('conflict');
      setError('服务器版本已变化。本地文字仍保留；请比较服务器与本机内容后再决定。');
      return;
    }
    baseRevision.current = entry.revision;
    values.current = { title: titleOf(entry), body: bodyOf(entry) };
    queue.current.document = values.current;
    queue.current.version = entry.revision;
    setTitle(values.current.title); setBody(values.current.body);
    setStatus('saved'); setError('');
  }, [entry]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (initializing.current) return false;
    const saved = await queue.current.flush(async (snapshot, expectedRevision) => {
      setStatus('saving');
      setError('');
      const updated = kind === 'character'
        ? await storyApi.updateCharacter(projectId, entry.id, { expectedRevision, name: snapshot.title.trim(), notes: snapshot.body })
        : await storyApi.updateDocument(projectId, entry.id, { expectedRevision, title: snapshot.title.trim(), body: snapshot.body });
      baseRevision.current = updated.revision;
      onSaved(updated);
      if (snapshot === values.current) await removeStoryLocalDraft(key).catch(() => {});
      return updated.revision;
    }, (cause) => {
      const conflict = cause instanceof ApiClientError && cause.status === 409;
      setStatus(conflict ? 'conflict' : 'local-only');
      setError(conflict ? '服务器内容已变化。你的本地文本已保留；先比较两边，再决定如何处理。' : '服务器暂不可用，文本仅保存在本机 IndexedDB。恢复连接后可重试。');
      if (conflict) onConflict?.();
    });
    if (saved) { setStatus('saved'); setError(''); }
    setDirty(queue.current.dirty);
    return saved;
  }, [entry.id, kind, key, onConflict, onSaved, projectId]);

  const update = useCallback((next: { title?: string; body?: string }) => {
    values.current = { ...values.current, ...next };
    queue.current.document = values.current;
    queue.current.dirty = true;
    setDirty(true);
    setTitle(values.current.title);
    setBody(values.current.body);
    setStatus('dirty');
    setError('');
    setRecoveryAvailable(false);
    void writeStoryLocalDraft({ key, projectId, entryKind: kind, entryId: entry.id,
      expectedRevision: baseRevision.current, ...values.current, updatedAt: Date.now() }).catch(() => {
      setError('本机草稿存储不可用；请勿关闭页面，先复制正文。');
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 600);
  }, [entry.id, flush, key, kind, projectId]);

  const recoverLocal = useCallback(async () => {
    const local = await readStoryLocalDraft(key);
    if (!local) { setRecoveryAvailable(false); return; }
    values.current = { title: local.title, body: local.body };
    setTitle(local.title); setBody(local.body);
    queue.current.document = values.current; queue.current.dirty = true;
    setDirty(true);
    setRecoveryAvailable(false);
    if (local.expectedRevision !== entry.revision) {
      queue.current.blocked = true;
      setStatus('conflict');
      setError(`本机草稿基于 v${local.expectedRevision}，服务器当前为 v${entry.revision}。已恢复本机文本但未自动覆盖；请先查看服务器版本。`);
      return;
    }
    queue.current.blocked = false;
    queue.current.version = entry.revision; baseRevision.current = entry.revision;
    setStatus('dirty'); setError('已恢复本机未同步文本；将重新保存。');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 600);
  }, [entry.revision, flush, key]);

  const discardLocal = useCallback(async () => {
    await removeStoryLocalDraft(key).catch(() => {});
    queue.current.document = values.current; queue.current.dirty = false; queue.current.blocked = false;
    setDirty(false);
    setRecoveryAvailable(false); setStatus('saved'); setError('');
  }, [key]);

  const acceptServer = useCallback(async (serverEntry: StoryEntry) => {
    await removeStoryLocalDraft(key).catch(() => {});
    queue.current.document = { title: titleOf(serverEntry), body: bodyOf(serverEntry) };
    queue.current.version = serverEntry.revision; queue.current.dirty = false; queue.current.blocked = false;
    setDirty(false);
    baseRevision.current = serverEntry.revision;
    values.current = queue.current.document;
    setTitle(values.current.title); setBody(values.current.body);
    setStatus('saved'); setError(''); setRecoveryAvailable(false);
  }, [key]);

  const retry = useCallback(() => {
    queue.current.blocked = false;
    queue.current.version = baseRevision.current;
    void flush();
  }, [flush]);

  const saveLocalOverServer = useCallback((serverRevision: number) => {
    queue.current.blocked = false;
    queue.current.version = serverRevision;
    baseRevision.current = serverRevision;
    queue.current.dirty = true;
    setDirty(true);
    void flush();
  }, [flush]);

  return { title, body, status, error, dirty, recoveryAvailable,
    update, flush, recoverLocal, discardLocal, acceptServer, retry, saveLocalOverServer };
}

export function storyEntryIdentity(entry: StoryEntry) {
  return { kind: 'name' in entry ? 'character' as const : entry.kind, id: entry.id };
}
