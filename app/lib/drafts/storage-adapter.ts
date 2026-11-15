import type { DraftStorageAdapter } from './types';

function getSessionStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {}
  return null;
}

function getLocalStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  return null;
}

export function createSessionStorageAdapter<T>(
  key: string,
  validate?: (raw: unknown) => boolean,
  storageInstance?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): DraftStorageAdapter<T> {
  const store = storageInstance !== undefined ? storageInstance : getSessionStorage();
  return {
    get(): T | null {
      if (!store) return null;
      try {
        const raw = store.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (validate && !validate(parsed)) return null;
        return parsed as T;
      } catch {
        return null;
      }
    },
    set(document: T): boolean {
      if (!store) return false;
      try {
        store.setItem(key, JSON.stringify(document));
        return true;
      } catch {
        return false;
      }
    },
    remove(): void {
      if (!store) return;
      try {
        store.removeItem(key);
      } catch {}
    },
  };
}

export function createLocalStorageAdapter<T>(
  key: string,
  validate?: (raw: unknown) => boolean,
  storageInstance?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): DraftStorageAdapter<T> {
  const store = storageInstance !== undefined ? storageInstance : getLocalStorage();
  return {
    get(): T | null {
      if (!store) return null;
      try {
        const raw = store.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (validate && !validate(parsed)) return null;
        return parsed as T;
      } catch {
        return null;
      }
    },
    set(document: T): boolean {
      if (!store) return false;
      try {
        store.setItem(key, JSON.stringify(document));
        return true;
      } catch {
        return false;
      }
    },
    remove(): void {
      if (!store) return;
      try {
        store.removeItem(key);
      } catch {}
    },
  };
}
