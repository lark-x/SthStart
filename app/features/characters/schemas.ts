import type { CharacterDraftV2 } from '@sthstart/contracts';

export const splitLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((item) => item.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

/** 新建角色的默认草稿：V2 是唯一可编辑形态。 */
export const EMPTY_DRAFT_V2: CharacterDraftV2 = {
  schemaVersion: 2,
  displayName: '',
  englishName: '',
  aliases: [],
  originType: 'original',
  work: '',
  summary: '',
  personaText: '',
  speechText: '',
  dialogueExamples: [],
  behaviorRules: '',
  appearance: { baseText: '', defaultOutfitText: '' },
  birthday: { status: 'unset', calendar: 'unknown' },
};

export const joinLines = (value: string[] = []): string => value.join('\n');

export const splitCommas = (value: string): string[] =>
  value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const joinCommas = (value: string[] = []): string => value.join('，');

