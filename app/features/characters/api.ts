import { getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import {
  CharacterAssetResponseSchema,
  GenerationTaskDescriptorSchema,
  CharacterDetailSchema,
  CharacterGenerateResponseSchema,
  CharacterListResponseSchema,
  CharacterProfileSchema,
  CharacterVersionSchema,
} from '@sthstart/contracts';
import type {
  CharacterDraft,
  CharacterProfile,
  CharacterRelationship,
  CharacterSource,
  CharacterVersion,
  GenerationTaskDescriptor,
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

export async function fetchCharacters(): Promise<{ items: CharacterProfile[] }> {
  return getJson<{ items: CharacterProfile[] }>('characters', undefined, CharacterListResponseSchema);
}

export async function fetchCharacterDetail(id: string): Promise<CharacterDetail> {
  return getJson<CharacterDetail>(`characters/${id}`, undefined, CharacterDetailSchema);
}

export async function createCharacter(payload: {
  displayName: string;
  draft: CharacterDraft;
  tags: string[];
}): Promise<CharacterProfile> {
  return postJson<CharacterProfile>('characters', payload, undefined, CharacterProfileSchema);
}

export async function updateCharacter(
  id: string,
  payload: { draft: CharacterDraft; tags: string[] }
): Promise<CharacterProfile> {
  return putJson<CharacterProfile>(`characters/${id}`, payload, undefined, CharacterProfileSchema);
}

export async function generateCharacterDraft(
  id: string,
  description: string,
  useWeb = true,
): Promise<{ draft: CharacterDraft; sources: CharacterSource[] }> {
  return postJson(`characters/${id}/generate`, { description, useWeb }, undefined, CharacterGenerateResponseSchema);
}

export async function publishCharacter(id: string): Promise<CharacterVersion> {
  return postJson<CharacterVersion>(`characters/${id}/publish`, undefined, undefined, CharacterVersionSchema);
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
