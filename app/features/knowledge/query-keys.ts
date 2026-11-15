/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  search: (params: object) => [...knowledgeKeys.all, 'search', params] as const,
  recommendations: (params: object) => [...knowledgeKeys.all, 'recommendations', params] as const,
  noteReferences: (id: string) => [...knowledgeKeys.all, 'noteReferences', id] as const,
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
