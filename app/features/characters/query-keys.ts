import type { CharacterBrowseQuery } from '@sthstart/contracts';

/**
 * 角色模块自己的查询键。键值必须与 app/lib/query-keys.ts 的过渡定义保持一致，
 * 其他模块仍通过旧入口按 'characters' 前缀失效缓存；迁移完成后旧定义只保留重导出。
 */
export const characterKeys = {
  all: ['characters'] as const,
  list: (filters?: { query?: string }) => [...characterKeys.all, 'list', filters] as const,
  detail: (id: string) => [...characterKeys.all, 'detail', id] as const,
  assets: (id: string) => [...characterKeys.all, 'assets', id] as const,
  migrationReview: (id: string) => [...characterKeys.all, 'migration-review', id] as const,
  llmStatus: (id: string) => [...characterKeys.all, 'llmStatus', id] as const,
  browse: (request: CharacterBrowseQuery) => [...characterKeys.all, 'browse', request] as const,
};

export const characterFacetKeys = {
  works: () => [...characterKeys.all, 'works-facets'] as const,
};
