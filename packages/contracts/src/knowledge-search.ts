import { Type, type Static } from '@sinclair/typebox';

export const KnowledgeSearchKindSchema = Type.Union([
  Type.Literal('note'), Type.Literal('narrative'), Type.Literal('topic'), Type.Literal('collection'),
]);
export type KnowledgeSearchKind = Static<typeof KnowledgeSearchKindSchema>;

/** Offset applies to the combined, stably ordered result set, not each source. */
export const KnowledgeSearchQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
  workId: Type.Optional(Type.String({ maxLength: 300 })),
  works: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 20 })),
  characters: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 20 })),
  kinds: Type.Optional(Type.Array(KnowledgeSearchKindSchema, { maxItems: 4 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
});
export type KnowledgeSearchQuery = Static<typeof KnowledgeSearchQuerySchema>;
