import type { CreativeNote, NoteBlock, NoteKind } from '@sthstart/contracts';
import { newBlock, summaryFromBlocks } from '../schemas';

export const BLOCK_LABELS: Record<NoteBlock['type'], string> = {
  text: '段落文本',
  image: '图片素材',
  link: '参考链接',
  'character-reference': '角色资料引用',
  'archive-reference': '叙事档案引用',
};

const ALLOWED_NOTE_KINDS = new Set<NoteKind>(['diary', 'idea', 'note', 'story', 'character', 'world']);

/** 新建资料时的编辑起点；每次调用生成独立块，避免多个编辑器共享可变内容。 */
export function createInitialNote(kind: NoteKind): CreativeNote {
  return {
    title: '',
    kind,
    summary: '',
    content: [newBlock('text')],
    tags: [],
    stage: 'draft',
    favorite: false,
  };
}

export function resolveInitialNoteKind(queryKind: string | null | undefined, fallback: NoteKind): NoteKind {
  return queryKind && ALLOWED_NOTE_KINDS.has(queryKind as NoteKind) ? queryKind as NoteKind : fallback;
}

/** 插入内容块；找不到锚点时追加到文末，与编辑器原行为一致。 */
export function insertContentBlock(content: NoteBlock[], block: NoteBlock, after: string | null): NoteBlock[] {
  const anchor = after === null ? -1 : content.findIndex((item) => item.id === after);
  const index = anchor < 0 ? content.length : anchor + 1;
  const next = [...content];
  next.splice(index, 0, block);
  return next;
}

export function updateContentBlock(content: NoteBlock[], id: string, patch: Partial<NoteBlock>): NoteBlock[] {
  return content.map((block) => (block.id === id ? ({ ...block, ...patch } as NoteBlock) : block));
}

/** 仅交换相邻块；越界时保持原数组，由调用方决定是否仍标记草稿。 */
export function moveContentBlock(content: NoteBlock[], index: number, direction: -1 | 1): NoteBlock[] {
  const target = index + direction;
  if (target < 0 || target >= content.length) return content;
  const next = [...content];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeContentBlock(content: NoteBlock[], id: string): NoteBlock[] {
  return content.filter((block) => block.id !== id);
}

/** 本机保存前统一标题与摘要，但不改编辑中的内存态。 */
export function noteSavePayload(note: CreativeNote, id: string): CreativeNote {
  return {
    ...note,
    id,
    title: note.title.trim() || '未命名笔记',
    summary: summaryFromBlocks(note.content),
  };
}
