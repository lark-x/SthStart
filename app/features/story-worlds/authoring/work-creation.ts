import type { WorkNature } from '@sthstart/contracts';

export const QUICK_CREATE_STORAGE_KEY = 'sthstart:story-worlds:quick-create';
export type WorkCreationValues = { title: string; workNature: WorkNature; parentWork: string | null };
export type WorkCreationAttempt = WorkCreationValues & { key: string };

export function normalizeWorkCreation(value: WorkCreationValues): WorkCreationValues {
  return {
    title: value.title.trim(), workNature: value.workNature,
    parentWork: value.workNature === 'derivative' ? value.parentWork?.trim() || null : null,
  };
}

export function parseWorkCreationAttempt(raw: string | null): WorkCreationAttempt | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    // Older title-only attempts cannot safely recover a work's nature. Leave
    // the old idempotency key unused rather than replaying it as an original.
    if (!value || typeof value.title !== 'string' || typeof value.key !== 'string' || !value.key
      || !['canon', 'derivative', 'original'].includes(value.workNature)
      || (value.parentWork !== null && typeof value.parentWork !== 'string')) return null;
    return { ...normalizeWorkCreation(value), key: value.key };
  } catch { return null; }
}

export function workCreationAttempt(previous: WorkCreationAttempt | null, values: WorkCreationValues, createKey: () => string): WorkCreationAttempt {
  const normalized = normalizeWorkCreation(values);
  const matches = previous && previous.title === normalized.title && previous.workNature === normalized.workNature
    && previous.parentWork === normalized.parentWork;
  return { ...normalized, key: matches ? previous.key : createKey() };
}
