/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const aiCallKeys = {
  list: (filters: object, cursor?: string | null) => ['ai-calls', filters, cursor] as const,
  storage: () => ['ai-calls-storage'] as const,
  detail: (id: string | null) => ['ai-call', id] as const,
};
