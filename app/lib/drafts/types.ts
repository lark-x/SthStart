export type SaveAction<T> = (document: T, version: number) => Promise<number>;

export type SaveErrorHandler = (error: unknown, isConflict: boolean) => void;

export type SaveSuccessHandler = (version: number) => void;

export interface DraftStorageAdapter<T> {
  get(): T | null;
  set(document: T): boolean;
  remove(): void;
}

export interface DraftSaveControllerOptions {
  debounceMs?: number;
}
