import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
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
import { extractCharacterPersonaDraft } from './characters.js';
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
import { ActivityStore } from './store.js';
import { adoptCandidate, runTextGenerationJob } from './text-jobs.js';
import { buildActivityExportPackage, startExportJob } from './exports.js';
import { commitActivityImport, stageActivityImport } from './imports.js';

export function registerActivityRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
) {
  const store = new ActivityStore(database);

  function checkAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
      reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
      return false;
    }
    return true;
  }

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

    let initialDocument: ContentDocument;

    if (body.document) {
      initialDocument = {
        ...body.document,
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
        let persona = undefined;
        if (a.sourceCharacterId) {
          persona = extractCharacterPersonaDraft(database, a.sourceCharacterId, a.sourceVersion);
        }
        if (!persona) {
          persona = {
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
            personality: ['友好', '热情'],
            motivations: ['共度愉快活动'],
            beliefs: [],
            secrets: [],
            speech: { tone: '自然友好', habits: '', catchphrases: [], examples: [] },
            likes: [],
            dislikes: [],
            fears: [],
            boundaries: [],
            appearance: { description: a.outfitDescription || '日常便装', hair: '', eyes: '', build: '', outfits: [], accessories: [] },
            extraRules: '',
          };
        }

        return {
          id: actorId,
          sourceCharacterId: a.sourceCharacterId,
          sourceVersion: a.sourceVersion,
          displayName: a.displayName,
          persona,
          activityRole: a.activityRole || '参与者',
          outfitDescription: a.outfitDescription || '日常便装',
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
    return {
      activity: act,
      draftVersion: draft?.draftVersion ?? 1,
      head: {
        contentRevisionId: act.currentContentRevisionId,
        mediaRevisionId: act.currentMediaRevisionId,
        playbackRevisionId: act.currentPlaybackRevisionId,
      },
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
    return draft;
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

  // 10. Get Content Revision
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
    return { checkpoints };
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
    return {
      llm: Boolean(llmProfile),
      llmProfile: llmProfile ? { id: llmProfile.id, name: llmProfile.id } : null,
      media: true,
      templates: [{ id: 'phone-v1', name: '手机通用竖屏 (1080x1920)', version: '1.0.0' }],
      limits: {
        maxActors: 20,
        maxStages: 50,
        maxRecords: 5000,
        maxDocumentBytes: 20 * 1024 * 1024,
      },
    };
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
      };
    }>,
    reply: FastifyReply,
  ) => {
    if (!checkAdmin(request, reply)) return;
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const body = request.body || {};
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
  app.post<{
    Params: { id: string };
    Body: { taskId: string };
  }>('/api/v1/admin/activities/:id/media-jobs/sync', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const res = syncActivityMediaTaskOutputs(database, request.params.id, request.body.taskId);
    if (!res) return reply.code(404).send({ error: 'task_not_found_or_not_linked' });
    return res;
  });

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
    const expectedHeadVersion = request.body.expectedHeadVersion ?? act.headVersion;

    try {
      const result = selectMediaForSlots(database, store, request.params.id, {
        ...request.body,
        expectedHeadVersion,
      });
      return reply.code(201).send(result.mediaRevision || result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('conflict')) {
        return reply.code(409).send({ error: 'revision_conflict', message: msg });
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

  // 27. Get Media Revision
  app.get<{ Params: { id: string; mediaRevisionId: string } }>(
    '/api/v1/admin/activities/:id/media/:mediaRevisionId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const rev = store.getMediaRevision(request.params.id, request.params.mediaRevisionId);
      if (!rev) return reply.code(404).send({ error: 'revision_not_found' });
      return rev;
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
  app.get<{ Params: { id: string; playbackRevisionId: string } }>(
    '/api/v1/admin/activities/:id/playback/:playbackRevisionId',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const doc = store.getPlaybackRevision(request.params.id, request.params.playbackRevisionId);
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
