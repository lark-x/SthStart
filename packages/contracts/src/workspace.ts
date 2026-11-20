import { Type, type Static } from '@sinclair/typebox';

export const RecentWorkQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});
export const RecentWorkResponseSchema = Type.Object({
  items: Type.Array(Type.Object({
    id: Type.String(),
    title: Type.String(),
    kind: Type.Union([
      Type.Literal('activity'),
      Type.Literal('note'),
      Type.Literal('character'),
      Type.Literal('story'),
      Type.Literal('publication'),
      Type.Literal('world'),
    ]),
    updatedAt: Type.String(),
    /** 卡片缩略图：作品/项目/制作的封面，或角色头像；笔记与无图实体为 null。 */
    imageArtifactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  })),
});
export type RecentWorkResponse = Static<typeof RecentWorkResponseSchema>;
