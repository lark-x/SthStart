'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorldAuthoringDraft } from '@sthstart/contracts';
import {
  WORLD_AUTHORING_STORAGE_PREFIX,
  branchFieldsChanged,
  createEnvelope,
  newIdempotencyKey,
  parseAuthoringEnvelope,
  restoreBranchDraft,
  stashBranchDraft,
  storageKeyFor,
  type AuthoringSuggestionRecord,
  type BranchFieldDraft,
  type ServerBranchSnapshot,
  type WorldAuthoringEnvelope,
} from './model';

const WRITE_DELAY_MS = 200;

function read(key: string): WorldAuthoringEnvelope | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseAuthoringEnvelope(window.sessionStorage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + key));
  } catch {
    return null;
  }
}

function write(key: string, envelope: WorldAuthoringEnvelope) {
  if (typeof window === 'undefined') return;
  try {
    if (!envelope.isDirty) {
      window.sessionStorage.removeItem(WORLD_AUTHORING_STORAGE_PREFIX + key);
      return;
    }
    window.sessionStorage.setItem(WORLD_AUTHORING_STORAGE_PREFIX + key, JSON.stringify(envelope));
  } catch {
  }
}

export type AuthoringConflictKind =
  | 'world-stale'
  | 'branch-stale'
  | 'branch-switched'
  | 'missing-base'
  | null;

export interface AuthoringSessionOptions {
  worldId?: string;
  branchId?: string;
  /** 当前分支在服务端的值；用于区分“改过”与“本来如此”，并保存分支草稿。 */
  serverBranch?: ServerBranchSnapshot;
  initialValues: WorldAuthoringDraft;
  baseRevision?: number;
  branchRevision?: number;
  /** 服务端数据就绪前不落草稿，避免空草稿覆盖已存内容。 */
  ready?: boolean;
}

export interface AuthoringSession {
  values: WorldAuthoringDraft;
  isDirty: boolean;
  hasConflict: boolean;
  conflictKind: AuthoringConflictKind;
  restoredFromLegacy: boolean;
  branchSwitched: boolean;
  /** 切走的分支上确有未保存输入；页面据此提示作者那些内容仍保留。 */
  switchedFromBranchId: string | null;
  clearBranchSwitched: () => void;
  baseRevision?: number;
  branchRevision?: number;
  idempotencyKey: string;
  attemptedFingerprint?: string;
  suggestion: AuthoringSuggestionRecord | null;
  branchDrafts: Record<string, BranchFieldDraft>;
  update: (mutator: (current: WorldAuthoringDraft) => WorldAuthoringDraft) => void;
  replaceValues: (next: WorldAuthoringDraft) => void;
  /** 读取最新草稿（不经渲染），用于请求期间对比晚到的编辑。 */
  getValues: () => WorldAuthoringDraft;
  setSuggestion: (record: AuthoringSuggestionRecord | null) => void;
  /** 发请求前调用：先同步落盘，再返回实际使用的幂等键。 */
  beginCreateAttempt: (fingerprint: string) => string;
  rotateIdempotencyKey: () => string;
  markSaved: (snapshot: {
    values: WorldAuthoringDraft;
    baseRevision?: number;
    branchRevision?: number;
    keepDirty?: boolean;
  }) => void;
  rebaseTo: (next: { baseRevision?: number; branchRevision?: number }) => void;
  discard: () => void;
  flush: () => void;
}

/**
 * 世界配置页的编辑信封。比共享 useStoredDraft 多保存分支字段、基准修订、幂等键与建议；
 * strict definition 里绝不写入 expectedRevision，基准只存在信封上。
 */
