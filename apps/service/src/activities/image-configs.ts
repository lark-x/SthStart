import { recordConfigImpacts } from './change-impact.js';
import { ImageConfigDocumentSchema, normalizeCreationProfile } from '@sthstart/contracts';
import { Value } from '@sinclair/typebox/value';
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
import { createArtifactReference } from '../artifacts.js';
import { validateArtDirection } from './art-config-validation.js';

export function hashImageConfig(doc: ImageConfigDocument): string {
  return createHash('sha256').update(JSON.stringify(doc, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')));
    }
    return value;
  })).digest('hex');
}

function configError(message: string, code: string, statusCode = 409): Error {
  return Object.assign(new Error(message), { code, statusCode });
}

function validateImageConfig(document: ImageConfigDocument): void {
  if (!Value.Check(ImageConfigDocumentSchema, document)) {
    const issue = [...Value.Errors(ImageConfigDocumentSchema, document)][0];
    throw configError(`图像配置无效：${issue?.path || '/'} ${issue?.message || ''}`, 'invalid_image_config', 400);
  }
  const ids = document.slotConfigs.map(slot => slot.slotId);
  if (new Set(ids).size !== ids.length) {
    throw configError('图像配置包含重复的素材槽位', 'invalid_image_config', 400);
  }
}

/** Read the configuration actually bound to the activity, without creating a draft. */
export function getCommittedImageConfig(database: ServiceDatabase, activityId: string): ImageConfigDocument | null {
  const row = database.connection.prepare(`SELECT c.document_json FROM activities a
    JOIN activity_media_revisions m ON m.id=a.current_media_revision_id AND m.activity_id=a.id
    JOIN activity_image_config_revisions c ON c.id=m.image_config_revision_id AND c.activity_id=a.id
    WHERE a.id=?`).get(activityId) as { document_json: string } | undefined;
  return row ? JSON.parse(row.document_json) as ImageConfigDocument : null;
}

export function getCommittedImageConfigRevisionId(database: ServiceDatabase, activityId: string): string | null {
  const row = database.connection.prepare(`SELECT m.image_config_revision_id FROM activities a
    JOIN activity_media_revisions m ON m.id=a.current_media_revision_id AND m.activity_id=a.id WHERE a.id=?`).get(activityId) as
    { image_config_revision_id: string | null } | undefined;
  return row?.image_config_revision_id ?? null;
}

