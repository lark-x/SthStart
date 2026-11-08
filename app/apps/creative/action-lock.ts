/** Acquire before any await: React's pending render alone cannot block rapid duplicate actions. */
export function createActionLock() {
  const pending = new Set<string>();
  return {
    acquire(key: string) { if (pending.has(key)) return false; pending.add(key); return true; },
    release(key: string) { pending.delete(key); },
  };
}
