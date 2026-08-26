export const runtimeKeys = {
  all: ['runtime'] as const,
  overview: () => [...runtimeKeys.all, 'overview'] as const,
  logs: (filter?: { limit?: number; level?: string; service?: string }) =>
    [...runtimeKeys.all, 'logs', filter] as const,
  configPreview: () => [...runtimeKeys.all, 'configPreview'] as const,
};

export const characterKeys = {
  all: ['characters'] as const,
  list: (filters?: { query?: string }) => [...characterKeys.all, 'list', filters] as const,
  detail: (id: string) => [...characterKeys.all, 'detail', id] as const,
};

export const notebookKeys = {
  all: ['notebook'] as const,
  list: (filters?: { q?: string; kind?: string; stage?: string }) =>
    [...notebookKeys.all, 'list', filters] as const,
  detail: (id: string) => [...notebookKeys.all, 'detail', id] as const,
};

export const narrativeKeys = {
  all: ['narrative'] as const,
  works: () => [...narrativeKeys.all, 'works'] as const,
  tree: (workId: string) => [...narrativeKeys.all, 'tree', workId] as const,
  reading: (nodeId: string) => [...narrativeKeys.all, 'reading', nodeId] as const,
  search: (query: string, workId?: string) =>
    [...narrativeKeys.all, 'search', { query, workId }] as const,
  connectors: () => [...narrativeKeys.all, 'connectors'] as const,
  remoteSearch: (world: string, keyword: string) =>
    [...narrativeKeys.all, 'remoteSearch', { world, keyword }] as const,
};

export const providerKeys = {
  all: ['providers'] as const,
  overview: () => [...providerKeys.all, 'overview'] as const,
  discover: (params: Record<string, unknown>) =>
    [...providerKeys.all, 'discover', params] as const,
};

