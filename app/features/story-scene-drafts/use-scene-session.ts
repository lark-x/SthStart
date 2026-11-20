'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SceneAction, PatchStorySceneDraft, StorySceneActionRequest, StorySceneDraft } from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { generateId } from '@/app/lib/uuid';
import { getSceneDraft, patchSceneDraft, runSceneAction, sceneKeys } from './api';

export type SceneEdits = Omit<PatchStorySceneDraft, 'expectedRevision'>;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'idempotencyKey' | 'expectedRevision'> : never;
export type SceneActionInput = WithoutEnvelope<StorySceneActionRequest>;
type SaveStatus = '已保存' | '保存中' | '仅保存到本机' | '有版本冲突';
type Recovery = { revision: number; edits: SceneEdits; updatedAt: number };

const hasEdits = (edits: SceneEdits) => Object.keys(edits).length > 0;
const actionMessage = (error: unknown) => error instanceof Error ? error.message : '操作暂时无法完成，请重试。';
export const sceneActionNames = {
  discover: '联想时地', 'refresh-sources': '更新参考资料', discuss: '讨论讲法', write: '写成一幕',
  'plan-image': '设计画面', 'generate-image': '生成图片', adopt: '收入作品',
} satisfies Record<SceneAction['action'], string>;

function getRecoveryPrefix(id: string) {
  return `sthstart:scene-recovery:${encodeURIComponent(id)}:`;
}

function restore(id: string): { key: string; value?: Recovery } {
  const prefix = getRecoveryPrefix(id);
  const ownKey = `${prefix}${generateId()}`;
  // Re-read this tab's copy on refresh. A fresh tab may recover the newest uncommitted copy.
  const pointer = `sthstart:scene-recovery-pointer:${id}`;
  try {
    const read = (key: string | null): Recovery | undefined => {
      if (!key?.startsWith(prefix)) return undefined;
      const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Recovery | null;
      return parsed && hasEdits(parsed.edits) ? parsed : undefined;
    };
    const previousKey = sessionStorage.getItem(pointer);
    const previous = read(previousKey);
    if (previous && previousKey) return { key: previousKey, value: previous };
    let newest: Recovery | undefined;
    for (let index = 0; index < localStorage.length; index++) {
      const item = read(localStorage.key(index));
      if (item && (!newest || item.updatedAt > newest.updatedAt)) newest = item;
    }
    sessionStorage.setItem(pointer, ownKey);
    return { key: ownKey, value: newest };
  } catch {
    return { key: ownKey };
  }
}

function record(key: string | null, revision: number, edits: SceneEdits) {
  if (!key) return;
  try {
    if (hasEdits(edits)) localStorage.setItem(key, JSON.stringify({ revision, edits, updatedAt: Date.now() } satisfies Recovery));
    else localStorage.removeItem(key);
  } catch { /* retain the in-memory copy if browser storage is unavailable */ }
}

function attemptStorage(id: string, attempt?: StorySceneActionRequest | null): StorySceneActionRequest | undefined {
  const key = `sthstart:scene-attempt:${id}`;
  try {
    if (attempt === null) sessionStorage.removeItem(key);
    else if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt));
    else return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
  } catch { /* retain the in-memory attempt when storage is unavailable */ }
}

