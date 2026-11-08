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
  assets: (id: string) => [...characterKeys.all, 'assets', id] as const,
  migrationReview: (id: string) => [...characterKeys.all, 'migration-review', id] as const,
  llmStatus: (id: string) => [...characterKeys.all, 'llmStatus', id] as const,
};

export const notebookKeys = {
  all: ['notebook'] as const,
  list: (filters?: { q?: string; kind?: string; stage?: string; works?: string[]; characters?: string[]; category?: string; usage?: string; nature?: string; favorite?: boolean; page?: number; pageSize?: number }) =>
    [...notebookKeys.all, 'list', filters] as const,
  detail: (id: string) => [...notebookKeys.all, 'detail', id] as const,
};

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  search: (params: object) => [...knowledgeKeys.all, 'search', params] as const,
  recommendations: (params: object) => [...knowledgeKeys.all, 'recommendations', params] as const,
  noteReferences: (id: string) => [...knowledgeKeys.all, 'noteReferences', id] as const,
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
  researchProvider: () => [...narrativeKeys.all, 'researchProvider'] as const,
  researchProjects: (workId?: string) => [...narrativeKeys.all, 'researchProjects', workId ?? ''] as const,
  researchProject: (id: string) => [...narrativeKeys.all, 'researchProject', id] as const,
  researchRun: (id: string) => [...narrativeKeys.all, 'researchRun', id] as const,
};

export const creativeKeys = {
  all: ['creative'] as const,
  status: () => [...creativeKeys.all, 'status'] as const,
  options: () => [...creativeKeys.all, 'options'] as const,
  tasks: () => [...creativeKeys.all, 'tasks'] as const,
  artifacts: () => [...creativeKeys.all, 'artifacts'] as const,
};

export const providerKeys = {
  all: ['providers'] as const,
  overview: () => [...providerKeys.all, 'overview'] as const,
  llmStatus: (appId: string) => [...providerKeys.all, 'llmStatus', appId] as const,
  discover: (params: Record<string, unknown>) =>
    [...providerKeys.all, 'discover', params] as const,
};

export const generationKeys = {
  all: ['generation'] as const,
  presets: (filter?: { appId?: string; purpose?: string; workflowId?: string }) =>
    [...generationKeys.all, 'presets', filter] as const,
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
  comicDraft: (id: string) => [...activityKeys.all, 'comic', id, 'draft'] as const,
  comicRevisions: (id: string) => [...activityKeys.all, 'comic', id, 'revisions'] as const,
  comicJob: (id: string, jobId: string) => [...activityKeys.all, 'comic', id, 'job', jobId] as const,
  assets: (id: string) => [...activityKeys.all, 'assets', id] as const,
  gallery: (id: string) => [...activityKeys.all, 'gallery', id] as const,
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
  production: (id: string) => [...activityKeys.all, 'production', id] as const,
  mediaBatches: (id: string) => [...activityKeys.all, 'mediaBatches', id] as const,
  mediaBatch: (id: string, batchId: string) => [...activityKeys.all, 'mediaBatch', id, batchId] as const,
  presets: (kind?: string) => [...activityKeys.all, 'presets', kind] as const,
  preset: (id: string) => [...activityKeys.all, 'preset', id] as const,
};

export const taskKeys = {
  all: ['tasks'] as const,
  list: (filters?: { state?: 'active' | 'recent' | 'all'; domain?: string; limit?: number }) =>
    [...taskKeys.all, 'list', filters] as const,
};