export function useAuthoringSession(options: AuthoringSessionOptions): AuthoringSession {
  const key = storageKeyFor(options.worldId);

  const initialEnvelope = useMemo<WorldAuthoringEnvelope>(
    () => createEnvelope(options.initialValues, {
      branchId: options.branchId,
      baseRevision: options.baseRevision,
      branchRevision: options.branchRevision,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [envelope, setEnvelope] = useState<WorldAuthoringEnvelope>(initialEnvelope);
  const [restoredFromLegacy, setRestoredFromLegacy] = useState(false);
  const [branchSwitched, setBranchSwitched] = useState(false);
  const [switchedFromBranchId, setSwitchedFromBranchId] = useState<string | null>(null);
  const latestRef = useRef<WorldAuthoringEnvelope>(initialEnvelope);
  const keyRef = useRef(key);
  const readyRef = useRef(Boolean(options.ready));

  useEffect(() => {
    readyRef.current = Boolean(options.ready);
  }, [options.ready]);

  /** 唯一写入点：先更新权威引用，再落盘，最后才排 React 渲染。 */
  const commit = useCallback((next: WorldAuthoringEnvelope, persist: 'immediate' | 'defer' = 'defer') => {
    latestRef.current = next;
    if (persist === 'immediate') write(keyRef.current, next);
    setEnvelope(next);
  }, []);

  const flush = useCallback(() => {
    if (!readyRef.current) return;
    write(keyRef.current, latestRef.current);
  }, []);

  useEffect(() => {
    const stored = read(keyRef.current);
    if (!stored?.isDirty) return;
    const sameBranch = !options.branchId || !stored.branchId || stored.branchId === options.branchId;
    const next: WorldAuthoringEnvelope = sameBranch
      ? stored
      : {
        ...stored,
        branchDrafts: stashBranchDraft(stored, stored.branchId),
        branchId: options.branchId,
        branchRevision: options.branchRevision,
        values: {
          definition: stored.values.definition,
          initialBranch: restoreBranchDraft(
            stashBranchDraft(stored, stored.branchId),
            options.branchId,
            options.serverBranch ?? options.initialValues.initialBranch,
          ),
        },
      };
    latestRef.current = next;
    setEnvelope(next);
    setRestoredFromLegacy(Boolean(stored.legacy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevReadyRef = useRef(false);
  useEffect(() => {
    if (!options.ready) {
      prevReadyRef.current = false;
      return;
    }
    const justReady = !prevReadyRef.current;
    prevReadyRef.current = true;
    const current = latestRef.current;

    const switched =
      options.branchId !== undefined &&
      current.branchId !== undefined &&
      options.branchId !== current.branchId;
    if (switched) {
      const branchDrafts = stashBranchDraft(
        current,
        current.branchId,
        Date.now(),
        !current.serverBranch,
      );
      const hadPendingBranchInput = Boolean(
        current.branchId && branchDrafts?.[current.branchId],
      );
      setBranchSwitched(hadPendingBranchInput);
      setSwitchedFromBranchId(hadPendingBranchInput ? current.branchId ?? null : null);
      const restored = restoreBranchDraft(
        branchDrafts,
        options.branchId,
        options.serverBranch ?? options.initialValues.initialBranch,
      );
      const restoredIsStashed = Boolean(options.branchId && branchDrafts?.[options.branchId]);
      commit({
        ...current,
        branchDrafts,
        serverBranch: options.serverBranch,
        branchId: options.branchId,
        branchRevision: restoredIsStashed
          ? branchDrafts?.[options.branchId!]?.branchRevision
          : options.branchRevision,
        values: {
          definition: current.values.definition,
          initialBranch: restored,
        },
      });
      return;
    }

    if (options.serverBranch && current.serverBranch?.revision !== options.serverBranch.revision) {
      commit({
        ...current,
        serverBranch: options.serverBranch,
      });
    }

    if (current.isDirty) return;

    const upstreamNewer =
      (options.baseRevision !== undefined &&
        (current.baseRevision === undefined || options.baseRevision > current.baseRevision)) ||
      (options.branchRevision !== undefined &&
        (current.branchRevision === undefined || options.branchRevision > current.branchRevision));
    if (!justReady && !upstreamNewer) return;

    commit({
      ...current,
      isDirty: false,
      branchId: options.branchId ?? current.branchId,
      baseRevision: options.baseRevision ?? current.baseRevision,
      branchRevision: options.branchRevision ?? current.branchRevision,
      serverBranch: options.serverBranch ?? current.serverBranch,
      values: options.initialValues,
    });
  }, [
    options.ready, options.baseRevision, options.branchRevision, options.branchId,
    options.initialValues, options.serverBranch, commit,
  ]);

  useEffect(() => {
    if (!options.ready) return;
    if (!envelope.isDirty) {
      write(key, envelope);
      return;
    }
    const timer = setTimeout(() => write(key, envelope), WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [envelope, key, options.ready]);

  useEffect(() => {
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);

  const update = useCallback((mutator: (current: WorldAuthoringDraft) => WorldAuthoringDraft) => {
    const current = latestRef.current;
    commit({
      ...current,
      isDirty: true,
      updatedAt: Date.now(),
      values: mutator(current.values),
    });
  }, [commit]);

  const replaceValues = useCallback((next: WorldAuthoringDraft) => {
    const current = latestRef.current;
    commit({ ...current, isDirty: true, updatedAt: Date.now(), values: next });
  }, [commit]);

  const getValues = useCallback(() => latestRef.current.values, []);

  const setSuggestion = useCallback((record: AuthoringSuggestionRecord | null) => {
    const current = latestRef.current;
    commit({ ...current, suggestion: record, updatedAt: Date.now() });
  }, [commit]);

  /**
   * 创建请求发出前调用：内容变了就换键，并且先同步落盘再返回。
   * 页面必须使用返回的键发请求，保证“落盘的键”与“实际请求”一致。
   */
  const beginCreateAttempt = useCallback((fingerprint: string) => {
    const current = latestRef.current;
    const changed = current.attemptedFingerprint !== undefined
      && current.attemptedFingerprint !== fingerprint;
    const next: WorldAuthoringEnvelope = {
      ...current,
      idempotencyKey: changed ? newIdempotencyKey() : current.idempotencyKey,
      attemptedFingerprint: fingerprint,
      updatedAt: Date.now(),
    };
    commit(next, 'immediate');
    return next.idempotencyKey;
  }, [commit]);

  const rotateIdempotencyKey = useCallback(() => {
    const current = latestRef.current;
    const next = newIdempotencyKey();
    commit({ ...current, idempotencyKey: next, updatedAt: Date.now() }, 'immediate');
    return next;
  }, [commit]);

  const markSaved = useCallback((snapshot: {
    values: WorldAuthoringDraft;
    baseRevision?: number;
    branchRevision?: number;
    keepDirty?: boolean;
  }) => {
    const current = latestRef.current;
    commit({
      ...current,
      isDirty: snapshot.keepDirty ?? false,
      updatedAt: Date.now(),
      baseRevision: snapshot.baseRevision ?? current.baseRevision,
      branchRevision: snapshot.branchRevision ?? current.branchRevision,
      attemptedFingerprint: undefined,
      values: snapshot.values,
      suggestion: null,
    }, 'immediate');
  }, [commit]);

  const rebaseTo = useCallback((next: { baseRevision?: number; branchRevision?: number }) => {
    const current = latestRef.current;
    commit({
      ...current,
      baseRevision: next.baseRevision ?? current.baseRevision,
      branchRevision: next.branchRevision ?? current.branchRevision,
      updatedAt: Date.now(),
    });
  }, [commit]);

  const discard = useCallback(() => {
    commit(createEnvelope(options.initialValues, {
      branchId: options.branchId,
      baseRevision: options.baseRevision,
      branchRevision: options.branchRevision,
    }), 'immediate');
  }, [commit, options.initialValues, options.branchId, options.baseRevision, options.branchRevision]);

  const clearBranchSwitched = useCallback(() => setBranchSwitched(false), []);

  const branchFieldsDiffer = branchFieldsChanged(envelope.values, options.serverBranch);
  const baseMissing = Boolean(options.ready && options.worldId && envelope.baseRevision === undefined);
  const branchBaseMissing = Boolean(
    options.ready && options.worldId && options.branchId &&
    envelope.branchRevision === undefined && branchFieldsDiffer,
  );
  const baseStale = Boolean(
    envelope.isDirty && envelope.baseRevision !== undefined &&
    options.baseRevision !== undefined && options.baseRevision > envelope.baseRevision,
  );
  const branchStale = Boolean(
    envelope.isDirty && envelope.branchRevision !== undefined &&
    options.branchRevision !== undefined && options.branchRevision > envelope.branchRevision,
  );
  const branchMismatch = Boolean(
    envelope.isDirty && options.branchId !== undefined &&
    envelope.branchId !== undefined && options.branchId !== envelope.branchId,
  );
  const hasConflict = Boolean(
    envelope.isDirty && (baseStale || branchStale || baseMissing || branchBaseMissing || branchMismatch),
  );
  const conflictKind: AuthoringConflictKind = !envelope.isDirty
    ? null
    : baseStale
      ? 'world-stale'
      : branchStale
        ? 'branch-stale'
        : branchMismatch
          ? 'branch-switched'
          : baseMissing || branchBaseMissing
            ? 'missing-base'
            : null;

  return {
    values: envelope.values,
    isDirty: envelope.isDirty,
    hasConflict,
    conflictKind,
    restoredFromLegacy,
    branchSwitched,
    switchedFromBranchId,
    clearBranchSwitched,
    baseRevision: envelope.baseRevision,
    branchRevision: envelope.branchRevision,
    idempotencyKey: envelope.idempotencyKey,
    attemptedFingerprint: envelope.attemptedFingerprint,
    suggestion: envelope.suggestion ?? null,
    branchDrafts: envelope.branchDrafts ?? {},
    update,
    replaceValues,
    getValues,
    setSuggestion,
    beginCreateAttempt,
    rotateIdempotencyKey,
    markSaved,
    rebaseTo,
    discard,
    flush,
  };
}
