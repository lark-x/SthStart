import { compileHyperFramesComposition } from '@sthstart/activity-playback';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  Activity,
  ActivityAsset,
  ActivityCandidate,
  ActivityCheckpoint,
  ActivityDraft,
  ActivityJob,
  ContentDocument,
  ContentRevision,
  MediaRevision,
  PlaybackDocument,
  PlaybackRevision,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import { ActivityStore } from './store.js';
import { createActorSnapshotFromCharacter, transferCharacterReferenceToActivity, materializeCharacterAvatars } from './characters.js';
import {
  createActivityMediaJob,
  getActivityAssetFile,
  linkArtifactAsActivityAsset,
  listActivityAssets,
  selectMediaForSlots,
  syncActivityMediaTaskOutputs,
  uploadActivityAsset,
} from './media.js';
import { generateAutoPlayback, validatePlaybackDocument } from './playback.js';
import { adoptCandidate, cancelTextJob, retryTextJob, runTextGenerationJob } from './text-jobs.js';
import { buildActivityExportPackage, startExportJob } from './exports.js';
import { commitActivityImport, stageActivityImport } from './imports.js';
import {
  commitImageConfigRevision,
  getImageConfigDraft,
  hashImageConfig,
  getImageConfigRevision,
  listImageConfigRevisions,
  saveImageConfigDraft,
} from './image-configs.js';
import {
  compilePromptRecipe,
  resolveImageExecutionPlan,
  getPromptRecipe,
  saveRecipeAndCompilation,
} from './image-prompt-compiler.js';
import {
  cancelImageAttempt,
  createImageGenerationAttempt,
  getImageAttempt,
  listImageAttempts,
  resolveImageCapabilityDescriptor,
  syncAttemptOutputs,
  syncImageExecutionSnapshots,
} from './image-attempts.js';
import { previewSourceImpact } from './image-impact.js';
import { resolveSourceRef } from './image-provenance.js';
import { getAssetAncestors } from './image-lineage.js';
import type {
  ImageConfigDocument,
  PromptRecipeOverride,
  ReferenceInput,
  SourceEntityKind,
  SourceRef,
} from '@sthstart/contracts';

