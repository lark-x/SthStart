'use client';

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CreativeNote } from '@sthstart/contracts';

export type NotebookSyncStatus = 'pending' | 'syncing' | 'synced' | 'error' | 'conflict' | 'deleted';

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
const SYNC_LEASE_MS = 60_000;
let databasePromise: Promise<IDBPDatabase<NotebookDatabase>> | null = null;
// 本次会话内已删除笔记的墓碑：防止过期的服务端列表响应复活已删除的笔记。
const deletedNoteTombstones = new Set<string>();
// 本标签页自己 PUT 成功并收到确认的 revision，以及这条写入链上出现过的
// revision。只有这些 revision 能用来回填过期草稿的写入基线；服务端刷新
// 拿到的 revision 可能包含其他客户端的修改，抬高基线会静默覆盖真实冲突。
export interface AcknowledgedWrite { revision: number; proven: Set<number>; }
const acknowledgedWrites = new Map<string, AcknowledgedWrite>();
// 草稿最多滞后几次连续写入；保留最近几个基线即可，避免长会话无限增长。
const MAX_PROVEN_REVISIONS = 8;

/**
 * 只有紧接上一次本机确认的写入才算同一条链。跨过未知 revision（例如外部
 * 先写了 2→3，本机再从 3 写 4）时必须丢弃旧链：更早的本地草稿不能越过
 * 2→3 直接抬到 4，否则会静默覆盖外部修改。
 */
export function mergeAcknowledgedWrite(
  previous: AcknowledgedWrite | undefined,
  sentRevision: number | undefined,
  serverRevision: number,
): AcknowledgedWrite {
  const continuous = typeof sentRevision === 'number' && previous?.revision === sentRevision;
  const proven = continuous ? new Set(previous.proven) : new Set<number>();
  if (typeof sentRevision === 'number') proven.add(sentRevision);
  proven.add(serverRevision);
  while (proven.size > MAX_PROVEN_REVISIONS) {
    const oldest = proven.values().next().value;
    if (oldest === undefined) break;
    proven.delete(oldest);
  }
  return { revision: serverRevision, proven };
}

/** 更新的本机记录只有在正好基于这次请求发送的 revision 时才能继承新版本。 */
export function canAdvancePendingRevision(
  pendingRevision: number | undefined,
  sentRevision: number | undefined,
) {
  return pendingRevision === sentRevision;
}

function rememberAcknowledgedWrite(noteId: string, revision: number, sentRevision?: number) {
  acknowledgedWrites.set(noteId, mergeAcknowledgedWrite(acknowledgedWrites.get(noteId), sentRevision, revision));
}

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

/**
 * A draft may only claim a revision this tab itself wrote and had acknowledged.
 * Revisions observed through a fetch are never promoted: advancing onto them
 * would make the next PUT overwrite an external edit instead of receiving the
 * server's real 409.
 */
export function draftBaseRevision(
  incomingRevision: number | undefined,
  acknowledgedRevision: number | undefined,
  provenRevisions?: ReadonlySet<number>,
) {
  if (typeof acknowledgedRevision !== 'number') return incomingRevision;
  // 新笔记首次确认后编辑器可能还没有 revision；它此时唯一可用的基线就是确认值。
  if (typeof incomingRevision !== 'number') return acknowledgedRevision;
  if (incomingRevision >= acknowledgedRevision) return incomingRevision;
  // 只回填本标签页写入链上真实出现过的 revision，别的基线仍然交给 409。
  return provenRevisions?.has(incomingRevision) ? acknowledgedRevision : incomingRevision;
}

/** Build the next record without dropping newer local content or its safe base. */
export function nextLocalNoteRecord(
  existing: LocalNoteRecord | undefined,
  note: CreativeNote,
  status: NotebookSyncStatus,
  now: number,
  acknowledgedWrite: AcknowledgedWrite | undefined,
): LocalNoteRecord {
  if (!note.id) throw new Error('note_id_required');
  const canRebase = status === 'pending' && existing?.status !== 'conflict';
  const revision = draftBaseRevision(note.revision, canRebase ? acknowledgedWrite?.revision : undefined,
    canRebase ? acknowledgedWrite?.proven : undefined);
  const savedNote = { ...note, id: note.id, updatedAt: note.updatedAt ?? new Date(now).toISOString() };
  if (typeof revision === 'number') savedNote.revision = revision;
  return {
    ...existing,
    noteId: note.id,
    note: savedNote,
    localVersion: (existing?.localVersion ?? 0) + 1,
    status: existing?.status === 'conflict' && status === 'pending' ? 'conflict' : status,
    updatedAt: now,
    attemptCount: status === 'pending' ? 0 : (existing?.attemptCount ?? 0),
    nextAttemptAt: 0,
    ...(existing?.status === 'conflict' && status === 'pending'
      ? { error: existing.error }
      : { error: undefined }),
  };
}

