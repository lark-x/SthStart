import {
  StorySceneActionResponseSchema,
  StorySceneDraftSchema,
  StorySceneListSchema,
  type CreateStorySceneDraft,
  type PatchStorySceneDraft,
  type StorySceneActionRequest,
  type StorySceneActionResponse,
  type StorySceneDraft,
  type StorySceneList,
} from '@sthstart/contracts';
import { getJson, patchJson, postJson } from '@/app/lib/api-client';

const endpoint = 'story-scene-drafts';
const draftPath = (id: string) => `${endpoint}/${encodeURIComponent(id)}`;
export const sceneHref = (id: string) => `/apps/story-worlds/scenes/${encodeURIComponent(id)}`;
export const sceneKeys = {
  list: [endpoint, 'list'] as const,
  detail: (id: string) => [endpoint, id] as const,
};

export function listSceneDrafts(cursor: string | null, signal?: AbortSignal): Promise<StorySceneList> {
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return getJson(`${endpoint}?${params}`, { signal }, StorySceneListSchema);
}

export function getSceneDraft(id: string, signal?: AbortSignal): Promise<StorySceneDraft> {
  return getJson(draftPath(id), { signal }, StorySceneDraftSchema);
}

export function createSceneDraft(body: CreateStorySceneDraft): Promise<StorySceneDraft> {
  return postJson(endpoint, body, undefined, StorySceneDraftSchema);
}

export function patchSceneDraft(id: string, body: PatchStorySceneDraft): Promise<StorySceneDraft> {
  return patchJson(draftPath(id), body, undefined, StorySceneDraftSchema);
}

export function runSceneAction(id: string, body: StorySceneActionRequest): Promise<StorySceneActionResponse> {
  return postJson(`${draftPath(id)}/actions`, body, undefined, StorySceneActionResponseSchema);
}
