'use client';

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CreativeNote } from '@sthstart/contracts';

export type NotebookSyncStatus = 'pending' | 'syncing' | 'synced' | 'error' | 'deleted';

export interface LocalNoteRecord {
  noteId: string;
  note: CreativeNote;
  localVersion: number;
  status: NotebookSyncStatus;
  updatedAt: number;
  attemptCount: number;
  nextAttemptAt: number;
  error?: string;
}

export interface LocalAssetRecord {
  id: string;
  noteId: string;
  blob: Blob;
  filename: string;
  contentType: string;
  createdAt: number;
  uploadedUrl?: string;
}

interface NotebookDatabase extends DBSchema {
  notes: {
    key: string;
    value: LocalNoteRecord;
    indexes: { 'by-updated': number; 'by-status': NotebookSyncStatus };
  };
  assets: {
    key: string;
    value: LocalAssetRecord;
    indexes: { 'by-note': string; 'by-created': number };
  };
}

const DB_NAME = 'sthstart-notebook';
const DB_VERSION = 1;
const LOCAL_ASSET_PREFIX = 'notebook-local://';
const MAX_PENDING_ASSET_BYTES = 100 * 1024 * 1024;
const CHANGE_EVENT = 'sthstart:notebook-local-change';
let databasePromise: Promise<IDBPDatabase<NotebookDatabase>> | null = null;

function database() {
  if (typeof indexedDB === 'undefined') throw new Error('indexeddb_unavailable');
  databasePromise ??= openDB<NotebookDatabase>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const notes = db.createObjectStore('notes', { keyPath: 'noteId' });
      notes.createIndex('by-updated', 'updatedAt');
      notes.createIndex('by-status', 'status');
      const assets = db.createObjectStore('assets', { keyPath: 'id' });
      assets.createIndex('by-note', 'noteId');
      assets.createIndex('by-created', 'createdAt');
    },
  });
  return databasePromise;
}

function announce(noteId?: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { noteId } }));
}

export function subscribeNotebookLocalChanges(callback: (noteId?: string) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<{ noteId?: string }>).detail?.noteId);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function localAssetId(url: string) {
  return url.startsWith(LOCAL_ASSET_PREFIX) ? url.slice(LOCAL_ASSET_PREFIX.length) : null;
}

export async function getLocalNote(noteId: string) {
  return (await database()).get('notes', noteId);
}

export async function listLocalNotes() {
  return (await database()).getAll('notes');
}

export async function saveLocalNote(note: CreativeNote, status: NotebookSyncStatus = 'pending') {
  if (!note.id) throw new Error('note_id_required');
  const db = await database();
  const transaction = db.transaction('notes', 'readwrite');
  const existing = await transaction.store.get(note.id);
  if (existing && existing.status !== 'deleted' && existing.status !== 'error'
    && JSON.stringify(existing.note) === JSON.stringify(note)) {
    await transaction.done;
    return existing;
  }
  const record: LocalNoteRecord = {
    noteId: note.id,
    note: { ...note, id: note.id },
    localVersion: (existing?.localVersion ?? 0) + 1,
    status,
    updatedAt: Date.now(),
    attemptCount: status === 'pending' ? 0 : (existing?.attemptCount ?? 0),
    nextAttemptAt: 0,
  };
  await transaction.store.put(record);
  await transaction.done;
  announce(note.id);
  return record;
}

export async function saveServerNotes(notes: CreativeNote[]) {
  const db = await database();
  const transaction = db.transaction('notes', 'readwrite');
  for (const note of notes) {
    if (!note.id) continue;
    const existing = await transaction.store.get(note.id);
    if (existing && existing.status !== 'synced') continue;
    await transaction.store.put({
      noteId: note.id,
      note,
      localVersion: existing?.localVersion ?? 0,
      status: 'synced',
      updatedAt: Date.now(),
      attemptCount: 0,
      nextAttemptAt: 0,
    });
  }
  await transaction.done;
  announce();
}

export async function markLocalNoteDeleted(noteId: string, fallback: CreativeNote) {
  const db = await database();
  const existing = await db.get('notes', noteId);
  await db.put('notes', {
    noteId,
    note: existing?.note ?? fallback,
    localVersion: (existing?.localVersion ?? 0) + 1,
    status: 'deleted',
    updatedAt: Date.now(),
    attemptCount: 0,
    nextAttemptAt: 0,
  });
  announce(noteId);
}

