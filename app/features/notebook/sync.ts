'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { CreativeNote } from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { notebookKeys } from '@/app/lib/query-keys';
import { deleteNote, upsertNote, uploadNoteAsset } from './api';
import {
  completeLocalNoteSync,
  deferLocalNoteSync,
  failLocalNoteSync,
  getLocalAsset,
  getLocalNote,
  localAssetId,
  markLocalAssetUploaded,
  pendingLocalNotes,
  pruneLocalAssets,
  removeLocalNote,
  replaceLocalAssetReference,
  setLocalNoteSyncing,
} from './local-store';

let activeSync: Promise<void> | null = null;
// 同步在开始时一次性快照待同步列表；进行中的同步会合并并发调用，
// 但这轮期间新保存的笔记（含强制/定向同步请求）必须补跑一轮，
// 否则要等下一个 15s 周期甚至更久（当轮卡在大图片上传时）。
let pendingRerun: { force?: boolean; noteId?: string } | null = null;

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

class OfflineSyncDeferred extends Error {
  constructor() {
    super('offline_sync_deferred');
    this.name = 'OfflineSyncDeferred';
  }
}

/** fetch rejects with TypeError when the browser loses connectivity mid-request. */
function isNetworkFailure(error: unknown) {
  return error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message);
}

interface SyncAttemptFailure {
  /** Version that this attempt tried to write; newer local edits must survive. */
  localVersion: number;
  error: unknown;
}

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
      if (!isOnline()) throw new OfflineSyncDeferred();
      const uploaded = await uploadNoteAsset(noteId, asset.blob, asset.filename);
      uploadedUrl = uploaded.url;
      await markLocalAssetUploaded(assetId, uploadedUrl);
    }
    await replaceLocalAssetReference(noteId, assetId, uploadedUrl);
    record = await getLocalNote(noteId);
    if (!record) return;
  }
}

async function syncRecord(noteId: string, queryClient?: QueryClient): Promise<SyncAttemptFailure | null> {
  let record = await getLocalNote(noteId);
  if (!record || record.status === 'conflict') return null;

  if (record.status === 'deleted') {
    const version = record.localVersion;
    if (!await setLocalNoteSyncing(noteId, version)) return null;
    try {
      if (!isOnline()) throw new OfflineSyncDeferred();
      await deleteNote(noteId);
    } catch (error) {
      if (!(error instanceof ApiClientError && error.status === 404)) return { localVersion: version, error };
    }
    await removeLocalNote(noteId);
    removeNoteCaches(queryClient, noteId);
    return null;
  }

  const uploadVersion = record.localVersion;
  try {
    await uploadLocalAssets(noteId);
  } catch (error) {
    return { localVersion: uploadVersion, error };
  }
  record = await getLocalNote(noteId);
  if (!record || record.status === 'deleted' || record.status === 'conflict') return null;
  const version = record.localVersion;
  if (!await setLocalNoteSyncing(noteId, version)) return null;
  // Existing notes edit knowledge through its dedicated endpoint. A stale
  // offline content snapshot must not write back an older knowledge object.
  const payload = record.note.revision ? { ...record.note, knowledge: undefined } : record.note;
  try {
    if (!isOnline()) throw new OfflineSyncDeferred();
    const serverNote = await upsertNote(noteId, payload);
    // 记录这次写入实际使用的基线，只有它能成为后续草稿的确认 revision。
    await completeLocalNoteSync(noteId, version, serverNote, record.note.revision);
    updateNoteCaches(queryClient, serverNote);
    return null;
  } catch (error) {
    return { localVersion: version, error };
  }
}

async function runSync(queryClient?: QueryClient, options?: { force?: boolean; noteId?: string }) {
  if (!isOnline()) return;
  const records = await pendingLocalNotes(Boolean(options?.force), options?.noteId);
  for (const record of records) {
    if (!isOnline()) break;
    const failure = await syncRecord(record.noteId, queryClient);
    if (!failure) continue;
    const { localVersion, error } = failure;
    // A server conflict is authoritative even if connectivity dropped after
    // the response arrived; it must not be downgraded to a retryable offline.
    if (error instanceof ApiClientError && (error.status === 409 || error.status === 428)) {
      await failLocalNoteSync(record.noteId, localVersion, error.message, true);
    } else if (error instanceof OfflineSyncDeferred || isNetworkFailure(error) || !isOnline()) {
      await deferLocalNoteSync(record.noteId, localVersion);
    } else {
      await failLocalNoteSync(
        record.noteId,
        localVersion,
        error instanceof Error ? error.message : String(error),
        false,
      );
    }
  }
  if (isOnline()) await pruneLocalAssets();
}

export function syncPendingNotebookData(queryClient?: QueryClient, options?: { force?: boolean; noteId?: string }) {
  if (activeSync) {
    pendingRerun = {
      force: (pendingRerun?.force ?? false) || Boolean(options?.force),
      noteId: options?.noteId ?? pendingRerun?.noteId,
    };
    return activeSync;
  }
  activeSync = runSync(queryClient, options).finally(() => {
    activeSync = null;
    if (pendingRerun) {
      const next = pendingRerun;
      pendingRerun = null;
      void syncPendingNotebookData(queryClient, next);
    }
  });
  return activeSync;
}
