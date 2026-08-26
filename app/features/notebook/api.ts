import { getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import {
  CreativeNoteSchema,
  CreativeNotesResponseSchema,
  NoteAssetResponseSchema,
  NoteDeleteResponseSchema,
  type CreativeNote,
} from '@sthstart/contracts';

export async function fetchNotes(filters?: {
  q?: string;
  kind?: string;
  stage?: string;
}): Promise<{ items: CreativeNote[] }> {
  const params = new URLSearchParams();
  if (filters?.q) params.set('q', filters.q);
  if (filters?.kind && filters.kind !== 'all') params.set('kind', filters.kind);
  if (filters?.stage && filters.stage !== 'all') params.set('stage', filters.stage);
  const qs = params.toString();
  return getJson<{ items: CreativeNote[] }>(
    `notebook/notes${qs ? `?${qs}` : ''}`,
    undefined,
    CreativeNotesResponseSchema
  );
}

export async function fetchNoteDetail(id: string): Promise<CreativeNote> {
  return getJson<CreativeNote>(`notebook/notes/${id}`, undefined, CreativeNoteSchema);
}

export async function createNote(payload: Partial<CreativeNote>): Promise<CreativeNote> {
  return postJson<CreativeNote>('notebook/notes', payload, undefined, CreativeNoteSchema);
}

export async function updateNote(id: string, payload: Partial<CreativeNote>): Promise<CreativeNote> {
  return putJson<CreativeNote>(`notebook/notes/${id}`, payload, undefined, CreativeNoteSchema);
}

export async function deleteNote(id: string): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`notebook/notes/${id}`, undefined, NoteDeleteResponseSchema);
}

export async function uploadNoteAsset(
  noteId: string | undefined,
  file: File
): Promise<{ id: string; url: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return postJson<{ id: string; url: string }>(
    'notebook/assets',
    { noteId, dataUrl, filename: file.name },
    undefined,
    NoteAssetResponseSchema
  );
}
