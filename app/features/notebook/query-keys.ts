/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const notebookKeys = {
  all: ['notebook'] as const,
  list: (filters?: { q?: string; kind?: string; stage?: string; works?: string[]; characters?: string[]; category?: string; usage?: string; nature?: string; favorite?: boolean; page?: number; pageSize?: number }) =>
    [...notebookKeys.all, 'list', filters] as const,
  detail: (id: string) => [...notebookKeys.all, 'detail', id] as const,
};
