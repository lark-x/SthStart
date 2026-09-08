import type { CharacterAppearance, CharacterDraft } from '@sthstart/contracts';

export const CHARACTER_PERSONA_COMPILER_VERSION = 'character-persona-v1';

export function normalizeCharacterAppearance(value: unknown): CharacterAppearance {
  if (typeof value === 'string') return { description: value.trim(), hair: '', eyes: '', build: '', outfits: [], accessories: [] };
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const list = (input: unknown) => Array.isArray(input) ? [...new Set(input.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))] : [];
  const text = (input: unknown, max = 4_000) => typeof input === 'string' ? input.trim().slice(0, max) : '';
  return {
    description: text(source.description),
    hair: text(source.hair, 1_000),
    eyes: text(source.eyes, 1_000),
    build: text(source.build, 1_000),
    outfits: list(source.outfits),
    accessories: list(source.accessories),
    ...(Array.isArray(source.stableFeatures) ? { stableFeatures: list(source.stableFeatures) } : {}),
    ...(typeof source.defaultOutfitId === 'string' || source.defaultOutfitId === null ? { defaultOutfitId: source.defaultOutfitId } : {}),
    ...(Array.isArray(source.referenceIds) ? { referenceIds: list(source.referenceIds) } : {}),
  };
}

export function buildCharacterVisualPrompt(appearanceValue: unknown, outfitOverride?: string) {
  const appearance = normalizeCharacterAppearance(appearanceValue);
  const selectedOutfit = outfitOverride?.trim() || (appearance.defaultOutfitId && appearance.outfits.includes(appearance.defaultOutfitId)
    ? appearance.defaultOutfitId : appearance.outfits[0]) || '';
  return [
    appearance.description,
    appearance.hair && `发型与发色：${appearance.hair}`,
    appearance.eyes && `眼睛：${appearance.eyes}`,
    appearance.build && `体态：${appearance.build}`,
    appearance.stableFeatures?.length ? `稳定辨识特征：${appearance.stableFeatures.join('；')}` : '',
    selectedOutfit ? `服装：${selectedOutfit}` : '',
    appearance.accessories.length ? `配饰：${appearance.accessories.join('；')}` : '',
  ].filter(Boolean).join('\n');
}

export function projectCharacterPersona(draft: CharacterDraft | Record<string, unknown>) {
  const source = draft as Record<string, unknown>;
  const appearance = normalizeCharacterAppearance(source.appearance);
  return {
    displayName: typeof source.displayName === 'string' ? source.displayName : '',
    englishName: typeof source.englishName === 'string' ? source.englishName : '',
    work: typeof source.work === 'string' ? source.work : '',
    world: typeof source.world === 'string' ? source.world : '',
    summary: typeof source.summary === 'string' ? source.summary : '',
    identity: typeof source.identity === 'string' ? source.identity : '',
    background: typeof source.background === 'string' ? source.background : '',
    personality: Array.isArray(source.personality) ? source.personality : [],
    speech: source.speech && typeof source.speech === 'object' ? source.speech : {},
    appearance,
    visualPrompt: buildCharacterVisualPrompt(appearance),
    sourceSnapshot: draft,
  };
}

export function buildAuditionPrompt(draft: CharacterDraft, scenario: string, feedback?: string) {
  return `你是严谨的角色试演编辑。请只根据下方已保存的人设和场景，输出一个 JSON 对象，不要输出 Markdown、解释或 JSON 以外的文字。

人设：
${JSON.stringify(projectCharacterPersona(draft), null, 2)}

场景：${scenario}
${feedback ? `用户反馈：${feedback}` : ''}

输出格式示例（严格遵守字段名；output 是一次 30-120 字的角色回复；suggestions 是可选的逐字段修改建议；不能新增字段）：
{
  "output": "（自然、符合人设的短回复，不替用户做决定）",
  "suggestions": [
    {
      "fieldPath": "/speech/tone",
      "before": "（当前字段原文；没有修改建议时为空字符串）",
      "after": "（建议值；没有修改建议时为空字符串）",
      "reason": "（不超过 80 字，说明为什么建议；没有修改建议时为空字符串）"
    }
  ]
}
严格只输出上述 JSON。`;
}
