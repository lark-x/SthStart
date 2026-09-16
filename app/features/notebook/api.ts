import { adminFetch, ApiClientError, getJson, postJson, putJson, deleteJson, validateResponse } from '@/app/lib/api-client';
import {
  CreativeNoteSchema,
  CreativeNotesResponseSchema,
  KnowledgeReferenceCheckResponseSchema,
  KnowledgeSearchResponseSchema,
  NoteAssetResponseSchema,
  NoteDeleteResponseSchema,
  type CreativeNote,
  type KnowledgeRecommendation,
  type KnowledgeReferenceCheckResponse,
  type KnowledgeSearchItem,
  type KnowledgeSearchResponse,
  type NoteKnowledge,
  type PlanningKnowledgeSnapshot,
  type PlanningReferenceSelection,
} from '@sthstart/contracts';

export interface NoteListFilters {
  q?: string;
  kind?: string;
  stage?: string;
  works?: string[];
  characters?: string[];
  category?: string;
  usage?: string;
  nature?: string;
  favorite?: boolean;
  page?: number;
  pageSize?: number;
}

export async function fetchNotes(filters?: NoteListFilters): Promise<{
  items: CreativeNote[];
  total?: number;
  page?: number;
  pageSize?: number;
  facets?: {
    works: string[];
    characters: string[];
    categories: string[];
    usages: string[];
    natures: string[];
  };
}> {
  const params = new URLSearchParams();
  if (filters?.q) params.set('q', filters.q);
  if (filters?.kind && filters.kind !== 'all') params.set('kind', filters.kind);
  if (filters?.stage && filters.stage !== 'all') params.set('stage', filters.stage);
  for (const work of filters?.works ?? []) params.append('works', work);
  for (const character of filters?.characters ?? []) params.append('characters', character);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.usage) params.set('usage', filters.usage);
  if (filters?.nature) params.set('nature', filters.nature);
  if (filters?.favorite) params.set('favorite', '1');
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return getJson('notebook/notes' + (qs ? '?' + qs : ''), undefined, CreativeNotesResponseSchema);
}

export async function fetchNoteDetail(id: string): Promise<CreativeNote> {
  return getJson<CreativeNote>('notebook/notes/' + id, undefined, CreativeNoteSchema);
}

export async function createNote(payload: Partial<CreativeNote>): Promise<CreativeNote> {
  return postJson<CreativeNote>('notebook/notes', payload, undefined, CreativeNoteSchema);
}

export async function updateNote(id: string, payload: Partial<CreativeNote>): Promise<CreativeNote> {
  return putJson<CreativeNote>('notebook/notes/' + id, payload, undefined, CreativeNoteSchema);
}

export const upsertNote = updateNote;

export async function deleteNote(id: string): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>('notebook/notes/' + id, undefined, NoteDeleteResponseSchema);
}

/**
 * 单独保存资料元数据：正文保存与属性保存分开，旧客户端同步不会把元数据清掉。
 * null 表示显式清空。
 */
export async function saveNoteKnowledge(id: string, knowledge: NoteKnowledge | null): Promise<{ knowledge: NoteKnowledge | null }> {
  return putJson<{ knowledge: NoteKnowledge | null }>('knowledge/notes/' + id + '/knowledge', { knowledge });
}

export interface NoteReferenceRecord {
  id: string;
  sourceKind: string;
  sourceId: string;
  title: string;
  sessionId?: string;
  activityId?: string;
  createdAt: string;
}

export async function fetchNoteReferences(id: string): Promise<{ items: NoteReferenceRecord[] }> {
  return getJson('knowledge/notes/' + id + '/references');
}

export interface KnowledgeSearchParams {
  q?: string;
  workId?: string;
  works?: string[];
  characters?: string[];
  kinds?: Array<'note' | 'narrative'>;
  limit?: number;
}

export async function searchKnowledge(params: KnowledgeSearchParams): Promise<KnowledgeSearchResponse> {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.workId) search.set('workId', params.workId);
  for (const work of params.works ?? []) search.append('works', work);
  for (const character of params.characters ?? []) search.append('characters', character);
  for (const kind of params.kinds ?? []) search.append('kinds', kind);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return getJson<KnowledgeSearchResponse>('knowledge/search' + (qs ? '?' + qs : ''), undefined, KnowledgeSearchResponseSchema);
}

/** 引用预览：按选择读取权威内容并编译快照，但不保存。 */
export async function previewReferences(selections: PlanningReferenceSelection[]): Promise<{
  snapshot: PlanningKnowledgeSnapshot;
  unresolved: Array<{ sourceKind: string; sourceId: string; reason: string }>;
  truncated: boolean;
}> {
  return postJson('knowledge/references/preview', { selections });
}

/** 引用更新检查：只比较本地内容 hash，不逐条联网。 */
export async function checkReferences(snapshot: PlanningKnowledgeSnapshot): Promise<KnowledgeReferenceCheckResponse> {
  return postJson<KnowledgeReferenceCheckResponse>('knowledge/references/check', { snapshot }, undefined, KnowledgeReferenceCheckResponseSchema);
}

export async function recommendKnowledge(input: {
  works?: string[];
  characters?: string[];
  locations?: string[];
  theme?: string;
  keywords?: string[];
  limit?: number;
  includePending?: boolean;
}): Promise<{ items: KnowledgeRecommendation[]; empty: boolean }> {
  const search = new URLSearchParams();
  for (const work of input.works ?? []) search.append('works', work);
  for (const character of input.characters ?? []) search.append('characters', character);
  for (const location of input.locations ?? []) search.append('locations', location);
  if (input.theme?.trim()) search.set('theme', input.theme.trim());
  for (const keyword of input.keywords ?? []) search.append('keywords', keyword);
  if (input.limit) search.set('limit', String(input.limit));
  if (input.includePending) search.set('includePending', '1');
  const qs = search.toString();
  return getJson('knowledge/recommendations' + (qs ? '?' + qs : ''));
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
    throw new ApiClientError(String(payload?.message ?? payload?.error ?? ('HTTP ' + response.status)), {
      status: response.status,
      code: typeof payload?.error === 'string' ? payload.error : undefined,
      requestId: response.headers.get('x-request-id'),
    });
  }
  return validateResponse<{ id: string; url: string }>(payload, NoteAssetResponseSchema, response.url);
}

/** 从话题素材收藏到资料库：重复点击返回已有收藏，不复制第二份。 */
export async function saveTopicToKnowledge(topicId: string): Promise<{ noteId: string; created: boolean }> {
  return postJson('knowledge/topics/' + topicId + '/save');
}

export type { KnowledgeSearchItem };
