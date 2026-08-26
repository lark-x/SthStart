export type NoteKind = 'diary' | 'idea' | 'note' | 'story' | 'character' | 'world';
export type NoteStage = 'draft' | 'reference' | 'story-candidate';

export type NoteBlock =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; src: string; caption: string }
  | { id: string; type: 'link'; url: string; label: string; note: string }
  | { id: string; type: 'character-reference'; characterId: string; note: string }
  | { id: string; type: 'archive-reference'; workId: string; targetType: 'utterance'; targetId: string; quote: string; locator: string };

export interface CreativeNote {
  id?: string;
  title: string;
  kind: NoteKind;
  summary: string;
  content: NoteBlock[];
  tags: string[];
  stage: NoteStage;
  favorite: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const kindLabels: Record<NoteKind, string> = {
  diary: '日记', idea: '灵感', note: '随记', story: '剧情素材', character: '角色设定', world: '世界资料',
};

export const stageLabels: Record<NoteStage, string> = {
  draft: '草稿', reference: '资料', 'story-candidate': '剧情候选',
};

export function newBlock(type: NoteBlock['type']): NoteBlock {
  const id = crypto.randomUUID();
  if (type === 'image') return { id, type, src: '', caption: '' };
  if (type === 'link') return { id, type, url: '', label: '', note: '' };
  if (type === 'character-reference') return { id, type, characterId: '', note: '' };
  if (type === 'archive-reference') return { id, type, workId: '', targetType: 'utterance', targetId: '', quote: '', locator: '' };
  return { id, type, text: '' };
}
