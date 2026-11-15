import { Type, type Static } from '@sinclair/typebox';

export const ModelThinkingLevelSchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('off'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
]);
export type ModelThinkingLevel = Static<typeof ModelThinkingLevelSchema>;

export const ModelRouteScopeSchema = Type.Union([
  Type.Literal('public'),
  Type.Literal('app'),
]);
export type ModelRouteScope = Static<typeof ModelRouteScopeSchema>;

export const ModelRouteCapabilitySchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('multimodal'),
]);
export type ModelRouteCapability = Static<typeof ModelRouteCapabilitySchema>;

export const ModelRouteSchema = Type.Object({
  id: Type.String(),
  scope: ModelRouteScopeSchema,
  appId: Type.Union([Type.String(), Type.Null()]),
  capability: ModelRouteCapabilitySchema,
  primaryModelId: Type.String(),
  fallbackModelIds: Type.Array(Type.String(), { maxItems: 2 }),
  inheritPublicFallbacks: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ModelRoute = Static<typeof ModelRouteSchema>;

export const ModelRouteListSchema = Type.Object({
  items: Type.Array(ModelRouteSchema),
});
export type ModelRouteList = Static<typeof ModelRouteListSchema>;

export const SaveModelRouteSchema = Type.Object({
  scope: ModelRouteScopeSchema,
  appId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  capability: ModelRouteCapabilitySchema,
  primaryModelId: Type.String({ minLength: 1, maxLength: 160 }),
  fallbackModelIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 2 }),
  inheritPublicFallbacks: Type.Boolean(),
});
export type SaveModelRoute = Static<typeof SaveModelRouteSchema>;

export const ApplyPublicModelRouteSchema = Type.Object({
  capability: ModelRouteCapabilitySchema,
});
export type ApplyPublicModelRoute = Static<typeof ApplyPublicModelRouteSchema>;
