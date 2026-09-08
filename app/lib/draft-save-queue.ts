/** Coalesces edits arriving during a request and serializes versioned writes. */
export class DraftSaveQueue<T> {
  document: T | null = null;
  version = 1;
  dirty = false;
  blocked = false;
  private pending: Promise<boolean> | null = null;
  get saving() { return this.pending !== null; }
  flush(save: (document: T, version: number) => Promise<number>, onError: (error: unknown) => void): Promise<boolean> {
    if (this.pending) return this.pending;
    if (this.blocked) return Promise.resolve(false);
    this.pending = (async () => {
      while (this.dirty && this.document !== null) {
        const snapshot = this.document;
        try {
          this.version = await save(snapshot, this.version);
          this.dirty = snapshot !== this.document;
        } catch (error) {
          this.blocked = true;
          onError(error);
          return false;
        }
      }
      return true;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}
