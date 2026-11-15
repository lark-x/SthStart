import type { WorldEventQuery } from '@sthstart/contracts';

/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const storyWorldKeys = {
  all: ['story-worlds'] as const,
  list: () => [...storyWorldKeys.all, 'list'] as const,
  overview: (worldId: string) => [...storyWorldKeys.all, 'overview', worldId] as const,
  branch: (worldId: string, branchId: string) =>
    [...storyWorldKeys.all, 'branch', worldId, branchId] as const,
  events: (worldId: string, branchId: string, query: WorldEventQuery) =>
    [...storyWorldKeys.all, 'events', worldId, branchId, query] as const,
  memories: (worldId: string, branchId: string, actorId?: string) =>
    [...storyWorldKeys.all, 'memories', worldId, branchId, actorId ?? 'all'] as const,
  comparison: (worldId: string, branchId: string) =>
    [...storyWorldKeys.all, 'comparison', worldId, branchId] as const,
  projectBinding: (projectId: string) =>
    [...storyWorldKeys.all, 'project-binding', projectId] as const,
  runRecovery: (worldId: string, branchId: string, runId: string) =>
    [...storyWorldKeys.all, 'run-recovery', worldId, branchId, runId] as const,
  uncertainGeneration: (appId?: string) =>
    [...storyWorldKeys.all, 'uncertain-generation', appId ?? 'all'] as const,
};

/** Cross-domain option caches are owned here so this module never mutates another module's keys. */
export const storyWorldOptionKeys = {
  all: [...storyWorldKeys.all, 'options'] as const,
  projects: () => [...storyWorldOptionKeys.all, 'projects'] as const,
  knowledgeSources: () => [...storyWorldOptionKeys.all, 'knowledge-sources'] as const,
  generation: () => [...storyWorldOptionKeys.all, 'generation'] as const,
  modelRouting: () => [...storyWorldOptionKeys.all, 'model-routing'] as const,
  notes: (query: string) => [...storyWorldOptionKeys.all, 'notes', query] as const,
  narrativeWorks: () => [...storyWorldOptionKeys.all, 'narrative-works'] as const,
  narrativeTree: (workId: string) => [...storyWorldOptionKeys.all, 'narrative-tree', workId] as const,
};
