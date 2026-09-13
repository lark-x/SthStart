import { adminFetch, getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import {
  CharacterAssetResponseSchema,
  GenerationTaskDescriptorSchema,
  CharacterDetailSchema,
  CharacterGenerateResponseSchema,
  CharacterListResponseSchema,
  CharacterProfileSchema,
  CharacterVersionSchema,
  CharacterMigrationReviewListSchema,
  CharacterMigrationReviewSchema,
  CharacterImportSessionSchema,
  CharacterLlmStatusResponseSchema,
} from '@sthstart/contracts';
import type {
  CharacterDraftAny,
  CharacterProfile,
  CharacterRelationship,
  CharacterSource,
  CharacterMigrationReview,
  CharacterMigrationReviewList,
  CharacterVersion,
  GenerationTaskDescriptor,
  CharacterImportSession,
  CharacterCardSearchResponse,
  CharacterLlmStatusResponse,
} from '@sthstart/contracts';

export type CharacterDetail = CharacterProfile & {
  versions: CharacterVersion[];
  sources: CharacterSource[];
  relationships: CharacterRelationship[];
  links: Array<{
    app_id: string;
    local_id: string;
    source_version: number;
    local_modified: number;
  }>;
};

export async function fetchCharacters(options?: { query?: string }): Promise<{ items: CharacterProfile[] }> {
  return getJson<{ items: CharacterProfile[] }>(`characters${options?.query ? `?q=${encodeURIComponent(options.query)}` : ''}`, undefined, CharacterListResponseSchema);
}

export async function fetchCharacterDetail(id: string): Promise<CharacterDetail> {
  return getJson<CharacterDetail>(`characters/${id}`, undefined, CharacterDetailSchema);
}

/** 结构迁移复核项：哪些内容在升级时无法自动归类，需要人确认。 */
export async function fetchCharacterMigrationReview(id: string): Promise<CharacterMigrationReview> {
  return getJson<CharacterMigrationReview>(`characters/${id}/migration-review`, undefined, CharacterMigrationReviewSchema);
}

/** 仍有复核项的角色清单。 */
export async function fetchCharacterMigrationReviews(): Promise<CharacterMigrationReviewList> {
  return getJson<CharacterMigrationReviewList>('character-migration-reviews', undefined, CharacterMigrationReviewListSchema);
}

export async function createCharacter(payload: {
  displayName: string;
  draft: CharacterDraftAny;
  tags: string[];
}): Promise<CharacterProfile> {
  return postJson<CharacterProfile>('characters', payload, undefined, CharacterProfileSchema);
}

export async function updateCharacter(
  id: string,
  payload: { draft: CharacterDraftAny; tags: string[]; expectedDraftRevision?: number }
): Promise<CharacterProfile> {
  return putJson<CharacterProfile>(`characters/${id}`, payload, undefined, CharacterProfileSchema);
}

export async function generateCharacterDraft(
  id: string,
  description: string,
  useWeb = true,
): Promise<{ draft: CharacterDraftAny; sources: CharacterSource[] }> {
  return postJson(`characters/${id}/generate`, { description, useWeb }, undefined, CharacterGenerateResponseSchema);
}

export async function publishCharacter(id: string, expectedDraftRevision?: number): Promise<CharacterVersion> {
  return postJson<CharacterVersion>(`characters/${id}/publish`, expectedDraftRevision == null ? undefined : { expectedDraftRevision }, undefined, CharacterVersionSchema);
}

export async function uploadCharacterAvatar(
  id: string,
  file: File
): Promise<Record<string, unknown>> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return postJson(
    `characters/${id}/assets`,
    { dataUrl, filename: file.name, kind: 'avatar' },
    undefined,
    CharacterAssetResponseSchema
  );
}

export async function uploadCharacterReference(id: string, file: File, purposes = ['identity']): Promise<{ id: string; url: string; reference?: Record<string, unknown> }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
  return postJson(`characters/${id}/assets`, { dataUrl, filename: file.name, kind: 'reference', purposes }, undefined);
}

export async function fetchCharacterVisualReferences(id: string): Promise<{ items: Array<Record<string, unknown>> }> {
  return getJson(`characters/${id}/visual-references`);
}

export async function extractCharacterAppearance(id: string, referenceId: string, expectedDraftRevision?: number): Promise<{ id: string; referenceId: string; extraction: Record<string, unknown>; draftRevision: number }> {
  return postJson(`characters/${id}/appearance-extractions`, { referenceId, ...(expectedDraftRevision == null ? {} : { expectedDraftRevision }) });
}

export async function applyCharacterAppearanceExtraction(id: string, taskId: string, expectedDraftRevision: number, fieldPaths: string[]): Promise<{ draft: CharacterDraftAny; draftRevision: number; candidateId: string }> {
  return postJson(`characters/${id}/appearance-extractions/${taskId}/apply`, { expectedDraftRevision, fieldPaths });
}

export type CharacterAuditionResult = {
  id: string;
  scenario: string;
  output: string;
  feedback?: string;
  suggestions: Array<{ fieldPath: string; before: string; after: string; reason: string }>;
  draftRevision: number;
  compilerVersion: string;
  profileId: string;
};

export async function auditionCharacter(
  id: string,
  input: { scenario: string; feedback?: string; draftRevision?: number },
): Promise<CharacterAuditionResult> {
  return postJson<CharacterAuditionResult>(`characters/${id}/auditions`, input);
}

export async function fetchCharacterModelAssignments(id: string): Promise<{ items: Array<{ role: 'text' | 'multimodal'; profile_id: string; updated_at: string }> }> {
  return getJson(`characters/${id}/model-assignments`);
}

