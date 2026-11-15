import type {
  ActivityAsset,
  GenerationPreset,
  PromptRecipeOverride,
  ReferenceInput,
  ReferenceInputRole,
} from '@sthstart/contracts';

export type WorkbenchReferenceRole = Extract<ReferenceInputRole, 'init_image' | 'identity' | 'outfit' | 'style'>;

export function buildPromptReferences({
  selectedReferenceKey,
  asset,
  role,
  referenceId,
}: {
  selectedReferenceKey: string | null;
  asset?: ActivityAsset;
  role: WorkbenchReferenceRole;
  referenceId: string;
}): ReferenceInput[] {
  if (!selectedReferenceKey) return [];
  if (!asset) throw new Error('参考图尚未加载，请重试');
  return [{
    referenceId,
    assetKey: asset.assetKey,
    artifactId: asset.artifactId,
    sha256: asset.sha256 || '',
    role,
    inputKey: 'sourceImage',
  }];
}

export function buildPromptCustomParams(selectedReferenceKey: string | null, denoise: number) {
  return { denoise: selectedReferenceKey ? denoise : undefined };
}

/** 与绘制按钮的待复用签名保持一致；字段顺序即原始 JSON 顺序。 */
export function buildDrawSignature({
  slotId,
  config,
  overrides,
  referenceKey,
  referenceRole,
  denoise,
  preset,
  seed,
  contentRevisionId,
}: {
  slotId: string;
  config: unknown;
  overrides: PromptRecipeOverride[];
  referenceKey: string | null;
  referenceRole: WorkbenchReferenceRole;
  denoise: number;
  preset?: GenerationPreset;
  seed: number;
  contentRevisionId?: string | null;
}): string {
  return JSON.stringify({
    slot: slotId,
    config,
    overrides,
    reference: referenceKey,
    referenceRole,
    denoise,
    preset,
    seed,
    contentRevisionId,
  });
}
