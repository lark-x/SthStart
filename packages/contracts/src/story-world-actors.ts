import { Type, type Static } from '@sinclair/typebox';
import { WorldActorSchema, WorldBranchSchema } from './story-worlds.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const nullableId = Type.Union([id, Type.Null()]);
const revision = Type.Integer({ minimum: 1 });
const strict = { additionalProperties: false };

/**
 * 配角提升/入角色库的用户选择。两个动作彼此独立；至少选择一个。
 * 幂等由当前分支状态保证：已是主角、已关联角色库时不重复写卡或递增 revision。
 */
export const PromoteWorldActorSchema = Type.Object({
  versionLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  expectedRevision: revision,
  promoteToMain: Type.Boolean(),
  addToLibrary: Type.Boolean(),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 50 })),
  summary: Type.Optional(Type.String({ maxLength: 5000 })),
}, strict);
export type PromoteWorldActor = Static<typeof PromoteWorldActorSchema>;

export const WorldActorCharacterLinkSchema = Type.Object({
  characterId: id,
  displayName: Type.String({ minLength: 1, maxLength: 200 }),
  version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  created: Type.Boolean(),
  archived: Type.Boolean(),
  sourceSnapshotId: nullableId,
}, strict);
export type WorldActorCharacterLink = Static<typeof WorldActorCharacterLinkSchema>;

export const WorldActorPromotionResultSchema = Type.Object({
  branch: WorldBranchSchema,
  actor: WorldActorSchema,
  promoted: Type.Boolean(),
  character: Type.Union([WorldActorCharacterLinkSchema, Type.Null()]),
}, strict);
export type WorldActorPromotionResult = Static<typeof WorldActorPromotionResultSchema>;
