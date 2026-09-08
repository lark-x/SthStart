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
import { getDefaultImageConfigDocument } from './image-configs.js';
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
  hasProvenance?: boolean;
  provenanceStats?: {
    configs: number;
    recipes: number;
    compilations: number;
    attempts: number;
  };
}

export interface StagedImportData {
  jobId: string;
  tempZipPath: string;
  preview: ImportPreview;
}

function verifyImportManifest(files: Map<string, Buffer>): void {
  const manifest = files.get('manifest.json');
  if (!manifest) throw new Error('invalid_import_archive: missing manifest.json');
  const parsed = JSON.parse(new TextDecoder().decode(manifest));
  if (!Array.isArray(parsed.files)) throw new Error('invalid_import_archive: missing manifest files');
  for (const entry of parsed.files) {
    const bytes = files.get(entry.path);
    if (!bytes || bytes.length !== entry.byteSize || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      throw new Error(`invalid_import_archive: checksum mismatch for ${entry.path}`);
    }
  }
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

  verifyImportManifest(files);

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

  const provIndexBuf = files.get('data/provenance/index.json');
  let hasProvenance = false;
  let provenanceStats: { configs: number; recipes: number; compilations: number; attempts: number } | undefined;
  if (provIndexBuf) {
    try {
      const idx = JSON.parse(new TextDecoder().decode(provIndexBuf));
      hasProvenance = true;
      provenanceStats = {
        configs: idx.imageConfigsCount || 0,
        recipes: idx.recipesCount || 0,
        compilations: idx.compilationsCount || 0,
        attempts: idx.attemptsCount || 0,
      };
    } catch {
      hasProvenance = true;
    }
  } else if (files.has('data/provenance/image-configs.json')) {
    hasProvenance = true;
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
    hasProvenance,
    provenanceStats,
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
  const files = readZip(zipBuffer, { maxTotalBytes: 500 * 1024 * 1024, maxFileCount: 1000 });
  verifyImportManifest(files);

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

  const assetKeyToArtifactId = new Map<string, string>();
  for (const m of mediaToInsert) {
    assetKeyToArtifactId.set(m.newAssetKey, m.artifact.id);
  }

  // 10b. Parse Provenance files if present
  const configRevIdMap = new Map<string, string>();
  const recipeIdMap = new Map<string, string>();
  const compilationIdMap = new Map<string, string>();
  const attemptIdMap = new Map<string, string>();

  let activeImageConfigRevId: string | null = null;
  let latestConfigDoc = getDefaultImageConfigDocument();

  interface RawConfigRev {
    id: string;
    parentId: string | null;
    document: any;
    hash: string;
    createdAt: string;
  }
  let importedConfigs: RawConfigRev[] = [];
  const configsBuf = files.get('data/provenance/image-configs.json');
  if (configsBuf) {
    try {
      importedConfigs = JSON.parse(new TextDecoder().decode(configsBuf));
    } catch {
      importedConfigs = [];
    }
  }

  for (const c of importedConfigs) {
    const newId = randomUUID();
    configRevIdMap.set(c.id, newId);
    activeImageConfigRevId = newId;
    latestConfigDoc = c.document;
  }

  interface RawRecipe {
    id: string;
    contentRevisionId: string;
    imageConfigRevisionId: string;
    slotId: string;
    slotFingerprint: string;
    sourceRefs: any[];
    blocks: any[];
    references: any[];
    overrides: any[];
    recipeHash: string;
    schemaVersion: number;
    createdAt: string;
  }
  let importedRecipes: RawRecipe[] = [];
  const recipesBuf = files.get('data/provenance/recipes.json');
  if (recipesBuf) {
    try {
      importedRecipes = JSON.parse(new TextDecoder().decode(recipesBuf));
    } catch {
      importedRecipes = [];
    }
  }
  for (const r of importedRecipes) {
    recipeIdMap.set(r.id, randomUUID());
  }

  interface RawComp {
    executionPlan?: unknown;
    id: string;
    recipeId: string;
    compilerVersion: string;
    templateId: string;
    templateVersion: string;
    channels: any;
    effectiveParams: any;
    executionPlanHash: string;
    createdAt: string;
  }
  let importedCompilations: RawComp[] = [];
  const compsBuf = files.get('data/provenance/compilations.json');
  if (compsBuf) {
    try {
      importedCompilations = JSON.parse(new TextDecoder().decode(compsBuf));
    } catch {
      importedCompilations = [];
    }
  }
  for (const c of importedCompilations) {
    compilationIdMap.set(c.id, randomUUID());
  }

  interface RawAttempt {
    id: string;
    baseContentRevisionId: string;
    imageConfigRevisionId: string;
    slotId: string;
    slotFingerprint: string;
    recipeId: string;
    compilationId: string;
    recipeHash: string;
    executionPlanHash: string;
    taskId: string;
    status: string;
    actualSeed: number;
    retryOfAttemptId: string | null;
    parentAttemptIds: string[];
    idempotencyKey: string | null;
    businessRequestHash: string;
    outputs: any[];
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  }
  let importedAttempts: RawAttempt[] = [];
  const attemptsBuf = files.get('data/provenance/attempts.json');
  if (attemptsBuf) {
    try {
      importedAttempts = JSON.parse(new TextDecoder().decode(attemptsBuf));
    } catch {
      importedAttempts = [];
    }
  }
  for (const a of importedAttempts) {
    attemptIdMap.set(a.id, randomUUID());
  }

  interface RawSnapshot {
    attemptId: string;
    phase: string;
    actualInputs: any;
    uploadedFileMappings: any;
    requestSummary: any;
    createdAt: string;
  }
  let importedSnapshots: RawSnapshot[] = [];
  const snapshotsBuf = files.get('data/provenance/execution-snapshots.json');
  if (snapshotsBuf) {
    try {
      importedSnapshots = JSON.parse(new TextDecoder().decode(snapshotsBuf));
    } catch {
      importedSnapshots = [];
    }
  }

  interface RawLineage {
    id: string;
    childAssetKey: string;
    parentAssetKey: string;
    attemptId: string | null;
    role: string;
    transformParams: any;
    createdAt: string;
  }
  let importedLineage: RawLineage[] = [];
  const lineageBuf = files.get('data/provenance/lineage.json');
  if (lineageBuf) {
    try {
      importedLineage = JSON.parse(new TextDecoder().decode(lineageBuf));
    } catch {
      importedLineage = [];
    }
  }

  const effectiveImageConfigRevId = (mediaDoc as any)?.imageConfigRevisionId
    ? (configRevIdMap.get((mediaDoc as any).imageConfigRevisionId) || activeImageConfigRevId)
    : activeImageConfigRevId;

  // 11. Atomic transaction to create activity, assets, draft, content revision, media revision, provenance
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

    // 3. Content revision
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

    // 4. Image Config Revisions
    for (const c of importedConfigs) {
      const newConfigRevId = configRevIdMap.get(c.id)!;
      const doc = {
        ...c.document,
        slotConfigs: (c.document.slotConfigs || []).map((sc: any) => ({
          ...sc,
          slotId: slotIdMap.get(sc.slotId) || sc.slotId,
          referenceAssetKeys: (sc.referenceAssetKeys || []).map((k: string) => assetKeyMap.get(k) || k),
        })),
      };
      const hash = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
      const parentId = c.parentId ? (configRevIdMap.get(c.parentId) || null) : null;
      database.connection.prepare(`
        INSERT INTO activity_image_config_revisions (
          id, activity_id, parent_id, document_json, hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(newConfigRevId, newActivityId, parentId, JSON.stringify(doc), hash, c.createdAt || now);
    }

    // 5. Image Config Draft
    database.connection.prepare(`
      INSERT INTO activity_image_config_drafts (
        activity_id, draft_version, document_json, base_revision_id, updated_at
      ) VALUES (?, 1, ?, ?, ?)
    `).run(
      newActivityId,
      JSON.stringify(latestConfigDoc),
      activeImageConfigRevId,
      now,
    );

    // 6. Prompt Recipes
    for (const r of importedRecipes) {
      const newRecipeId = recipeIdMap.get(r.id)!;
      const newImageConfigRevId = configRevIdMap.get(r.imageConfigRevisionId) || activeImageConfigRevId || '';
      const newSlotId = slotIdMap.get(r.slotId) || r.slotId;
      const sourceRefIdMap = new Map<string, string>((r.sourceRefs || []).map((ref: any) => [ref.id, randomUUID()]));
      const newSourceRefs = (r.sourceRefs || []).map((ref: any) => ({
        ...ref,
        id: sourceRefIdMap.get(ref.id)!,
        activityId: newActivityId,
        ownerRevisionId: ref.ownerKind === 'recipe' ? (recipeIdMap.get(ref.ownerRevisionId) || newRecipeId) : ref.ownerKind === 'content' ? contentRevId : (configRevIdMap.get(ref.ownerRevisionId) || ref.ownerRevisionId),
        entityId: ref.entityKind === 'actor'
          ? (actorIdMap.get(ref.entityId) || ref.entityId)
          : (ref.entityKind === 'stage'
              ? (stageIdMap.get(ref.entityId) || ref.entityId)
              : (ref.entityKind === 'fact' ? (factIdMap.get(ref.entityId) || ref.entityId) : ref.entityKind === 'shot' ? (slotIdMap.get(ref.entityId) || ref.entityId) : ref.entityId)),
      }));
      const newBlocks = (r.blocks || []).map((b: any) => ({
        ...b,
        sourceRefIds: (b.sourceRefIds || []).map((id: string) => {
          const mapped = sourceRefIdMap.get(id);
          if (!mapped) throw new Error(`invalid_provenance_source: ${id}`);
          return mapped;
        }),
        actorIds: (b.actorIds || []).map((aid: string) => actorIdMap.get(aid) || aid),
      }));
      const newReferences = (r.references || []).map((ref: any) => ({
        ...ref,
        assetKey: assetKeyMap.get(ref.assetKey) || ref.assetKey,
        artifactId: assetKeyToArtifactId.get(assetKeyMap.get(ref.assetKey) || ref.assetKey) || ref.artifactId,
        actorId: ref.actorId ? (actorIdMap.get(ref.actorId) || ref.actorId) : undefined,
        parentAttemptId: ref.parentAttemptId ? (attemptIdMap.get(ref.parentAttemptId) || ref.parentAttemptId) : undefined,
      }));
      database.connection.prepare(`
        INSERT INTO activity_prompt_recipes (
          id, activity_id, content_revision_id, image_config_revision_id, slot_id, slot_fingerprint,
          source_refs_json, blocks_json, references_json, overrides_json, recipe_hash, schema_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newRecipeId,
        newActivityId,
        contentRevId,
        newImageConfigRevId,
        newSlotId,
        r.slotFingerprint,
        JSON.stringify(newSourceRefs),
        JSON.stringify(newBlocks),
        JSON.stringify(newReferences),
        JSON.stringify(r.overrides || []),
        r.recipeHash,
        r.schemaVersion || 1,
        r.createdAt || now,
      );
    }

    // 7. Prompt Compilations
    for (const comp of importedCompilations) {
      const newCompId = compilationIdMap.get(comp.id)!;
      const newRecipeId = recipeIdMap.get(comp.recipeId) || comp.recipeId;
      database.connection.prepare(`
        INSERT INTO activity_prompt_compilations (
          id, recipe_id, activity_id, compiler_version, template_id, template_version,
          channels_json, effective_params_json, execution_plan_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newCompId,
        newRecipeId,
        newActivityId,
        comp.compilerVersion,
        comp.templateId,
        comp.templateVersion,
        JSON.stringify(comp.channels || {}),
        JSON.stringify(comp.effectiveParams || {}),
        comp.executionPlanHash,
        comp.createdAt || now,
      );
    }

    for (const comp of importedCompilations) {
      database.connection.prepare('UPDATE activity_prompt_compilations SET execution_plan_json = ? WHERE id = ?')
        .run(JSON.stringify(comp.executionPlan || null), compilationIdMap.get(comp.id)!);
    }

    // 8. Attempts & Outputs
    for (const a of importedAttempts) {
      const newAttemptId = attemptIdMap.get(a.id)!;
      const newRecipeId = recipeIdMap.get(a.recipeId) || a.recipeId;
      const newCompId = compilationIdMap.get(a.compilationId) || a.compilationId;
      const newConfigRevId = configRevIdMap.get(a.imageConfigRevisionId) || activeImageConfigRevId || '';
      const newSlotId = slotIdMap.get(a.slotId) || a.slotId;
      const newRetryOf = a.retryOfAttemptId ? (attemptIdMap.get(a.retryOfAttemptId) || null) : null;
      const newParentAttemptIds = (a.parentAttemptIds || []).map((pid: string) => attemptIdMap.get(pid) || pid);
      const importedTaskId = `imported_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

      database.connection.prepare(`
        INSERT INTO activity_image_attempts (
          id, activity_id, base_content_revision_id, image_config_revision_id,
          slot_id, slot_fingerprint, recipe_id, compilation_id,
          recipe_hash, execution_plan_hash, task_id, status,
          actual_seed, retry_of_attempt_id, parent_attempt_ids_json,
          idempotency_key, business_request_hash, error_code, error_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
      `).run(
        newAttemptId,
        newActivityId,
        contentRevId,
        newConfigRevId,
        newSlotId,
        a.slotFingerprint,
        newRecipeId,
        newCompId,
        a.recipeHash,
        a.executionPlanHash,
        importedTaskId,
        a.status || 'succeeded',
        a.actualSeed || 0,
        newRetryOf,
        JSON.stringify(newParentAttemptIds),
        a.businessRequestHash || '',
        a.errorCode || null,
        a.errorMessage || null,
        a.createdAt || now,
        a.updatedAt || now,
      );

      for (const o of a.outputs || []) {
        const mappedAssetKey = assetKeyMap.get(o.assetKey) || o.assetKey;
        const artId = assetKeyToArtifactId.get(mappedAssetKey);
        if (artId) {
          database.connection.prepare(`
            INSERT INTO activity_image_attempt_outputs (
              attempt_id, artifact_id, asset_key, output_name, sort_order, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(attempt_id, artifact_id) DO NOTHING
          `).run(
            newAttemptId,
            artId,
            mappedAssetKey,
            o.outputName || 'default',
            o.sortOrder || 0,
            now,
          );
        }
      }
    }

    // 9. Execution Snapshots
    for (const s of importedSnapshots) {
      const newAttemptId = attemptIdMap.get(s.attemptId);
      if (newAttemptId) {
        database.connection.prepare(`
          INSERT INTO activity_image_execution_snapshots (
            attempt_id, phase, actual_inputs_json, uploaded_file_mappings_json, request_summary_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(attempt_id, phase) DO NOTHING
        `).run(
          newAttemptId,
          s.phase,
          JSON.stringify(s.actualInputs || {}),
          JSON.stringify(s.uploadedFileMappings || {}),
          JSON.stringify(s.requestSummary || {}),
          s.createdAt || now,
        );
      }
    }

    // 10. Lineage Edges
    for (const l of importedLineage) {
      const newChildKey = assetKeyMap.get(l.childAssetKey) || l.childAssetKey;
      const newParentKey = assetKeyMap.get(l.parentAssetKey) || l.parentAssetKey;
      const newAttemptId = l.attemptId ? (attemptIdMap.get(l.attemptId) || null) : null;
      database.connection.prepare(`
        INSERT INTO activity_image_lineage (
          id, activity_id, child_asset_key, parent_asset_key, attempt_id, role, transform_params_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        newActivityId,
        newChildKey,
        newParentKey,
        newAttemptId,
        l.role || 'init_image',
        JSON.stringify(l.transformParams || {}),
        l.createdAt || now,
      );
    }

    // 11. Media revision
    database.connection.prepare(`
      INSERT INTO activity_media_revisions (
        id, activity_id, content_revision_id, image_config_revision_id, slot_bindings_json, hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      mediaRevId,
      newActivityId,
      contentRevId,
      effectiveImageConfigRevId,
      JSON.stringify(newMediaRevisionDocument),
      createHash('sha256').update(JSON.stringify(newMediaRevisionDocument)).digest('hex'),
      now,
    );

    // 12. Update activities to link current revisions
    database.connection.prepare(`
      UPDATE activities
      SET current_content_revision_id = ?, current_media_revision_id = ?
      WHERE id = ?
    `).run(
      contentRevId,
      mediaRevId,
      newActivityId,
    );

    // 13. Draft row
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

    // 14. Checkpoint
    database.connection.prepare(`
      INSERT INTO activity_checkpoints (
        id, activity_id, name, head_version, content_revision_id, media_revision_id, playback_revision_id, image_config_revision_id, created_at
      ) VALUES (?, ?, '导入初始状态', 1, ?, ?, NULL, ?, ?)
    `).run(
      randomUUID(),
      newActivityId,
      contentRevId,
      mediaRevId,
      effectiveImageConfigRevId,
      now,
    );

    // 15. Update job to succeeded
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
