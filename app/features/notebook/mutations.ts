import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notebookKeys } from '@/app/lib/query-keys';
import { createNote, updateNote, deleteNote, uploadNoteAsset } from './api';
import type { CreativeNote } from '@sthstart/contracts';

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreativeNote> }) =>
      updateNote(id, payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
      if (data.id) {
        queryClient.invalidateQueries({ queryKey: notebookKeys.detail(data.id) });
      }
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
    },
  });
}

export function useUploadNoteAsset() {
  return useMutation({
    mutationFn: ({ noteId, file }: { noteId?: string; file: File }) =>
      uploadNoteAsset(noteId, file),
  });
}

