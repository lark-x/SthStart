import { Type, type Static } from '@sinclair/typebox';
import { CharacterAssetCategorySchema } from './character-assets.js';

export const CharacterUpstreamSourceIdSchema = Type.Union([
  Type.Literal('yatta'),
  Type.Literal('starrailres'),
  Type.Literal('mihoyo-obc'),
  Type.Literal('bwiki'),
  Type.Literal('akasha-mcp'),
  Type.Literal('moegirl'),
  Type.Literal('fandom'),
  Type.Literal('enka'),
]);
export type CharacterUpstreamSourceId = Static<typeof CharacterUpstreamSourceIdSchema>;

export const CharacterVariantKindSchema = Type.Union([
  Type.Literal('stage'),
  Type.Literal('sp'),
  Type.Literal('form'),
]);
export type CharacterVariantKind = Static<typeof CharacterVariantKindSchema>;

export const CharacterUpstreamSkinProposalSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  /** variant = 崩坏三装甲 / 星铁 SP 等独立阶段形态；skin = 纯换装多皮肤。 */
  classification: Type.Union([Type.Literal('variant'), Type.Literal('skin')]),
  variantKind: Type.Optional(CharacterVariantKindSchema),
  /** 服装描述（用于视觉生成与提示词拼接）。 */
  outfitDescription: Type.String(),
  /** 皮肤/形态的背景故事（用于展示与故事推演参考）。 */
  loreStory: Type.String(),
  avatarUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  portraitUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  source: Type.String(),
  isDefault: Type.Optional(Type.Boolean()),
  selected: Type.Boolean(),
});
export type CharacterUpstreamSkinProposal = Static<typeof CharacterUpstreamSkinProposalSchema>;

export const CharacterUpstreamAssetCandidateSchema = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal('avatar'), Type.Literal('portrait'), Type.Literal('reference')]),
  category: CharacterAssetCategorySchema,
  title: Type.String(),
  url: Type.String(),
  previewUrl: Type.Optional(Type.String()),
  source: Type.String(),
  skinName: Type.Optional(Type.String()),
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  recommended: Type.Optional(Type.Boolean()),
});
export type CharacterUpstreamAssetCandidate = Static<typeof CharacterUpstreamAssetCandidateSchema>;

export const CharacterUpstreamResearchRequestSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  work: Type.Optional(Type.String()),
  characterId: Type.Optional(Type.String()),
  includeSkins: Type.Optional(Type.Boolean()),
  includeVariants: Type.Optional(Type.Boolean()),
  includeVoiceLines: Type.Optional(Type.Boolean()),
  preferSources: Type.Optional(Type.Array(CharacterUpstreamSourceIdSchema)),
});
export type CharacterUpstreamResearchRequest = Static<typeof CharacterUpstreamResearchRequestSchema>;

export const CharacterUpstreamEvidenceSourceSchema = Type.Object({
  title: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  excerpt: Type.String(),
  sourceType: Type.String(),
  /** Display excerpts may be abbreviated; rawText/rawPayload preserve the complete retrieved evidence. */
  rawText: Type.Optional(Type.String()),
  rawPayload: Type.Optional(Type.Unknown()),
  provider: Type.Optional(Type.String()),
  externalId: Type.Optional(Type.String()),
  contentHash: Type.Optional(Type.String()),
  retrievedAt: Type.Optional(Type.String()),
  evidenceKind: Type.Optional(Type.Union([Type.Literal('fulltext'), Type.Literal('structured'), Type.Literal('snippet')])),
});
export type CharacterUpstreamEvidenceSource = Static<typeof CharacterUpstreamEvidenceSourceSchema>;

export const CharacterUpstreamApplyFieldsSchema = Type.Object({
  summary: Type.Optional(Type.Boolean()),
  personaText: Type.Optional(Type.Boolean()),
  speechText: Type.Optional(Type.Boolean()),
  dialogueExamples: Type.Optional(Type.Boolean()),
  behaviorRules: Type.Optional(Type.Boolean()),
  appearance: Type.Optional(Type.Boolean()),
  tags: Type.Optional(Type.Boolean()),
});
export type CharacterUpstreamApplyFields = Static<typeof CharacterUpstreamApplyFieldsSchema>;

export const CharacterUpstreamSelectedAssetImportSchema = Type.Object({
  kind: Type.Union([Type.Literal('avatar'), Type.Literal('portrait'), Type.Literal('reference')]),
  category: Type.Optional(CharacterAssetCategorySchema),
  title: Type.Optional(Type.String()),
  url: Type.String(),
  source: Type.Optional(Type.String()),
  setAsActive: Type.Optional(Type.Boolean()),
  registerReference: Type.Optional(Type.Boolean()),
  skinName: Type.Optional(Type.String()),
  outfitDescription: Type.Optional(Type.String()),
  loreStory: Type.Optional(Type.String()),
});
export type CharacterUpstreamSelectedAssetImport = Static<typeof CharacterUpstreamSelectedAssetImportSchema>;

/**
 * 展示层统一剥离 `【MCP角色索引】...` 等机器索引前缀，避免污染阅读视图或反复写入正文。
 */
export function stripMachineCharacterIndex(text: string): string {
  if (!text) return '';
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      if (/^\s*【MCP角色索引】/.test(line)) return [];
      const cleaned = line.replace(/【MCP角色索引】[^\n]*/g, '').trimEnd();
      return line.trim() && !cleaned.trim() ? [] : [cleaned];
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
