import { getJson, postJson, putJson, patchJson, deleteJson } from '@/app/lib/api-client';
import type {
  KnowledgeCollection, KnowledgeCollectionRun, KnowledgeOrganizeDraft, KnowledgePendingItem,
  KnowledgeSourceVersion,
} from '@sthstart/contracts';

export interface CollectionSaveInput {
  name: string;
  goal?: string;
  works?: string[];
  characters?: string[];
  mode?: 'topic' | 'recent';
  windowDays?: number;
  sources?: Array<{ sourceId: string; searchTool: string; readTool?: string }>;
  targetNoteIds?: string[];
  frequency?: 'once' | 'daily' | 'weekly';
  dailyTime?: string;
  weekday?: number;
  timezone?: string;
  enabled?: boolean;
  /** 从企划发起的补查：带上会话 ID 便于回来时定位，但不作为任务存在的前提。 */
  sessionId?: string;
}

export async function fetchCollections(): Promise<{ items: KnowledgeCollection[]; runs: KnowledgeCollectionRun[] }> {
  return getJson('/api/admin/knowledge/collections');
}

export async function fetchCollection(id: string): Promise<{ collection: KnowledgeCollection; runs: KnowledgeCollectionRun[] }> {
  return getJson('/api/admin/knowledge/collections/' + encodeURIComponent(id));
}

export async function createCollection(input: CollectionSaveInput): Promise<KnowledgeCollection> {
  return postJson<KnowledgeCollection>('/api/admin/knowledge/collections', input);
}

export async function updateCollection(id: string, input: CollectionSaveInput): Promise<KnowledgeCollection> {
  return putJson<KnowledgeCollection>('/api/admin/knowledge/collections/' + encodeURIComponent(id), input);
}

export async function setCollectionEnabled(id: string, enabled: boolean): Promise<KnowledgeCollection> {
  return patchJson<KnowledgeCollection>('/api/admin/knowledge/collections/' + encodeURIComponent(id) + '/enabled', { enabled });
}

export async function deleteCollection(id: string): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>('/api/admin/knowledge/collections/' + encodeURIComponent(id));
}

export async function runCollection(id: string, options: { retryRunId?: string } = {}): Promise<{ run: KnowledgeCollectionRun; reused: boolean }> {
  return postJson('/api/admin/knowledge/collections/' + encodeURIComponent(id) + '/run', options);
}

export async function fetchCollectionRuns(collectionId?: string, limit = 30): Promise<{ items: KnowledgeCollectionRun[] }> {
  const params = new URLSearchParams();
  if (collectionId) params.set('collectionId', collectionId);
  params.set('limit', String(limit));
  return getJson('/api/admin/knowledge/collection-runs?' + params.toString());
}

export interface RunFinding {
  sourceVersionId: string;
  title: string;
  excerpt: string;
  url?: string;
  sourceName: string;
  publishedAt?: string;
  retrievedAt: string;
  truncated?: boolean;
  changeType: 'new' | 'changed' | 'duplicate';
  state: string;
}

export async function fetchCollectionRun(id: string): Promise<{ run: KnowledgeCollectionRun; findings: RunFinding[]; pending: KnowledgePendingItem[] }> {
  return getJson('/api/admin/knowledge/collection-runs/' + encodeURIComponent(id));
}

export async function cancelCollectionRun(id: string): Promise<KnowledgeCollectionRun> {
  return postJson<KnowledgeCollectionRun>('/api/admin/knowledge/collection-runs/' + encodeURIComponent(id) + '/cancel', {});
}

export async function fetchPending(options: { state?: string; collectionId?: string; limit?: number } = {}): Promise<{ items: KnowledgePendingItem[]; counts: Record<string, number> }> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.collectionId) params.set('collectionId', options.collectionId);
  params.set('limit', String(options.limit ?? 60));
  return getJson('/api/admin/knowledge/pending?' + params.toString());
}

export async function fetchPendingDetail(id: string): Promise<{ item: KnowledgePendingItem; versions: KnowledgeSourceVersion[] }> {
  return getJson('/api/admin/knowledge/pending/' + encodeURIComponent(id));
}

export async function setPendingState(ids: string[], state: 'pending' | 'kept' | 'ignored' | 'organized'): Promise<{ changed: number; counts: Record<string, number> }> {
  return patchJson('/api/admin/knowledge/pending', { ids, state });
}

export async function createOrganizeDraft(input: {
  itemIds: string[];
  /** 直接引用叙事档案的原文片段（不需要先成为待整理条目）。 */
  narrativeRefIds?: string[];
  targetNoteId?: string;
  instruction?: string;
}): Promise<KnowledgeOrganizeDraft> {
  return postJson<KnowledgeOrganizeDraft>('/api/admin/knowledge/organize-drafts', input);
}

export async function fetchOrganizeDraft(id: string): Promise<KnowledgeOrganizeDraft> {
  return getJson<KnowledgeOrganizeDraft>('/api/admin/knowledge/organize-drafts/' + encodeURIComponent(id));
}

export async function adoptOrganizeDraft(id: string, input: {
  mode: 'new-note' | 'append';
  targetNoteId?: string;
  expectedRevision?: number;
  title?: string;
}): Promise<{ noteId: string; created: boolean }> {
  return postJson('/api/admin/knowledge/organize-drafts/' + encodeURIComponent(id) + '/adopt', input);
}

// 收藏话题到资料库的入口在 notebook/api.ts（saveTopicToKnowledge），避免重复实现。
