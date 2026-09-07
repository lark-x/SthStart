import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type {
  Activity,
  ContentDocument,
  MediaRevisionDocument,
  PlaybackDocument,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { createArtifactReference, streamUploadArtifact } from '../artifacts.js';
import type { ActivityStore } from './store.js';
import { readZip } from './zip.js';

export interface ImportPreview {
  title: string;
  theme: string;
  activity?: { title: string; theme: string };
  actorCount: number;
  stageCount: number;
  messageCount: number;
  postCount: number;
  mediaCount: number;
  assetCount?: number;
}

export interface StagedImportData {
  jobId: string;
  tempZipPath: string;
  preview: ImportPreview;
}

export async function stageActivityImport(
  config: ServiceConfig,
  database: ServiceDatabase,
  zipBuffer: Buffer,
): Promise<{ jobId: string; importId: string; preview: ImportPreview }> {
  // 1. Read & validate zip structure
  const files = readZip(zipBuffer, {
    maxTotalBytes: 500 * 1024 * 1024,
    maxFileCount: 1000,
  });

  // 2. Check for records.json or activity.json
  const recordsBuf = files.get('data/records.json');
  if (!recordsBuf) {
    throw new Error('invalid_import_archive: missing data/records.json');
  }

  let contentDoc: ContentDocument;
  try {
    contentDoc = JSON.parse(new TextDecoder().decode(recordsBuf));
  } catch {
    throw new Error('invalid_import_archive: malformed data/records.json');
  }

  const activityBuf = files.get('data/activity.json');
  let title = contentDoc.activity?.title || '导入的活动';
  let theme = contentDoc.activity?.theme || '';

  if (activityBuf) {
    try {
      const actObj = JSON.parse(new TextDecoder().decode(activityBuf));
      if (actObj.title) title = actObj.title;
      if (actObj.theme) theme = actObj.theme;
    } catch {
      // Ignore fallback to contentDoc
    }
  }

  let mediaCount = 0;
  for (const k of files.keys()) {
    if (k.startsWith('assets/media/') || k.startsWith('media/')) {
      mediaCount++;
    }
  }

  const preview: ImportPreview = {
    title,
    theme,
    activity: { title, theme },
    actorCount: (contentDoc.actors || []).length,
    stageCount: (contentDoc.stages || []).length,
    messageCount: (contentDoc.messages || []).length,
    postCount: (contentDoc.posts || []).length,
    mediaCount,
    assetCount: mediaCount,
  };

  const jobId = randomUUID();
  const now = nowIso();

  // Save staging file
  const stagingDir = resolve(config.artifactDirectory, 'activities', 'staging');
  mkdirSync(stagingDir, { recursive: true });
  const tempZipPath = resolve(stagingDir, `${jobId}.zip`);
  writeFileSync(tempZipPath, zipBuffer);

  database.connection.prepare(`
    INSERT INTO activity_jobs (
      id, activity_id, kind, mode, status, request_hash,
      idempotency_key, target_revision_id, result_candidate_ids_json,
      error_message, model_metadata_json, created_at, updated_at
    ) VALUES (?, NULL, 'import', 'zip', 'ready', ?, NULL, NULL, '[]', NULL, ?, ?, ?)
  `).run(
    jobId,
    createHash('sha256').update(zipBuffer.subarray(0, 1024)).digest('hex'),
    JSON.stringify({ tempZipPath, preview }),
    now,
    now,
  );

  return { importId: jobId, jobId, preview };
}

export async function commitActivityImport(
  config: ServiceConfig,
  database: ServiceDatabase,
  store: ActivityStore,
  jobId: string,
): Promise<{ activity: Activity; headVersion: number }> {
  const job = database.connection.prepare(
    'SELECT id, status, model_metadata_json FROM activity_jobs WHERE id = ? AND kind = ?'
  ).get(jobId, 'import') as { id: string; status: string; model_metadata_json: string } | undefined;

  if (!job) throw new Error('import_job_not_found');
  if (job.status !== 'ready') throw new Error(`import_job_invalid_status: ${job.status}`);

  const meta = JSON.parse(job.model_metadata_json) as { tempZipPath: string; preview: ImportPreview };
  const zipBuffer = readFileSync(meta.tempZipPath);
  const files = readZip(zipBuffer);

  const recordsBuf = files.get('data/records.json')!;
  const contentDoc = JSON.parse(new TextDecoder().decode(recordsBuf)) as ContentDocument;

  let mediaDoc: MediaRevisionDocument | null = null;
  const mediaBuf = files.get('data/media.json');
  if (mediaBuf) {
    try {
      mediaDoc = JSON.parse(new TextDecoder().decode(mediaBuf));
    } catch {
      mediaDoc = null;
    }
  }

  // Generate new IDs and mapping tables
  const newActivityId = randomUUID();
  const actorIdMap = new Map<string, string>();
  const stageIdMap = new Map<string, string>();
  const convIdMap = new Map<string, string>();
  const msgIdMap = new Map<string, string>();
  const postIdMap = new Map<string, string>();
  const commentIdMap = new Map<string, string>();
  const slotIdMap = new Map<string, string>();
  const factIdMap = new Map<string, string>();
  const assetKeyMap = new Map<string, string>();

  // 1. Actors
  const newActors = (contentDoc.actors || []).map((a) => {
    const newId = randomUUID();
    actorIdMap.set(a.id, newId);
    return { ...a, id: newId };
  });

  // 2. Stages
  const newStages = (contentDoc.stages || []).map((s) => {
    const newId = randomUUID();
    stageIdMap.set(s.id, newId);
    return {
      ...s,
      id: newId,
      actorIds: (s.actorIds || []).map((aid) => actorIdMap.get(aid) || aid),
      requiredBeats: (s.requiredBeats || []).map((b) => ({
        ...b,
        id: randomUUID(),
        actorIds: (b.actorIds || []).map((aid) => actorIdMap.get(aid) || aid),
      })),
    };
  });

  // 3. Conversations
  const newConversations = (contentDoc.conversations || []).map((c) => {
    const newId = randomUUID();
    convIdMap.set(c.id, newId);
    return {
      ...c,
      id: newId,
      memberActorIds: (c.memberActorIds || []).map((aid) => actorIdMap.get(aid) || aid),
    };
  });

  // 4. Media slots
  const newMediaSlots = (contentDoc.mediaSlots || []).map((ms) => {
    const newId = randomUUID();
    slotIdMap.set(ms.id, newId);
    return {
      ...ms,
      id: newId,
      stageId: stageIdMap.get(ms.stageId) || ms.stageId,
      actorIds: (ms.actorIds || []).map((aid) => actorIdMap.get(aid) || aid),
      sourceFactIds: (ms.sourceFactIds || []).map((fid) => factIdMap.get(fid) || fid),
    };
  });

  // 5. Messages
  const newMessages = (contentDoc.messages || []).map((m) => {
    const newId = randomUUID();
    msgIdMap.set(m.id, newId);
    return {
      ...m,
      id: newId,
      conversationId: convIdMap.get(m.conversationId) || m.conversationId,
      stageId: stageIdMap.get(m.stageId) || m.stageId,
      speakerActorId: m.speakerActorId ? (actorIdMap.get(m.speakerActorId) || m.speakerActorId) : undefined,
      replyToMessageId: m.replyToMessageId ? (msgIdMap.get(m.replyToMessageId) || m.replyToMessageId) : undefined,
      mediaSlotIds: (m.mediaSlotIds || []).map((sid) => slotIdMap.get(sid) || sid),
    };
  });

  // 6. Posts
  const newPosts = (contentDoc.posts || []).map((p) => {
    const newId = randomUUID();
    postIdMap.set(p.id, newId);
    return {
      ...p,
      id: newId,
      stageId: stageIdMap.get(p.stageId) || p.stageId,
      authorActorId: actorIdMap.get(p.authorActorId) || p.authorActorId,
      mediaSlotIds: (p.mediaSlotIds || []).map((sid) => slotIdMap.get(sid) || sid),
      sourceFactIds: (p.sourceFactIds || []).map((fid) => factIdMap.get(fid) || fid),
    };
  });

  // 7. Comments
  const newComments = (contentDoc.comments || []).map((c) => {
    const newId = randomUUID();
    commentIdMap.set(c.id, newId);
    return {
      ...c,
      id: newId,
      postId: postIdMap.get(c.postId) || c.postId,
      authorActorId: actorIdMap.get(c.authorActorId) || c.authorActorId,
      replyToCommentId: c.replyToCommentId ? (commentIdMap.get(c.replyToCommentId) || c.replyToCommentId) : undefined,
    };
  });

  // 8. Facts & StageResults
  const newFacts = (contentDoc.facts || []).map((f) => {
    const newId = randomUUID();
    factIdMap.set(f.id, newId);
    return {
      ...f,
      id: newId,
      stageId: stageIdMap.get(f.stageId) || f.stageId,
      knownByActorIds: (f.knownByActorIds || []).map((aid) => actorIdMap.get(aid) || aid),
      sourceRecordIds: (f.sourceRecordIds || []).map((rid) => msgIdMap.get(rid) || postIdMap.get(rid) || rid),
    };
  });

  const newStageResults = (contentDoc.stageResults || []).map((sr) => ({
    ...sr,
    stageId: stageIdMap.get(sr.stageId) || sr.stageId,
    factIds: (sr.factIds || []).map((fid) => factIdMap.get(fid) || fid),
  }));

  // Rebuild ContentDocument
  const newContentDocument: ContentDocument = {
    schemaVersion: 1,
    activity: { ...contentDoc.activity },
    actors: newActors,
    relationships: (contentDoc.relationships || []).map((r) => ({
      fromActorId: actorIdMap.get(r.fromActorId) || r.fromActorId,
      toActorId: actorIdMap.get(r.toActorId) || r.toActorId,
      description: r.description,
    })),
    stages: newStages,
    conversations: newConversations,
    messages: newMessages,
    posts: newPosts,
    comments: newComments,
    likes: (contentDoc.likes || []).map((l) => ({
      postId: postIdMap.get(l.postId) || l.postId,
      actorId: actorIdMap.get(l.actorId) || l.actorId,
    })),
    mediaSlots: newMediaSlots,
    facts: newFacts,
    stageResults: newStageResults,
  };

  // 9. Process media files & upload to artifacts
  const mediaToInsert: Array<{
    newAssetKey: string;
    artifact: Awaited<ReturnType<typeof streamUploadArtifact>>;
    isVideo: boolean;
  }> = [];

  for (const [filePath, fileBuf] of files.entries()) {
    if (filePath.startsWith('assets/media/') || filePath.startsWith('media/')) {
      const fileName = filePath.split('/').pop()!;
      const rawAssetKey = fileName.split('.')[0];
      const isVideo = fileName.endsWith('.mp4') || fileName.endsWith('.webm');
      const contentType = isVideo ? 'video/mp4' : 'image/png';

      const artifact = await streamUploadArtifact(config, database, {
        stream: Readable.from(fileBuf),
        contentType,
        contentLength: fileBuf.length,
        originalName: fileName,
        appId: 'activities',
      });

      const newAssetKey = rawAssetKey || `asset_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      assetKeyMap.set(rawAssetKey, newAssetKey);
      mediaToInsert.push({ newAssetKey, artifact, isVideo });
    }
  }

  // 10. Rebuild MediaRevisionDocument if present
  let newMediaRevisionDocument: MediaRevisionDocument['slotBindings'] = [];
  if (mediaDoc?.slotBindings) {
    newMediaRevisionDocument = mediaDoc.slotBindings.map((b) => ({
      slotId: slotIdMap.get(b.slotId) || b.slotId,
      slotFingerprint: b.slotFingerprint,
      assets: (b.assets || []).map((a) => ({
        assetKey: assetKeyMap.get(a.assetKey) || a.assetKey,
        order: a.order,
      })),
    }));
  }

  // 11. Atomic transaction to create activity, assets, draft, content revision, media revision
  const now = nowIso();
  const initialContentHash = createHash('sha256')
    .update(JSON.stringify(newContentDocument))
    .digest('hex');

  const contentRevId = randomUUID();
  const mediaRevId = randomUUID();

  database.transaction(() => {
    // 1. Activities row (insert with NULL revisions initially to avoid FK cycle)
    database.connection.prepare(`
      INSERT INTO activities (
        id, title, type, theme, location, rules, archived, head_version,
        current_content_revision_id, current_media_revision_id, current_playback_revision_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, NULL, NULL, NULL, ?, ?)
    `).run(
      newActivityId,
      meta.preview.title,
      newContentDocument.activity.type || 'custom',
      meta.preview.theme,
      newContentDocument.activity.location || '',
      newContentDocument.activity.rules || '',
      now,
      now,
    );

    // 2. Insert imported activity_assets (activities row now exists!)
    for (const m of mediaToInsert) {
      database.connection.prepare(`
        INSERT INTO activity_assets (
          activity_id, asset_key, artifact_id, source, type,
          width, height, duration_ms, hash, created_at
        ) VALUES (?, ?, ?, 'upload', ?, ?, ?, ?, ?, ?)
      `).run(
        newActivityId,
        m.newAssetKey,
        m.artifact.id,
        m.artifact.mediaType ?? (m.isVideo ? 'video' : 'image'),
        m.artifact.width ?? null,
        m.artifact.height ?? null,
        m.artifact.durationMs ?? null,
        m.artifact.sha256 ?? '',
        now,
      );

      createArtifactReference(database, {
        artifactId: m.artifact.id,
        appId: 'activities',
        refType: 'activity_asset',
        refId: m.newAssetKey,
      });
    }

    // 2. Content revision
    database.connection.prepare(`
      INSERT INTO activity_content_revisions (
        id, activity_id, parent_id, document_json, schema_version, hash, created_source, created_at
      ) VALUES (?, ?, NULL, ?, 1, ?, 'import', ?)
    `).run(
      contentRevId,
      newActivityId,
      JSON.stringify(newContentDocument),
      initialContentHash,
      now,
    );

    // 3. Media revision
    database.connection.prepare(`
      INSERT INTO activity_media_revisions (
        id, activity_id, content_revision_id, slot_bindings_json, hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      mediaRevId,
      newActivityId,
      contentRevId,
      JSON.stringify(newMediaRevisionDocument),
      createHash('sha256').update(JSON.stringify(newMediaRevisionDocument)).digest('hex'),
      now,
    );

    // 4. Update activities to link current revisions
    database.connection.prepare(`
      UPDATE activities
      SET current_content_revision_id = ?, current_media_revision_id = ?
      WHERE id = ?
    `).run(
      contentRevId,
      mediaRevId,
      newActivityId,
    );

    // 5. Draft row
    database.connection.prepare(`
      INSERT INTO activity_drafts (
        activity_id, draft_version, base_content_revision_id, document_json, updated_at
      ) VALUES (?, 1, ?, ?, ?)
    `).run(
      newActivityId,
      contentRevId,
      JSON.stringify(newContentDocument),
      now,
    );

    // Checkpoint
    database.connection.prepare(`
      INSERT INTO activity_checkpoints (
        id, activity_id, name, head_version, content_revision_id, media_revision_id, playback_revision_id, created_at
      ) VALUES (?, ?, '导入初始状态', 1, ?, ?, NULL, ?)
    `).run(
      randomUUID(),
      newActivityId,
      contentRevId,
      mediaRevId,
      now,
    );

    // Update job to succeeded
    database.connection.prepare(`
      UPDATE activity_jobs
      SET status = 'succeeded', activity_id = ?, target_revision_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      newActivityId,
      newActivityId,
      now,
      jobId,
    );
  });

  const createdActivity = store.getActivity(newActivityId)!;
  return { activity: createdActivity, headVersion: 1 };
}
