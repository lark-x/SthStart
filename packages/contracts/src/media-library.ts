import { Type, type Static } from '@sinclair/typebox';

export const MediaLibraryKindSchema = Type.Union([
  Type.Literal('image'),
  Type.Literal('video'),
  Type.Literal('audio'),
  Type.Literal('file'),
]);
export type MediaLibraryKind = Static<typeof MediaLibraryKindSchema>;

export const MediaLibraryStatusSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('missing'),
  Type.Literal('quarantined'),
]);
export type MediaLibraryStatus = Static<typeof MediaLibraryStatusSchema>;

export const MediaLibraryReferenceItemSchema = Type.Object({
  id: Type.Optional(Type.String()),
  appId: Type.String(),
  appName: Type.Optional(Type.String()),
  refType: Type.String(),
  refId: Type.String(),
  createdAt: Type.Optional(Type.String()),
});
export type MediaLibraryReferenceItem = Static<typeof MediaLibraryReferenceItemSchema>;

export const MediaLibraryReferenceSummarySchema = Type.Object({
  totalCount: Type.Number(),
  appCounts: Type.Record(Type.String(), Type.Number()),
  topRefs: Type.Array(Type.String()),
});
export type MediaLibraryReferenceSummary = Static<typeof MediaLibraryReferenceSummarySchema>;

export const MediaLibraryItemSchema = Type.Object({
  id: Type.String(),
  appId: Type.String(),
  appName: Type.String(),
  appHref: Type.String(),
  contentType: Type.Union([Type.String(), Type.Null()]),
  byteSize: Type.Number(),
  sha256: Type.Union([Type.String(), Type.Null()]),
  fileStatus: MediaLibraryStatusSchema,
  originalName: Type.Union([Type.String(), Type.Null()]),
  mediaType: Type.Union([Type.String(), Type.Null()]),
  mediaKind: MediaLibraryKindSchema,
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
  fps: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  codec: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  hasAudio: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  thumbnailArtifactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  paramsSummary: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  pinned: Type.Optional(Type.Boolean()),
  createdAt: Type.String(),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
  fileUrl: Type.String(),
  thumbnailUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  references: Type.Array(MediaLibraryReferenceItemSchema),
  referenceSummary: MediaLibraryReferenceSummarySchema,
});
export type MediaLibraryItem = Static<typeof MediaLibraryItemSchema>;

export const MediaLibraryQuerySchema = Type.Object({
  q: Type.Optional(Type.String()),
  mediaKind: Type.Optional(Type.Union([
    Type.Literal('image'),
    Type.Literal('video'),
    Type.Literal('audio'),
    Type.Literal('file'),
    Type.Literal('all'),
  ])),
  appId: Type.Optional(Type.String()),
  status: Type.Optional(Type.Union([
    Type.Literal('ready'),
    Type.Literal('missing'),
    Type.Literal('quarantined'),
    Type.Literal('all'),
  ])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type MediaLibraryQuery = Static<typeof MediaLibraryQuerySchema>;

export const MediaLibraryResponseSchema = Type.Object({
  items: Type.Array(MediaLibraryItemSchema),
  total: Type.Number(),
  limit: Type.Number(),
  offset: Type.Number(),
});
export type MediaLibraryResponse = Static<typeof MediaLibraryResponseSchema>;

export const KNOWN_APP_META: Record<string, { name: string; href: string }> = {
  activities: { name: '制作', href: '/apps/activities' },
  story: { name: '创作项目', href: '/apps/projects' },
  characters: { name: '角色资料库', href: '/apps/characters' },
  'creative-center': { name: '自由生成', href: '/apps/creative' },
  creative: { name: '自由生成', href: '/apps/creative' },
  inspiration: { name: '灵感素材', href: '/apps/inspiration' },
  notebook: { name: '创作笔记', href: '/apps/notebook' },
  narrative: { name: '叙事档案', href: '/apps/narrative' },
  calendar: { name: '创作日历', href: '/apps/calendar' },
  linshe: { name: '邻舍.EXE', href: '/apps/linshe' },
};

export function inferMediaKind(mediaType?: string | null, contentType?: string | null): MediaLibraryKind {
  const type = ((mediaType || contentType || '')).toLowerCase();
  if (type.startsWith('image') || type.includes('image')) return 'image';
  if (type.startsWith('video') || type.includes('video')) return 'video';
  if (type.startsWith('audio') || type.includes('audio')) return 'audio';
  return 'file';
}

export function resolveAppMeta(appId: string, knownName?: string | null): { name: string; href: string } {
  const known = KNOWN_APP_META[appId];
  if (known) return known;
  const name = (typeof knownName === 'string' && knownName.trim()) ? knownName : appId;
  return {
    name,
    href: `/apps/media?appId=${encodeURIComponent(appId)}`,
  };
}