export async function saveLocalNote(note: CreativeNote, status: NotebookSyncStatus = 'pending') {
  if (!note.id) throw new Error('note_id_required');
  const db = await database();
  // 读取、比较和写入必须同属一个事务：并发的同步完成/失败不能把刚写入的
  // 本地编辑覆盖回旧内容。
  const transaction = db.transaction('notes', 'readwrite');
  const existing = await transaction.store.get(note.id);
  const record = nextLocalNoteRecord(existing, note, status, Date.now(), acknowledgedWrites.get(note.id));
  if (existing && existing.status !== 'deleted' && existing.status !== 'error'
    && JSON.stringify(existing.note) === JSON.stringify(record.note)) {
    await transaction.done;
    return existing;
  }
  await transaction.store.put(record);
  await transaction.done;
  announce(note.id);
  return record;
}

export async function saveServerNotes(notes: CreativeNote[]) {
  const db = await database();
  const transaction = db.transaction('notes', 'readwrite');
  for (const note of notes) {
    if (!note.id || deletedNoteTombstones.has(note.id)) continue;
    const existing = await transaction.store.get(note.id);
    if (existing && existing.status !== 'synced') continue;
    // 列表响应可能早于本机的 PUT 完成（内容更旧），按 revision 丢弃过期版本。
    if (
      existing
      && typeof existing.note.revision === 'number'
      && typeof note.revision === 'number'
      && note.revision < existing.note.revision
    ) continue;
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
  deletedNoteTombstones.add(noteId);
  acknowledgedWrites.delete(noteId);
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

/** 另一个标签页可能已认领同一版本；只有租约过期后才允许接管。 */
export function canClaimSyncLease(
  record: Pick<LocalNoteRecord, 'localVersion' | 'status' | 'updatedAt'> | undefined,
  localVersion: number,
  now: number,
) {
  if (!record || record.localVersion !== localVersion) return false;
  if (record.status === 'synced' || record.status === 'conflict') return false;
  if (record.status === 'syncing' && record.updatedAt >= now - SYNC_LEASE_MS) return false;
  return true;
}

export async function setLocalNoteSyncing(noteId: string, localVersion: number) {
  const db = await database();
  const transaction = db.transaction('notes', 'readwrite');
  const record = await transaction.store.get(noteId);
  // 同步列表可能已过期：已同步、已冲突或刚被其他标签页认领的记录都不应再 PUT。
  if (!record || !canClaimSyncLease(record, localVersion, Date.now())) {
    await transaction.done;
    return false;
  }
  // A delete tombstone must survive an offline retry; it is never a draft
  // that can be promoted back to a live note.
  if (record.status !== 'deleted') record.status = 'syncing';
  record.error = undefined;
  record.updatedAt = Date.now();
  await transaction.store.put(record);
  await transaction.done;
  announce(noteId);
  return true;
}

export async function completeLocalNoteSync(noteId: string, localVersion: number, serverNote?: CreativeNote, sentRevision?: number) {
  const db = await database();
  const transaction = db.transaction('notes', 'readwrite');
  const record = await transaction.store.get(noteId);
  if (!record) {
    await transaction.done;
    return;
  }
  if (record.localVersion === localVersion) {
    record.status = 'synced';
    record.note = serverNote ?? record.note;
    record.attemptCount = 0;
    record.nextAttemptAt = 0;
    record.error = undefined;
    record.updatedAt = Date.now();
  } else {
    if (record.status !== 'deleted' && record.status !== 'conflict') record.status = 'pending';
    // 只在同一写入链上推进：待同步记录若基于别的（可能是外部）版本，
    // 抬高它的基线会让下一次 PUT 越过真实冲突。
    if (typeof serverNote?.revision === 'number'
      && canAdvancePendingRevision(record.note.revision, sentRevision)) {
      record.note.revision = serverNote.revision;
    }
  }
  await transaction.store.put(record);
  await transaction.done;
  // 这是本标签页自己的写入成功；调用方随后保存的草稿可以安全地基于它。
  if (typeof serverNote?.revision === 'number') rememberAcknowledgedWrite(noteId, serverNote.revision, sentRevision);
  announce(noteId);
}

export async function failLocalNoteSync(noteId: string, localVersion: number, message: string, conflict = false) {
  const db = await database();
  const transaction = db.transaction('notes', 'readwrite');
  const record = await transaction.store.get(noteId);
  if (!record || record.localVersion !== localVersion) {
    await transaction.done;
    return;
  }
  if (record.status !== 'deleted') record.status = conflict ? 'conflict' : 'error';
  record.error = message;
  record.attemptCount += 1;
  record.nextAttemptAt = Date.now() + Math.min(5 * 60_000, 5_000 * (2 ** Math.min(record.attemptCount, 6)));
  await transaction.store.put(record);
  await transaction.done;
  announce(noteId);
}

/**
 * A sync that lost connectivity is not a failed write: keep the local draft
 * pending so the online event can retry it without showing a sync error.
 */
export async function deferLocalNoteSync(noteId: string, localVersion: number) {
  const db = await database();
  const transaction = db.transaction('notes', 'readwrite');
  const record = await transaction.store.get(noteId);
  if (!record || record.localVersion !== localVersion || record.status === 'deleted' || record.status === 'conflict') {
    await transaction.done;
    return;
  }
  record.status = 'pending';
  record.error = undefined;
  record.nextAttemptAt = 0;
  record.updatedAt = Date.now();
  await transaction.store.put(record);
  await transaction.done;
  announce(noteId);
}

/** Keep the complete local draft before accepting the server's version. */
export async function preserveConflictCopy(noteId: string, localVersion: number, copyId: string, serverNote: CreativeNote | null, copyContent?: CreativeNote['content']) {
  const db = await database();
  const transaction = db.transaction(['notes', 'assets'], 'readwrite');
  const notes = transaction.objectStore('notes');
  const record = await notes.get(noteId);
  if (!record || record.localVersion !== localVersion || record.status !== 'conflict') {
    await transaction.done;
    throw new Error('本机草稿已变化，请重新处理冲突。');
  }
  const now = new Date().toISOString();
  const copy: CreativeNote = { ...record.note, id: copyId, revision: undefined,
    content: copyContent ?? record.note.content,
    title: `${record.note.title || '未命名笔记'}（本机副本）`, createdAt: now, updatedAt: now };
  await notes.put({ noteId: copyId, note: copy, localVersion: 1, status: 'pending',
    updatedAt: Date.now(), attemptCount: 0, nextAttemptAt: 0 });
  // Local image blobs must survive later deletion of the original note.
  for (const block of copy.content) {
    const assetId = block.type === 'image' ? localAssetId(block.src) : null;
    if (!assetId) continue;
    const asset = await transaction.objectStore('assets').get(assetId);
    if (asset) await transaction.objectStore('assets').put({ ...asset, noteId: copyId });
  }
  if (serverNote) {
    await notes.put({ noteId, note: serverNote, localVersion: localVersion + 1, status: 'synced',
      updatedAt: Date.now(), attemptCount: 0, nextAttemptAt: 0 });
  } else await notes.delete(noteId);
  await transaction.done;
  // 记录已换成服务端抓取的内容，之前本机写入的确认基线不再适用。
  acknowledgedWrites.delete(noteId);
  acknowledgedWrites.delete(copyId);
  if (!serverNote) deletedNoteTombstones.add(noteId);
  announce(noteId); announce(copyId);
  return copy;
}

export async function removeLocalNote(noteId: string) {
  const db = await database();
  const transaction = db.transaction(['notes', 'assets'], 'readwrite');
  const assets = await transaction.objectStore('assets').index('by-note').getAllKeys(noteId);
  for (const assetId of assets) await transaction.objectStore('assets').delete(assetId);
  await transaction.objectStore('notes').delete(noteId);
  await transaction.done;
  acknowledgedWrites.delete(noteId);
  announce(noteId);
}

export async function pendingLocalNotes(force = false, noteId?: string) {
  const records = await listLocalNotes();
  const now = Date.now();
  return records.filter((record) =>
    (!noteId || record.noteId === noteId)
    && record.status !== 'synced'
    && record.status !== 'conflict'
    && (record.status !== 'syncing' || record.updatedAt < now - SYNC_LEASE_MS)
    && (force || record.nextAttemptAt <= now));
}

export async function addLocalAsset(noteId: string, blob: Blob, filename: string) {
  const db = await database();
  const existing = await db.getAll('assets');
  // 配额只约束“待上传”的资产；已上传、等待被 prune 回收的不占额度。
  const usedBytes = existing.reduce((sum, asset) => sum + (asset.uploadedUrl ? 0 : asset.blob.size), 0);
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
    if (record.status !== 'conflict') record.status = 'pending';
    record.updatedAt = Date.now();
    await transaction.objectStore('notes').put(record);
  }
  // 保留本地 blob（只标记已上传）：编辑器的内存态可能仍持有 notebook-local://
  // 引用并在下一次自动保存时写回；blob 一旦删除，同步就会永久报 local_image_missing。
  // 未再被引用的上传资产由 pruneLocalAssets 统一回收。
  const asset = await transaction.objectStore('assets').get(assetId);
  if (asset && !asset.uploadedUrl) {
    asset.uploadedUrl = uploadedUrl;
    await transaction.objectStore('assets').put(asset);
  }
  await transaction.done;
  announce(noteId);
}

export async function pruneLocalAssets() {
  const db = await database();
  const [notes, assets] = await Promise.all([
    db.getAll('notes'),
    db.getAll('assets'),
  ]);
  const referenced = new Set<string>();
  for (const record of notes) {
    for (const block of record.note.content) {
      if (block.type !== 'image') continue;
      const assetId = localAssetId(block.src);
      if (assetId) referenced.add(assetId);
    }
  }
  const stale = assets.filter((asset) => asset.uploadedUrl && !referenced.has(asset.id));
  if (!stale.length) return;
  const transaction = db.transaction('assets', 'readwrite');
  for (const asset of stale) await transaction.store.delete(asset.id);
  await transaction.done;
  if (stale.length) announce();
}