export async function setLocalNoteSyncing(noteId: string, localVersion: number) {
  const db = await database();
  const record = await db.get('notes', noteId);
  if (!record || record.localVersion !== localVersion) return false;
  record.status = 'syncing';
  record.error = undefined;
  record.updatedAt = Date.now();
  await db.put('notes', record);
  announce(noteId);
  return true;
}

export async function completeLocalNoteSync(noteId: string, localVersion: number, serverNote?: CreativeNote) {
  const db = await database();
  const record = await db.get('notes', noteId);
  if (!record) return;
  if (record.localVersion === localVersion) {
    record.status = 'synced';
    record.note = serverNote ?? record.note;
    record.attemptCount = 0;
    record.nextAttemptAt = 0;
    record.error = undefined;
    record.updatedAt = Date.now();
  } else {
    record.status = 'pending';
    if (serverNote?.revision) record.note.revision = serverNote.revision;
  }
  await db.put('notes', record);
  announce(noteId);
}

export async function failLocalNoteSync(noteId: string, localVersion: number, message: string) {
  const db = await database();
  const record = await db.get('notes', noteId);
  if (!record || record.localVersion !== localVersion) return;
  record.status = 'error';
  record.error = message;
  record.attemptCount += 1;
  record.nextAttemptAt = Date.now() + Math.min(5 * 60_000, 5_000 * (2 ** Math.min(record.attemptCount, 6)));
  await db.put('notes', record);
  announce(noteId);
}

export async function removeLocalNote(noteId: string) {
  const db = await database();
  const transaction = db.transaction(['notes', 'assets'], 'readwrite');
  const assets = await transaction.objectStore('assets').index('by-note').getAllKeys(noteId);
  for (const assetId of assets) await transaction.objectStore('assets').delete(assetId);
  await transaction.objectStore('notes').delete(noteId);
  await transaction.done;
  announce(noteId);
}

export async function pendingLocalNotes(force = false, noteId?: string) {
  const records = await listLocalNotes();
  const now = Date.now();
  return records.filter((record) =>
    (!noteId || record.noteId === noteId)
    && record.status !== 'synced'
    && (record.status !== 'syncing' || record.updatedAt < now - 60_000)
    && (force || record.nextAttemptAt <= now));
}

export async function addLocalAsset(noteId: string, blob: Blob, filename: string) {
  const db = await database();
  const existing = await db.getAll('assets');
  const usedBytes = existing.reduce((sum, asset) => sum + asset.blob.size, 0);
  if (usedBytes + blob.size > MAX_PENDING_ASSET_BYTES) throw new Error('local_asset_quota_exceeded');
  const id = crypto.randomUUID();
  await db.put('assets', { id, noteId, blob, filename, contentType: blob.type, createdAt: Date.now() });
  announce(noteId);
  return `${LOCAL_ASSET_PREFIX}${id}`;
}

export async function getLocalAsset(id: string) {
  return (await database()).get('assets', id);
}

export async function removeLocalAsset(id: string) {
  const db = await database();
  const asset = await db.get('assets', id);
  await db.delete('assets', id);
  announce(asset?.noteId);
}

export async function markLocalAssetUploaded(id: string, uploadedUrl: string) {
  const db = await database();
  const asset = await db.get('assets', id);
  if (!asset) return;
  asset.uploadedUrl = uploadedUrl;
  await db.put('assets', asset);
}

export async function replaceLocalAssetReference(noteId: string, assetId: string, uploadedUrl: string) {
  const db = await database();
  const transaction = db.transaction(['notes', 'assets'], 'readwrite');
  const record = await transaction.objectStore('notes').get(noteId);
  if (record) {
    const localUrl = `${LOCAL_ASSET_PREFIX}${assetId}`;
    record.note = {
      ...record.note,
      content: record.note.content.map((block) => block.type === 'image' && block.src === localUrl
        ? { ...block, src: uploadedUrl }
        : block),
    };
    record.localVersion += 1;
    record.status = 'pending';
    record.updatedAt = Date.now();
    await transaction.objectStore('notes').put(record);
  }
  await transaction.objectStore('assets').delete(assetId);
  await transaction.done;
  announce(noteId);
}
