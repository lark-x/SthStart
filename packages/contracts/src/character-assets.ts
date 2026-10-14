import { Type, type Static } from '@sinclair/typebox';

export const CharacterAssetCategorySchema = Type.Union([
  Type.Literal('avatar'),
  Type.Literal('portrait'),
  Type.Literal('expression'),
  Type.Literal('costume'),
  Type.Literal('cg'),
  Type.Literal('concept'),
  Type.Literal('other'),
]);
export type CharacterAssetCategory = Static<typeof CharacterAssetCategorySchema>;

export const CHARACTER_ASSET_CATEGORIES: { id: CharacterAssetCategory; label: string; description: string }[] = [
  { id: 'avatar', label: '头像', description: '角色特写或代表图标' },
  { id: 'portrait', label: '立绘', description: '全身立绘或半身主图' },
  { id: 'expression', label: '表情差分', description: '喜怒哀乐等神态表情' },
  { id: 'costume', label: '差分私服', description: '不同服装造型及配饰' },
  { id: 'cg', label: '剧情CG', description: '关键故事情境与名场面' },
  { id: 'concept', label: '设定草图', description: '三视图、设计原案或参考' },
  { id: 'other', label: '其它资产', description: '杂项贴图与视觉素材' },
];

export const CharacterAssetDetailSchema = Type.Object({
  id: Type.String(),
  characterId: Type.String(),
  kind: Type.Union([Type.Literal('avatar'), Type.Literal('portrait'), Type.Literal('reference')]),
  category: CharacterAssetCategorySchema,
  title: Type.String(),
  url: Type.String(),
  artifactId: Type.Union([Type.String(), Type.Null()]),
  tags: Type.Array(Type.String()),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
  sourceUrl: Type.Union([Type.String(), Type.Null()]),
  sourcePage: Type.Union([Type.String(), Type.Null()]),
  authorNote: Type.Optional(Type.String()),
  userNote: Type.Optional(Type.String()),
  originalName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contentType: Type.Optional(Type.String()),
  byteSize: Type.Optional(Type.Number()),
});
export type CharacterAssetDetail = Static<typeof CharacterAssetDetailSchema>;

export const CharacterAssetListResponseSchema = Type.Object({
  characterId: Type.Optional(Type.String()),
  avatarAssetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  portraitAssetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  activeAvatarId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  activePortraitId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  items: Type.Array(CharacterAssetDetailSchema),
});
export type CharacterAssetListResponse = Static<typeof CharacterAssetListResponseSchema>;

export const CreateCharacterAssetRequestSchema = Type.Object({
  dataUrl: Type.String(),
  filename: Type.Optional(Type.String()),
  category: Type.Optional(CharacterAssetCategorySchema),
  kind: Type.Optional(Type.Union([Type.Literal('avatar'), Type.Literal('portrait'), Type.Literal('reference')])),
  title: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  setAsActive: Type.Optional(Type.Boolean()),
  purposes: Type.Optional(Type.Array(Type.String())),
  sourcePage: Type.Optional(Type.String()),
  originalUrl: Type.Optional(Type.String()),
  authorNote: Type.Optional(Type.String()),
  userNote: Type.Optional(Type.String()),
});
export type CreateCharacterAssetRequest = Static<typeof CreateCharacterAssetRequestSchema>;

export const UpdateCharacterAssetRequestSchema = Type.Object({
  title: Type.Optional(Type.String()),
  category: Type.Optional(CharacterAssetCategorySchema),
  tags: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  userNote: Type.Optional(Type.String()),
  authorNote: Type.Optional(Type.String()),
  setAsActive: Type.Optional(Type.Union([Type.Literal('avatar'), Type.Literal('portrait'), Type.Literal('none')])),
});
export type UpdateCharacterAssetRequest = Static<typeof UpdateCharacterAssetRequestSchema>;

// ── 多角色公共资产库 (Shared Multi-Character Asset Vault) ──

