import { Type, type Static } from '@sinclair/typebox';

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
}, { additionalProperties: false });
export type CharacterAvatarGenerationRequest = Static<typeof CharacterAvatarGenerationRequestSchema>;
