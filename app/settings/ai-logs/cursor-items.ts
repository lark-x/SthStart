/** A cursor page can overlap a refreshed page; the latest copy wins without moving its row. */
export function uniqueCursorItems<T extends { id: string }>(pages: ReadonlyArray<{ items: readonly T[] }>): T[] {
  const items = new Map<string, T>();
  for (const page of pages) for (const item of page.items) items.set(item.id, item);
  return [...items.values()];
}
