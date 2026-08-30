'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { CreativeNote } from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { notebookKeys } from '@/app/lib/query-keys';
import { deleteNote, upsertNote, uploadNoteAsset } from './api';
import {
  completeLocalNoteSync,
  failLocalNoteSync,
  getLocalAsset,
  getLocalNote,
  localAssetId,
  markLocalAssetUploaded,
  pendingLocalNotes,
  removeLocalNote,
  replaceLocalAssetReference,
  setLocalNoteSyncing,
} from './local-store';

let activeSync: Promise<void> | null = null;

function updateNoteCaches(queryClient: QueryClient | undefined, note: CreativeNote) {
  if (!queryClient || !note.id) return;
  queryClient.setQueryData(notebookKeys.detail(note.id), note);
  queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) => {
    if (!current) return current;
    const found = current.items.some((item) => item.id === note.id);
    const items = found
      ? current.items.map((item) => item.id === note.id ? note : item)
      : [note, ...current.items];
    return { items };
  });
}

function removeNoteCaches(queryClient: QueryClient | undefined, noteId: string) {
  if (!queryClient) return;
  queryClient.removeQueries({ queryKey: notebookKeys.detail(noteId) });
  queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) =>
    current ? { items: current.items.filter((item) => item.id !== noteId) } : current);
}

async function uploadLocalAssets(noteId: string) {
  let record = await getLocalNote(noteId);
  if (!record) return;
  for (const block of record.note.content) {
    if (block.type !== 'image') continue;
    const assetId = localAssetId(block.src);
    if (!assetId) continue;
    const asset = await getLocalAsset(assetId);
    if (!asset) throw new Error('local_image_missing');
    let uploadedUrl = asset.uploadedUrl;
    if (!uploadedUrl) {
      const uploaded = await uploadNoteAsset(noteId, asset.blob, asset.filename);
      uploadedUrl = uploaded.url;
      await markLocalAssetUploaded(assetId, uploadedUrl);
    }
    await replaceLocalAssetReference(noteId, assetId, uploadedUrl);
    record = await getLocalNote(noteId);
    if (!record) return;
  }
}

async function syncRecord(noteId: string, queryClient?: QueryClient) {
  let record = await getLocalNote(noteId);
  if (!record) return;

  if (record.status === 'deleted') {
    if (!await setLocalNoteSyncing(noteId, record.localVersion)) return;
    try {
      await deleteNote(noteId);
    } catch (error) {
      if (!(error instanceof ApiClientError && error.status === 404)) throw error;
    }
    await removeLocalNote(noteId);
    removeNoteCaches(queryClient, noteId);
    return;
  }

  await uploadLocalAssets(noteId);
  record = await getLocalNote(noteId);
  if (!record || record.status === 'deleted') return;
  const version = record.localVersion;
  if (!await setLocalNoteSyncing(noteId, version)) return;
  const serverNote = await upsertNote(noteId, record.note);
  await completeLocalNoteSync(noteId, version, serverNote);
  updateNoteCaches(queryClient, serverNote);
}

async function runSync(queryClient?: QueryClient, options?: { force?: boolean; noteId?: string }) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const records = await pendingLocalNotes(Boolean(options?.force), options?.noteId);
  for (const record of records) {
    try {
      await syncRecord(record.noteId, queryClient);
    } catch (error) {
      const latest = await getLocalNote(record.noteId);
      if (latest) await failLocalNoteSync(
        record.noteId,
        latest.localVersion,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export function syncPendingNotebookData(queryClient?: QueryClient, options?: { force?: boolean; noteId?: string }) {
  activeSync ??= runSync(queryClient, options).finally(() => { activeSync = null; });
  return activeSync;
}
