/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const projectKeys = {
  all: ['projects'] as const,
  overview: (projectId: string) => [...projectKeys.all, projectId] as const,
};
