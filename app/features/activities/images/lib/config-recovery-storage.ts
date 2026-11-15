import type { ImageConfigDocument } from '@sthstart/contracts';
import { parseImageConfigRecovery, type ImageConfigRecovery } from '../model/config-recovery';

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Browser persistence stays outside the pure recovery parser. */
export function readImageConfigRecovery(key: string, storage: Storage | null = browserSessionStorage()): ImageConfigRecovery | null {
  if (!storage) return null;
  try {
    return parseImageConfigRecovery(storage.getItem(key));
  } catch {
    return null;
  }
}

export function writeImageConfigRecovery(
  key: string,
  value: { version: number; baseline: string; document: ImageConfigDocument },
  storage: Storage | null = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch { /* Optional browser recovery must not block editing. */ }
}

export function clearImageConfigRecovery(key: string, storage: Storage | null = browserSessionStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch { /* Optional browser recovery must not block editing. */ }
}

export function configRecoveryKey(activityId: string): string {
  return `sthstart:activity-image-config-editor:${activityId}`;
}
