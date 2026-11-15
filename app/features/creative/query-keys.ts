/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const creativeKeys = {
  all: ['creative'] as const,
  status: () => [...creativeKeys.all, 'status'] as const,
  options: () => [...creativeKeys.all, 'options'] as const,
  tasks: () => [...creativeKeys.all, 'tasks'] as const,
  artifacts: () => [...creativeKeys.all, 'artifacts'] as const,
};
