/** Opaque, stable descending (timestamp, id) cursor. */
export function encodeListCursor(time: string, id: string): string {
  return Buffer.from(JSON.stringify([time, id])).toString('base64url');
}
export function decodeListCursor(value?: string): [string, string] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(v => typeof v === 'string' && v.length > 0)) return parsed as [string, string];
  } catch { /* Invalid input is rejected by the route, never interpolated into SQL. */ }
  throw new Error('invalid_list_cursor');
}
