import type {
  BeatRenderAdoptResponse, BeatRenderCandidateList, BeatRenderPreview, BeatRenderPreviewRequest,
  BeatRenderSubmitRequest, BeatRenderSubmitResponse,
} from '@sthstart/contracts';
import {
  BeatRenderAdoptResponseSchema, BeatRenderCandidateListSchema, BeatRenderPreviewSchema, BeatRenderSubmitResponseSchema,
} from '@sthstart/contracts';
import { getJson, postJson } from '@/app/lib/api-client';

export async function previewBeatRender(activityId: string, body: BeatRenderPreviewRequest): Promise<BeatRenderPreview> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/beat-renders/preview`, body, undefined, BeatRenderPreviewSchema);
}

export async function submitBeatRender(activityId: string, body: BeatRenderSubmitRequest): Promise<BeatRenderSubmitResponse> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/beat-renders`, body, undefined, BeatRenderSubmitResponseSchema);
}

export async function fetchBeatRenderCandidates(activityId: string, stageId: string, sceneId: string, beatId: string, offset = 0): Promise<BeatRenderCandidateList> {
  const query = new URLSearchParams({ stageId, sceneId, beatId, limit: '24', offset: String(offset) });
  return getJson(`/api/admin/activities/${encodeURIComponent(activityId)}/beat-renders?${query.toString()}`, undefined, BeatRenderCandidateListSchema);
}

export async function adoptBeatRenderCandidate(activityId: string, candidateId: string): Promise<BeatRenderAdoptResponse> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/beat-renders/${encodeURIComponent(candidateId)}/adopt`, {}, undefined, BeatRenderAdoptResponseSchema);
}

export async function selectBeatRenderImage(activityId: string, candidateId: string, artifactId: string, allowStaleSource = false): Promise<BeatRenderAdoptResponse> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/beat-renders/${encodeURIComponent(candidateId)}/images/${encodeURIComponent(artifactId)}/select`,
    { allowStaleSource }, undefined, BeatRenderAdoptResponseSchema);
}

export async function rerenderBeatRenderCandidate(activityId: string, candidateId: string, seed?: number): Promise<BeatRenderSubmitResponse> {
  return postJson(`/api/admin/activities/${encodeURIComponent(activityId)}/beat-renders/${encodeURIComponent(candidateId)}/rerender`,
    seed === undefined ? {} : { seed }, undefined, BeatRenderSubmitResponseSchema);
}
