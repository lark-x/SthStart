import { Type, type Static } from '@sinclair/typebox';

const id = Type.String({ minLength: 1, maxLength: 160 });
const strict = { additionalProperties: false };
export const WorldRunRecoveryCallSchema = Type.Object({
  id, stepId: id, stage: Type.String({ maxLength: 300 }), purpose: Type.String({ maxLength: 100 }),
  attempt: Type.Integer({ minimum: 0, maximum: 1 }),
  status: Type.Union([Type.Literal('submitting'), Type.Literal('uncertain')]),
  requestedAt: Type.String(), updatedAt: Type.String(), error: Type.String({ maxLength: 2000 }),
  aiCallId: Type.Union([id, Type.Null()]),
}, strict);
export type WorldRunRecoveryCall = Static<typeof WorldRunRecoveryCallSchema>;
export const WorldRunRecoveryListSchema = Type.Object({ items: Type.Array(WorldRunRecoveryCallSchema) }, strict);
export type WorldRunRecoveryList = Static<typeof WorldRunRecoveryListSchema>;
/** Human evidence is mandatory; this is not a general retry endpoint. */
export const ResolveWorldRunCallSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  resolution: Type.Union([Type.Literal('not-executed'), Type.Literal('received-result')]),
  evidence: Type.String({ minLength: 1, maxLength: 4000 }),
  responseText: Type.Optional(Type.String({ minLength: 1, maxLength: 1000000 })),
}, strict);
export type ResolveWorldRunCall = Static<typeof ResolveWorldRunCallSchema>;
export const WorldRunRecoveryResultSchema = Type.Object({
  callId: id,
  status: Type.Union([Type.Literal('confirmed-not-executed'), Type.Literal('received-result')]),
  validation: Type.Union([Type.Literal('not-applicable'), Type.Literal('validated-on-resume')]),
  branchRevision: Type.Integer({ minimum: 1 }),
}, strict);
export type WorldRunRecoveryResult = Static<typeof WorldRunRecoveryResultSchema>;
