import { useQuery } from '@tanstack/react-query';
import { narrativeKeys } from '@/app/lib/query-keys';
import {
  fetchWorks,
  fetchWorkTree,
  fetchReadingNode,
  searchNarrative,
  fetchConnectors,
} from './api';

export function useNarrativeWorks() {
  return useQuery({
    queryKey: narrativeKeys.works(),
    queryFn: fetchWorks,
    staleTime: 60_000,
  });
}

export function useNarrativeTree(workId?: string) {
  return useQuery({
    queryKey: narrativeKeys.tree(workId ?? ''),
    queryFn: () => fetchWorkTree(workId!),
    enabled: Boolean(workId),
    staleTime: 30_000,
  });
}

export function useNarrativeReading(nodeId?: string) {
  return useQuery({
    queryKey: narrativeKeys.reading(nodeId ?? ''),
    queryFn: () => fetchReadingNode(nodeId!),
    enabled: Boolean(nodeId),
    // Limit cache time for big textual scenes to avoid memory bloating
    staleTime: 20_000,
    gcTime: 2 * 60_000,
  });
}

export function useNarrativeSearch(query: string, workId?: string) {
  return useQuery({
    queryKey: narrativeKeys.search(query, workId),
    queryFn: () => searchNarrative(query, workId),
    enabled: Boolean(query.trim()),
    staleTime: 10_000,
  });
}

export function useNarrativeConnectors() {
  return useQuery({
    queryKey: narrativeKeys.connectors(),
    queryFn: fetchConnectors,
    staleTime: 60_000,
  });
}

