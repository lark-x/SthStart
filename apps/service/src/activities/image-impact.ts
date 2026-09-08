import type {
  AffectedSlotPreview,
  ImpactPreview,
  SourceEntityKind,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { computeValueHash } from './image-provenance.js';
import type { ActivityStore } from './store.js';

export function previewSourceImpact(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  params: {
    changedEntityKind: SourceEntityKind;
    changedEntityId: string;
    fieldPath: string;
    newValue: unknown;
  },
): ImpactPreview {
  const { changedEntityKind, changedEntityId, fieldPath, newValue } = params;
  const newHash = computeValueHash(newValue);

  let targetProp = fieldPath;
  if (targetProp.includes('].')) {
    targetProp = targetProp.split('].')[1];
  }
  const cleanSlashPath = '/' + targetProp.replace(/^\//, '');

  // 1. Query dependent slots from activity_image_source_dependencies
  const depRows = database.connection.prepare(`
    SELECT slot_id, recipe_id, value_hash, field_path
    FROM activity_image_source_dependencies
    WHERE activity_id = ? AND entity_kind = ? AND entity_id = ?
      AND (field_path = ? OR field_path = ? OR field_path LIKE '%' || ?)
  `).all(activityId, changedEntityKind, changedEntityId, fieldPath, cleanSlashPath, targetProp) as Array<{
    slot_id: string;
    recipe_id: string;
    value_hash: string;
    field_path: string;
  }>;

  const activity = store.getActivity(activityId);
  const currentMediaRev = activity?.currentMediaRevisionId
    ? store.getMediaRevision(activityId, activity.currentMediaRevisionId)
    : null;

  const slotBindingsMap = new Map<string, string | null>();
  if (currentMediaRev?.slotBindings) {
    for (const b of currentMediaRev.slotBindings) {
      slotBindingsMap.set(b.slotId, b.assets?.[0]?.assetKey || null);
    }
  }

  // Check active attempts for slots
  const activeAttempts = database.connection.prepare(`
    SELECT slot_id FROM activity_image_attempts
    WHERE activity_id = ? AND status IN ('preparing', 'submitting', 'queued', 'running')
  `).all(activityId) as Array<{ slot_id: string }>;
  const activeAttemptSlotSet = new Set(activeAttempts.map((a) => a.slot_id));

  const affectedSlots: AffectedSlotPreview[] = [];
  let oldValue: unknown = null;

  for (const dep of depRows) {
    const isChanged = dep.value_hash !== newHash;
    const currentAssetKey = slotBindingsMap.get(dep.slot_id) || null;

    // Fetch old value snapshot if not fetched yet
    if (oldValue === null) {
      const recipeRow = database.connection.prepare(
        'SELECT source_refs_json FROM activity_prompt_recipes WHERE id = ?'
      ).get(dep.recipe_id) as { source_refs_json: string } | undefined;
      if (recipeRow) {
        try {
          const refs = JSON.parse(recipeRow.source_refs_json) as Array<{ entityKind: string; entityId: string; fieldPath: string; valueSnapshot: unknown }>;
          const targetRef = refs.find((r) =>
            r.entityKind === changedEntityKind &&
            r.entityId === changedEntityId &&
            (r.fieldPath === fieldPath || r.fieldPath === cleanSlashPath || r.fieldPath.includes(targetProp))
          );
          if (targetRef) oldValue = targetRef.valueSnapshot;
        } catch {
          // ignore
        }
      }
    }

    affectedSlots.push({
      slotId: dep.slot_id,
      reason: `${changedEntityKind === 'actor' ? '角色设定' : (changedEntityKind === 'style' ? '图像画风' : '剧情场景')} 发生了变更`,
      fieldPath,
      oldValueHash: dep.value_hash,
      newValueHash: newHash,
      currentAssetKey,
      needsReview: isChanged,
      hasActiveAttempt: activeAttemptSlotSet.has(dep.slot_id),
    });
  }

  return {
    activityId,
    changedEntityKind,
    changedEntityId,
    fieldPath,
    oldValue,
    newValue,
    affectedSlots,
  };
}

export function listActivitySourceDependencies(
  database: ServiceDatabase,
  activityId: string,
  slotId?: string,
) {
  let query = `
    SELECT slot_id, recipe_id, entity_kind, entity_id, field_path, value_hash, updated_at
    FROM activity_image_source_dependencies
    WHERE activity_id = ?
  `;
  const params: string[] = [activityId];

  if (slotId) {
    query += ' AND slot_id = ?';
    params.push(slotId);
  }

  return database.connection.prepare(query).all(...params);
}