/** 剧情项目。键形状与既有缓存保持一致：项目内数据都以 ['story', projectId] 为前缀，便于整体失效。 */
export const storyKeys = {
  all: ['story'] as const,
  projects: () => [...storyKeys.all, 'projects'] as const,
  scope: (projectId: string) => [...storyKeys.all, projectId] as const,
  project: (projectId: string) => [...storyKeys.scope(projectId), 'project'] as const,
  documents: (projectId: string) => [...storyKeys.scope(projectId), 'documents'] as const,
  characters: (projectId: string) => [...storyKeys.scope(projectId), 'characters'] as const,
  proposals: (projectId: string) => [...storyKeys.scope(projectId), 'proposals'] as const,
  bridgeStatus: (projectId: string) => [...storyKeys.scope(projectId), 'bridge-status'] as const,
  dshStatus: (projectId: string) => [...storyKeys.scope(projectId), 'dsh-status'] as const,
  search: (projectId: string, query: string) => [...storyKeys.scope(projectId), 'search', query] as const,
  archiveSessions: (projectId: string) => [...storyKeys.scope(projectId), 'archive-sessions'] as const,
  archiveMessages: (projectId: string, sessionId?: string) => [...storyKeys.scope(projectId), 'archive-messages', sessionId] as const,
  revisionsAll: (projectId: string) => [...storyKeys.scope(projectId), 'revisions'] as const,
  revisions: (projectId: string, kind: string, entryId?: string) => [...storyKeys.revisionsAll(projectId), kind, entryId] as const,
  compileScript: (projectId: string, chapterTitle: string, chapterBody: string) =>
    [...storyKeys.scope(projectId), 'compile-script', chapterTitle, chapterBody] as const,
};

export const projectKeys = {
  all: ['projects'] as const,
  overview: (projectId: string) => [...projectKeys.all, projectId] as const,
};

/** 以下键沿用迁移前的字面量形状，保证已有缓存与前缀失效行为不变。 */
export const topicKeys = {
  all: ['topics'] as const,
  list: (params: object) => [...topicKeys.all, params] as const,
  picker: (params: object) => [...topicKeys.all, 'picker', params] as const,
  detail: (id: string | null) => [...topicKeys.all, 'detail', id] as const,
};

export const topicCollectionKeys = {
  all: ['topic-collection'] as const,
  runs: () => [...topicCollectionKeys.all, 'runs'] as const,
  settings: () => [...topicCollectionKeys.all, 'settings'] as const,
};

export const ideaBatchKeys = {
  list: () => ['idea-batches'] as const,
  detail: (batchId: string | null) => ['idea-batch', batchId] as const,
};

export const knowledgeCollectionKeys = {
  all: ['knowledge-collections'] as const,
  poll: (runIds: string) => [...knowledgeCollectionKeys.all, 'poll', runIds] as const,
  run: (runId: string) => ['knowledge-run', runId] as const,
};

export const knowledgePendingKeys = {
  all: ['knowledge-pending'] as const,
  list: (state: string) => [...knowledgePendingKeys.all, state] as const,
  detail: (id: string | null) => [...knowledgePendingKeys.all, 'detail', id] as const,
};

export const mcpSourceKeys = {
  all: ['mcp-sources'] as const,
};

export const characterFacetKeys = {
  works: () => [...characterKeys.all, 'works-facets'] as const,
};

export const aiCallKeys = {
  list: (filters: object, cursor?: string | null) => ['ai-calls', filters, cursor] as const,
  storage: () => ['ai-calls-storage'] as const,
  detail: (id: string | null) => ['ai-call', id] as const,
};

export const workspaceKeys = {
  all: ['workspace'] as const,
  recent: (limit: number) => [...workspaceKeys.all, 'recent', limit] as const,
};

export const mediaLibraryKeys = {
  all: ['media-library'] as const,
  summary: () => [...mediaLibraryKeys.all, 'summary'] as const,
};

export const backupKeys = {
  all: ['backups'] as const,
  overview: () => [...backupKeys.all, 'overview'] as const,
  snapshots: () => [...backupKeys.all, 'snapshots'] as const,
  restores: () => [...backupKeys.all, 'restores'] as const,
  restorePreview: (snapshotId: string, targetId: string) => [...backupKeys.all, 'restorePreview', snapshotId, targetId] as const,
  quark: () => [...backupKeys.all, 'quark'] as const,
};
