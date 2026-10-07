import type { SceneBeatRenderSettings } from '@sthstart/contracts';

/** Defaults reset drawing choices, never the user's visual description or actor references. */
export function restoreVisualDefaults(settings: SceneBeatRenderSettings): SceneBeatRenderSettings {
  const { purpose, workflowId, workflowVersion, presetId, presetRevision, quality, parameters, ...authored } = settings;
  return authored;
}
