/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const workspaceKeys = {
  all: ['workspace'] as const,
  recent: (limit: number) => [...workspaceKeys.all, 'recent', limit] as const,
};
