import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ActivityAsset, MediaRevisionDocument } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import {
  createArtifactGrant,
  createArtifactReference,
  hasArtifactAccess,
  inferMediaType,
  streamUploadArtifact,
} from '../artifacts.js';
import { createGenerationTask, getGenerationTask } from '../generation.js';
import type { ActivityStore } from './store.js';

export interface UploadAssetInput {
  stream: NodeJS.ReadableStream | ReadableStream;
  contentType?: string | null;
  contentLength?: number | null;
  originalName?: string | null;
  customAssetKey?: string | null;
}

export async function uploadActivityAsset(
  config: ServiceConfig,
  database: ServiceDatabase,
  activityId: string,
  input: UploadAssetInput,
): Promise<ActivityAsset> {
  const artifact = await streamUploadArtifact(config, database, {
    stream: input.stream,
    contentType: input.contentType,
    contentLength: input.contentLength,
    originalName: input.originalName,
    appId: 'activities',
  });

  const assetKey = input.customAssetKey?.trim() || `asset_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const id = randomUUID();
  const now = nowIso();

  database.transaction(() => {
    database.connection.prepare(`
      INSERT INTO activity_assets (
        activity_id, asset_key, artifact_id, source, type,
        width, height, duration_ms, hash, created_at
      ) VALUES (?, ?, ?, 'upload', ?, ?, ?, ?, ?, ?)
    `).run(
      activityId,
      assetKey,
      artifact.id,
      artifact.mediaType ?? inferMediaType(input.contentType),
      artifact.width ?? null,
      artifact.height ?? null,
      artifact.durationMs ?? null,
      artifact.sha256 ?? '',
      now,
    );

    createArtifactReference(database, {
      artifactId: artifact.id,
      appId: 'activities',
      refType: 'activity_asset',
      refId: assetKey,
    });
  });

  return {
    id: assetKey,
    activityId,
    assetKey,
    artifactId: artifact.id,
    source: 'upload',
    type: (artifact.mediaType ?? inferMediaType(input.contentType)) as 'image' | 'video' | 'audio' | 'document' | 'binary',
    byteSize: artifact.byteSize,
    sha256: artifact.sha256 ?? undefined,
    hash: artifact.sha256 ?? undefined,
    width: artifact.width ?? undefined,
    height: artifact.height ?? undefined,
    durationMs: artifact.durationMs ?? undefined,
    createdAt: now,
  };
}

export function linkArtifactAsActivityAsset(
  database: ServiceDatabase,
  activityId: string,
  artifactId: string,
  customAssetKey?: string | null,
): ActivityAsset {
  const artifact = database.connection.prepare(
    'SELECT id, app_id, media_type, content_type, byte_size, sha256, width, height, duration_ms FROM artifacts WHERE id = ?'
  ).get(artifactId) as {
    id: string;
    app_id: string;
    media_type: string | null;
    content_type: string | null;
    byte_size: number;
    sha256: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
  } | undefined;

  if (!artifact) {
    throw new Error('artifact_not_found');
  }

  if (artifact.app_id !== 'activities') {
    if (!hasArtifactAccess(database, artifactId, 'activities', 'reference')) {
      createArtifactGrant(database, {
        artifactId,
        ownerAppId: artifact.app_id,
        granteeAppId: 'activities',
        access: 'reference',
      });
    }
  }

  const assetKey = customAssetKey?.trim() || `asset_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const id = randomUUID();
  const now = nowIso();

  database.transaction(() => {
    database.connection.prepare(`
      INSERT INTO activity_assets (
        activity_id, asset_key, artifact_id, source, type,
        width, height, duration_ms, hash, created_at
      ) VALUES (?, ?, ?, 'link', ?, ?, ?, ?, ?, ?)
    `).run(
      activityId,
      assetKey,
      artifact.id,
      artifact.media_type ?? inferMediaType(artifact.content_type),
      artifact.width,
      artifact.height,
      artifact.duration_ms,
      artifact.sha256 ?? '',
      now,
    );

    createArtifactReference(database, {
      artifactId: artifact.id,
      appId: 'activities',
      refType: 'activity_asset',
      refId: assetKey,
    });
  });

  return {
    id: assetKey,
    activityId,
    assetKey,
    artifactId: artifact.id,
    source: 'link',
    type: (artifact.media_type ?? inferMediaType(artifact.content_type)) as 'image' | 'video' | 'audio' | 'document' | 'binary',
    byteSize: artifact.byte_size,
    sha256: artifact.sha256,
    hash: artifact.sha256,
    width: artifact.width ?? undefined,
    height: artifact.height ?? undefined,
    durationMs: artifact.duration_ms ?? undefined,
    createdAt: now,
  };
}

