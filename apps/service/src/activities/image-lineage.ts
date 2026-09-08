import { randomUUID } from 'node:crypto';
import type { AssetLineageEdge, ImageTransformParams } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

export interface RecordLineageParams {
  activityId: string;
  childAssetKey: string;
  parentAssetKey: string;
  attemptId?: string | null;
  role?: string;
  transformParams?: ImageTransformParams | Record<string, unknown>;
}

export function wouldCreateCycle(
  database: ServiceDatabase,
  activityId: string,
  childAssetKey: string,
  parentAssetKey: string,
): boolean {
  if (childAssetKey === parentAssetKey) return true;

  // Check if childAssetKey is already an ancestor of parentAssetKey
  const visited = new Set<string>();
  const queue = [parentAssetKey];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === childAssetKey) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = database.connection.prepare(`
      SELECT parent_asset_key FROM activity_image_lineage
      WHERE activity_id = ? AND child_asset_key = ?
    `).all(activityId, current) as Array<{ parent_asset_key: string }>;

    for (const p of parents) {
      if (!visited.has(p.parent_asset_key)) {
        queue.push(p.parent_asset_key);
      }
    }
  }

  return false;
}

export function recordAssetLineage(
  database: ServiceDatabase,
  params: RecordLineageParams,
): AssetLineageEdge {
  const { activityId, childAssetKey, parentAssetKey, attemptId = null, role = 'init_image', transformParams } = params;

  if (wouldCreateCycle(database, activityId, childAssetKey, parentAssetKey)) {
    throw new Error(`lineage_cycle_detected: adding edge from ${parentAssetKey} to ${childAssetKey} would create a cycle`);
  }

  const id = `edge_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = nowIso();

  database.connection.prepare(`
    INSERT INTO activity_image_lineage (
      id, activity_id, child_asset_key, parent_asset_key, attempt_id, role, transform_params_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    activityId,
    childAssetKey,
    parentAssetKey,
    attemptId,
    role,
    JSON.stringify(transformParams || {}),
    now,
  );

  return {
    id,
    activityId,
    childAssetKey,
    parentAssetKey,
    attemptId,
    role,
    transformParams,
    createdAt: now,
  };
}

export function getAssetAncestors(
  database: ServiceDatabase,
  activityId: string,
  assetKey: string,
): AssetLineageEdge[] {
  const results: AssetLineageEdge[] = [];
  const visited = new Set<string>();
  const queue = [assetKey];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const rows = database.connection.prepare(`
      SELECT id, activity_id, child_asset_key, parent_asset_key, attempt_id, role, transform_params_json, created_at
      FROM activity_image_lineage
      WHERE activity_id = ? AND child_asset_key = ?
    `).all(activityId, current) as Array<{
      id: string;
      activity_id: string;
      child_asset_key: string;
      parent_asset_key: string;
      attempt_id: string | null;
      role: string;
      transform_params_json: string;
      created_at: string;
    }>;

    for (const r of rows) {
      results.push({
        id: r.id,
        activityId: r.activity_id,
        childAssetKey: r.child_asset_key,
        parentAssetKey: r.parent_asset_key,
        attemptId: r.attempt_id,
        role: r.role,
        transformParams: JSON.parse(r.transform_params_json),
        createdAt: r.created_at,
      });
      if (!visited.has(r.parent_asset_key)) {
        queue.push(r.parent_asset_key);
      }
    }
  }

  return results;
}
