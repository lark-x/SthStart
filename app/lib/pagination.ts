/** Pure pagination helpers shared by lists and selectors. Pages are one-based. */
export function positiveInteger(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function getPagination(total: number, page: number, pageSize: number) {
  const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const safeSize = positiveInteger(pageSize, 20);
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeSize));
  const safePage = Math.min(positiveInteger(page), pageCount);
  return {
    total: safeTotal, page: safePage, pageSize: safeSize, pageCount,
    start: safeTotal ? (safePage - 1) * safeSize + 1 : 0,
    end: Math.min(safePage * safeSize, safeTotal),
  };
}

export type PaginationToken = number | 'ellipsis-start' | 'ellipsis-end';
export function getPageNumbers(page: number, pageCount: number): PaginationToken[] {
  const count = positiveInteger(pageCount);
  const current = Math.min(positiveInteger(page), count);
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const start = Math.max(2, Math.min(current - 1, count - 4));
  const end = Math.min(count - 1, Math.max(current + 1, 5));
  const pages: PaginationToken[] = [1];
  if (start > 2) pages.push('ellipsis-start');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < count - 1) pages.push('ellipsis-end');
  pages.push(count);
  return pages;
}
