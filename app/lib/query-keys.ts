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

export const creativeKeys = {
  all: ['creative'] as const,
  status: () => [...creativeKeys.all, 'status'] as const,
  tasks: () => [...creativeKeys.all, 'tasks'] as const,
  artifacts: () => [...creativeKeys.all, 'artifacts'] as const,
};

export const providerKeys = {
  all: ['providers'] as const,
  overview: () => [...providerKeys.all, 'overview'] as const,
  discover: (params: Record<string, unknown>) =>
    [...providerKeys.all, 'discover', params] as const,
};

export const activityKeys = {
  all: ['activities'] as const,
  list: (filters?: { q?: string; archived?: boolean }) => [...activityKeys.all, 'list', filters] as const,
  detail: (id: string) => [...activityKeys.all, 'detail', id] as const,
  draft: (id: string) => [...activityKeys.all, 'draft', id] as const,
  revisions: (id: string) => [...activityKeys.all, 'revisions', id] as const,
  revision: (id: string, revisionId: string) => [...activityKeys.all, 'revision', id, revisionId] as const,
  mediaRevision: (id: string, mediaRevisionId: string) => [...activityKeys.all, 'mediaRevision', id, mediaRevisionId] as const,
  playbackRevision: (id: string, playbackRevisionId: string) => [...activityKeys.all, 'playbackRevision', id, playbackRevisionId] as const,
  assets: (id: string) => [...activityKeys.all, 'assets', id] as const,
  jobs: (id: string) => [...activityKeys.all, 'jobs', id] as const,
  job: (id: string, jobId: string) => [...activityKeys.all, 'job', id, jobId] as const,
  candidates: (id: string) => [...activityKeys.all, 'candidates', id] as const,
  candidate: (id: string, candidateId: string) => [...activityKeys.all, 'candidate', id, candidateId] as const,
  checkpoints: (id: string) => [...activityKeys.all, 'checkpoints', id] as const,
  capabilities: () => [...activityKeys.all, 'capabilities'] as const,
  imageConfigDraft: (id: string) => [...activityKeys.all, 'imageConfigDraft', id] as const,
  imageConfigRevisions: (id: string) => [...activityKeys.all, 'imageConfigRevisions', id] as const,
  recipes: (id: string, slotId?: string) => [...activityKeys.all, 'recipes', id, slotId] as const,
  attempts: (id: string, slotId?: string) => [...activityKeys.all, 'attempts', id, slotId] as const,
  attempt: (id: string, attemptId: string) => [...activityKeys.all, 'attempt', id, attemptId] as const,
  lineage: (id: string, assetKey: string) => [...activityKeys.all, 'lineage', id, assetKey] as const,
  sourceResolve: (id: string, refId: string) => [...activityKeys.all, 'sourceResolve', id, refId] as const,
};
