import type { NoteBlock, NoteKind, NoteStage } from '@sthstart/contracts';
import { generateId } from '@/app/lib/uuid';

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
  const id = generateId();
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
import type { NoteNature, NoteUsage, NoteAuthorship, NoteCategory } from '@sthstart/contracts';

/** 参考资料库的三条轴与分类的展示文案，列表、详情与企划共用。 */
export const usageLabels: Record<NoteUsage, string> = {
  record: '仅记录',
  pending: '待整理',
  reference: '可参考',
};

export const natureLabels: Record<NoteNature, string> = {
  canon: '原作资料',
  community: '社区解读',
  personal: '个人设定',
  unconfirmed: '未确认',
};

export const authorshipLabels: Record<NoteAuthorship, string> = {
  handwritten: '手写',
  excerpt: '原文摘录',
  'ai-organized': 'AI 整理',
  'ai-inferred': 'AI 推断',
};

export const categoryLabels: Record<NoteCategory, string> = {
  relation: '关系',
  personality: '性格表达',
  preference: '喜好',
  location: '地点',
  plot: '剧情',
  inspiration: '灵感',
  other: '其他',
};
