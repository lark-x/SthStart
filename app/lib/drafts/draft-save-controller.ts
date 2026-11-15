import { ApiClientError } from '@/app/lib/api-client';
import { DraftSaveQueue } from '@/app/lib/draft-save-queue';
import type { DraftSaveControllerOptions, SaveAction, SaveErrorHandler, SaveSuccessHandler } from './types';

export function isConflictError(error: unknown): boolean {
  if (error instanceof ApiClientError && error.status === 409) return true;
  if (error && typeof error === 'object') {
    const candidate = error as { status?: unknown; message?: unknown };
    if (candidate.status === 409) return true;
    if (typeof candidate.message === 'string' && /conflict/i.test(candidate.message)) return true;
  }
  if (typeof error === 'string' && /conflict/i.test(error)) return true;
  return false;
}

export function attachBeforeUnload(isDirty: () => boolean): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: BeforeUnloadEvent) => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', handler);
  return () => {
    window.removeEventListener('beforeunload', handler);
  };
}

export class DraftSaveController<T> {
  readonly queue: DraftSaveQueue<T>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<boolean> | null = null;
  private defaultDebounceMs: number;

  constructor(options?: DraftSaveControllerOptions) {
    this.queue = new DraftSaveQueue<T>();
    this.defaultDebounceMs = options?.debounceMs ?? 600;
  }

  get document(): T | null {
    return this.queue.document;
  }

  set document(doc: T | null) {
    this.queue.document = doc;
  }

  get version(): number {
    return this.queue.version;
  }

  set version(v: number) {
    this.queue.version = v;
  }

  get dirty(): boolean {
    return this.queue.dirty;
  }

  set dirty(d: boolean) {
    this.queue.dirty = d;
  }

  get blocked(): boolean {
    return this.queue.blocked;
  }

  set blocked(b: boolean) {
    this.queue.blocked = b;
  }

  get saving(): boolean {
    return this.pending !== null || this.queue.saving;
  }

  get pendingPromise(): Promise<boolean> | null {
    return this.pending;
  }

  isClean(): boolean {
    return !this.queue.dirty && !this.queue.blocked && !this.saving;
  }

  cancelSchedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  schedule(callback: () => void, delayMs: number = this.defaultDebounceMs): void {
    this.cancelSchedule();
    this.timer = setTimeout(() => {
      this.timer = null;
      callback();
    }, delayMs);
  }

  unblock(): void {
    this.queue.blocked = false;
  }

  flush(
    save: SaveAction<T>,
    onError: SaveErrorHandler,
    options?: {
      onStart?: () => void;
      onSuccess?: SaveSuccessHandler;
    }
  ): Promise<boolean> {
    this.cancelSchedule();
    if (this.pending) return this.pending;
    if (this.queue.blocked) return Promise.resolve(false);
    // A clean flush is a successful no-op; it must not leave the UI in "saving".
    if (!this.queue.dirty || this.queue.document === null) return Promise.resolve(true);

    this.pending = (async () => {
      options?.onStart?.();
      let latestVersion: number | null = null;
      const ok = await this.queue.flush(
        async (snapshot, version) => {
          const nextVersion = await save(snapshot, version);
          latestVersion = nextVersion;
          return nextVersion;
        },
        (error) => {
          const conflict = isConflictError(error);
          onError(error, conflict);
        }
      );
      if (ok && latestVersion !== null) {
        options?.onSuccess?.(latestVersion);
      }
      return ok;
    })().finally(() => {
      this.pending = null;
    });

    return this.pending;
  }

  dispose(): void {
    this.cancelSchedule();
  }
}
