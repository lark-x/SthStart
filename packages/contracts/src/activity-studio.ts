import { Type, type Static } from '@sinclair/typebox';

// Leaf contracts: do not import index.ts here (the index consumes these schemas).
export const ActivityRenderQualitySchema = Type.Union([Type.Literal('draft'), Type.Literal('final')]);
export type ActivityRenderQuality = Static<typeof ActivityRenderQualitySchema>;

export const GenerationPresetRefSchema = Type.Object({
  purpose: Type.String({ minLength: 1 }),
  presetId: Type.String({ minLength: 1 }),
  presetRevision: Type.Integer({ minimum: 1 }),
  workflowId: Type.String({ minLength: 1 }),
  workflowVersion: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type GenerationPresetRef = Static<typeof GenerationPresetRefSchema>;

export const ActivityCanvasSchema = Type.Object({
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
const RenderProfilesSchema = Type.Object({
  draft: Type.Union([GenerationPresetRefSchema, Type.Null()]),
  final: Type.Union([GenerationPresetRefSchema, Type.Null()]),
}, { additionalProperties: false });

export const ActivityArtStylePayloadSchema = Type.Object({
  schemaKind: Type.Literal('activity_art_style_v1'),
  positiveStylePrompt: Type.String({ maxLength: 20_000 }),
  negativePrompt: Type.String({ maxLength: 20_000 }),
  renderProfiles: RenderProfilesSchema,
  defaultQuality: ActivityRenderQualitySchema,
  defaultCanvas: ActivityCanvasSchema,
  previewArtifactId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
}, { additionalProperties: false });
export type ActivityArtStylePayload = Static<typeof ActivityArtStylePayloadSchema>;

export const ActivityArtDirectionSchema = Type.Object({
  selectedStyle: Type.Union([Type.Object({
    id: Type.String({ minLength: 1 }),
    version: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1 }),
    payloadSnapshot: ActivityArtStylePayloadSchema,
  }, { additionalProperties: false }), Type.Null()]),
  quality: ActivityRenderQualitySchema,
  canvas: ActivityCanvasSchema,
  renderProfiles: RenderProfilesSchema,
  parameterOverrides: Type.Object({
    draft: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    final: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type ActivityArtDirection = Static<typeof ActivityArtDirectionSchema>;

export const DirectorSettingsSchema = Type.Object({
  shotSize: Type.Optional(Type.Union([
    Type.Literal('wide'), Type.Literal('medium'), Type.Literal('closeup'),
    Type.Literal('detail'), Type.Literal('full_body'),
  ])),
  angle: Type.Optional(Type.Union([Type.Literal('eye_level'), Type.Literal('high'), Type.Literal('low')])),
  lighting: Type.Optional(Type.Union([
    Type.Literal('natural'), Type.Literal('warm'), Type.Literal('rim'), Type.Literal('low_key'),
  ])),
  mood: Type.Optional(Type.Union([
    Type.Literal('calm'), Type.Literal('tense'), Type.Literal('joyful'), Type.Literal('melancholy'),
  ])),
}, { additionalProperties: false });
export type DirectorSettings = Static<typeof DirectorSettingsSchema>;

export const ActivityArtStyleWriteSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  payload: ActivityArtStylePayloadSchema,
}, { additionalProperties: false });
export type ActivityArtStyleWrite = Static<typeof ActivityArtStyleWriteSchema>;
export const ActivityArtStyleUpdateSchema = Type.Object({
  ...ActivityArtStyleWriteSchema.properties,
  expectedVersion: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type ActivityArtStyleUpdate = Static<typeof ActivityArtStyleUpdateSchema>;

/** Distinguishes art cards from legacy production/batch presets sharing the table. */
export function isActivityArtStylePayload(value: unknown): value is ActivityArtStylePayload {
  return !!value && typeof value === 'object'
    && (value as Record<string, unknown>).schemaKind === 'activity_art_style_v1';
}
