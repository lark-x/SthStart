import { getJson, postJson } from '@/app/lib/api-client';
import { CreativePurposeOptionsSchema, ImagePreparationResponseSchema,
  type CreativePurposeOptions, type ImagePreparationRequest, type ImagePreparationResponse } from '@sthstart/contracts';

export function fetchImageGenerationOptions(appId: 'creative-center' | 'characters', purpose: string) {
  return getJson<CreativePurposeOptions>(`generation/image/options?appId=${encodeURIComponent(appId)}&purpose=${encodeURIComponent(purpose)}`,
    undefined, CreativePurposeOptionsSchema);
}
export function prepareImageGeneration(input: ImagePreparationRequest) {
  return postJson<ImagePreparationResponse>('generation/image/prepare', input, undefined, ImagePreparationResponseSchema);
}

export type ImageGenerationSubmission = {
  presetId?: string;
  presetRevision?: number;
  parameters: Record<string, unknown>;
  seed?: number | null;
  configurationHash: string;
  optimizerCallId?: string;
  sourceDescription?: string;
  idempotencyKey: string;
};
