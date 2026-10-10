import { Type, type Static } from '@sinclair/typebox';

export const RecentWorkQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});
export const RecentWorkResponseSchema = Type.Object({
  items: Type.Array(Type.Object({
    id: Type.String(),
    title: Type.String(),
    kind: Type.Union([Type.Literal('activity'), Type.Literal('note'), Type.Literal('character')]),
    updatedAt: Type.String(),
  })),
});
export type RecentWorkResponse = Static<typeof RecentWorkResponseSchema>;
