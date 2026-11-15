import { draftStorageKey } from './use-stored-draft';

export const ADOPTION_ATTEMPT_STORAGE_PREFIX = 'sthstart:story-worlds:adoption-attempt:';

export interface PersistedAdoptionAttempt {
  key: string;
  fingerprint: string;
  updatedAt: number;
}

export function adoptionAttemptStorageKey(draftKey: string) {
  return ADOPTION_ATTEMPT_STORAGE_PREFIX + draftKey;
}

export function readAdoptionAttempt(
  draftKey: string,
  storage: Pick<Storage, 'getItem'> = window.sessionStorage,
): PersistedAdoptionAttempt | null {
  try {
    const raw = storage.getItem(adoptionAttemptStorageKey(draftKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAdoptionAttempt>;
    if (typeof parsed.key !== 'string' || !parsed.key) return null;
    if (typeof parsed.fingerprint !== 'string') return null;
    return {
      key: parsed.key,
      fingerprint: parsed.fingerprint,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function persistAdoptionAttempt(
  draftKey: string,
  attempt: Pick<PersistedAdoptionAttempt, 'key' | 'fingerprint'>,
  storage: Pick<Storage, 'setItem'> = window.sessionStorage,
) {
  const envelope: PersistedAdoptionAttempt = {
    key: attempt.key,
    fingerprint: attempt.fingerprint,
    updatedAt: Date.now(),
  };
  storage.setItem(adoptionAttemptStorageKey(draftKey), JSON.stringify(envelope));
  return envelope;
}

export function clearAdoptionAttempt(
  draftKey: string,
  storage: Pick<Storage, 'removeItem'> = window.sessionStorage,
) {
  storage.removeItem(adoptionAttemptStorageKey(draftKey));
}

export function persistAdoptionDraftSnapshot<T>(
  draftKey: string,
  data: T,
  expectedRevision: number,
  storage: Pick<Storage, 'setItem'> = window.sessionStorage,
) {
  storage.setItem(draftStorageKey(draftKey), JSON.stringify({
    isDirty: true,
    data,
    expectedRevision,
    updatedAt: Date.now(),
  }));
}