export function useSceneSession(incoming: StorySceneDraft) {
  const id = incoming.id;
  const client = useQueryClient();
  const [server, setServer] = useState(incoming);
  const [edits, renderEdits] = useState<SceneEdits>({});
  const [status, setStatus] = useState<SaveStatus>('已保存');
  const [conflict, setConflict] = useState<StorySceneDraft | null>(null);
  const [saveError, setSaveError] = useState('');
  const [actionError, setActionError] = useState('');
  const [activeAction, setActiveAction] = useState<SceneAction['action'] | null>(null);
  const [unknownAction, setUnknownAction] = useState<StorySceneActionRequest>();
  const serverRef = useRef(incoming);
  const editsRef = useRef<SceneEdits>({});
  const revision = useRef(incoming.revision);
  const conflictRef = useRef(false);
  const recoveryKey = useRef<string | null>(null);
  const pendingSave = useRef<Promise<StorySceneDraft | null> | null>(null);
  const pendingAction = useRef(false);
  const unresolved = useRef<StorySceneActionRequest | undefined>(undefined);
  const autosave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publishEdits = useCallback((next: SceneEdits) => {
    editsRef.current = next;
    record(recoveryKey.current, revision.current, next);
    renderEdits(next);
  }, []);

  const commitServer = useCallback((next: StorySceneDraft) => {
    if (next.revision < serverRef.current.revision) return;
    serverRef.current = next;
    setServer(next);
    client.setQueryData<StorySceneDraft>(sceneKeys.detail(id), (current) => current && current.revision > next.revision ? current : next);
  }, [client, id]);

  const markConflict = useCallback((next: StorySceneDraft) => {
    const latest = next.revision < serverRef.current.revision ? serverRef.current : next;
    conflictRef.current = true;
    commitServer(latest);
    setConflict(latest);
    setStatus('有版本冲突');
  }, [commitServer]);

  const clearAttempt = useCallback(() => {
    unresolved.current = undefined;
    setUnknownAction(undefined);
    setActionError('');
    attemptStorage(id, null);
  }, [id]);

  useEffect(() => {
    const { key, value } = restore(id);
    recoveryKey.current = key;
    const attempt = attemptStorage(id);
    if (attempt) {
      if (serverRef.current.currentAction?.idempotencyKey === attempt.idempotencyKey) clearAttempt();
      else {
        unresolved.current = attempt;
        setUnknownAction(attempt);
        setActionError('请求结果暂时无法确认。可以检查原请求状态。');
      }
    }
    if (!value) return;
    revision.current = value.revision;
    publishEdits(value.edits);
    if (value.revision !== serverRef.current.revision) markConflict(serverRef.current);
    else setStatus('仅保存到本机');
  }, [clearAttempt, id, markConflict, publishEdits]);

  useEffect(() => {
    if (incoming === serverRef.current || incoming.revision < serverRef.current.revision || pendingSave.current) return;
    if (incoming.revision > revision.current && hasEdits(editsRef.current)) {
      if (pendingAction.current) return;
      markConflict(incoming);
    } else {
      revision.current = incoming.revision;
      commitServer(incoming);
    }
    if (unresolved.current && incoming.currentAction?.idempotencyKey === unresolved.current.idempotencyKey) clearAttempt();
  }, [clearAttempt, commitServer, incoming, markConflict]);

  const flush = useCallback(async function save(): Promise<StorySceneDraft | null> {
    if (autosave.current) clearTimeout(autosave.current);
    if (conflictRef.current) return null;
    if (pendingSave.current) {
      const previous = await pendingSave.current;
      return previous && hasEdits(editsRef.current) ? save() : previous;
    }
    const snapshot = editsRef.current;
    if (!hasEdits(snapshot)) return serverRef.current;
    setStatus('保存中');
    setSaveError('');
    const request = (async () => {
      try {
        const next = await patchSceneDraft(id, { ...snapshot, expectedRevision: revision.current });
        revision.current = next.revision;
        const remaining = { ...editsRef.current };
        for (const field of Object.keys(snapshot) as (keyof SceneEdits)[]) {
          if (remaining[field] === snapshot[field]) delete remaining[field];
        }
        publishEdits(remaining);
        commitServer(next);
        void client.invalidateQueries({ queryKey: sceneKeys.list });
        setStatus(hasEdits(remaining) ? '保存中' : '已保存');
        return next;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409) {
          const latest = await getSceneDraft(id).catch(() => null);
          if (latest) markConflict(latest);
          else setStatus('仅保存到本机');
        } else setStatus('仅保存到本机');
        setSaveError(actionMessage(error));
        return null;
      } finally {
        pendingSave.current = null;
      }
    })();
    pendingSave.current = request;
    const next = await request;
    return next && hasEdits(editsRef.current) ? save() : next;
  }, [client, commitServer, id, markConflict, publishEdits]);

  const edit = useCallback((patch: SceneEdits, saveSoon = true) => {
    publishEdits({ ...editsRef.current, ...patch });
    if (conflictRef.current) return;
    setStatus('保存中');
    if (autosave.current) clearTimeout(autosave.current);
    if (saveSoon) autosave.current = setTimeout(() => void flush(), 650);
  }, [flush, publishEdits]);

  useEffect(() => () => { if (autosave.current) clearTimeout(autosave.current); }, []);

  const resolveConflict = useCallback(async (keepLocal: boolean) => {
    if (!conflict) return;
    revision.current = conflict.revision;
    conflictRef.current = false;
    setConflict(null);
    setSaveError('');
    if (keepLocal) {
      publishEdits(editsRef.current);
      return flush();
    }
    publishEdits({});
    setStatus('已保存');
  }, [conflict, flush, publishEdits]);

  const act = useCallback(async (input: SceneActionInput, recover = false): Promise<SceneAction | null> => {
    if (pendingAction.current || (!recover && unresolved.current)) return null;
    pendingAction.current = true;
    setActiveAction(input.action);
    setActionError('');
    let request: StorySceneActionRequest | undefined;
    try {
      if (recover && unresolved.current) {
        request = unresolved.current;
        const latest = await getSceneDraft(id);
        if (latest.currentAction?.idempotencyKey === request.idempotencyKey) {
          if (hasEdits(editsRef.current) && latest.revision !== revision.current) markConflict(latest);
          else { revision.current = latest.revision; commitServer(latest); }
          clearAttempt();
          return latest.currentAction;
        }
      } else {
        const saved = await flush();
        if (!saved) return null;
        request = { ...input, expectedRevision: saved.revision, idempotencyKey: generateId() } as StorySceneActionRequest;
        unresolved.current = request;
        attemptStorage(id, request);
      }
      const result = await runSceneAction(id, request);
      if (result.draft.revision >= serverRef.current.revision) {
        if (request.expectedRevision !== revision.current && hasEdits(editsRef.current)) {
          markConflict(result.draft);
        } else {
          revision.current = result.draft.revision;
          record(recoveryKey.current, revision.current, editsRef.current);
          commitServer(result.draft);
        }
      }
      void client.invalidateQueries({ queryKey: sceneKeys.list });
      clearAttempt();
      return result.action;
    } catch (error) {
      const latest = await getSceneDraft(id).catch(() => null);
      if (latest) {
        const accepted = request && latest.currentAction?.idempotencyKey === request.idempotencyKey;
        if (hasEdits(editsRef.current) && latest.revision !== revision.current) markConflict(latest);
        else { revision.current = latest.revision; commitServer(latest); }
        if (accepted) {
          clearAttempt();
          return latest.currentAction;
        }
      }
      if (error instanceof ApiClientError && error.status < 500) {
        clearAttempt();
        setActionError(actionMessage(error));
      } else if (request) {
        setUnknownAction(request);
        setActionError('请求结果暂时无法确认。可以检查原请求状态。');
      } else setActionError(actionMessage(error));
      return null;
    } finally {
      pendingAction.current = false;
      setActiveAction(null);
    }
  }, [clearAttempt, client, commitServer, flush, id, markConflict]);

  return { server, edits, status, conflict, saveError, actionError, activeAction, unknownAction, edit, flush, resolveConflict, act };
}
