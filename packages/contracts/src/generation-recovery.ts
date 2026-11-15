import { Type, type Static } from '@sinclair/typebox';

export const GenerationRecoveryTaskStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('submitting'),
  Type.Literal('accepted'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('abandoned'),
]);
export type GenerationRecoveryTaskStatus = Static<typeof GenerationRecoveryTaskStatusSchema>;

export const GenerationRecoveryProgressSchema = Type.Object({
  value: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
  stage: Type.String(),
  message: Type.Optional(Type.String()),
  current: Type.Optional(Type.Number({ minimum: 0 })),
  total: Type.Optional(Type.Number({ minimum: 0 })),
  source: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type GenerationRecoveryProgress = Static<typeof GenerationRecoveryProgressSchema>;

/** Public, UI-facing view of a task whose upstream outcome still needs review. */
export const GenerationRecoveryTaskSchema = Type.Object({
  id: Type.String(),
  appId: Type.String(),
  engineId: Type.String(),
  workflowId: Type.String(),
  workflowVersion: Type.Number(),
  purpose: Type.String(),
  status: GenerationRecoveryTaskStatusSchema,
  priority: Type.Optional(Type.Union([
    Type.Literal('interactive'), Type.Literal('normal'), Type.Literal('background'),
  ])),
  progress: Type.Optional(GenerationRecoveryProgressSchema),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  upstreamMayContinue: Type.Boolean(),
  cancellationScope: Type.Union([
    Type.Literal('none'), Type.Literal('queued'), Type.Literal('local-tracking'),
  ]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  finishedAt: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
export type GenerationRecoveryTask = Static<typeof GenerationRecoveryTaskSchema>;

export const GenerationRecoveryListQuerySchema = Type.Object({
  appId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
}, { additionalProperties: false });
export type GenerationRecoveryListQuery = Static<typeof GenerationRecoveryListQuerySchema>;

export const GenerationRecoveryListResponseSchema = Type.Object({
  items: Type.Array(GenerationRecoveryTaskSchema),
  total: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type GenerationRecoveryListResponse = Static<typeof GenerationRecoveryListResponseSchema>;

/** The operator must state that the provider was checked; `note` is required. */
export const GenerationRecoveryResolveRequestSchema = Type.Object({
  confirmed: Type.Literal(true),
  outcome: Type.Union([Type.Literal('cancelled'), Type.Literal('failed')]),
  note: Type.String({ minLength: 1, maxLength: 500 }),
  appId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false });
export type GenerationRecoveryResolveRequest = Static<typeof GenerationRecoveryResolveRequestSchema>;

export const GenerationRecoveryResolveResponseSchema = Type.Object({
  task: GenerationRecoveryTaskSchema,
}, { additionalProperties: false });
export type GenerationRecoveryResolveResponse = Static<typeof GenerationRecoveryResolveResponseSchema>;
