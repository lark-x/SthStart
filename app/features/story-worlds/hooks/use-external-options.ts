'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchGenerationEngines, fetchGenerationWorkflows } from '@/app/features/generation/api';
import { fetchPending } from '@/app/features/knowledge/api';
import { fetchNotes } from '@/app/features/notebook/api';
import { projectsApi } from '@/app/features/projects/api';
import { fetchModelProfiles, fetchPurposeBindings } from '@/app/features/public-services/api';
import { fetchWorks, fetchWorkTree } from '@/app/features/narrative/api';
import { storyWorldOptionKeys } from '../query-keys';

/** One-way option reads; story-worlds never participates in these modules' caches. */
export function useProjectOptions(enabled = true) {
  return useQuery({
    queryKey: storyWorldOptionKeys.projects(),
    queryFn: () => projectsApi.list(),
    enabled,
    staleTime: 60_000,
  });
}

export function useKnowledgeSourceOptions(enabled = true) {
  return useQuery({
    queryKey: storyWorldOptionKeys.knowledgeSources(),
    queryFn: () => fetchPending({ state: 'kept', limit: 50 }),
    enabled,
    staleTime: 60_000,
  });
}

export function useNoteSourceOptions(query: string, enabled = true) {
  const normalized = query.trim();
  return useQuery({
    queryKey: storyWorldOptionKeys.notes(normalized),
    queryFn: () => fetchNotes({ q: normalized || undefined, pageSize: 30 }),
    enabled,
    staleTime: 30_000,
  });
}

export function useNarrativeWorkOptions(enabled = true) {
  return useQuery({
    queryKey: storyWorldOptionKeys.narrativeWorks(),
    queryFn: fetchWorks,
    enabled,
    staleTime: 60_000,
  });
}

export function useNarrativeTreeOptions(workId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: storyWorldOptionKeys.narrativeTree(workId ?? ''),
    queryFn: () => fetchWorkTree(workId!),
    enabled: Boolean(enabled && workId),
    staleTime: 60_000,
  });
}

export function useGenerationOptions(enabled = true) {
  return useQuery({
    queryKey: storyWorldOptionKeys.generation(),
    queryFn: async () => {
      const [engines, workflows] = await Promise.all([
        fetchGenerationEngines(),
        fetchGenerationWorkflows(),
      ]);
      return { engines, workflows };
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useModelRoutingOptions(enabled = true) {
  return useQuery({
    queryKey: storyWorldOptionKeys.modelRouting(),
    queryFn: async () => {
      const [models, purposes] = await Promise.all([
        fetchModelProfiles(),
        fetchPurposeBindings(),
      ]);
      return { models, purposes };
    },
    enabled,
    staleTime: 60_000,
  });
}
