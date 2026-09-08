import type { CharacterDraft } from '@sthstart/contracts';

export const EMPTY_DRAFT: CharacterDraft = {
  displayName: '', englishName: '', aliases: [], originType: 'original', work: '', world: '', summary: '',
  identity: '', background: '', currentSituation: '', personality: [], motivations: [], beliefs: [], secrets: [],
  speech: { tone: '', habits: '', catchphrases: [], examples: [] }, likes: [], dislikes: [], fears: [], boundaries: [],
  appearance: { description: '', hair: '', eyes: '', build: '', outfits: [], accessories: [] }, extraRules: '',
};

export function text(value: unknown, max = 20_000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
export function list(value: unknown, maxItems = 30) {
  return Array.isArray(value) ? [...new Set(value.map((item) => text(item, 1_000)).filter(Boolean))].slice(0, maxItems) : [];
}

export function normalizeCharacterDraft(raw: unknown): CharacterDraft {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const speech = source.speech && typeof source.speech === 'object' ? source.speech as Record<string, unknown> : {};
  const appearance = source.appearance && typeof source.appearance === 'object' ? source.appearance as Record<string, unknown> : {};
  return {
    ...EMPTY_DRAFT,
    displayName: text(source.displayName, 200), englishName: text(source.englishName, 200), aliases: list(source.aliases),
    originType: source.originType === 'ip' ? 'ip' : 'original', work: text(source.work, 300), world: text(source.world, 300),
    summary: text(source.summary, 2_000), identity: text(source.identity), background: text(source.background),
    currentSituation: text(source.currentSituation), personality: list(source.personality), motivations: list(source.motivations),
    beliefs: list(source.beliefs), secrets: list(source.secrets),
    speech: { tone: text(speech.tone, 4_000), habits: text(speech.habits, 4_000), catchphrases: list(speech.catchphrases), examples: Array.isArray(speech.examples) ? speech.examples.map((item) => text(item, 40_000)).filter(Boolean).slice(0, 30) : [] },
    likes: list(source.likes), dislikes: list(source.dislikes), fears: list(source.fears), boundaries: list(source.boundaries),
    appearance: {
      description: typeof source.appearance === 'string' ? text(source.appearance) : text(appearance.description), hair: text(appearance.hair, 1_000), eyes: text(appearance.eyes, 1_000),
      build: text(appearance.build, 1_000), outfits: list(appearance.outfits), accessories: list(appearance.accessories),
      ...(Array.isArray(appearance.stableFeatures) ? { stableFeatures: list(appearance.stableFeatures) } : {}),
      ...(typeof appearance.defaultOutfitId === 'string' || appearance.defaultOutfitId === null ? { defaultOutfitId: appearance.defaultOutfitId } : {}),
      ...(Array.isArray(appearance.referenceIds) ? { referenceIds: list(appearance.referenceIds) } : {}),
    },
    extraRules: text(source.extraRules), ...(text(source.legacyPrompt) ? { legacyPrompt: text(source.legacyPrompt) } : {}),
  };
}
