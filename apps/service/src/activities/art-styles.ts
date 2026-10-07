import { ActivityArtStylePayloadSchema, isActivityArtStylePayload, type ActivityArtStyleWrite } from '@sthstart/contracts';
import { Value } from '@sinclair/typebox/value';
import type { ServiceDatabase } from '../database.js';
import { createArtifactReference } from '../artifacts.js';
import { createActivityPreset, getActivityPreset, listActivityPresets, updateActivityPreset } from './presets.js';
import { validateArtPreview, validateArtProfiles } from './art-config-validation.js';

function validateArtStyle(database: ServiceDatabase, input: ActivityArtStyleWrite) {
  if (!input.name.trim() || !Value.Check(ActivityArtStylePayloadSchema, input.payload)) {
    throw Object.assign(new Error('画风名称或配置无效'), { statusCode: 400, code: 'invalid_art_style' });
  }
  validateArtProfiles(database, input.payload);
  validateArtPreview(database, input.payload.previewArtifactId);
}

export function listActivityArtStyles(database: ServiceDatabase) {
  return listActivityPresets(database, 'production_preset').filter(item => isActivityArtStylePayload(item.payload));
}

export function saveActivityArtStyle(database: ServiceDatabase, input: ActivityArtStyleWrite, update?: { id: string; expectedVersion: number }) {
  return database.transaction(() => {
    validateArtStyle(database, input);
    if (update) {
      const existing = getActivityPreset(database, update.id);
      if (!existing || existing.kind !== 'production_preset' || !isActivityArtStylePayload(existing.payload)) {
        throw Object.assign(new Error('画风不存在'), { statusCode: 404, code: 'art_style_not_found' });
      }
      if (existing.version !== update.expectedVersion) {
        throw Object.assign(new Error('画风已被修改，请刷新后重试'), { statusCode: 409, code: 'art_style_conflict' });
      }
    }
    const preset = update
      ? updateActivityPreset(database, update.id, { name: input.name, payload: input.payload })
      : createActivityPreset(database, { kind: 'production_preset', name: input.name, payload: input.payload });
    if (input.payload.previewArtifactId) createArtifactReference(database, {
      artifactId: input.payload.previewArtifactId, appId: 'activities', refType: 'activity_art_style', refId: `art-style:${preset.id}:${preset.version}`,
    });
    return preset;
  });
}
