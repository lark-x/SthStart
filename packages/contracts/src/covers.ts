import { Type, type Static } from '@sinclair/typebox';

/**
 * 作品封面契约。封面只保存指向中心媒体（artifacts）的引用 ID，不保存 URL：
 * 文件读取统一走媒体库的 `/media-library/:id/file`，与已有媒体的访问、配额和清理规则一致。
 */
export const CoverEntityTypeSchema = Type.Union([
  Type.Literal('story-project'),
  Type.Literal('story-world'),
  Type.Literal('activity'),
]);
export type CoverEntityType = Static<typeof CoverEntityTypeSchema>;
export const COVER_ENTITY_TYPES: readonly CoverEntityType[] = ['story-project', 'story-world', 'activity'];

/** 与创作中心上传沿用同一组图片格式与 12 MiB 上限。 */
export const COVER_IMAGE_CONTENT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
export const COVER_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

/** 实体上的封面字段：缺省与 null 都表示没有封面，旧数据无需回填。 */
export const CoverArtifactIdFieldSchema = Type.Optional(Type.Union([Type.String(), Type.Null()]));

export const CoverEntityParamsSchema = Type.Object({
  entityType: CoverEntityTypeSchema,
  entityId: Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: false });
export type CoverEntityParams = Static<typeof CoverEntityParamsSchema>;

/** 设置或清除封面：`artifactId: null` 为显式移除，字段不能省略。 */
export const SetEntityCoverSchema = Type.Object({
  artifactId: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
}, { additionalProperties: false });
export type SetEntityCover = Static<typeof SetEntityCoverSchema>;

export const EntityCoverSchema = Type.Object({
  entityType: CoverEntityTypeSchema,
  entityId: Type.String(),
  coverArtifactId: Type.Union([Type.String(), Type.Null()]),
});
export type EntityCover = Static<typeof EntityCoverSchema>;

export const CoverUploadResponseSchema = Type.Object({
  artifactId: Type.String(),
  contentType: Type.String(),
  byteSize: Type.Integer({ minimum: 1 }),
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
});
export type CoverUploadResponse = Static<typeof CoverUploadResponseSchema>;