export async function fetchCharacterLlmStatus(id: string): Promise<CharacterLlmStatusResponse> {
  return getJson(`characters/${id}/llm-status`, undefined, CharacterLlmStatusResponseSchema);
}

export async function updateCharacterModelAssignments(id: string, input: { textProfileId?: string | null; multimodalProfileId?: string | null }) {
  return putJson(`characters/${id}/model-assignments`, input);
}

export async function generateCharacterAvatar(id: string, prompt?: string): Promise<GenerationTaskDescriptor> {
  return postJson<GenerationTaskDescriptor>(
    `characters/${id}/generate-avatar`,
    prompt?.trim() ? { prompt: prompt.trim() } : undefined,
    undefined,
    GenerationTaskDescriptorSchema,
  );
}

export async function fetchCharacterGenerationTask(id: string, taskId: string): Promise<GenerationTaskDescriptor> {
  return getJson<GenerationTaskDescriptor>(
    `characters/${id}/generation-tasks/${taskId}`,
    undefined,
    GenerationTaskDescriptorSchema,
  );
}

export async function applyCharacterAvatar(id: string, taskId: string): Promise<{ id: string; url: string }> {
  return postJson<{ id: string; url: string }>(
    `characters/${id}/generation-tasks/${taskId}/apply-avatar`,
    undefined,
    undefined,
    CharacterAssetResponseSchema,
  );
}

export async function importTavernCard(card: Record<string, unknown>): Promise<CharacterProfile> {
  return postJson<CharacterProfile>('characters/import-tavern', { card }, undefined, CharacterProfileSchema);
}

export async function searchCharacterCards(input: { providerId?: string; query: string; cursor?: string; limit?: number; signal?: AbortSignal }): Promise<CharacterCardSearchResponse> {
  const params = new URLSearchParams({ providerId: input.providerId || 'character-tavern', q: input.query });
  if (input.cursor) params.set('cursor', input.cursor);
  if (input.limit) params.set('limit', String(input.limit));
  return getJson<CharacterCardSearchResponse>(`characters/card-search?${params.toString()}`, { signal: input.signal });
}

export async function fetchCharacterCardDetail(providerId: string, externalId: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ providerId, externalId });
  return getJson<Record<string, unknown>>(`characters/card-detail?${params.toString()}`);
}

export async function createCharacterImportSession(payload: Record<string, unknown>, idempotencyKey?: string): Promise<CharacterImportSession> {
  return postJson<CharacterImportSession>('characters/import-sessions', payload, idempotencyKey ? { headers: { 'idempotency-key': idempotencyKey } } : undefined, CharacterImportSessionSchema);
}

export async function updateCharacterImportSession(id: string, payload: Record<string, unknown>): Promise<CharacterImportSession> {
  const response = await adminFetch(`/api/admin/characters/import-sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload), cache: 'no-store',
  });
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  return (await response.json()) as CharacterImportSession;
}

export async function commitCharacterImportSession(id: string, payload: { expectedPreviewRevision: number; previewHash?: string; targetCharacterId?: string | null; baseDraftRevision?: number | null }, idempotencyKey: string): Promise<{ characterId: string; created: boolean; draftRevision: number }> {
  return postJson(`characters/import-sessions/${encodeURIComponent(id)}/commit`, payload, { headers: { 'idempotency-key': idempotencyKey } });
}

export async function cancelCharacterImportSession(id: string): Promise<{ cancelled: boolean }> {
  return deleteJson(`characters/import-sessions/${encodeURIComponent(id)}`);
}

export async function createCharacterImportSessionFromFile(file: File, targetCharacterId?: string, baseDraftRevision?: number): Promise<CharacterImportSession> {
  const bytes = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
  return createCharacterImportSession({ dataBase64: bytes, mimeType: file.type || 'application/octet-stream', filename: file.name, ...(targetCharacterId ? { targetCharacterId } : {}), ...(baseDraftRevision == null ? {} : { baseDraftRevision }) }, crypto.randomUUID());
}

export async function exportTavernCard(id: string): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(`characters/${id}/export-tavern`);
}

export async function saveCharacterRelationship(
  id: string,
  relationship: { toCharacterId: string; relationType: string; description: string }
): Promise<Record<string, unknown>> {
  return putJson(`characters/${id}/relationship`, relationship);
}

export async function deleteCharacterRelationship(
  id: string,
  relationshipId: string
): Promise<Record<string, unknown>> {
  return deleteJson(`characters/${id}/relationships/${relationshipId}`);
}

export async function browseCharacters(filter: import('@sthstart/contracts').CharacterBrowseQuery, signal?: AbortSignal): Promise<import('@sthstart/contracts').CharacterBrowseResult> {
  return getJson(`characters/browse?${new URLSearchParams({ filter: JSON.stringify(filter) })}`, { signal });
}
export type OrganizationEdit = { ids: string[]; work?: string; originType?: 'ip' | 'original'; tags?: string[]; groups?: string[]; interpretation?: string; favorite?: boolean; fillEmpty?: boolean; replaceTags?: boolean; replaceGroups?: boolean };
export const editCharacterOrganization = (input: OrganizationEdit) => putJson<{ updated: number }>('characters/organization', input);
export const saveCharacterWork = (input: import('@sthstart/contracts').CharacterWork) => putJson('characters/works', input);
export type ImportDuplicate = { id: string; displayName: string; draftRevision: number; kind: 'exact' | 'source' | 'name' };
export const fetchImportDuplicates = (id: string) => getJson<{ items: ImportDuplicate[] }>(`characters/import-sessions/${id}/duplicates`);
export const fetchImportSession = (id: string) => getJson<CharacterImportSession>(`characters/import-sessions/${id}`, undefined, CharacterImportSessionSchema);
