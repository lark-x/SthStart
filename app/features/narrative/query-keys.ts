/** Owned by this domain; tuple shapes are a cache compatibility contract. */
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
  researchProvider: () => [...narrativeKeys.all, 'researchProvider'] as const,
  researchProjects: (workId?: string) => [...narrativeKeys.all, 'researchProjects', workId ?? ''] as const,
  researchProject: (id: string) => [...narrativeKeys.all, 'researchProject', id] as const,
  researchRun: (id: string) => [...narrativeKeys.all, 'researchRun', id] as const,
};
