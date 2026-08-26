import type { CharacterDraft } from '@sthstart/contracts';

export const EMPTY_DRAFT: CharacterDraft = {
  displayName: '',
  englishName: '',
  aliases: [],
  originType: 'original',
  work: '',
  world: '',
  summary: '',
  identity: '',
  background: '',
  currentSituation: '',
  personality: [],
  motivations: [],
  beliefs: [],
  secrets: [],
  speech: {
    tone: '',
    habits: '',
    catchphrases: [],
    examples: [],
  },
  likes: [],
  dislikes: [],
  fears: [],
  boundaries: [],
  appearance: {
    description: '',
    hair: '',
    eyes: '',
    build: '',
    outfits: [],
    accessories: [],
  },
  extraRules: '',
};

export const splitLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((item) => item.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

export const joinLines = (value: string[] = []): string => value.join('\n');

export const splitCommas = (value: string): string[] =>
  value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const joinCommas = (value: string[] = []): string => value.join('，');

