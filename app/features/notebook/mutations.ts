import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notebookKeys } from '@/app/lib/query-keys';
import { createNote, updateNote, deleteNote, uploadNoteAsset } from './api';
import type { CreativeNote } from '@sthstart/contracts';

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createNote,
    onSuccess: (note) => {
      if (note.id) queryClient.setQueryData(notebookKeys.detail(note.id), note);
      queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) =>
        current ? { items: [note, ...current.items.filter((item) => item.id !== note.id)] } : current);
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreativeNote> }) =>
      updateNote(id, payload),
    onSuccess: (data) => {
      if (data.id) {
        queryClient.setQueryData(notebookKeys.detail(data.id), data);
        queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) =>
          current ? { items: current.items.map((item) => item.id === data.id ? data : item) } : current);
      }
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteNote,
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: notebookKeys.detail(id) });
      queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) =>
        current ? { items: current.items.filter((item) => item.id !== id) } : current);
    },
  });
}

export function useUploadNoteAsset() {
  return useMutation({
    mutationFn: ({ noteId, file }: { noteId?: string; file: File }) =>
      uploadNoteAsset(noteId, file),
  });
}