export function listActivityAssets(
  database: ServiceDatabase,
  activityId: string,
): ActivityAsset[] {
  const rows = database.connection.prepare(`
    SELECT a.activity_id, a.asset_key, a.artifact_id, a.source, a.type,
           a.width, a.height, a.duration_ms, a.hash, a.created_at,
           art.byte_size, art.sha256
    FROM activity_assets a
    JOIN artifacts art ON art.id = a.artifact_id
    WHERE a.activity_id = ?
    ORDER BY a.created_at DESC
  `).all(activityId) as Array<{
    activity_id: string;
    asset_key: string;
    artifact_id: string;
    source: string;
    type: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    hash: string;
    created_at: string;
    byte_size: number;
    sha256: string;
  }>;

  return rows.map((r) => ({
    id: r.asset_key,
    activityId: r.activity_id,
    assetKey: r.asset_key,
    artifactId: r.artifact_id,
    source: r.source as 'upload' | 'generation' | 'link',
    type: r.type as 'image' | 'video' | 'audio' | 'document' | 'binary',
    byteSize: r.byte_size,
    sha256: r.sha256,
    hash: r.hash || r.sha256,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    durationMs: r.duration_ms ?? undefined,
    createdAt: r.created_at,
  }));
}

export function getActivityAssetFile(
  database: ServiceDatabase,
  activityId: string,
  assetKey: string,
) {
  const row = database.connection.prepare(`
    SELECT a.asset_key, a.artifact_id, art.local_path, art.content_type, art.byte_size, art.sha256
    FROM activity_assets a
    JOIN artifacts art ON art.id = a.artifact_id
    WHERE a.activity_id = ? AND a.asset_key = ?
  `).get(activityId, assetKey) as {
    asset_key: string;
    artifact_id: string;
    local_path: string | null;
    content_type: string | null;
    byte_size: number;
    sha256: string;
  } | undefined;

  if (!row || !row.local_path || !existsSync(row.local_path)) {
    return null;
  }

  return {
    assetId: row.asset_key,
    assetKey: row.asset_key,
    artifactId: row.artifact_id,
    localPath: row.local_path,
    contentType: row.content_type || 'application/octet-stream',
    byteSize: row.byte_size,
    sha256: row.sha256,
  };
}

export interface CreateMediaJobParams {
  contentRevisionId: string;
  slotId: string;
  slotFingerprint: string;
  workflowId?: string;
  workflowVersion?: number;
  inputs?: Record<string, unknown>;
  idempotencyKey?: string;
}

