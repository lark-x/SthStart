import { createHash, randomUUID } from 'node:crypto';
import type {
  Activity,
  ImageConfigDocument,
  ImageConfigDraft,
  ImageConfigRevision,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { ActivityStore } from './store.js';

export function hashImageConfig(doc: ImageConfigDocument): string {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

export function getDefaultImageConfigDocument(): ImageConfigDocument {
  return {
    schemaVersion: 1,
    stylePreset: 'anime_standard',
    globalStylePrompt: 'anime aesthetic, clean lines, vibrant colors, soft volumetric lighting, detailed environment',
    globalNegativePrompt: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry',
    slotConfigs: [],
  };
}

export function getImageConfigDraft(
  database: ServiceDatabase,
  activityId: string,
): ImageConfigDraft {
  const row = database.connection.prepare(
    'SELECT activity_id, draft_version, document_json, base_revision_id, updated_at FROM activity_image_config_drafts WHERE activity_id = ?'
  ).get(activityId) as {
    activity_id: string;
    draft_version: number;
    document_json: string;
    base_revision_id: string | null;
    updated_at: string;
  } | undefined;

  if (row) {
    return {
      activityId: row.activity_id,
      draftVersion: row.draft_version,
      document: JSON.parse(row.document_json) as ImageConfigDocument,
      baseRevisionId: row.base_revision_id,
      updatedAt: row.updated_at,
    };
  }

  const defaultDoc = getDefaultImageConfigDocument();
  const now = nowIso();

  database.connection.prepare(`
    INSERT INTO activity_image_config_drafts (activity_id, draft_version, document_json, base_revision_id, updated_at)
    VALUES (?, 1, ?, NULL, ?)
    ON CONFLICT(activity_id) DO NOTHING
  `).run(activityId, JSON.stringify(defaultDoc), now);

  return {
    activityId,
    draftVersion: 1,
    document: defaultDoc,
    baseRevisionId: null,
    updatedAt: now,
  };
}

export function saveImageConfigDraft(
  database: ServiceDatabase,
  activityId: string,
  expectedDraftVersion: number,
  document: ImageConfigDocument,
): ImageConfigDraft {
  const current = getImageConfigDraft(database, activityId);
  if (current.draftVersion !== expectedDraftVersion) {
    const err = new Error('图像配置草稿版本冲突，请刷新后重试');
    (err as unknown as { statusCode: number; code: string }).statusCode = 409;
    (err as unknown as { code: string }).code = 'draft_version_conflict';
    throw err;
  }

  const newVersion = current.draftVersion + 1;
  const now = nowIso();

  database.connection.prepare(`
    UPDATE activity_image_config_drafts
    SET draft_version = ?, document_json = ?, updated_at = ?
    WHERE activity_id = ? AND draft_version = ?
  `).run(newVersion, JSON.stringify(document), now, activityId, expectedDraftVersion);

  return {
    activityId,
    draftVersion: newVersion,
    document,
    baseRevisionId: current.baseRevisionId,
    updatedAt: now,
  };
}

export function commitImageConfigRevision(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  expectedDraftVersion: number,
  expectedHeadVersion: number,
): { revision: ImageConfigRevision; activity: Activity } {
  const activity = store.getActivity(activityId);
  if (!activity) throw new Error('activity_not_found');

  if (activity.headVersion !== expectedHeadVersion) {
    const err = new Error('活动版本冲突');
    (err as unknown as { statusCode: number; code: string }).statusCode = 409;
    (err as unknown as { code: string }).code = 'revision_conflict';
    throw err;
  }

  const draft = getImageConfigDraft(database, activityId);
  if (draft.draftVersion !== expectedDraftVersion) {
    const err = new Error('图像配置草稿版本冲突');
    (err as unknown as { statusCode: number; code: string }).statusCode = 409;
    (err as unknown as { code: string }).code = 'draft_version_conflict';
    throw err;
  }

  const revId = `rev_imgcfg_${randomUUID().replace(/-/g, '')}`;
  const now = nowIso();
  const hash = hashImageConfig(draft.document);

  return database.transaction(() => {
    // 1. Insert image config revision
    database.connection.prepare(`
      INSERT INTO activity_image_config_revisions (id, activity_id, parent_id, document_json, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(revId, activityId, draft.baseRevisionId, JSON.stringify(draft.document), hash, now);

    // 2. Update image config draft baseRevisionId
    database.connection.prepare(`
      UPDATE activity_image_config_drafts
      SET base_revision_id = ?, updated_at = ?
      WHERE activity_id = ?
    `).run(revId, now, activityId);

    // 3. Create a new media revision that references this image config revision,
    //    keeping existing slot bindings if any.
    const currentMediaRev = activity.currentMediaRevisionId
      ? store.getMediaRevision(activityId, activity.currentMediaRevisionId)
      : null;
    const slotBindings = currentMediaRev?.slotBindings || [];

    const newMediaRevId = `rev_media_${randomUUID().replace(/-/g, '')}`;
    const mediaDoc = { schemaVersion: 1, slotBindings };
    const mediaHash = createHash('sha256').update(JSON.stringify(mediaDoc)).digest('hex');
    const newHeadVersion = activity.headVersion + 1;

    database.connection.prepare(`
      INSERT INTO activity_media_revisions (id, activity_id, content_revision_id, image_config_revision_id, slot_bindings_json, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      newMediaRevId,
      activityId,
      activity.currentContentRevisionId,
      revId,
      JSON.stringify(slotBindings),
      mediaHash,
      now
    );

    // 4. Update activity headVersion and currentMediaRevisionId
    database.connection.prepare(`
      UPDATE activities
      SET head_version = ?, current_media_revision_id = ?, updated_at = ?
      WHERE id = ? AND head_version = ?
    `).run(newHeadVersion, newMediaRevId, now, activityId, expectedHeadVersion);

    const updatedActivity = store.getActivity(activityId)!;

    return {
      revision: {
        id: revId,
        activityId,
        parentId: draft.baseRevisionId,
        document: draft.document,
        hash,
        createdAt: now,
      },
      activity: updatedActivity,
    };
  });
}

export function getImageConfigRevision(
  database: ServiceDatabase,
  activityId: string,
  revisionId: string,
): ImageConfigRevision | null {
  const row = database.connection.prepare(`
    SELECT id, activity_id, parent_id, document_json, hash, created_at
    FROM activity_image_config_revisions
    WHERE activity_id = ? AND id = ?
  `).get(activityId, revisionId) as {
    id: string;
    activity_id: string;
    parent_id: string | null;
    document_json: string;
    hash: string;
    created_at: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    activityId: row.activity_id,
    parentId: row.parent_id,
    document: JSON.parse(row.document_json),
    hash: row.hash,
    createdAt: row.created_at,
  };
}

export function listImageConfigRevisions(
  database: ServiceDatabase,
  activityId: string,
  limit = 50,
): ImageConfigRevision[] {
  const rows = database.connection.prepare(`
    SELECT id, activity_id, parent_id, document_json, hash, created_at
    FROM activity_image_config_revisions
    WHERE activity_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(activityId, limit) as Array<{
    id: string;
    activity_id: string;
    parent_id: string | null;
    document_json: string;
    hash: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    activityId: r.activity_id,
    parentId: r.parent_id,
    document: JSON.parse(r.document_json),
    hash: r.hash,
    createdAt: r.created_at,
  }));
}
