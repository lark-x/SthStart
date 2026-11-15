import { Type, type Static } from '@sinclair/typebox';

const strict = { additionalProperties: false };
export const WebSearchProviderSchema = Type.Union([Type.Literal('anysearch'), Type.Literal('exa'), Type.Literal('tavily')]);
export type WebSearchProvider = Static<typeof WebSearchProviderSchema>;
export const WebSearchSettingsSchema = Type.Object({
  provider: Type.Optional(WebSearchProviderSchema),
  anonymous: Type.Optional(Type.Boolean()),
  providers: Type.Optional(Type.Array(Type.Object({ provider: WebSearchProviderSchema, hasCredential: Type.Boolean() }, strict))),
  enabled: Type.Boolean(),
  hasCredential: Type.Boolean(),
  credentialSource: Type.Union([Type.Literal('keyring'), Type.Literal('environment'), Type.Literal('none')]),
}, strict);
export type WebSearchSettings = Static<typeof WebSearchSettingsSchema>;
export const SaveWebSearchSettingsSchema = Type.Object({
  provider: Type.Optional(WebSearchProviderSchema),
  anonymous: Type.Optional(Type.Boolean()),
  enabled: Type.Boolean(), apiKey: Type.Optional(Type.String({ maxLength: 1000 })),
}, strict);
export type SaveWebSearchSettings = Static<typeof SaveWebSearchSettingsSchema>;
export const WebSearchRequestSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500 }),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
}, strict);
export type WebSearchRequest = Static<typeof WebSearchRequestSchema>;
export const WebSearchResultSchema = Type.Object({
  provider: Type.Optional(WebSearchProviderSchema),
  id: Type.String({ minLength: 1, maxLength: 160 }),
  title: Type.String({ maxLength: 500 }), url: Type.String({ minLength: 1, maxLength: 4000 }),
  siteName: Type.String({ maxLength: 300 }), snippet: Type.String({ maxLength: 10000 }),
  content: Type.String({ maxLength: 20000 }), retrievedAt: Type.String({ maxLength: 100 }),
  contentHash: Type.String({ maxLength: 160 }),
  status: Type.Union([Type.Literal('snippet'), Type.Literal('extracted'), Type.Literal('failed')]),
  truncated: Type.Boolean(), error: Type.Optional(Type.String({ maxLength: 2000 })),
}, strict);
export type WebSearchResult = Static<typeof WebSearchResultSchema>;
export const WebSearchResponseSchema = Type.Object({
  items: Type.Array(WebSearchResultSchema, { maxItems: 10 }), query: Type.String({ maxLength: 500 }),
}, strict);
export type WebSearchResponse = Static<typeof WebSearchResponseSchema>;
export const ExtractWebSearchRequestSchema = Type.Object({
  items: Type.Array(WebSearchResultSchema, { minItems: 1, maxItems: 10 }),
}, strict);
export type ExtractWebSearchRequest = Static<typeof ExtractWebSearchRequestSchema>;
export const ExtractWebSearchResponseSchema = Type.Object({
  items: Type.Array(WebSearchResultSchema, { maxItems: 10 }),
}, strict);
export type ExtractWebSearchResponse = Static<typeof ExtractWebSearchResponseSchema>;
export const WebSearchTestResultSchema = Type.Object({ ok: Type.Boolean(), message: Type.String() }, strict);
export type WebSearchTestResult = Static<typeof WebSearchTestResultSchema>;
export const SaveWebSearchSourceSchema = Type.Object({ item: WebSearchResultSchema }, strict);
export type SaveWebSearchSource = Static<typeof SaveWebSearchSourceSchema>;
export const SaveWebSearchSourceResultSchema = Type.Object({ id: Type.String({ minLength: 1 }) }, strict);
export type SaveWebSearchSourceResult = Static<typeof SaveWebSearchSourceResultSchema>;
