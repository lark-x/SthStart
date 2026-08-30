import { adminFetch, ApiClientError, getJson, postJson, putJson, deleteJson, validateResponse } from '@/app/lib/api-client';
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

export const upsertNote = updateNote;

export async function deleteNote(id: string): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`notebook/notes/${id}`, undefined, NoteDeleteResponseSchema);
}

export async function uploadNoteAsset(
  noteId: string | undefined,
  file: Blob,
  filename = file instanceof File ? file.name : 'notebook-image'
): Promise<{ id: string; url: string }> {
  const response = await adminFetch('notebook/assets', {
    method: 'POST',
    headers: {
      'content-type': file.type,
      'x-original-filename': filename,
      ...(noteId ? { 'x-note-id': noteId } : {}),
    },
    body: file,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new ApiClientError(String(payload?.message ?? payload?.error ?? `HTTP ${response.status}`), {
      status: response.status,
      code: typeof payload?.error === 'string' ? payload.error : undefined,
      requestId: response.headers.get('x-request-id'),
    });
  }
  return validateResponse<{ id: string; url: string }>(payload, NoteAssetResponseSchema, response.url);
}