export async function createActivityMediaJob(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  activityId: string,
  params: CreateMediaJobParams,
  fetcher: typeof fetch = fetch,
) {
  const task = await createGenerationTask(
    config,
    database,
    secrets,
    {
      appId: 'activities',
      purpose: 'activity_media_slot',
      workflowId: params.workflowId,
      workflowVersion: params.workflowVersion,
      inputs: params.inputs ?? {},
      idempotencyKey: params.idempotencyKey,
    },
    fetcher,
  );

  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO activity_media_job_links (
      task_id, activity_id, content_revision_id, slot_id, slot_fingerprint, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, slot_id) DO UPDATE SET
      content_revision_id = excluded.content_revision_id,
      slot_fingerprint = excluded.slot_fingerprint
  `).run(
    task.id,
    activityId,
    params.contentRevisionId,
    params.slotId,
    params.slotFingerprint,
    now,
  );

  return task;
}

export function syncActivityMediaTaskOutputs(
  database: ServiceDatabase,
  activityId: string,
  taskId: string,
) {
  const link = database.connection.prepare(`
    SELECT content_revision_id, slot_id, slot_fingerprint FROM activity_media_job_links
    WHERE task_id = ? AND activity_id = ?
  `).get(taskId, activityId) as { content_revision_id: string; slot_id: string; slot_fingerprint: string } | undefined;

  if (!link) return null;

  const task = getGenerationTask(database, taskId, 'activities');
  if (!task) return null;

  if (task.status === 'succeeded') {
    const outputs = database.connection.prepare(`
      SELECT gta.artifact_id, art.media_type, art.byte_size, art.sha256, art.width, art.height, art.duration_ms
      FROM generation_task_artifacts gta
      JOIN artifacts art ON art.id = gta.artifact_id
      WHERE gta.task_id = ?
      ORDER BY gta.sort_order ASC
    `).all(taskId) as Array<{
      artifact_id: string;
      media_type: string | null;
      byte_size: number;
      sha256: string;
      width: number | null;
      height: number | null;
      duration_ms: number | null;
    }>;

    const createdAssets: ActivityAsset[] = [];
    database.transaction(() => {
      for (const [idx, out] of outputs.entries()) {
        const existing = database.connection.prepare(`
          SELECT asset_key, created_at FROM activity_assets
          WHERE activity_id = ? AND artifact_id = ?
        `).get(activityId, out.artifact_id) as { asset_key: string; created_at: string } | undefined;

        if (existing) {
          createdAssets.push({
            id: existing.asset_key,
            activityId,
            assetKey: existing.asset_key,
            artifactId: out.artifact_id,
            source: 'generation',
            type: (out.media_type ?? 'image') as 'image' | 'video' | 'audio' | 'document' | 'binary',
            byteSize: out.byte_size,
            sha256: out.sha256,
            hash: out.sha256,
            width: out.width ?? undefined,
            height: out.height ?? undefined,
            durationMs: out.duration_ms ?? undefined,
            createdAt: existing.created_at,
          });
          continue;
        }

        const assetKey = `slot_${link.slot_id.slice(0, 8)}_${idx + 1}_${randomUUID().replace(/-/g, '').slice(0, 6)}`;
        const now = nowIso();

        database.connection.prepare(`
          INSERT INTO activity_assets (
            activity_id, asset_key, artifact_id, source, type,
            width, height, duration_ms, hash, created_at
          ) VALUES (?, ?, ?, 'generation', ?, ?, ?, ?, ?, ?)
        `).run(
          activityId,
          assetKey,
          out.artifact_id,
          out.media_type ?? 'image',
          out.width,
          out.height,
          out.duration_ms,
          out.sha256 ?? '',
          now,
        );

        createArtifactReference(database, {
          artifactId: out.artifact_id,
          appId: 'activities',
          refType: 'activity_asset',
          refId: assetKey,
        });

        createdAssets.push({
          id: assetKey,
          activityId,
          assetKey,
          artifactId: out.artifact_id,
          source: 'generation',
          type: (out.media_type ?? 'image') as 'image' | 'video' | 'audio' | 'document' | 'binary',
          byteSize: out.byte_size,
          sha256: out.sha256,
          hash: out.sha256,
          width: out.width ?? undefined,
          height: out.height ?? undefined,
          durationMs: out.duration_ms ?? undefined,
          createdAt: now,
        });
      }
    });

    return { task, link, assets: createdAssets };
  }

  return { task, link, assets: [] };
}

export function selectMediaForSlots(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  params: {
    expectedHeadVersion: number;
    contentRevisionId?: string;
    slotBindings: MediaRevisionDocument['slotBindings'];
  },
) {
  const head = store.getActivity(activityId);
  if (!head) throw new Error('activity_not_found');

  const contentRevisionId = params.contentRevisionId || head.currentContentRevisionId;
  if (!contentRevisionId) throw new Error('no_content_revision');

  const contentRev = store.getContentRevision(activityId, contentRevisionId);
  if (!contentRev) throw new Error('content_revision_not_found');

  const allAssets = listActivityAssets(database, activityId);
  const assetKeySet = new Set(allAssets.map((a) => a.assetKey));

  for (const binding of params.slotBindings) {
    for (const item of binding.assets) {
      if (!assetKeySet.has(item.assetKey)) {
        throw new Error(`media_missing: assetKey '${item.assetKey}' not found in activity assets`);
      }
    }
  }

  const res = store.saveMediaSelection(
    activityId,
    params.expectedHeadVersion,
    params.slotBindings,
  );

  const mediaRev = store.getMediaRevision(activityId, res.mediaRevisionId)!;

  return { mediaRevision: mediaRev, activity: res.activity };
}
