/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const mediaLibraryKeys = {
  all: ['media-library'] as const,
  summary: () => [...mediaLibraryKeys.all, 'summary'] as const,
};
