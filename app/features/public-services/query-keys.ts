/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const providerKeys = {
  all: ['providers'] as const,
  overview: () => [...providerKeys.all, 'overview'] as const,
  modelRoutes: () => [...providerKeys.all, 'model-routes'] as const,
  llmStatus: (appId: string) => [...providerKeys.all, 'llmStatus', appId] as const,
  discover: (params: Record<string, unknown>) =>
    [...providerKeys.all, 'discover', params] as const,
};