export function registerActivityRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
) {
  const store = new ActivityStore(database);
  store.recoverDanglingJobs();

  function checkAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
      reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
      return false;
    }
    return true;
  }

  app.post<{ Params: { id: string }; Body: { playback: PlaybackDocument } }>(
    '/api/v1/admin/activities/:id/playback-preview', async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const playback = request.body.playback;
      const content = store.getContentRevision(request.params.id, playback.contentRevisionId);
      const media = store.getMediaRevision(request.params.id, playback.mediaRevisionId);
      if (!content || !media || media.contentRevisionId !== content.id) return reply.code(409).send({ error: 'preview_revision_mismatch' });
      const validation = validatePlaybackDocument(playback, content.document, { schemaVersion: 1, slotBindings: media.slotBindings });
      if (!validation.valid) return reply.code(400).send({ error: 'invalid_playback', details: validation.errors });
      const assetMap = Object.fromEntries(listActivityAssets(database, request.params.id).map(asset => [asset.assetKey,
        `/api/admin/activities/${encodeURIComponent(request.params.id)}/assets/${encodeURIComponent(asset.assetKey)}`]));
      const gsapSource = readFileSync(fileURLToPath(new URL('../../../../packages/activity-playback/templates/phone-v1/assets/gsap.min.js', import.meta.url)), 'utf8');
      const result = compileHyperFramesComposition(content.document, { schemaVersion: 1, slotBindings: media.slotBindings }, playback, { assetUrlMap: assetMap, gsapSource });
      const avatar = Buffer.from(readFileSync(fileURLToPath(new URL('../../../../packages/activity-playback/templates/phone-v1/assets/default_avatar.png', import.meta.url)))).toString('base64');
      return { html: result.html.replaceAll('assets/default_avatar.png', `data:image/png;base64,${avatar}`) };
    });

  // 1. List activities
  app.get<{ Querystring: { q?: string; archived?: string; limit?: string } }>(
    '/api/v1/admin/activities',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const query = request.query.q?.trim();
      const archived = request.query.archived === 'true';
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
      const res = store.listActivities({ q: query, archived, limit });
      return { items: res.items };
    },
  );

  // 2. Create activity (creates 2 initial blank stages baseline)
  app.post<{
    Body: {
      title?: string;
      type?: string;
      theme?: string;
      location?: string;
      rules?: string;
      actors?: Array<{
        sourceCharacterId?: string;
        sourceVersion?: number;
        displayName: string;
        activityRole?: string;
        outfitDescription?: string;
      }>;
      stageTitles?: string[];
      document?: ContentDocument;
    };
  }>('/api/v1/admin/activities', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body || {};
    const title = body.title?.trim() || body.document?.activity?.title?.trim();
    if (!title) {
      return reply.code(400).send({ error: 'title_required', message: '活动标题不能为空。' });
    }

    if (body.document) {
      if (!body.document.stages || body.document.stages.length < 2) {
        return reply.code(400).send({ error: 'minimum_two_stages_required', message: '活动至少必须包含两个阶段。' });
      }
    } else if (body.stageTitles && body.stageTitles.length < 2) {
      return reply.code(400).send({ error: 'minimum_two_stages_required', message: '活动至少必须包含两个阶段。' });
    }

    const requestedActors = body.document?.actors ?? body.actors ?? [];
    for (const actor of requestedActors) {
      if (actor.sourceCharacterId && !createActorSnapshotFromCharacter(database, actor.sourceCharacterId, { sourceVersion: actor.sourceVersion })) {
        return reply.code(409).send({ error: 'character_snapshot_not_found', characterId: actor.sourceCharacterId, version: actor.sourceVersion ?? null });
      }
    }

    let initialDocument: ContentDocument;

    if (body.document) {
      const hydratedActors = body.document.actors.map((actor) => {
        if (!actor.sourceCharacterId) return actor;
        const snapshot = createActorSnapshotFromCharacter(database, actor.sourceCharacterId, {
          sourceVersion: actor.sourceVersion,
          activityRole: actor.activityRole,
          outfitDescription: actor.outfitDescription,
        });
        if (!snapshot) throw new Error('character_snapshot_not_found');
        return { ...snapshot, id: actor.id };
      });
      initialDocument = {
        ...body.document,
        actors: hydratedActors,
        activity: {
          ...body.document.activity,
          title,
        },
      };
    } else {
      const stageTitles = body.stageTitles && body.stageTitles.length >= 2
        ? body.stageTitles
        : ['阶段一：初聚与准备', '阶段二：活动高潮与纪念'];

      // Map actors with snapshot personas
      const actors = (body.actors || []).map((a, idx) => {
        const actorId = `act_${idx + 1}_${randomUUID().replace(/-/g, '').slice(0, 6)}`;
        if (a.sourceCharacterId) {
          const snapshot = createActorSnapshotFromCharacter(database, a.sourceCharacterId, {
            sourceVersion: a.sourceVersion, activityRole: a.activityRole, outfitDescription: a.outfitDescription,
          });
          if (!snapshot) throw new Error('character_snapshot_not_found');
          return { ...snapshot, id: actorId };
        }
        const persona = {
          displayName: a.displayName,
          englishName: '',
          aliases: [],
          originType: 'original' as const,
          work: '',
          world: '',
          summary: `${a.displayName}参加${title}`,
          identity: a.activityRole || '参与者',
          background: '',
          currentSituation: '',
          personality: [],
          motivations: [],
          beliefs: [],
          secrets: [],
          speech: { tone: '', habits: '', catchphrases: [], examples: [] },
          likes: [],
          dislikes: [],
          fears: [],
          boundaries: [],
          appearance: { description: '', hair: '', eyes: '', build: '', outfits: [], accessories: [] },
          extraRules: '',
        };

        return {
          id: actorId,
          sourceCharacterId: a.sourceCharacterId,
          sourceVersion: a.sourceVersion,
          displayName: a.displayName,
          persona,
          activityRole: a.activityRole || '参与者',
          outfitDescription: a.outfitDescription || '',
          appearanceReferenceAssetKeys: [],
        };
      });

      const stages = stageTitles.map((stTitle, idx) => ({
        id: `st_${idx + 1}_${randomUUID().replace(/-/g, '').slice(0, 6)}`,
        title: stTitle,
        order: idx + 1,
        actorIds: actors.map((a) => a.id),
        location: body.location || '',
        instruction: '',
        requiredBeats: [],
        locked: false,
        endCondition: '',
      }));

      const conversationId = `conv_group_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const conversations = [
        {
          id: conversationId,
          kind: 'group' as const,
          title: `${title} 活动群`,
          memberActorIds: actors.map((a) => a.id),
        },
      ];

      initialDocument = {
        schemaVersion: 1,
        activity: {
          title,
          type: body.type || 'gathering',
          theme: body.theme || '',
          location: body.location || '',
          rules: body.rules || '',
          generationMode: 'fill_details',
        },
        actors,
        relationships: [],
        stages,
        conversations,
        messages: [],
        posts: [],
        comments: [],
        likes: [],
        mediaSlots: [],
        facts: [],
        stageResults: [],
      };
    }

    const { activity: initialActivity, draft: initialDraft } = store.createActivity({
      title,
      type: body.type || initialDocument.activity.type || 'gathering',
      theme: body.theme || initialDocument.activity.theme || '',
      location: body.location || initialDocument.activity.location || '',
      rules: body.rules || initialDocument.activity.rules || '',
      initialDocument,
    });

    return reply.code(201).send({
      activity: initialActivity,
      draft: initialDraft,
      draftVersion: initialDraft.draftVersion,
      headVersion: initialActivity.headVersion,
    });
  });

  // 3. Get activity
  app.get<{ Params: { id: string } }>('/api/v1/admin/activities/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const act = store.getActivity(request.params.id);
    if (!act) {
      return reply.code(404).send({ error: 'activity_not_found', message: '活动不存在。' });
    }
    const draft = store.getDraft(request.params.id);
    const currentContentRev = act.currentContentRevisionId ? store.getContentRevision(act.id, act.currentContentRevisionId) : null;
    const currentMediaRev = act.currentMediaRevisionId ? store.getMediaRevision(act.id, act.currentMediaRevisionId) : null;
    const currentPlaybackRev = act.currentPlaybackRevisionId ? store.getPlaybackRevisionRecord(act.id, act.currentPlaybackRevisionId) : null;

    return {
      activity: act,
      draft: draft || null,
      draftVersion: draft?.draftVersion ?? 1,
      head: {
        contentRevisionId: act.currentContentRevisionId,
        mediaRevisionId: act.currentMediaRevisionId,
        playbackRevisionId: act.currentPlaybackRevisionId,
      },
      currentContentRevision: currentContentRev,
      currentMediaRevision: currentMediaRev,
      currentPlaybackRevision: currentPlaybackRev,
    };
  });

  // 4. Update activity meta (CAS)
  app.put<{
    Params: { id: string };
    Body: {
      expectedHeadVersion: number;
      title?: string;
      theme?: string;
      location?: string;
      rules?: string;
      archived?: boolean;
      status?: 'draft' | 'in_progress' | 'completed' | 'archived';
    };
  }>('/api/v1/admin/activities/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const updated = store.updateActivity(request.params.id, request.body.expectedHeadVersion, {
        title: request.body.title,
        theme: request.body.theme,
        location: request.body.location,
        rules: request.body.rules,
        archived: request.body.archived,
      });
      if (!updated) return reply.code(404).send({ error: 'activity_not_found' });
      return { activity: updated };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('head_version_conflict') || msg.includes('conflict')) {
        return reply.code(409).send({ error: 'revision_conflict', message: '活动已被修改，请刷新后重试。' });
      }
      return reply.code(400).send({ error: 'update_failed', message: msg });
    }
  });

  // 5. Duplicate activity
  app.post<{
    Params: { id: string };
    Body: { scope?: 'settings' | 'adopted' };
  }>('/api/v1/admin/activities/:id/duplicate', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const cloned = store.duplicateActivity(request.params.id, { scope: request.body?.scope });
    if (!cloned) return reply.code(404).send({ error: 'duplicate_failed' });
    return reply.code(201).send({ activity: cloned });
  });

  // 6. Delete activity
  app.delete<{ Params: { id: string } }>('/api/v1/admin/activities/:id', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const deleted = store.deleteActivity(request.params.id);
    if (!deleted) return reply.code(404).send({ error: 'activity_not_found' });
    return { ok: true };
  });

  // 7. Get Draft
  app.get<{ Params: { id: string } }>('/api/v1/admin/activities/:id/draft', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const draft = store.getDraft(request.params.id);
    if (!draft) return reply.code(404).send({ error: 'draft_not_found' });
    return {
      ...draft,
      draft,
    };
  });

  // 8. Update Draft (CAS Auto-save)
  app.put<{
    Params: { id: string };
    Body: { expectedDraftVersion: number; document: ContentDocument };
  }>('/api/v1/admin/activities/:id/draft', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const { expectedDraftVersion, document } = request.body;
    try {
      const updatedDraft = store.updateDraft(request.params.id, expectedDraftVersion, document);
      return { draftVersion: updatedDraft.draftVersion };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('draft_version_conflict') || msg.includes('conflict')) {
        return reply.code(409).send({ error: 'draft_version_conflict', message: '草稿已被其他人或在其他标签页修改。' });
      }
      return reply.code(400).send({ error: 'save_draft_failed', message: msg });
    }
  });

  // 9. Commit Draft into ContentRevision
  const handleCommitDraft = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { expectedHeadVersion: number; expectedDraftVersion?: number };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const { expectedHeadVersion } = request.body || {};
    let expectedDraftVersion = request.body?.expectedDraftVersion;
    if (expectedDraftVersion === undefined) {
      const draft = store.getDraft(request.params.id);
      expectedDraftVersion = draft ? draft.draftVersion : 1;
    }
    try {
      const currentDraft = store.getDraft(request.params.id);
      if (currentDraft && currentDraft.draftVersion !== expectedDraftVersion) throw new Error('draft_version_conflict');
      if (currentDraft) {
        const withAvatars = await materializeCharacterAvatars(config, database, request.params.id, currentDraft.document);
        if (withAvatars !== currentDraft.document) {
          expectedDraftVersion = store.updateDraft(request.params.id, expectedDraftVersion, withAvatars).draftVersion;
        }
      }
      const result = store.commitDraft(request.params.id, expectedHeadVersion, expectedDraftVersion);

      const draft = store.getDraft(request.params.id);

      return {
        activity: result.activity,
        draft,
        contentRevisionId: result.contentRevisionId,
        mediaRevisionId: result.mediaRevisionId,
        headVersion: result.activity.headVersion,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict')) {
        return reply.code(409).send({ error: 'revision_conflict', message: '版本发生冲突，请刷新后重试。' });
      }
      return reply.code(400).send({ error: 'commit_failed', message: msg });
    }
  };

  app.post<{ Params: { id: string }; Body: { expectedHeadVersion: number; expectedDraftVersion?: number } }>(
    '/api/v1/admin/activities/:id/draft/commit',
    handleCommitDraft,
  );
  app.post<{ Params: { id: string }; Body: { expectedHeadVersion: number; expectedDraftVersion?: number } }>(
    '/api/v1/admin/activities/:id/commit',
    handleCommitDraft,
  );

  // 10. List & Get Content Revisions
  app.get<{ Params: { id: string } }>('/api/v1/admin/activities/:id/revisions', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const items = store.listContentRevisions(request.params.id);
    return { items };
  });

  const handleGetContentRevision = async (
    request: FastifyRequest<{ Params: { id: string; revisionId: string } }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const rev = store.getContentRevision(request.params.id, request.params.revisionId);
    if (!rev) return reply.code(404).send({ error: 'revision_not_found' });
    return rev;
  };

  app.get<{ Params: { id: string; revisionId: string } }>(
    '/api/v1/admin/activities/:id/content/:revisionId',
    handleGetContentRevision,
  );
  app.get<{ Params: { id: string; revisionId: string } }>(
    '/api/v1/admin/activities/:id/revisions/:revisionId',
    handleGetContentRevision,
  );

  // 11. History (Checkpoints)
  const handleListCheckpoints = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!checkAdmin(request, reply)) return;
    const checkpoints = store.listCheckpoints(request.params.id);
    return { items: checkpoints, checkpoints };
  };

  app.get<{ Params: { id: string } }>('/api/v1/admin/activities/:id/history', handleListCheckpoints);
  app.get<{ Params: { id: string } }>('/api/v1/admin/activities/:id/checkpoints', handleListCheckpoints);

  // 11b. Create Checkpoint
  app.post<{
    Params: { id: string };
    Body: { name: string };
  }>('/api/v1/admin/activities/:id/checkpoints', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const name = request.body?.name?.trim() || '手动检查点';
    try {
      const checkpoint = store.createCheckpoint(request.params.id, name);
      return reply.code(201).send(checkpoint);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'create_checkpoint_failed', message: msg });
    }
  });

  // 12. Restore Checkpoint
  const handleRestoreCheckpoint = async (
    request: FastifyRequest<{
      Params: { id: string; checkpointId?: string };
      Body: { checkpointId?: string; expectedHeadVersion?: number };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const checkpointId = request.params.checkpointId || request.body?.checkpointId;
    if (!checkpointId) {
      return reply.code(400).send({ error: 'checkpoint_id_required' });
    }
    try {
      const restored = store.restoreCheckpoint(
        request.params.id,
        checkpointId,
        request.body?.expectedHeadVersion,
      );
      return { activity: restored };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict')) {
        return reply.code(409).send({ error: 'revision_conflict', message: '版本冲突，无法恢复。' });
      }
      return reply.code(400).send({ error: 'restore_failed', message: msg });
    }
  };

  app.post<{
    Params: { id: string };
    Body: { checkpointId: string; expectedHeadVersion?: number };
  }>('/api/v1/admin/activities/:id/restore', handleRestoreCheckpoint);

  app.post<{
    Params: { id: string; checkpointId: string };
    Body: { expectedHeadVersion?: number };
  }>('/api/v1/admin/activities/:id/checkpoints/:checkpointId/restore', handleRestoreCheckpoint);

  // 13. Candidate by id
  app.get<{ Params: { id: string; candidateId: string } }>(
    '/api/v1/admin/activities/:id/candidates/:candidateId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const cand = store.getCandidate(request.params.id, request.params.candidateId);
      if (!cand) return reply.code(404).send({ error: 'candidate_not_found' });
      return cand;
    },
  );

  // 14. Adopt Candidate
  app.post<{
    Params: { id: string; candidateId: string };
    Body: { expectedHeadVersion: number };
  }>('/api/v1/admin/activities/:id/candidates/:candidateId/adopt', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const result = adoptCandidate(
        database,
        store,
        request.params.id,
        request.params.candidateId,
        request.body.expectedHeadVersion,
      );
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict')) {
        return reply.code(409).send({ error: 'revision_conflict', message: msg });
      }
      return reply.code(400).send({ error: 'adopt_failed', message: msg });
    }
  });

  // 15. Capabilities
  app.get('/api/v1/admin/activities/capabilities', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const llmProfile = await resolveAssignedLlmProfile(database, secrets, 'activities', 'text');
    const textToImage = resolveImageCapabilityDescriptor(database, 'activity_image_text', 'activity_media_slot');
    const imageToImage = resolveImageCapabilityDescriptor(database, 'activity_image_edit', 'activity_media_slot');

    return {
      llm: Boolean(llmProfile),
      llmProfile: llmProfile ? { id: llmProfile.id, name: llmProfile.id } : null,
      media: true,
      images: {
        textToImage,
        imageToImage,
      },
      templates: [{ id: 'phone-v1', name: '手机通用竖屏 (1080x1920)', version: '1.0.0' }],
      limits: {
        maxActors: 20,
        maxStages: 50,
        maxRecords: 5000,
        maxDocumentBytes: 20 * 1024 * 1024,
      },
    };
  });

  app.get<{ Params: { characterId: string }; Querystring: { version?: string } }>('/api/v1/admin/activities/characters/:characterId/snapshot', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const version = request.query.version == null ? undefined : Number(request.query.version);
    if (version != null && (!Number.isSafeInteger(version) || version < 1)) return reply.code(400).send({ error: 'invalid_character_version' });
    const snapshot = createActorSnapshotFromCharacter(database, request.params.characterId, { sourceVersion: version });
    return snapshot ?? reply.code(404).send({ error: 'character_snapshot_not_found' });
  });

  // 16. Characters for selection
  app.get('/api/v1/admin/activities/characters', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const rows = database.connection.prepare(`
      SELECT id, slug, display_name, latest_version, draft_json, tags_json
      FROM character_profiles
      WHERE archived = 0
      ORDER BY updated_at DESC
      LIMIT 100
    `).all() as Array<{
      id: string;
      slug: string;
      display_name: string;
      latest_version: number | null;
      draft_json: string;
      tags_json: string;
    }>;

    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        displayName: r.display_name,
        latestVersion: r.latest_version ?? 0,
        tags: JSON.parse(r.tags_json || '[]'),
        summary: (JSON.parse(r.draft_json || '{}') as Record<string, unknown>).summary || '',
        identity: (JSON.parse(r.draft_json || '{}') as Record<string, unknown>).identity || '',
      })),
    };
  });

  // 17. Text Generation Job
  const handleGenerationJob = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        mode: 'plan' | 'stage' | 'rewrite-records' | 'whole-text';
        targetRevisionId?: string;
        scope?: { stageId?: string; recordIds?: string[] };
        stageId?: string;
        userInstruction?: string;
        idempotencyKey?: string;
      };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const body = request.body || {};
    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined) || body.idempotencyKey;
    const scope = body.scope || (body.stageId ? { stageId: body.stageId } : undefined);

    try {
      const job = await runTextGenerationJob(
        database,
        secrets,
        store,
        request.params.id,
        {
          mode: body.mode,
          targetRevisionId: body.targetRevisionId,
          scope,
          userInstruction: body.userInstruction,
          idempotencyKey,
        },
        fetcher,
      );
      return reply.code(202).send(job);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('idempotency_conflict')) {
        return reply.code(409).send({ error: 'idempotency_conflict', message: msg });
      }
      return reply.code(400).send({ error: 'generation_job_failed', message: msg });
    }
  };

  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/generation-jobs',
    handleGenerationJob,
  );
  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/text-jobs',
    handleGenerationJob,
  );

  // 17b. Cancel Job
  app.post<{ Params: { id: string; jobId: string } }>(
    '/api/v1/admin/activities/:id/jobs/:jobId/cancel',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const job = cancelTextJob(store, request.params.id, request.params.jobId);
      if (!job) return reply.code(404).send({ error: 'job_not_found' });
      return { ...job, job };
    },
  );

  // 17c. Retry Job
  app.post<{ Params: { id: string; jobId: string } }>(
    '/api/v1/admin/activities/:id/jobs/:jobId/retry',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const job = await retryTextJob(database, secrets, store, request.params.id, request.params.jobId, fetcher);
      if (!job) return reply.code(404).send({ error: 'job_not_found' });
      return reply.code(202).send({ ...job, job });
    },
  );

  // 18. Jobs list
  app.get<{ Params: { id: string } }>('/api/v1/admin/activities/:id/jobs', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const rows = database.connection.prepare(`
      SELECT * FROM activity_jobs WHERE activity_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(request.params.id) as Record<string, unknown>[];

    return {
      items: rows.map((r) => ({
        id: String(r.id),
        activityId: String(r.activity_id),
        kind: String(r.kind),
        mode: String(r.mode),
        status: String(r.status),
        requestHash: String(r.request_hash),
        targetRevisionId: r.target_revision_id ? String(r.target_revision_id) : undefined,
        resultCandidateIds: JSON.parse(String(r.result_candidate_ids_json || '[]')),
        errorMessage: r.error_message ? String(r.error_message) : undefined,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
    };
  });

  // 19. Get Job details
  app.get<{ Params: { id: string; jobId: string } }>(
    '/api/v1/admin/activities/:id/jobs/:jobId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const jobRow = database.connection.prepare(
        'SELECT * FROM activity_jobs WHERE id = ? AND activity_id = ?'
      ).get(request.params.jobId, request.params.id) as Record<string, unknown> | undefined;

      if (!jobRow) return reply.code(404).send({ error: 'job_not_found' });

      const candidateIds: string[] = JSON.parse(String(jobRow.result_candidate_ids_json || '[]'));
      const candidates = candidateIds
        .map((cid) => store.getCandidate(request.params.id, cid))
        .filter(Boolean);

      return {
        job: {
          id: String(jobRow.id),
          activityId: String(jobRow.activity_id),
          kind: String(jobRow.kind),
          mode: String(jobRow.mode),
          status: String(jobRow.status),
          requestHash: String(jobRow.request_hash),
          targetRevisionId: jobRow.target_revision_id ? String(jobRow.target_revision_id) : undefined,
          resultCandidateIds: candidateIds,
          errorMessage: jobRow.error_message ? String(jobRow.error_message) : undefined,
          createdAt: String(jobRow.created_at),
          updatedAt: String(jobRow.updated_at),
        },
        candidates,
      };
    },
  );

  // 20. Uploads (Stream upload binary media)
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/activities/:id/uploads',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const act = store.getActivity(request.params.id);
      if (!act) return reply.code(404).send({ error: 'activity_not_found' });

      const contentType = request.headers['content-type'] || 'application/octet-stream';
      const contentLength = request.headers['content-length']
        ? parseInt(request.headers['content-length'], 10)
        : null;
      const originalName = (request.headers['x-artifact-original-name'] ||
        request.headers['x-original-filename']) as string | undefined;
      const customAssetKey = (request.headers['x-asset-key'] ||
        request.headers['x-artifact-key']) as string | undefined;

      const inputStream = (Buffer.isBuffer(request.body)
        ? Readable.from(request.body as unknown as Uint8Array)
        : (request.body && typeof (request.body as NodeJS.ReadableStream).pipe === 'function')
          ? request.body as NodeJS.ReadableStream
          : request.raw) as NodeJS.ReadableStream;

      try {
        const asset = await uploadActivityAsset(config, database, request.params.id, {
          stream: inputStream,
          contentType,
          contentLength,
          originalName,
          customAssetKey,
        });
        return reply.code(201).send(asset);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: 'upload_failed', message: msg });
      }
    },
  );

  // 21. Link existing artifact
  app.post<{
    Params: { id: string };
    Body: { artifactId: string; customAssetKey?: string };
  }>('/api/v1/admin/activities/:id/assets/link', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const asset = linkArtifactAsActivityAsset(
        database,
        request.params.id,
        request.body.artifactId,
        request.body.customAssetKey,
      );
      return reply.code(201).send(asset);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'link_failed', message: msg });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { characterId?: string; version?: number | null; referenceId?: string; idempotencyKey?: string };
  }>('/api/v1/admin/activities/:id/character-references', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined) || request.body?.idempotencyKey;
    if (!request.body?.characterId || !request.body?.referenceId || !idempotencyKey) return reply.code(400).send({ error: 'character_reference_parameters_required' });
    try {
      const asset = await transferCharacterReferenceToActivity(config, database, {
        activityId: request.params.id, characterId: request.body.characterId, version: request.body.version,
        referenceId: request.body.referenceId, idempotencyKey,
      });
      return reply.code(201).send(asset);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('not_found') ? 404 : msg.includes('conflict') || msg.includes('UNIQUE') ? 409 : 400;
      return reply.code(status).send({ error: 'character_reference_transfer_failed', message: msg });
    }
  });

  // 22. List activity assets
  app.get<{ Params: { id: string } }>('/api/v1/admin/activities/:id/assets', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const items = listActivityAssets(database, request.params.id);
    return { items };
  });

  // 23. Asset streaming read & HEAD (supports HTTP Range for video seeking!)
  const handleAssetStream = (request: FastifyRequest<{ Params: { id: string; assetKey: string } }>, reply: FastifyReply, isHead = false) => {
    const file = getActivityAssetFile(database, request.params.id, request.params.assetKey);
    if (!file) {
      return reply.code(404).send({ error: 'asset_not_found' });
    }

    const stat = statSync(file.localPath);
    const fileSize = stat.size;
    const range = request.headers.range;

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', file.contentType);
    reply.header('ETag', `"${file.sha256}"`);

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        reply.header('Content-Range', `bytes */${fileSize}`);
        return reply.code(416).send({ error: 'requested_range_not_satisfiable' });
      }

      const chunksize = end - start + 1;
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Content-Length', chunksize);

      if (isHead) return reply.send();
      return reply.send(createReadStream(file.localPath, { start, end }));
    } else {
      reply.code(200);
      reply.header('Content-Length', fileSize);
      if (isHead) return reply.send();
      return reply.send(createReadStream(file.localPath));
    }
  };

  app.get<{ Params: { id: string; assetKey: string } }>(
    '/api/v1/admin/activities/:id/assets/:assetKey',
    (request, reply) => handleAssetStream(request, reply, request.method === 'HEAD'),
  );

  // 24. Media Jobs: create generation task for slot
  app.post<{
    Params: { id: string };
    Body: {
      contentRevisionId: string;
      slotId: string;
      slotFingerprint: string;
      workflowId?: string;
      workflowVersion?: number;
      inputs?: Record<string, unknown>;
    };
  }>('/api/v1/admin/activities/:id/media-jobs', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    try {
      const task = await createActivityMediaJob(
        config,
        database,
        secrets,
        request.params.id,
        {
          ...request.body,
          idempotencyKey,
        },
        fetcher,
      );
      return reply.code(202).send(task);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'media_job_failed', message: msg });
    }
  });

  // 25. Media Jobs: sync completed outputs
  const handleSyncMediaOutputs = async (
    request: FastifyRequest<{
      Params: { id: string; taskId?: string };
      Body: { taskId?: string };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const taskId = request.params.taskId || request.body?.taskId;
    if (!taskId) return reply.code(400).send({ error: 'task_id_required' });
    const res = syncActivityMediaTaskOutputs(database, request.params.id, taskId);
    if (!res) return reply.code(404).send({ error: 'task_not_found_or_not_linked' });
    return res;
  };

  app.post<{ Params: { id: string }; Body: { taskId: string } }>(
    '/api/v1/admin/activities/:id/media-jobs/sync',
    handleSyncMediaOutputs,
  );
  app.post<{ Params: { id: string; taskId: string }; Body: any }>(
    '/api/v1/admin/activities/:id/media-jobs/:taskId/sync',
    handleSyncMediaOutputs,
  );

  // 26. Select Media for slots
  const handleMediaSelection = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        expectedHeadVersion?: number;
        contentRevisionId?: string;
        slotBindings: Array<{
          slotId: string;
          slotFingerprint: string;
          assets: Array<{ assetKey: string; order: number }>;
        }>;
      };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const act = store.getActivity(request.params.id);
    if (!act) return reply.code(404).send({ error: 'activity_not_found' });
    const body = request.body as any;
    const expectedHeadVersion = body.expectedHeadVersion ?? act.headVersion;

    const slotBindings = body.slotBindings || (
      body.slotId && body.assetKey
        ? [{
            slotId: body.slotId,
            slotFingerprint: body.slotFingerprint || '',
            assets: [{ assetKey: body.assetKey, order: 1 }],
          }]
        : Array.isArray(body.selections)
          ? body.selections.map((s: any) => ({
              slotId: s.slotId,
              slotFingerprint: s.slotFingerprint || '',
              assets: Array.isArray(s.assets)
                ? s.assets
                : (s.assetKeys || []).map((ak: string, idx: number) => ({ assetKey: ak, order: idx + 1 })),
            }))
          : []
    );

    try {
      const result = selectMediaForSlots(database, store, request.params.id, {
        ...request.body,
        slotBindings,
        expectedHeadVersion,
      });
      const mediaRev = result.mediaRevision;
      const statusCode = request.url.includes('/media-selection') ? 200 : 201;
      return reply.code(statusCode).send({
        ...mediaRev,
        headVersion: result.activity.headVersion,
        mediaRevision: mediaRev,
        mediaRevisionId: mediaRev?.id,
        activity: result.activity,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict') || (err as { code?: string })?.code === 'revision_conflict' || (err as { code?: string })?.code === 'head_version_conflict') {
        return reply.code(409).send({ error: 'head_version_conflict', message: msg });
      }
      return reply.code(400).send({ error: 'media_selection_failed', message: msg });
    }
  };

  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/media-selection',
    handleMediaSelection,
  );
  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/media-revisions',
    handleMediaSelection,
  );
  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/media/select',
    handleMediaSelection,
  );

  // 27. Get Media Revision
  const handleGetMediaRevision = async (
    request: FastifyRequest<{ Params: { id: string; mediaRevisionId: string } }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const rev = store.getMediaRevision(request.params.id, request.params.mediaRevisionId);
    if (!rev) return reply.code(404).send({ error: 'revision_not_found' });
    return rev;
  };

  app.get<{ Params: { id: string; mediaRevisionId: string } }>(
    '/api/v1/admin/activities/:id/media/:mediaRevisionId',
    handleGetMediaRevision,
  );
  app.get<{ Params: { id: string; mediaRevisionId: string } }>(
    '/api/v1/admin/activities/:id/media-revisions/:mediaRevisionId',
    handleGetMediaRevision,
  );
  app.get<{ Params: { mediaRevisionId: string } }>(
    '/api/v1/admin/media-revisions/:mediaRevisionId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const rev = store.getMediaRevisionById(request.params.mediaRevisionId);
      if (!rev) return reply.code(404).send({ error: 'revision_not_found' });
      return rev;
    },
  );

  // --- Activity Image Config Routes ---
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/activities/:id/image-config/draft',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      return getImageConfigDraft(database, request.params.id);
    },
  );

  app.put<{
    Params: { id: string };
    Body: { expectedDraftVersion: number; document: ImageConfigDocument };
  }>('/api/v1/admin/activities/:id/image-config/draft', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const updated = saveImageConfigDraft(
        database,
        request.params.id,
        request.body.expectedDraftVersion,
        request.body.document,
      );
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict')) {
        return reply.code(409).send({ error: 'draft_version_conflict', message: msg });
      }
      return reply.code(400).send({ error: 'save_image_config_failed', message: msg });
    }
  });

  app.post<{
    Params: { id: string };
    Body: {
      expectedDraftVersion?: number;
      expectedHeadVersion?: number;
      document?: ImageConfigDocument;
    };
  }>('/api/v1/admin/activities/:id/image-config/revisions', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const activityId = request.params.id;
      let draft = getImageConfigDraft(database, activityId);
      if (request.body?.document) {
        draft = saveImageConfigDraft(
          database,
          activityId,
          request.body.expectedDraftVersion ?? draft.draftVersion,
          request.body.document,
        );
      }
      const activity = store.getActivity(activityId);
      if (!activity) return reply.code(404).send({ error: 'activity_not_found' });
      const expDraftVer = request.body?.document ? draft.draftVersion : request.body?.expectedDraftVersion ?? draft.draftVersion;
      const expHeadVer = request.body?.expectedHeadVersion ?? activity.headVersion;

      const res = commitImageConfigRevision(
        database,
        store,
        activityId,
        expDraftVer,
        expHeadVer,
      );
      return reply.code(201).send({
        ...res.revision,
        revision: res.revision,
        activity: res.activity,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict')) {
        return reply.code(409).send({ error: 'revision_conflict', message: msg });
      }
      return reply.code(400).send({ error: 'commit_image_config_failed', message: msg });
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/activities/:id/image-config/revisions',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      return { items: listImageConfigRevisions(database, request.params.id) };
    },
  );

  app.get<{ Params: { id: string; revId: string } }>(
    '/api/v1/admin/activities/:id/image-config/revisions/:revId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const rev = getImageConfigRevision(database, request.params.id, request.params.revId);
      if (!rev) return reply.code(404).send({ error: 'image_config_revision_not_found' });
      return rev;
    },
  );

  // --- Prompt Recipes & Compilation Routes ---
  const handlePrepareRecipe = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        slotId: string;
        contentRevisionId?: string;
        imageConfigRevisionId?: string;
        overrides?: PromptRecipeOverride[];
        references?: ReferenceInput[];
        customParams?: Record<string, unknown>;
        workflowId?: string;
        workflowVersion?: number;
      };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const { id: activityId } = request.params;
    const body = request.body || {};

    const activity = store.getActivity(activityId);
    if (!activity) return reply.code(404).send({ error: 'activity_not_found' });

    const contentRevId = body.contentRevisionId || activity.currentContentRevisionId;
    if (!contentRevId) return reply.code(400).send({ error: 'no_content_revision' });

    const contentRev = store.getContentRevision(activityId, contentRevId);
    if (!contentRev) return reply.code(404).send({ error: 'content_revision_not_found' });

    let imageConfigRevId = body.imageConfigRevisionId;
    let imageConfigDoc: ImageConfigDocument;

    if (imageConfigRevId) {
      const cfgRev = getImageConfigRevision(database, activityId, imageConfigRevId);
      if (!cfgRev) return reply.code(404).send({ error: 'image_config_revision_not_found' });
      imageConfigDoc = cfgRev.document;
    } else {
      const currentMediaRev = activity.currentMediaRevisionId
        ? store.getMediaRevision(activityId, activity.currentMediaRevisionId)
        : null;
      if (currentMediaRev?.imageConfigRevisionId) {
        imageConfigRevId = currentMediaRev.imageConfigRevisionId;
        const cfgRev = getImageConfigRevision(database, activityId, imageConfigRevId);
        imageConfigDoc = cfgRev ? cfgRev.document : getImageConfigDraft(database, activityId).document;
      } else {
        const draft = getImageConfigDraft(database, activityId);
        imageConfigRevId = draft.baseRevisionId || 'draft';
        imageConfigDoc = draft.document;
      }
    }

    try {
      if (!getImageConfigRevision(database, activityId, imageConfigRevId)) {
        imageConfigRevId = `imgcfg_${randomUUID()}`;
        database.connection.prepare('INSERT INTO activity_image_config_revisions (id, activity_id, parent_id, document_json, hash, created_at) VALUES (?, ?, NULL, ?, ?, ?)')
          .run(imageConfigRevId, activityId, JSON.stringify(imageConfigDoc), hashImageConfig(imageConfigDoc), nowIso());
      }
      const references = (body.references || []).map((ref) => {
        const asset = listActivityAssets(database, activityId).find((asset) => asset.assetKey === ref.assetKey);
        if (!asset || asset.type !== 'image' || !asset.artifactId) throw new Error('reference_asset_not_found');
        if (ref.actorId && !contentRev.document.actors.some((actor) => actor.id === ref.actorId)) throw new Error('reference_actor_not_found');
        return { ...ref, artifactId: asset.artifactId, sha256: asset.sha256 || '' };
      });
      const executionPlan = resolveImageExecutionPlan(database, references.length > 0);
      const { recipe, compilation } = compilePromptRecipe({
        activityId,
        contentRevisionId: contentRevId,
        contentDoc: contentRev.document,
        imageConfigRevisionId: imageConfigRevId,
        imageConfigDoc,
        slotId: body.slotId,
        overrides: body.overrides,
        references,
        executionPlan,
        customParams: body.customParams,
        workflowId: body.workflowId,
        workflowVersion: body.workflowVersion,
      });

      saveRecipeAndCompilation(database, recipe, compilation);
      return { recipe, compilation };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'recipe_preparation_failed', message: msg });
    }
  };

  app.post<{
    Params: { id: string };
    Body: {
      slotId: string;
      contentRevisionId?: string;
      imageConfigRevisionId?: string;
      overrides?: PromptRecipeOverride[];
      references?: ReferenceInput[];
      customParams?: Record<string, unknown>;
      workflowId?: string;
      workflowVersion?: number;
    };
  }>('/api/v1/admin/activities/:id/image-recipes/prepare', handlePrepareRecipe);

  app.post<{
    Params: { id: string };
    Body: {
      slotId: string;
      contentRevisionId?: string;
      imageConfigRevisionId?: string;
      overrides?: PromptRecipeOverride[];
      references?: ReferenceInput[];
      customParams?: Record<string, unknown>;
      workflowId?: string;
      workflowVersion?: number;
    };
  }>('/api/v1/admin/activities/:id/recipes/prepare', handlePrepareRecipe);

  const handleGetRecipe = async (
    request: FastifyRequest<{ Params: { id: string; recipeId: string } }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const res = getPromptRecipe(database, request.params.id, request.params.recipeId);
    if (!res) return reply.code(404).send({ error: 'recipe_not_found' });
    return res;
  };

  app.get<{ Params: { id: string; recipeId: string } }>(
    '/api/v1/admin/activities/:id/image-recipes/:recipeId',
    handleGetRecipe,
  );

  app.get<{ Params: { id: string; recipeId: string } }>(
    '/api/v1/admin/activities/:id/recipes/:recipeId',
    handleGetRecipe,
  );

  // --- Generation Attempts Routes ---
  app.post<{
    Params: { id: string };
    Body: {
      recipeId: string;
      expectedHeadVersion?: number;
      seed?: number | null;
      idempotencyKey?: string | null;
      retryOfAttemptId?: string | null;
      customInputs?: Record<string, unknown>;
      purpose?: string;
    };
  }>('/api/v1/admin/activities/:id/image-attempts', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined) || request.body?.idempotencyKey;
    try {
      const attempt = await createImageGenerationAttempt(
        config,
        database,
        secrets,
        store,
        request.params.id,
        {
          ...request.body,
          idempotencyKey,
        },
        fetcher,
      );
      return reply.code(202).send(attempt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict') || (err as { code?: string })?.code === 'idempotency_conflict' || (err as { code?: string })?.code === 'head_conflict' || (err as { code?: string })?.code === 'execution_plan_conflict') {
        return reply.code(409).send({ error: 'conflict', message: msg });
      }
      if (msg.includes('assignment_missing') || (err as { code?: string })?.code === 'assignment_missing') {
        return reply.code(400).send({ error: 'assignment_missing', message: msg });
      }
      return reply.code(400).send({ error: 'image_attempt_failed', message: msg });
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { slotId?: string; limit?: string };
  }>('/api/v1/admin/activities/:id/image-attempts', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    const items = listImageAttempts(database, request.params.id, request.query.slotId, limit);
    return { items: items.map(item => syncAttemptOutputs(database, request.params.id, item.id) || item) };
  });

  app.get<{ Params: { id: string; attemptId: string } }>(
    '/api/v1/admin/activities/:id/image-attempts/:attemptId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const attempt = syncAttemptOutputs(database, request.params.id, request.params.attemptId) || getImageAttempt(database, request.params.id, request.params.attemptId);
      if (!attempt) return reply.code(404).send({ error: 'attempt_not_found' });
      return attempt;
    },
  );

  app.post<{ Params: { id: string; attemptId: string } }>(
    '/api/v1/admin/activities/:id/image-attempts/:attemptId/sync',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const res = syncAttemptOutputs(database, request.params.id, request.params.attemptId);
      if (!res) return reply.code(404).send({ error: 'attempt_not_found' });
      return res;
    },
  );

  app.post<{
    Params: { id: string; attemptId: string };
    Body?: { seed?: number | null; idempotencyKey?: string | null };
  }>('/api/v1/admin/activities/:id/image-attempts/:attemptId/retry', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const prev = getImageAttempt(database, request.params.id, request.params.attemptId);
    if (!prev) return reply.code(404).send({ error: 'attempt_not_found' });

    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined) || request.body?.idempotencyKey;
    try {
      const attempt = await createImageGenerationAttempt(
        config,
        database,
        secrets,
        store,
        request.params.id,
        {
          recipeId: prev.recipeId,
          seed: request.body?.seed !== undefined ? request.body.seed : prev.actualSeed,
          idempotencyKey,
          retryOfAttemptId: prev.id,
        },
        fetcher,
      );
      return reply.code(202).send(attempt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'retry_attempt_failed', message: msg });
    }
  });

  app.post<{ Params: { id: string; attemptId: string } }>(
    '/api/v1/admin/activities/:id/image-attempts/:attemptId/cancel',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const res = await cancelImageAttempt(
        config,
        database,
        secrets,
        request.params.id,
        request.params.attemptId,
        fetcher,
      );
      if (!res) return reply.code(404).send({ error: 'attempt_not_found' });
      return res;
    },
  );

  app.get<{ Params: { id: string; attemptId: string } }>('/api/v1/admin/activities/:id/image-attempts/:attemptId/execution-snapshots', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!getImageAttempt(database, request.params.id, request.params.attemptId)) return reply.code(404).send({ error: 'attempt_not_found' });
    syncImageExecutionSnapshots(database, request.params.id);
    const rows = database.connection.prepare('SELECT * FROM activity_image_execution_snapshots WHERE attempt_id = ? ORDER BY created_at').all(request.params.attemptId) as Array<Record<string, unknown>>;
    return { items: rows.map(row => ({ attemptId: row.attempt_id, phase: row.phase, actualInputs: JSON.parse(String(row.actual_inputs_json)), uploadedFileMappings: JSON.parse(String(row.uploaded_file_mappings_json)), requestSummary: JSON.parse(String(row.request_summary_json)), createdAt: row.created_at })) };
  });

  // --- Source Impact & Resolution Routes ---
  app.post<{
    Params: { id: string };
    Body: {
      changedEntityKind: SourceEntityKind;
      changedEntityId: string;
      fieldPath: string;
      newValue: unknown;
    };
  }>('/api/v1/admin/activities/:id/image-impact/preview', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const preview = previewSourceImpact(database, store, request.params.id, request.body);
      return preview;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'impact_preview_failed', message: msg });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { sourceRef?: SourceRef; sourceRefId?: string };
  }>('/api/v1/admin/activities/:id/image-sources/resolve', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const activity = store.getActivity(request.params.id);
    if (!activity) return reply.code(404).send({ error: 'activity_not_found' });

    const contentRev = activity.currentContentRevisionId
      ? store.getContentRevision(request.params.id, activity.currentContentRevisionId)
      : null;
    const contentDoc = contentRev ? contentRev.document : store.getDraft(request.params.id)?.document;

    const imgDraft = getImageConfigDraft(database, request.params.id);
    const imgDoc = imgDraft.document;

    if (!contentDoc) return reply.code(400).send({ error: 'no_content_available' });

    let sourceRef = request.body.sourceRef;
    const sourceRefId = request.body.sourceRefId || (request.body as any)?.id;

    if (!sourceRef && sourceRefId) {
      const rows = database.connection.prepare(`
        SELECT source_refs_json FROM activity_prompt_recipes WHERE activity_id = ?
      `).all(request.params.id) as Array<{ source_refs_json: string }>;

      for (const row of rows) {
        try {
          const refs = JSON.parse(row.source_refs_json) as SourceRef[];
          const found = refs.find((r) => r.id === sourceRefId);
          if (found) {
            sourceRef = found;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!sourceRef) {
      return reply.code(404).send({ error: 'source_ref_not_found' });
    }

    try {
      const detail = resolveSourceRef(sourceRef, contentDoc, imgDoc);
      return detail;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'source_resolve_failed', message: msg });
    }
  });

  // --- Asset Lineage Routes ---
  app.get<{ Params: { id: string; assetKey: string } }>(
    '/api/v1/admin/activities/:id/image-lineage/:assetKey',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const ancestors = getAssetAncestors(database, request.params.id, request.params.assetKey);
      return { items: ancestors };
    },
  );

  // 28. Auto Playback generator
  const handleAutoPlayback = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        contentRevisionId?: string;
        mediaRevisionId?: string;
        viewerActorId?: string;
        speed?: number;
        expandMedia?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const act = store.getActivity(request.params.id);
    if (!act) return reply.code(404).send({ error: 'activity_not_found' });

    const contentRevId = request.body.contentRevisionId || act.currentContentRevisionId;
    if (!contentRevId) return reply.code(400).send({ error: 'no_content_revision' });

    const contentRev = store.getContentRevision(request.params.id, contentRevId);
    if (!contentRev) return reply.code(404).send({ error: 'content_revision_not_found' });

    const mediaRevId = request.body.mediaRevisionId || act.currentMediaRevisionId;
    const mediaRev = mediaRevId ? store.getMediaRevision(request.params.id, mediaRevId) : null;
    const mediaDoc = mediaRev ? { schemaVersion: 1 as const, slotBindings: mediaRev.slotBindings } : null;

    const doc = generateAutoPlayback(
      contentRevId,
      contentRev.document,
      mediaRevId || 'none',
      mediaDoc,
      {
        viewerActorId: request.body.viewerActorId,
        speed: request.body.speed,
        expandMedia: request.body.expandMedia,
      },
    );

    return { document: doc, playbackDocument: doc };
  };

  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/playback/auto',
    handleAutoPlayback,
  );
  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/playback/generate',
    handleAutoPlayback,
  );

  // 29. Save Playback Document
  const handleSavePlayback = async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        expectedHeadVersion?: number;
        contentRevisionId: string;
        mediaRevisionId: string;
        document: PlaybackDocument;
      };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const act = store.getActivity(request.params.id);
    if (!act) return reply.code(404).send({ error: 'activity_not_found' });
    const expectedHeadVersion = request.body.expectedHeadVersion ?? act.headVersion;
    const { contentRevisionId, mediaRevisionId, document } = request.body;

    const contentRev = store.getContentRevision(request.params.id, contentRevisionId);
    if (!contentRev) return reply.code(404).send({ error: 'content_revision_not_found' });

    const mediaRev = store.getMediaRevision(request.params.id, mediaRevisionId);
    const mediaDoc = mediaRev ? { schemaVersion: 1 as const, slotBindings: mediaRev.slotBindings } : null;

    const validation = validatePlaybackDocument(document, contentRev.document, mediaDoc);
    if (!validation.valid) {
      return reply.code(400).send({
        error: 'playback_invalid',
        message: '回放文档校验失败。',
        details: validation.errors,
      });
    }

    try {
      const res = store.savePlaybackRevision(
        request.params.id,
        expectedHeadVersion,
        document,
      );

      return reply.code(201).send({
        id: res.playbackRevisionId,
        playbackRevisionId: res.playbackRevisionId,
        activity: res.activity,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict')) {
        return reply.code(409).send({ error: 'revision_conflict', message: msg });
      }
      return reply.code(400).send({ error: 'save_playback_failed', message: msg });
    }
  };

  app.put<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/playback',
    handleSavePlayback,
  );
  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/playback',
    handleSavePlayback,
  );
  app.post<{ Params: { id: string }; Body: any }>(
    '/api/v1/admin/activities/:id/playback-revisions',
    handleSavePlayback,
  );

  // 30. Get Playback Revision
  const handleGetPlaybackRevision = async (
    request: FastifyRequest<{ Params: { id: string; playbackRevisionId: string } }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const revision = store.getPlaybackRevisionRecord(request.params.id, request.params.playbackRevisionId);
    if (!revision) return reply.code(404).send({ error: 'revision_not_found' });
    return { ...revision.document, ...revision };
  };

  app.get<{ Params: { id: string; playbackRevisionId: string } }>(
    '/api/v1/admin/activities/:id/playback/:playbackRevisionId',
    handleGetPlaybackRevision,
  );
  app.get<{ Params: { id: string; playbackRevisionId: string } }>(
    '/api/v1/admin/activities/:id/playback-revisions/:playbackRevisionId',
    handleGetPlaybackRevision,
  );
  app.get<{ Params: { playbackRevisionId: string } }>(
    '/api/v1/admin/playback-revisions/:playbackRevisionId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const doc = store.getPlaybackRevisionById(request.params.playbackRevisionId);
      if (!doc) return reply.code(404).send({ error: 'revision_not_found' });
      return doc;
    },
  );

  // 30b. Direct synchronous export
  app.post<{
    Params: { id: string };
    Body: any;
  }>('/api/v1/admin/activities/:id/export', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const zipBuffer = await buildActivityExportPackage(
        config,
        database,
        store,
        request.params.id,
        request.body || {},
      );
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="activity-${request.params.id}.zip"`);
      return reply.send(zipBuffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'export_failed', message: msg });
    }
  });

  // 31. Export: Start asynchronous export job
  app.post<{
    Params: { id: string };
    Body: {
      contentRevisionId?: string;
      mediaRevisionId?: string;
      playbackRevisionId?: string;
      format?: 'reader' | 'project' | 'hyperframes-project';
      includeHistory?: boolean;
    };
  }>('/api/v1/admin/activities/:id/exports', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    try {
      const jobId = startExportJob(
        config,
        database,
        store,
        request.params.id,
        request.body || {},
      );
      return reply.code(202).send({ jobId, status: 'running' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'export_failed', message: msg });
    }
  });

  // 32. Export: Check job status
  app.get<{ Params: { id: string; jobId: string } }>(
    '/api/v1/admin/activities/:id/exports/:jobId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const row = database.connection.prepare(
        'SELECT id, activity_id, kind, mode, status, error_message, model_metadata_json, created_at, updated_at FROM activity_jobs WHERE id = ? AND activity_id = ? AND kind = ?'
      ).get(request.params.jobId, request.params.id, 'export') as Record<string, unknown> | undefined;

      if (!row) return reply.code(404).send({ error: 'export_job_not_found' });
      return {
        job: {
          id: String(row.id),
          activityId: String(row.activity_id),
          kind: String(row.kind),
          mode: String(row.mode),
          status: String(row.status),
          errorMessage: row.error_message ? String(row.error_message) : undefined,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        },
      };
    },
  );

  // 33. Export: Download completed ZIP
  app.get<{ Params: { id: string; jobId: string } }>(
    '/api/v1/admin/activities/:id/exports/:jobId/download',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const row = database.connection.prepare(
        'SELECT id, activity_id, status, model_metadata_json FROM activity_jobs WHERE id = ? AND activity_id = ? AND kind = ?'
      ).get(request.params.jobId, request.params.id, 'export') as {
        id: string;
        activity_id: string;
        status: string;
        model_metadata_json: string;
      } | undefined;

      if (!row || row.status !== 'succeeded') {
        return reply.code(404).send({ error: 'export_not_ready_or_not_found' });
      }

      const meta = JSON.parse(row.model_metadata_json || '{}') as { exportPath?: string };
      if (!meta.exportPath || !existsSync(meta.exportPath)) {
        return reply.code(404).send({ error: 'export_file_missing' });
      }

      const act = store.getActivity(request.params.id);
      const safeTitle = (act?.title || 'activity').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
      const filename = `activity-${safeTitle}-${Date.now()}.zip`;

      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return reply.send(createReadStream(meta.exportPath));
    },
  );

  // 34. Import: Stage zip upload
  const handleStageImport = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAdmin(request, reply)) return;
    let zipBuffer: Buffer;
    if (Buffer.isBuffer(request.body)) {
      zipBuffer = request.body as Buffer;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of request.raw) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      zipBuffer = Buffer.concat(chunks);
    }

    if (zipBuffer.length === 0) {
      return reply.code(400).send({ error: 'empty_upload_body' });
    }

    try {
      const staged = await stageActivityImport(config, database, zipBuffer);
      return reply.code(200).send(staged);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'import_stage_failed', message: msg });
    }
  };

  app.post('/api/v1/admin/activities/imports', handleStageImport);
  app.post('/api/v1/admin/activities/imports/stage', handleStageImport);

  // 35. Import: Commit staged import
  const handleCommitImport = async (
    request: FastifyRequest<{ Params: { jobId?: string; importId?: string } }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const importId = request.params.jobId || request.params.importId;
    if (!importId) return reply.code(400).send({ error: 'import_id_required' });
    try {
      const result = await commitActivityImport(config, database, store, importId);
      return reply.code(201).send(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'import_commit_failed', message: msg });
    }
  };

  app.post<{ Params: { importId: string } }>('/api/v1/admin/activities/imports/:importId/commit', handleCommitImport);
}
