import { openDB, type DBSchema } from 'idb';

export interface StoryLocalDraft {
  key: string;
  projectId: string;
  entryKind: string;
  entryId: string;
  expectedRevision: number;
  title: string;
  body: string;
  updatedAt: number;
}

interface StoryDraftDatabase extends DBSchema {
  drafts: { key: string; value: StoryLocalDraft; indexes: { 'by-project': string } };
}

let databasePromise: ReturnType<typeof openDB<StoryDraftDatabase>> | undefined;
function database() {
  if (typeof indexedDB === 'undefined') throw new Error('此浏览器不支持本地草稿恢复。');
  databasePromise ??= openDB<StoryDraftDatabase>('sthstart-story-drafts', 1, {
    upgrade(db) {
      const drafts = db.createObjectStore('drafts', { keyPath: 'key' });
      drafts.createIndex('by-project', 'projectId');
    },
  });
  return databasePromise;
}

export async function readStoryLocalDraft(key: string) { return (await database()).get('drafts', key); }
export async function writeStoryLocalDraft(draft: StoryLocalDraft) { await (await database()).put('drafts', draft); }
export async function removeStoryLocalDraft(key: string) { await (await database()).delete('drafts', key); }
