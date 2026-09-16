import { useQuery } from '@tanstack/react-query';
import { knowledgeKeys, notebookKeys } from '@/app/lib/query-keys';
import {
  fetchNotes, fetchNoteDetail, fetchNoteReferences, recommendKnowledge, searchKnowledge,
  type KnowledgeSearchParams, type NoteListFilters,
} from './api';

export function useNotes(filters?: NoteListFilters) {
  return useQuery({
    queryKey: notebookKeys.list(filters),
    queryFn: () => fetchNotes(filters),
    staleTime: 60_000,
  });
}

export function useNoteDetail(id?: string) {
  return useQuery({
    queryKey: notebookKeys.detail(id ?? ''),
    queryFn: () => fetchNoteDetail(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** 某篇资料被哪些企划或活动引用过。 */
export function useNoteReferences(id?: string) {
  return useQuery({
    queryKey: knowledgeKeys.noteReferences(id ?? ''),
    queryFn: () => fetchNoteReferences(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useKnowledgeSearch(params: KnowledgeSearchParams, enabled = true) {
  return useQuery({
    queryKey: knowledgeKeys.search(params),
    queryFn: () => searchKnowledge(params),
    enabled,
    staleTime: 15_000,
  });
}

export function useKnowledgeRecommendations(params: {
  works?: string[];
  characters?: string[];
  locations?: string[];
  theme?: string;
  keywords?: string[];
  limit?: number;
  includePending?: boolean;
}, enabled = true) {
  return useQuery({
    queryKey: knowledgeKeys.recommendations(params),
    queryFn: () => recommendKnowledge(params),
    enabled,
    staleTime: 30_000,
  });
}
