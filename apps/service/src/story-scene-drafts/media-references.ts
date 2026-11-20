import { createArtifactReference } from '../artifacts.js';
import { CREATIVE_APP_ID } from '../creative.js';
import type { ServiceDatabase } from '../database.js';

/** Called in the transaction that saves the draft's reference choice. */
export function replaceScenePlanReference(database: ServiceDatabase, draftId: string, artifactId: string | null): boolean {
  const refType = 'story-scene-plan';
  if (artifactId) {
    const image = database.connection.prepare(`SELECT 1 FROM artifacts
      WHERE id=? AND app_id=? AND file_status='ready' AND media_type='image' AND content_type LIKE 'image/%'`)
      .get(artifactId, CREATIVE_APP_ID);
    if (!image) return false;
    createArtifactReference(database, { appId: CREATIVE_APP_ID, artifactId, refType, refId: draftId });
  }
  database.connection.prepare(`DELETE FROM artifact_references
    WHERE app_id=? AND ref_type=? AND ref_id=? AND artifact_id IS NOT ?`)
    .run(CREATIVE_APP_ID, refType, draftId, artifactId);
  return true;
}
