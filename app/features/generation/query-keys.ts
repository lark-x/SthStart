/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const generationKeys = {
  all: ['generation'] as const,
  presets: (filter?: { appId?: string; purpose?: string; workflowId?: string }) =>
    [...generationKeys.all, 'presets', filter] as const,
};
