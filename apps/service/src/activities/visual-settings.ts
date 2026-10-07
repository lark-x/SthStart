import type { DirectorSettings, ImageConfigDocument, SceneBeatRenderSettings } from '@sthstart/contracts';

/** Resolve user configuration only; workflow validation remains in the existing executor. */
export function resolveVisualSettings(document: ImageConfigDocument | null, local: SceneBeatRenderSettings = {}) {
  const direction = document?.artDirection;
  const quality = local.quality ?? direction?.quality ?? 'draft';
  const explicitSelection = Boolean(local.presetId || local.workflowId);
  const profile = explicitSelection ? null : direction?.renderProfiles[quality];
  const selection = explicitSelection ? {
    purpose: local.purpose, workflowId: local.workflowId, workflowVersion: local.workflowVersion,
    presetId: local.presetId, presetRevision: local.presetRevision,
  } : profile ?? {
    purpose: local.purpose,
    ...(!direction ? { workflowId: document?.defaultWorkflowId, workflowVersion: document?.defaultWorkflowVersion } : {}),
  };
  return {
    quality, selection,
    parameters: {
      ...(!direction ? document?.defaultParams : {}),
      ...(direction?.parameterOverrides[quality] ?? {}),
      ...(direction ? { width: direction.canvas.width, height: direction.canvas.height } : {}),
      ...local.parameters,
    } as Record<string, unknown>,
    // Empty is an intentional override, not a reason to fall back.
    negativePrompt: local.negativePrompt !== undefined ? local.negativePrompt : direction ? document?.globalNegativePrompt : undefined,
    stylePrompt: direction ? document?.globalStylePrompt ?? '' : '',
    directorPrompt: compileDirectorPrompt(local.director),
  };
}

export function compileDirectorPrompt(director?: DirectorSettings): string {
  if (!director) return '';
  const labels: Record<string, string> = {
    wide: '远景', medium: '中景', closeup: '特写', detail: '局部细节', full_body: '全身景别',
    eye_level: '平视角度', high: '俯视角度', low: '仰视角度',
    natural: '自然光', warm: '暖光', rim: '轮廓光', low_key: '低调光线',
    calm: '平静氛围', tense: '紧张氛围', joyful: '欢快氛围', melancholy: '忧郁氛围',
  };
  return Object.values(director).filter(Boolean).map(value => labels[value] ?? value).join('；');
}

/** Restoring defaults is not equivalent to erasing authored visual direction. */
export function restoreVisualDefaults(settings: SceneBeatRenderSettings): SceneBeatRenderSettings {
  const { purpose, workflowId, workflowVersion, presetId, presetRevision, quality, parameters, ...authored } = settings;
  return authored;
}
