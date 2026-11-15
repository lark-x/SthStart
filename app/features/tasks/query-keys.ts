/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const taskKeys = {
  all: ['tasks'] as const,
  list: (filters?: { state?: 'active' | 'recent' | 'all'; domain?: string; limit?: number }) =>
    [...taskKeys.all, 'list', filters] as const,
};
