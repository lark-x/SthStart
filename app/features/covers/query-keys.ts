/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const coverKeys = {
  all: ['covers'] as const,
  mediaPicker: (query: string, offset: number) => [...coverKeys.all, 'media-picker', query, offset] as const,
};
