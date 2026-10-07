import type { ActivityArtStylePayload, ImageConfigDocument } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { hasArtifactAccess } from '../artifacts.js';
import { mergeActivityImageInputs, resolveActivityImageWorkflow } from './image-render-common.js';

export function validateArtPreview(database: ServiceDatabase, artifactId: string | null) {
  if (!artifactId) return;
  const artifact = database.connection.prepare('SELECT media_type,file_status FROM artifacts WHERE id=?').get(artifactId) as { media_type: string; file_status: string } | undefined;
  if (!artifact || !(artifact.media_type === 'image' || artifact.media_type?.startsWith('image/')) || artifact.file_status !== 'ready'
      || !hasArtifactAccess(database, artifactId, 'activities', 'reference')) {
    throw Object.assign(new Error('画风预览图片不存在、不可用或未授权给活动'), { statusCode: 400, code: 'invalid_art_preview' });
  }
}

export function validateArtProfiles(database: ServiceDatabase, art: Pick<ActivityArtStylePayload, 'renderProfiles' | 'defaultCanvas'>,
  overrides?: ImageConfigDocument['artDirection']) {
  for (const [quality, profile] of Object.entries(art.renderProfiles)) {
    if (!profile) continue;
    const selection = resolveActivityImageWorkflow(database, profile);
    // Uses the same schema, semantic dimensions, model locks and step validation as submission.
    mergeActivityImageInputs(selection.resolved, selection.presetValues, {
      ...overrides?.parameterOverrides[quality as 'draft' | 'final'],
      width: art.defaultCanvas.width, height: art.defaultCanvas.height,
    }, true);
  }
}

export function validateArtDirection(database: ServiceDatabase, document: ImageConfigDocument) {
  const direction = document.artDirection;
  if (!direction) return;
  validateArtProfiles(database, { renderProfiles: direction.renderProfiles, defaultCanvas: direction.canvas }, direction);
  if (direction.selectedStyle) {
    // A frozen older card is legal even after its editable source card changes or is removed.
    validateArtPreview(database, direction.selectedStyle.payloadSnapshot.previewArtifactId);
  }
}