export const SharedAssetCategorySchema = Type.Union([
  Type.Literal('group_photo'),
  Type.Literal('scene_background'),
  Type.Literal('key_visual'),
  Type.Literal('item_prop'),
  Type.Literal('worldview_map'),
  Type.Literal('other'),
]);
export type SharedAssetCategory = Static<typeof SharedAssetCategorySchema>;

export const SHARED_ASSET_CATEGORIES: { id: SharedAssetCategory; label: string; description: string }[] = [
  { id: 'group_photo', label: '合影群像', description: '多角色同框、双人互动或聚会场景' },
  { id: 'scene_background', label: '场景背景', description: '地点、环境、教室或室内外舞台' },
  { id: 'key_visual', label: '主视觉KV', description: '海报、封面图或宣传插画' },
  { id: 'item_prop', label: '道具信物', description: '关键物品、赠礼、纪念品或装备' },
  { id: 'worldview_map', label: '世界观地图', description: '区域地图、势力关系图或世界设定' },
  { id: 'other', label: '其它公共素材', description: 'UI 元素、公共纹理或未分类资源' },
];

export const SharedAssetItemSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  category: SharedAssetCategorySchema,
  url: Type.String(),
  artifactId: Type.String(),
  characterIds: Type.Array(Type.String()),
  tags: Type.Array(Type.String()),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  authorNote: Type.Optional(Type.String()),
  userNote: Type.Optional(Type.String()),
  sourceUrl: Type.Union([Type.String(), Type.Null()]),
  sourcePage: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type SharedAssetItem = Static<typeof SharedAssetItemSchema>;

export const SharedAssetListResponseSchema = Type.Object({
  items: Type.Array(SharedAssetItemSchema),
  total: Type.Number(),
});
export type SharedAssetListResponse = Static<typeof SharedAssetListResponseSchema>;

export const CreateSharedAssetRequestSchema = Type.Object({
  dataUrl: Type.String(),
  filename: Type.Optional(Type.String()),
  title: Type.String(),
  category: SharedAssetCategorySchema,
  characterIds: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  sourcePage: Type.Optional(Type.String()),
  sourceUrl: Type.Optional(Type.String()),
  authorNote: Type.Optional(Type.String()),
  userNote: Type.Optional(Type.String()),
});
export type CreateSharedAssetRequest = Static<typeof CreateSharedAssetRequestSchema>;

export const UpdateSharedAssetRequestSchema = Type.Object({
  title: Type.Optional(Type.String()),
  category: Type.Optional(SharedAssetCategorySchema),
  characterIds: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  sourcePage: Type.Optional(Type.String()),
  sourceUrl: Type.Optional(Type.String()),
  authorNote: Type.Optional(Type.String()),
  userNote: Type.Optional(Type.String()),
});
export type UpdateSharedAssetRequest = Static<typeof UpdateSharedAssetRequestSchema>;

// ── 邻舍数据互通网桥 (Linshe Data Bridge) ──

export const LinsheBridgeStatusSchema = Type.Object({
  ready: Type.Boolean(),
  linsheAvailable: Type.Boolean(),
  charactersCount: Type.Number(),
  sharedAssetsCount: Type.Number(),
  linkedCharacters: Type.Array(Type.Object({
    sthCharacterId: Type.String(),
    linsheCharacterId: Type.String(),
    displayName: Type.String(),
    sourceVersion: Type.Number(),
    latestVersion: Type.Number(),
    hasUpdate: Type.Boolean(),
  })),
});
export type LinsheBridgeStatus = Static<typeof LinsheBridgeStatusSchema>;

export const LinsheBridgeSyncResultSchema = Type.Object({
  ok: Type.Boolean(),
  action: Type.String(),
  characterId: Type.String(),
  localId: Type.Optional(Type.String()),
  version: Type.Optional(Type.Number()),
  message: Type.Optional(Type.String()),
});
export type LinsheBridgeSyncResult = Static<typeof LinsheBridgeSyncResultSchema>;
