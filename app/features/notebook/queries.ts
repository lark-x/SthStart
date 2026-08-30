import { useQuery } from '@tanstack/react-query';
import { notebookKeys } from '@/app/lib/query-keys';
import { fetchNotes, fetchNoteDetail } from './api';

export function useNotes(filters?: { q?: string; kind?: string; stage?: string }) {
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
