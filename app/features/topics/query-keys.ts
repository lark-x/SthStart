/** Owned by this domain; tuple shapes are a cache compatibility contract. */
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
