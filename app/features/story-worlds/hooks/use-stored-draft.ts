'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'sthstart:story-worlds:draft:';
const SAVE_DELAY_MS = 200;

export function draftStorageKey(key: string) {
  return STORAGE_PREFIX + key;
}

export interface StoredEnvelope<T> {
  isDirty: boolean;
  data: T;
  expectedRevision?: number;
  updatedAt: number;
}

export interface StoredDraftOptions {
  open?: boolean;
  expectedRevision?: number;
}

interface DraftContext<T> {
  draft: T;
  baseRevision: number | undefined;
  dirty: boolean;
}

function validRevision(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function embeddedRevision<T>(draft: T): number | undefined {
  if (!draft || typeof draft !== 'object') return undefined;
  return validRevision((draft as { expectedRevision?: unknown }).expectedRevision);
}

function readStored<T>(key: string): StoredEnvelope<T> | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'isDirty' in parsed && 'data' in parsed) {
      const envelope = parsed as StoredEnvelope<T>;
      if (!envelope.isDirty) {
        window.sessionStorage.removeItem(draftStorageKey(key));
        return undefined;
      }
      return envelope;
    }
    return { isDirty: true, data: parsed as T, updatedAt: Date.now() };
  } catch {
    return undefined;
  }
}

function initialContext<T>(
  key: string,
  createInitial: () => T,
  upstreamRevision: number | undefined,
): DraftContext<T> {
  const stored = readStored<T>(key);
  if (stored) {
    return {
      draft: stored.data,
      baseRevision: validRevision(stored.expectedRevision) ?? embeddedRevision(stored.data),
      dirty: true,
    };
  }
  const draft = createInitial();
  return {
    draft,
    baseRevision: embeddedRevision(draft) ?? upstreamRevision,
    dirty: false,
  };
}

function writeStored<T>(key: string, context: DraftContext<T>) {
  if (typeof window === 'undefined') return;
  try {
    if (!context.dirty) {
      window.sessionStorage.removeItem(draftStorageKey(key));
      return;
    }
    const envelope: StoredEnvelope<T> = {
      isDirty: true,
      data: context.draft,
      expectedRevision: context.baseRevision,
      updatedAt: Date.now(),
    };
    window.sessionStorage.setItem(draftStorageKey(key), JSON.stringify(envelope));
  } catch {
    return;
  }
}

export function useStoredDraft<T>(
  key: string,
  createInitial: () => T,
  options?: StoredDraftOptions,
) {
  const createInitialRef = useRef(createInitial);
  useEffect(() => {
    createInitialRef.current = createInitial;
  }, [createInitial]);
  const upstreamRevision = validRevision(options?.expectedRevision);

  const [context, setContext] = useState<DraftContext<T>>(
    () => initialContext(key, createInitial, upstreamRevision),
  );
  const contextRef = useRef(context);
  const updateContext = useCallback((next: DraftContext<T>) => {
    contextRef.current = next;
    setContext(next);
  }, []);
  const currentKeyRef = useRef(key);
  const upstreamRevisionRef = useRef(upstreamRevision);
  const revisionKeyRef = useRef(key);
  const openRef = useRef(options?.open);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerKeyRef = useRef(key);

  const persistNow = useCallback((storageName: string, next: DraftContext<T>) => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    writeStored(storageName, next);
  }, []);

  useEffect(() => {
    if (currentKeyRef.current === key) return;
    const previousKey = currentKeyRef.current;
    const previousContext = contextRef.current;
    currentKeyRef.current = key;
    revisionKeyRef.current = key;
    upstreamRevisionRef.current = upstreamRevision;
    persistNow(previousKey, previousContext);
    const stored = readStored<T>(key);
    const initial = createInitialRef.current();
    const next = stored
      ? {
          draft: stored.data,
          baseRevision: validRevision(stored.expectedRevision) ?? embeddedRevision(stored.data),
          dirty: true,
        }
      : {
          draft: initial,
          baseRevision: embeddedRevision(initial) ?? upstreamRevisionRef.current,
          dirty: false,
        };
    updateContext(next);
  }, [key, persistNow, updateContext, upstreamRevision]);

  useEffect(() => {
    if (revisionKeyRef.current !== key) {
      revisionKeyRef.current = key;
      upstreamRevisionRef.current = upstreamRevision;
      return;
    }
    const previousRevision = upstreamRevisionRef.current;
    upstreamRevisionRef.current = upstreamRevision;
    if (previousRevision === upstreamRevision) return;
    setContext((current) => {
      if (current.dirty) return current;
      if (upstreamRevision === undefined) return current;
      const next = {
        draft: createInitialRef.current(),
        baseRevision: upstreamRevision,
        dirty: false,
      };
      contextRef.current = next;
      return next;
    });
  }, [upstreamRevision, key, updateContext]);

  useEffect(() => {
    const justOpened = Boolean(options?.open && !openRef.current);
    const justClosed = Boolean(!options?.open && openRef.current);
    openRef.current = options?.open;
    if (justClosed) {
      persistNow(currentKeyRef.current, contextRef.current);
      return;
    }
    if (!justOpened) return;
    setContext((current) => {
      if (current.dirty) return current;
      const next = {
        draft: createInitialRef.current(),
        baseRevision: upstreamRevisionRef.current,
        dirty: false,
      };
      contextRef.current = next;
      return next;
    });
  }, [options?.open, persistNow, updateContext]);

  useEffect(() => {
    if (saveTimerRef.current !== null && saveTimerKeyRef.current === key) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!context.dirty) {
      writeStored(key, context);
      return;
    }
    saveTimerKeyRef.current = key;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      writeStored(key, { ...context, draft: contextRef.current.draft });
    }, SAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current !== null && saveTimerKeyRef.current === key) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [context, key]);

  useEffect(() => () => {
    persistNow(currentKeyRef.current, contextRef.current);
  }, [persistNow]);

  useEffect(() => {
    const flush = () => persistNow(currentKeyRef.current, contextRef.current);
    const flushWhenHidden = () => {
      if (window.document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    window.document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      window.document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [persistNow]);

  const setDraft = useCallback((next: T | ((current: T) => T)) => {
    setContext((current) => {
      const value = typeof next === 'function'
        ? (next as (value: T) => T)(current.draft)
        : next;
      const updated = { ...current, draft: value, dirty: true };
      contextRef.current = updated;
      return updated;
    });
  }, []);

  const rebase = useCallback((nextRevision?: number) => {
    const target = validRevision(nextRevision) ?? upstreamRevisionRef.current;
    if (target === undefined) return;
    setContext((current) => {
      const hadEmbeddedRevision = embeddedRevision(current.draft) !== undefined;
      const draft = hadEmbeddedRevision && current.draft && typeof current.draft === 'object'
        ? { ...current.draft, expectedRevision: target }
        : current.draft;
      const updated = { ...current, draft, baseRevision: target };
      contextRef.current = updated;
      return updated;
    });
  }, []);

  const clear = useCallback(() => {
    const next = {
      draft: createInitialRef.current(),
      baseRevision: upstreamRevisionRef.current,
      dirty: false,
    };
    updateContext(next);
    persistNow(key, next);
  }, [key, persistNow, updateContext]);

  return {
    draft: context.draft,
    baseRevision: context.baseRevision,
    setDraft,
    reset: clear,
    clear,
    isDirty: context.dirty,
    hasConflict: Boolean(
      context.dirty &&
      upstreamRevision !== undefined &&
      (context.baseRevision === undefined || context.baseRevision !== upstreamRevision),
    ),
    rebase,
  };
}
