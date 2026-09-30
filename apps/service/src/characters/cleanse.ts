/**
 * 清洗角色数据中的富文本与残留 HTML 标签（如原神/外部源的 <span style="...">、<br/> 等）
 */
export function cleanseHtmlText(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanseCharacterDraft<T>(obj: T): T {
  if (typeof obj === 'string') {
    return cleanseHtmlText(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanseCharacterDraft(item)) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = cleanseCharacterDraft(v);
    }
    return res as unknown as T;
  }
  return obj;
}
