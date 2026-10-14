import { Type, type Static } from '@sinclair/typebox';
import { ActivityLoraSchema } from './activities.js';
import { KnowledgeHitSchema, RemovedTagDiagnosticSchema } from './activity-image-prompts.js';

export const ImageContextSelectionSchema = Type.Object({
  characters: Type.Optional(Type.Array(Type.Object({
    characterId: Type.String({ minLength: 1 }),
    draftRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    outfitOverride: Type.Optional(Type.String({ maxLength: 4000 })),
  }, { additionalProperties: false }), { maxItems: 8 })),
  noteIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 12 })),
}, { additionalProperties: false });
export type ImageContextSelection = Static<typeof ImageContextSelectionSchema>;

/** Managed public generation only consumes the server-authorized purpose graph. */
export const ManagedImageOptionsSchema = Type.Object({
  version: Type.Literal(1),
  loras: Type.Array(ActivityLoraSchema, { maxItems: 32 }),
}, { additionalProperties: false });
export type ManagedImageOptions = Static<typeof ManagedImageOptionsSchema>;

export const ImagePreparationDiagnosticsSchema = Type.Object({
  knowledgeMode: Type.Union([Type.Literal('none'), Type.Literal('keyword'), Type.Literal('hybrid')]),
  knowledgeVersion: Type.Union([Type.String(), Type.Null()]),
  knowledgeHits: Type.Array(KnowledgeHitSchema),
  removedTags: Type.Array(RemovedTagDiagnosticSchema),
  contextSources: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), revision: Type.String(), hash: Type.String() })),
  loras: Type.Array(ActivityLoraSchema),
  warnings: Type.Array(Type.String()),
});

export const ImageGenerationSelectionSchema = Type.Object({
  appId: Type.Union([Type.Literal('creative-center'), Type.Literal('characters')]),
  purpose: Type.String({ minLength: 1, maxLength: 80 }),
  presetId: Type.Optional(Type.String({ minLength: 1 })),
  presetRevision: Type.Optional(Type.Integer({ minimum: 1 })),
});
export const ImagePreparationRequestSchema = Type.Composite([
  ImageGenerationSelectionSchema,
  Type.Object({
    description: Type.String({ minLength: 1, maxLength: 10000 }),
    ai: Type.Boolean(),
    manualFinal: Type.Optional(Type.Boolean()),
    context: Type.Optional(ImageContextSelectionSchema),
    parameters: Type.Record(Type.String(), Type.Unknown()),
    idempotencyKey: Type.String({ minLength: 8, maxLength: 200 }),
  }),
], { additionalProperties: false });
export type ImagePreparationRequest = Static<typeof ImagePreparationRequestSchema>;
export const ImagePreparationResponseSchema = Type.Object({
  originalDescription: Type.String(),
  positivePrompt: Type.String(),
  negativePrompt: Type.Union([Type.String(), Type.Null()]),
  parameters: Type.Record(Type.String(), Type.Unknown()),
  configurationHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  promptMode: Type.Union([Type.Literal('service-finalized-v1'), Type.Literal('workflow-internal')]),
  optimizerCallId: Type.Union([Type.String(), Type.Null()]),
  warnings: Type.Array(Type.String()),
  contextHash: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
  preparationId: Type.Optional(Type.String()),
  diagnostics: Type.Optional(ImagePreparationDiagnosticsSchema),
});
export type ImagePreparationResponse = Static<typeof ImagePreparationResponseSchema>;
export const CharacterAvatarGenerationRequestSchema = Type.Object({
  idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 200 })),
  prompt: Type.Optional(Type.String({ maxLength: 10000 })),
  seed: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 2147483647 }), Type.Null()])),
  presetId: Type.Optional(Type.String({ minLength: 1 })),
  presetRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  configurationHash: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
  optimizerCallId: Type.Optional(Type.String()),
  sourceDescription: Type.Optional(Type.String({ maxLength: 10000 })),
  preparationId: Type.Optional(Type.String()),
  contextHash: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
}, { additionalProperties: false });
export type CharacterAvatarGenerationRequest = Static<typeof CharacterAvatarGenerationRequestSchema>;
