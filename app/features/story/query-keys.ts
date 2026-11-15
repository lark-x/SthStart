/** Owned by this domain; tuple shapes are a cache compatibility contract. */
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