export function getDefaultImageConfigDocument(): ImageConfigDocument {
  return {
    schemaVersion: 1,
    stylePreset: 'anime_standard',
    globalStylePrompt: normalizeCreationProfile({}).globalStylePrompt,
    globalNegativePrompt: normalizeCreationProfile({}).globalNegativePrompt,
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
  const content = database.connection.prepare('SELECT document_json FROM activity_drafts WHERE activity_id=?').get(activityId) as {document_json:string}|undefined;
  const profile = content ? JSON.parse(content.document_json)?.activity?.creationProfile?.values : null;
  if (profile) { const values=normalizeCreationProfile(profile); defaultDoc.globalStylePrompt=values.globalStylePrompt; defaultDoc.globalNegativePrompt=values.globalNegativePrompt; }

  const now = nowIso();

  database.connection.prepare(`
    INSERT INTO activity_image_config_drafts (activity_id, draft_version, document_json, base_revision_id, updated_at)
    VALUES (?, 1, ?, NULL, ?)
    ON CONFLICT(activity_id) DO NOTHING
  `).run(activityId, JSON.stringify(defaultDoc), now);

  // Another connection may have inserted first; return what was actually stored.
  return getImageConfigDraft(database, activityId);
}

export function saveImageConfigDraft(
  database: ServiceDatabase,
  activityId: string,
  expectedDraftVersion: number,
  document: ImageConfigDocument,
  options: { skipTransaction?: boolean } = {},
): ImageConfigDraft {
  const operation = () => {
  validateImageConfig(document);
  validateArtDirection(database, document);
  const current = getImageConfigDraft(database, activityId);
  if (current.draftVersion !== expectedDraftVersion) {
    const err = new Error('图像配置草稿版本冲突，请刷新后重试');
    (err as unknown as { statusCode: number; code: string }).statusCode = 409;
    (err as unknown as { code: string }).code = 'draft_version_conflict';
    throw err;
  }

  const newVersion = current.draftVersion + 1;
  const now = nowIso();

  const saved = database.connection.prepare(`
    UPDATE activity_image_config_drafts
    SET draft_version = ?, document_json = ?, updated_at = ?
    WHERE activity_id = ? AND draft_version = ?
  `).run(newVersion, JSON.stringify(document), now, activityId, expectedDraftVersion);
  if (Number(saved.changes) !== 1) {
    throw configError('图像配置草稿版本冲突，请刷新后重试', 'draft_version_conflict');
  }
  const preview = document.artDirection?.selectedStyle?.payloadSnapshot.previewArtifactId;
  const refId = `image-config-draft:${activityId}`;
  if (preview) createArtifactReference(database, { artifactId: preview, appId: 'activities', refType: 'activity_image_config_draft', refId });
  database.connection.prepare(`DELETE FROM artifact_references WHERE app_id='activities'
    AND ref_type='activity_image_config_draft' AND ref_id=? AND artifact_id<>?`).run(refId, preview ?? '');

  return {
    activityId,
    draftVersion: newVersion,
    document,
    baseRevisionId: current.baseRevisionId,
    updatedAt: now,
  };
  };
  return options.skipTransaction ? operation() : database.transaction(operation);
}

export function commitImageConfigRevision(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  expectedDraftVersion: number,
  expectedHeadVersion: number,
  options: {skipTransaction?:boolean} = {},
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

  const operation = () => {
    // Compare inside the transaction too, not merely before acquiring the lock.
    const latest = store.getActivity(activityId);
    const latestDraft = getImageConfigDraft(database, activityId);
    if (latest?.headVersion !== expectedHeadVersion) throw configError('活动版本冲突', 'revision_conflict');
    if (latestDraft.draftVersion !== expectedDraftVersion) throw configError('图像配置草稿版本冲突', 'draft_version_conflict');
    validateImageConfig(draft.document);
    validateArtDirection(database, draft.document);
    const base = draft.baseRevisionId ? getImageConfigRevision(database, activityId, draft.baseRevisionId) : null;
    const currentMedia = latest.currentMediaRevisionId ? store.getMediaRevision(activityId, latest.currentMediaRevisionId) : null;
    if (base && hashImageConfig(base.document) === hash && currentMedia?.imageConfigRevisionId === base.id) {
      return { revision: base, activity: latest };
    }
    // 1. Insert image config revision
    database.connection.prepare(`
      INSERT INTO activity_image_config_revisions (id, activity_id, parent_id, document_json, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(revId, activityId, draft.baseRevisionId, JSON.stringify(draft.document), hash, now);
    const preview = draft.document.artDirection?.selectedStyle?.payloadSnapshot.previewArtifactId;
    if (preview) createArtifactReference(database, { artifactId: preview, appId: 'activities',
      refType: 'activity_image_config_revision', refId: `image-config-revision:${revId}` });

    // 2. Update image config draft baseRevisionId
    const updatedDraft = database.connection.prepare(`
      UPDATE activity_image_config_drafts
      SET base_revision_id = ?, updated_at = ?
      WHERE activity_id = ? AND draft_version = ?
    `).run(revId, now, activityId, expectedDraftVersion);
    if (Number(updatedDraft.changes) !== 1) throw configError('图像配置草稿版本冲突', 'draft_version_conflict');

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
    const updatedHead = database.connection.prepare(`
      UPDATE activities
      SET head_version = ?, current_media_revision_id = ?, updated_at = ?
      WHERE id = ? AND head_version = ?
    `).run(newHeadVersion, newMediaRevId, now, activityId, expectedHeadVersion);
    if (Number(updatedHead.changes) !== 1) throw configError('活动版本冲突', 'revision_conflict');

    const oldConfig=draft.baseRevisionId?getImageConfigRevision(database,activityId,draft.baseRevisionId)?.document:getDefaultImageConfigDocument();
    const content=activity.currentContentRevisionId?store.getContentRevision(activityId,activity.currentContentRevisionId)?.document:null;
    if(content)recordConfigImpacts(database.connection,activityId,content,oldConfig as unknown as Record<string,unknown>||{},draft.document as unknown as Record<string,unknown>);
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
  };
  return options.skipTransaction?operation():database.transaction(operation);
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
