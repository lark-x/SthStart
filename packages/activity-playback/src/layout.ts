/**
 * Calculates reading duration in milliseconds based on text length and grapheme count.
 * Formula: clamp(1200 + graphemeCount / 6 * 1000, 1800, 12000) ms.
 */
export function estimateReadingTimeMs(text: string): number {
  if (!text) return 1800;
  // Segmenter or code points for accurate grapheme count (including emoji & CJK)
  const graphemeCount = Array.from(text).length;
  const rawMs = 1200 + (graphemeCount / 6) * 1000;
  return Math.min(12000, Math.max(1800, Math.round(rawMs)));
}

/**
 * Escapes HTML characters to prevent XSS in composition output.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
