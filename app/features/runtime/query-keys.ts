/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const runtimeKeys = {
  all: ['runtime'] as const,
  overview: () => [...runtimeKeys.all, 'overview'] as const,
  logs: (filter?: { limit?: number; level?: string; service?: string }) =>
    [...runtimeKeys.all, 'logs', filter] as const,
  configPreview: () => [...runtimeKeys.all, 'configPreview'] as const,
};
