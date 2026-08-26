import type { NoteBlock, NoteKind, NoteStage } from '@sthstart/contracts';

export const kindLabels: Record<NoteKind, string> = {
  diary: '日记',
  idea: '灵感',
  note: '随记',
  story: '剧情素材',
  character: '角色设定',
  world: '世界资料',
};

export const stageLabels: Record<NoteStage, string> = {
  draft: '草稿',
  reference: '资料',
  'story-candidate': '剧情候选',
};

export function newBlock(type: NoteBlock['type']): NoteBlock {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  if (type === 'image') return { id, type, src: '', caption: '' };
  if (type === 'link') return { id, type, url: '', label: '', note: '' };
  if (type === 'character-reference') return { id, type, characterId: '', note: '' };
  if (type === 'archive-reference')
    return { id, type, workId: '', targetType: 'utterance', targetId: '', quote: '', locator: '' };
  return { id, type, text: '' };
}

export function summaryFromBlocks(blocks: NoteBlock[]): string {
  return blocks
    .filter((block): block is Extract<NoteBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 180);
}
