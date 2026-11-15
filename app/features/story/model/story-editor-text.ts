export interface HeadingEntry { line: number; text: string; depth: number }

export function findHeadings(body: string): HeadingEntry[] {
  return body.split('\n').flatMap((line, index) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    return match ? [{ line: index, text: match[2]!, depth: match[1]!.length }] : [];
  });
}

export function lineStartOffset(body: string, line: number) {
  return body.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0);
}

export function wrapSelection(body: string, start: number, end: number, prefix: string, suffix = '') {
  const selected = body.slice(start, end);
  const content = selected || (suffix ? '文本' : '');
  const replacement = `${prefix}${content}${suffix}`;
  return {
    body: `${body.slice(0, start)}${replacement}${body.slice(end)}`,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + content.length,
  };
}

export function appendSnippet(body: string, prefix: string, suffix = '') {
  const separator = body.endsWith('\n') || !body ? '' : '\n';
  return `${body}${separator}${prefix}${suffix}`;
}

export function formatChineseIndentation(body: string) {
  return body.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (/^(#{1,6}\s|```|[-*+]\s|\d+\.\s|>)/.test(trimmed)) return trimmed;
    return `\u3000\u3000${trimmed.replace(/^[\s\u3000]+/, '')}`;
  }).join('\n');
}

/** Finds an @ mention that should open the cast picker at the given caret. */
export function findMentionTrigger(value: string, caret: number): { anchor: number; query: string } | null {
  const textBeforeCaret = value.slice(0, caret);
  const lastAtIndex = textBeforeCaret.lastIndexOf('@');
  if (lastAtIndex === -1 || lastAtIndex < textBeforeCaret.length - 10) return null;
  const charBeforeAt = lastAtIndex > 0 ? textBeforeCaret[lastAtIndex - 1] : '\n';
  if (!/[\s\n，。！？；：“”"]/.test(charBeforeAt || '')) return null;
  const query = textBeforeCaret.slice(lastAtIndex + 1);
  if (/[\s\n]/.test(query)) return null;
  return { anchor: lastAtIndex, query };
}

export function completeDialogue(body: string, anchor: number, caret: number, name: string) {
  const before = body.slice(0, anchor);
  const after = body.slice(caret);
  const template = `${name}：“”`;
  return { body: `${before}${template}${after}`, caret: before.length + template.length - 1 };
}

export type ScriptLine =
  | { kind: 'blank' }
  | { kind: 'scene'; text: string }
  | { kind: 'dialogue'; speaker: string; dialogue: string }
  | { kind: 'narration'; text: string };

export function parseScriptBody(body: string): ScriptLine[] {
  return body.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { kind: 'blank' } as const;
    if (/^#{1,3}\s+(.+)$/.test(trimmed) || trimmed.startsWith('场景：') || trimmed.startsWith('场景:')) {
      return { kind: 'scene', text: trimmed.replace(/^#{1,3}\s+/, '') } as const;
    }
    const dialogue = /^([^：“:「\n]{1,16})[：“:「]\s*(.+?)[”」"]?\s*$/.exec(trimmed);
    if (dialogue) return { kind: 'dialogue', speaker: dialogue[1]!.trim(), dialogue: dialogue[2]!.trim() } as const;
    return { kind: 'narration', text: trimmed } as const;
  });
}
