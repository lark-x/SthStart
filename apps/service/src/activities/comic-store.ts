import { createHash, randomUUID } from 'node:crypto';
import type {
  ComicDocument, ComicDraft, ComicHistoryImage, ComicJob, ComicJobPage, ComicRevision,
} from '@sthstart/contracts';
import { createArtifactReference, hasArtifactAccess, removeArtifactReference, resolveArtifactStoragePath } from '../artifacts.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { validateComicDocument } from './comic-validation.js';
import { updateAiCallRecord } from '../ai-call-trace.js';
import { readImageOperationMetadata } from './studio-image-operation.js';

type ComicJobKind = ComicJob['kind'];
type NewComicJob = {
  activityId: string;
  kind: ComicJobKind;
  panelId?: string | null;
  idempotencyKey: string;
  request: Record<string, unknown>;
  traceId: string;
};

function jsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mapJob(row: Record<string, unknown>): ComicJob {
  return {
    id: String(row.id), activityId: String(row.activity_id), kind: String(row.kind) as ComicJobKind,
    panelId: row.panel_id ? String(row.panel_id) : null, status: String(row.status) as ComicJob['status'],
    idempotencyKey: String(row.idempotency_key), input: jsonObject(String(row.input_json)) ?? {},
    result: jsonObject(row.result_json == null ? null : String(row.result_json)),
    generationTaskId: row.generation_task_id ? String(row.generation_task_id) : null,
    traceId: String(row.trace_id), callId: row.call_id ? String(row.call_id) : null,
    errorCode: row.error_code ? String(row.error_code) : null, errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapRevision(row: Record<string, unknown>): ComicRevision {
  return {
    id: String(row.id), activityId: String(row.activity_id), sourceDraftVersion: Number(row.source_draft_version),
    document: JSON.parse(String(row.document_json)) as ComicDocument, documentHash: String(row.document_hash), createdAt: String(row.created_at),
  };
}

function mapDraft(row: Record<string, unknown>): ComicDraft {
  return {
    activityId: String(row.activity_id), draftVersion: Number(row.draft_version),
    document: JSON.parse(String(row.document_json)) as ComicDocument,
    baseRevisionId: row.base_revision_id ? String(row.base_revision_id) : null, updatedAt: String(row.updated_at),
  };
}

function selectedArtifactIds(document: ComicDocument) {
  return [...new Set(document.panels.flatMap((panel) => panel.selectedImage ? [panel.selectedImage.artifactId] : []))];
}

function codedError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function decodeCursor(cursor?: string | null): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    return typeof parsed.createdAt === 'string' && typeof parsed.id === 'string'
      ? { createdAt: parsed.createdAt, id: parsed.id } : null;
  } catch { return null; }
}

function decodeHistoryCursor(cursor?: string | null): { createdAt: string; jobId: string; sortOrder: number; artifactId: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown; jobId?: unknown; sortOrder?: unknown; artifactId?: unknown;
    };
    return typeof parsed.createdAt === 'string' && typeof parsed.jobId === 'string'
      && Number.isInteger(parsed.sortOrder) && typeof parsed.artifactId === 'string'
      ? { createdAt: parsed.createdAt, jobId: parsed.jobId, sortOrder: Number(parsed.sortOrder), artifactId: parsed.artifactId }
      : null;
  } catch { return null; }
}

function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

function boundedLimit(limit: number, fallback = 20, maximum = 100) {
  const value = Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.max(1, Math.min(maximum, value));
}

export class ComicStore {
  constructor(private readonly database: ServiceDatabase) {}

  private get connection() { return this.database.connection; }

  getComicDraft(activityId: string): ComicDraft | null {
    const row = this.connection.prepare('SELECT * FROM activity_comic_drafts WHERE activity_id=?').get(activityId) as Record<string, unknown> | undefined;
    return row ? mapDraft(row) : null;
  }

  createComicDraft(activityId: string, contentRevisionId: string, options: { skipTransaction?: boolean } = {}): ComicDraft {
    const activity = this.connection.prepare('SELECT id FROM activities WHERE id=?').get(activityId);
    if (!activity) throw codedError('activity_not_found', '活动不存在。', 404);
    const revision = this.connection.prepare('SELECT id FROM activity_content_revisions WHERE id=? AND activity_id=?').get(contentRevisionId, activityId);
    if (!revision) throw codedError('comic_source_missing', '指定的活动内容版本不存在。', 404);
    const now = nowIso();
    const insert = () => {
      const existing = this.connection.prepare('SELECT 1 FROM activity_comic_drafts WHERE activity_id=?').get(activityId);
      if (existing) return;
      const document: ComicDocument = {
        schemaVersion: 1, contentRevisionId, style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 }, pages: [], panels: [],
      };
      this.connection.prepare(`INSERT INTO activity_comic_drafts(activity_id,draft_version,document_json,base_revision_id,updated_at)
        VALUES (?,1,?,NULL,?)`).run(activityId, JSON.stringify(document), now);
    };
    if (options.skipTransaction) insert(); else this.database.transaction(insert);
    return this.getComicDraft(activityId)!;
  }

  private validateImageOwnership(activityId: string, document: ComicDocument) {
    for (const panel of document.panels) {
      const selected = panel.selectedImage;
      if (!selected) continue;
      const artifact = this.connection.prepare('SELECT app_id,media_type,file_status FROM artifacts WHERE id=?').get(selected.artifactId) as
        { app_id: string; media_type: string | null; file_status: string } | undefined;
      if (!artifact || !hasArtifactAccess(this.database, selected.artifactId, 'activities', 'read')) {
        throw codedError('comic_image_not_allowed', `图片 ${selected.artifactId} 不属于当前活动或没有读取权限。`, 403);
      }
      if (!(artifact.media_type === 'image' || artifact.media_type?.startsWith('image/'))) throw codedError('comic_image_not_allowed', `产物 ${selected.artifactId} 不是图片。`);
      if (artifact.file_status !== 'ready') throw codedError('comic_image_unavailable', `图片 ${selected.artifactId} 当前不可读取。`, 409);
      if (selected.origin === 'comic_render') {
        if (!selected.renderJobId) throw codedError('comic_image_not_allowed', '漫画生成图片缺少任务来源。');
        const output = this.connection.prepare(`SELECT 1 FROM activity_comic_job_outputs o
          JOIN activity_comic_jobs j ON j.id=o.job_id
          WHERE o.job_id=? AND o.artifact_id=? AND j.activity_id=? AND j.panel_id=?`).get(
          selected.renderJobId, selected.artifactId, activityId, panel.id,
        );
        if (!output) throw codedError('comic_image_not_allowed', '图片不是当前画格的生成产物。', 403);
      } else {
        const beats = new Set(panel.source.beatIds);
        const output = this.connection.prepare(`SELECT 1 FROM activity_beat_render_candidate_outputs o
          JOIN activity_beat_render_candidates c ON c.id=o.candidate_id
          WHERE o.artifact_id=? AND c.activity_id=? AND c.stage_id=? AND c.scene_id=? AND c.beat_id IN (${[...beats].map(() => '?').join(',')}) LIMIT 1`)
          .get(selected.artifactId, activityId, panel.source.stageId, panel.source.sceneId, ...beats);
        if (!output) throw codedError('comic_image_not_allowed', '图片不是此画格关联镜头的历史图片。', 403);
      }
    }
  }

  private syncDraftReferences(activityId: string, before: ComicDocument | null, after: ComicDocument) {
    const refId = `comic-draft:${activityId}`;
    const previous = new Set(before ? selectedArtifactIds(before) : []);
    const next = new Set(selectedArtifactIds(after));
    for (const artifactId of next) {
      if (!previous.has(artifactId)) createArtifactReference(this.database, {
        artifactId, appId: 'activities', refType: 'activity_comic_draft', refId,
      });
    }
    for (const artifactId of previous) {
      if (!next.has(artifactId)) removeArtifactReference(this.database, { artifactId, appId: 'activities', refId });
    }
  }

  saveComicDraft(activityId: string, expectedDraftVersion: number, document: ComicDocument, options: { skipTransaction?: boolean } = {}): ComicDraft {
    const revision = this.connection.prepare('SELECT document_json FROM activity_content_revisions WHERE id=? AND activity_id=?')
      .get(document.contentRevisionId, activityId) as { document_json: string } | undefined;
    if (!revision) throw codedError('comic_source_missing', '漫画绑定的活动内容版本不存在。', 409);
    validateComicDocument(document, JSON.parse(revision.document_json) as import('@sthstart/contracts').ContentDocument);
    const save = () => {
      const current = this.getComicDraft(activityId);
      if (!current) throw codedError('comic_draft_not_found', '漫画草稿不存在。', 404);
      if (current.draftVersion !== expectedDraftVersion) throw codedError('comic_draft_conflict', '漫画草稿已在其他位置更新；本地输入已保留。', 409);
      this.validateImageOwnership(activityId, document);
      const result = this.connection.prepare(`UPDATE activity_comic_drafts
        SET document_json=?,draft_version=draft_version+1,updated_at=? WHERE activity_id=? AND draft_version=?`)
        .run(JSON.stringify(document), nowIso(), activityId, expectedDraftVersion);
      if (result.changes !== 1) throw codedError('comic_draft_conflict', '漫画草稿版本冲突；请刷新后比较。', 409);
      this.syncDraftReferences(activityId, current.document, document);
    };
    if (options.skipTransaction) save(); else this.database.transaction(save);
    return this.getComicDraft(activityId)!;
  }

  createComicRevision(activityId: string, expectedDraftVersion: number): ComicRevision {
    return this.database.transaction(() => {
      const draft = this.getComicDraft(activityId);
      if (!draft) throw codedError('comic_draft_not_found', '漫画草稿不存在。', 404);
      if (draft.draftVersion !== expectedDraftVersion) throw codedError('comic_draft_conflict', '漫画草稿已更新，请先刷新。', 409);
      const source = this.connection.prepare('SELECT document_json FROM activity_content_revisions WHERE id=? AND activity_id=?')
        .get(draft.document.contentRevisionId, activityId) as { document_json: string } | undefined;
      if (!source) throw codedError('comic_source_missing', '漫画绑定的活动内容版本不存在。', 409);
      validateComicDocument(draft.document, JSON.parse(source.document_json));
      this.validateImageOwnership(activityId, draft.document);
      const id = randomUUID();
      const createdAt = nowIso();
      const documentJson = JSON.stringify(draft.document);
      const documentHash = hash(draft.document);
      this.connection.prepare(`INSERT INTO activity_comic_revisions(id,activity_id,source_draft_version,document_json,document_hash,created_at)
        VALUES (?,?,?,?,?,?)`).run(id, activityId, draft.draftVersion, documentJson, documentHash, createdAt);
      for (const artifactId of selectedArtifactIds(draft.document)) createArtifactReference(this.database, {
        artifactId, appId: 'activities', refType: 'activity_comic_revision', refId: `comic-revision:${id}`,
      });
      return { id, activityId, sourceDraftVersion: draft.draftVersion, document: draft.document, documentHash, createdAt };
    });
  }

  getComicRevision(activityId: string, revisionId: string): ComicRevision | null {
    const row = this.connection.prepare('SELECT * FROM activity_comic_revisions WHERE activity_id=? AND id=?').get(activityId, revisionId) as Record<string, unknown> | undefined;
    return row ? mapRevision(row) : null;
  }

  listComicRevisions(activityId: string, cursor?: string | null, limit = 20) {
    const pageSize = boundedLimit(limit);
    const decoded = decodeCursor(cursor);
    const rows = (decoded
      ? this.connection.prepare(`SELECT * FROM activity_comic_revisions WHERE activity_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`)
        .all(activityId, decoded.createdAt, decoded.createdAt, decoded.id, pageSize + 1)
      : this.connection.prepare('SELECT * FROM activity_comic_revisions WHERE activity_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(activityId, pageSize + 1)) as Record<string, unknown>[];
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map(mapRevision);
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  createComicJob(input: NewComicJob, options: { skipTransaction?: boolean } = {}): { job: ComicJob; isExisting: boolean } {
    if (!this.connection.prepare('SELECT 1 FROM activities WHERE id=?').get(input.activityId)) throw codedError('activity_not_found', '活动不存在。', 404);
    const requestHash = hash({ kind: input.kind, panelId: input.panelId ?? null, request: input.request });
    const now = nowIso();
    const create = () => {
      const existing = this.connection.prepare('SELECT * FROM activity_comic_jobs WHERE activity_id=? AND idempotency_key=?')
        .get(input.activityId, input.idempotencyKey) as Record<string, unknown> | undefined;
      if (existing) {
        if (String(existing.request_hash) !== requestHash) throw codedError('idempotency_conflict', '相同幂等键已用于不同的漫画请求。', 409);
        return { job: mapJob(existing), isExisting: true };
      }
      const id = randomUUID();
      this.connection.prepare(`INSERT INTO activity_comic_jobs
        (id,activity_id,kind,panel_id,status,idempotency_key,request_hash,input_json,result_json,generation_task_id,trace_id,call_id,error_code,error_message,created_at,updated_at)
        VALUES (?,?,?,?,'queued',?,?,?,NULL,NULL,?,NULL,NULL,NULL,?,?)`).run(
        id, input.activityId, input.kind, input.panelId ?? null, input.idempotencyKey, requestHash, JSON.stringify(input.request), input.traceId, now, now,
      );
      return { job: this.getComicJob(input.activityId, id)!, isExisting: false };
    };
    return options.skipTransaction ? create() : this.database.transaction(create);
  }

  getComicJob(activityId: string, jobId: string): ComicJob | null {
    const row = this.connection.prepare('SELECT * FROM activity_comic_jobs WHERE activity_id=? AND id=?').get(activityId, jobId) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : null;
  }

  getComicJobByIdempotencyKey(activityId: string, idempotencyKey: string): ComicJob | null {
    const row = this.connection.prepare('SELECT * FROM activity_comic_jobs WHERE activity_id=? AND idempotency_key=?')
      .get(activityId, idempotencyKey) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : null;
  }

  claimComicJob(jobId: string): boolean {
    const input=this.connection.prepare('SELECT input_json FROM activity_comic_jobs WHERE id=?').get(jobId);
    if(input && jsonObject(String(input.input_json))?.readOnly===true)return false;
    const result = this.connection.prepare(`UPDATE activity_comic_jobs SET status='preparing',updated_at=? WHERE id=? AND status='queued'`)
      .run(nowIso(), jobId);
    return result.changes === 1;
  }

  recoverInterruptedJobs(): number {
    const result = this.connection.prepare(`UPDATE activity_comic_jobs SET status='interrupted',error_code='comic_process_interrupted',
      error_message='服务重启时任务尚未关联上游生成任务；请查看日志后手动重试。',updated_at=?
      WHERE status IN ('preparing','running') AND generation_task_id IS NULL`).run(nowIso());
    return Number(result.changes);
  }

  listQueuedComicJobs(limit = 100): ComicJob[] {
    return (this.connection.prepare(`SELECT * FROM activity_comic_jobs WHERE status='queued' ORDER BY created_at,id LIMIT ?`)
      .all(boundedLimit(limit, 100, 500)) as Record<string, unknown>[]).map(mapJob);
  }

  listComicJobsForRecovery(limit = 100): ComicJob[] {
    return (this.connection.prepare(`SELECT * FROM activity_comic_jobs WHERE kind='render' AND generation_task_id IS NOT NULL
      AND status IN ('queued','preparing','running','unknown') ORDER BY created_at,id LIMIT ?`)
      .all(boundedLimit(limit, 100, 500)) as Record<string, unknown>[]).map(mapJob);
  }

  findComicRenderJobsByTask(generationTaskId: string): ComicJob[] {
    return (this.connection.prepare(`SELECT * FROM activity_comic_jobs WHERE kind='render' AND generation_task_id=?`)
      .all(generationTaskId) as Record<string, unknown>[]).map(mapJob);
  }

  updateComicJob(jobId: string, patch: Partial<Pick<ComicJob, 'status' | 'result' | 'generationTaskId' | 'callId' | 'errorCode' | 'errorMessage'>>): void {
    const fields: string[] = ['updated_at=?'];
    const params: Array<string | null> = [nowIso()];
    const add = (column: string, value: string | null) => { fields.push(`${column}=?`); params.push(value); };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.result !== undefined) add('result_json', patch.result === null ? null : JSON.stringify(patch.result));
    if (patch.generationTaskId !== undefined) add('generation_task_id', patch.generationTaskId);
    if (patch.callId !== undefined) add('call_id', patch.callId);
    if (patch.errorCode !== undefined) add('error_code', patch.errorCode);
    if (patch.errorMessage !== undefined) add('error_message', patch.errorMessage);
    params.push(jobId);
    this.connection.prepare(`UPDATE activity_comic_jobs SET ${fields.join(',')} WHERE id=?`).run(...params);
  }

  selectComicPanelImage(input: {
    activityId: string; panelId: string; expectedDraftVersion: number; artifactId: string; artifactDirectory: string;
    currentSourceFingerprint: string; allowStaleSource: boolean; withinTransaction?: boolean;
  }): ComicDraft {
    const draft = this.getComicDraft(input.activityId);
    if (!draft) throw codedError('comic_draft_not_found', '漫画草稿不存在。', 404);
    if (draft.draftVersion !== input.expectedDraftVersion) throw codedError('comic_draft_conflict', '漫画草稿已更新，请刷新后重试。', 409);
    const panel = draft.document.panels.find((item) => item.id === input.panelId);
    if (!panel) throw codedError('comic_panel_not_found', '此漫画画格已不存在。', 404);
    if (panel.selectedImage?.artifactId === input.artifactId) return draft;

    const artifact = this.connection.prepare("SELECT id,app_id,media_type,file_status FROM artifacts WHERE id=?").get(input.artifactId) as
      { id: string; app_id: string; media_type: string | null; file_status: string } | undefined;
    if (!artifact || artifact.app_id !== 'activities' || !(artifact.media_type === 'image' || artifact.media_type?.startsWith('image/'))
      || !hasArtifactAccess(this.database, input.artifactId, 'activities', 'read')
      || !resolveArtifactStoragePath(this.database, input.artifactId, input.artifactDirectory)) {
      throw codedError('comic_image_unavailable', '图片文件不可读取，无法选择此历史图片。', 409);
    }

    let origin: 'comic_render' | 'beat_history';
    let renderJobId: string | null = null;
    let sourceFingerprint: string | null = null;
    let sourceChanged = false;
    const renderOutput = this.connection.prepare(`SELECT j.id,j.input_json,j.status FROM activity_comic_job_outputs o
      JOIN activity_comic_jobs j ON j.id=o.job_id WHERE o.artifact_id=? AND j.activity_id=? AND j.panel_id=? AND j.kind='render'`)
      .get(input.artifactId, input.activityId, input.panelId) as { id: string; input_json: string; status: string } | undefined;
    if (renderOutput) {
      if (!['succeeded', 'unknown'].includes(renderOutput.status)) throw codedError('comic_image_not_ready', '漫画绘制任务尚未完成。', 409);
      const jobInput = jsonObject(renderOutput.input_json) ?? {};
      origin = 'comic_render';
      renderJobId = renderOutput.id;
      sourceFingerprint = typeof jobInput.sourceFingerprint === 'string' ? jobInput.sourceFingerprint : null;
      sourceChanged = sourceFingerprint !== input.currentSourceFingerprint;
    } else {
      const beatIds = panel.source.beatIds;
      const placeholders = beatIds.map(() => '?').join(',');
      const beatOutput = this.connection.prepare(`SELECT c.id,c.source_fingerprint,c.status FROM activity_beat_render_candidates c
        LEFT JOIN activity_beat_render_candidate_outputs o ON o.candidate_id=c.id
        WHERE c.activity_id=? AND c.stage_id=? AND c.scene_id=? AND c.beat_id IN (${placeholders})
          AND (o.artifact_id=? OR (o.artifact_id IS NULL AND c.artifact_id=?))
        ORDER BY c.created_at DESC LIMIT 1`).get(input.activityId, panel.source.stageId, panel.source.sceneId,
        ...beatIds, input.artifactId, input.artifactId) as { id: string; source_fingerprint: string; status: string } | undefined;
      if (!beatOutput || !['succeeded', 'adopted'].includes(beatOutput.status)) throw codedError('comic_image_not_in_history', '此图片不属于当前画格或来源镜头的生成历史。', 404);
      origin = 'beat_history';
      sourceFingerprint = beatOutput.source_fingerprint;
      // Beat and comic prompt fingerprints intentionally describe different render pipelines;
      // require an explicit confirmation before importing a source-beat image.
      sourceChanged = true;
    }
    if (sourceChanged && !input.allowStaleSource) throw codedError('comic_source_changed', '这张图片来自不同的画面描述。确认后可将它选入当前画格。', 409);

    const nextDocument: ComicDocument = { ...draft.document, panels: draft.document.panels.map((item) => item.id === input.panelId ? {
      ...item, selectedImage: { artifactId: input.artifactId, origin, renderJobId, sourceFingerprint },
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
    } : item) };
    const saved=this.saveComicDraft(input.activityId, input.expectedDraftVersion, nextDocument,{skipTransaction:input.withinTransaction});
    // Selection belongs to the producing task's timeline, so a reviewer can see
    // which generated picture was used where. No model call is implied.
    const callId=renderJobId?this.connection.prepare('SELECT call_id FROM activity_comic_jobs WHERE id=?').get(renderJobId):null;
    if(callId&&(callId as {call_id:string|null}).call_id)updateAiCallRecord(this.database,String((callId as {call_id:string}).call_id),
      {event:'comic_image_selected',detail:{activityId:input.activityId,panelId:input.panelId,artifactId:input.artifactId,origin,sourceChanged}});
    return saved;
  }

  listComicJobs(activityId: string, panelId?: string | null, cursor?: string | null, limit = 20): ComicJobPage {
    const pageSize = boundedLimit(limit);
    const decoded = decodeCursor(cursor);
    const panelClause = panelId ? ' AND panel_id=?' : '';
    const cursorClause = decoded ? ' AND (created_at<? OR (created_at=? AND id<?))' : '';
    const params: Array<string | number> = [activityId];
    if (panelId) params.push(panelId);
    if (decoded) params.push(decoded.createdAt, decoded.createdAt, decoded.id);
    params.push(pageSize + 1);
    const rows = this.connection.prepare(`SELECT * FROM activity_comic_jobs WHERE activity_id=?${panelClause}${cursorClause} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params) as Record<string, unknown>[];
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map(mapJob);
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  recordComicJobOutputs(jobId: string, artifactIds: string[]): void {
    this.database.transaction(() => {
      const job = this.connection.prepare('SELECT activity_id FROM activity_comic_jobs WHERE id=?').get(jobId) as { activity_id: string } | undefined;
      if (!job) throw codedError('comic_job_not_found', '漫画任务不存在。', 404);
      const unique = [...new Set(artifactIds)];
      unique.forEach((artifactId, index) => {
        const artifact = this.connection.prepare('SELECT app_id,media_type FROM artifacts WHERE id=?').get(artifactId) as { app_id: string; media_type: string | null } | undefined;
        if (!artifact || artifact.app_id !== 'activities' || !(artifact.media_type === 'image' || artifact.media_type?.startsWith('image/'))) return;
        this.connection.prepare(`INSERT INTO activity_comic_job_outputs(job_id,artifact_id,sort_order,created_at)
          VALUES (?,?,?,?) ON CONFLICT(job_id,artifact_id) DO NOTHING`).run(jobId, artifactId, index, nowIso());
        createArtifactReference(this.database, { artifactId, appId: 'activities', refType: 'activity_comic_render', refId: `comic-render:${jobId}` });
      });
    });
  }

  listComicHistoryImages(activityId: string, panelId: string, currentArtifactId: string | null, currentFingerprint: string | null, cursor?: string | null, limit = 24) {
    const pageSize = boundedLimit(limit, 24);
    const decoded = decodeHistoryCursor(cursor);
    const cursorClause = decoded ? ` AND (
        j.created_at<? OR (j.created_at=? AND j.id<?)
        OR (j.created_at=? AND j.id=? AND (o.sort_order>? OR (o.sort_order=? AND o.artifact_id>?)))
      )` : '';
    const params: Array<string | number> = [activityId, panelId];
    if (decoded) params.push(
      decoded.createdAt, decoded.createdAt, decoded.jobId,
      decoded.createdAt, decoded.jobId, decoded.sortOrder, decoded.sortOrder, decoded.artifactId,
    );
    params.push(pageSize + 1);
    const rows = this.connection.prepare(`SELECT j.id AS job_id,j.created_at,j.call_id,j.input_json,j.status AS job_status,o.sort_order,
        a.id AS artifact_id,a.file_status,a.media_type
      FROM activity_comic_jobs j JOIN activity_comic_job_outputs o ON o.job_id=j.id
      JOIN artifacts a ON a.id=o.artifact_id
      WHERE j.activity_id=? AND j.panel_id=?${cursorClause}
      ORDER BY j.created_at DESC,j.id DESC,o.sort_order,o.artifact_id LIMIT ?`).all(...params) as Array<Record<string, unknown>>;
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);
    const images: ComicHistoryImage[] = pageRows.map((row) => {
      const input = jsonObject(String(row.input_json)) ?? {};
      const operation = readImageOperationMetadata(this.database, String(row.job_id));
      return {
        artifactId: String(row.artifact_id), origin: 'comic_render' as const, renderJobId: String(row.job_id), createdAt: String(row.created_at),
        available: String(row.file_status) === 'ready' && (String(row.media_type) === 'image' || String(row.media_type).startsWith('image/')),
        unavailableReason: String(row.file_status) !== 'ready' ? '文件不可用'
          : (String(row.media_type) === 'image' || String(row.media_type).startsWith('image/')) ? null : '产物不是图片',
        current: String(row.artifact_id) === currentArtifactId,
        sourceChanged: typeof input.sourceFingerprint === 'string' && currentFingerprint !== null && input.sourceFingerprint !== currentFingerprint,
        sourceFingerprint: typeof input.sourceFingerprint === 'string' ? input.sourceFingerprint : null,
        callId: row.call_id ? String(row.call_id) : null,
        previewUrl: String(row.file_status) === 'ready' ? `/api/admin/artifacts/${encodeURIComponent(String(row.artifact_id))}/file` : null,
        ...(operation ? { imageOperation: operation } : {}),
      };
    });
    const jobs = this.listComicJobs(activityId, panelId, null, 100).items;
    const last = pageRows.at(-1);
    return {
      images,
      jobs,
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify({
          createdAt: String(last.created_at), jobId: String(last.job_id),
          sortOrder: Number(last.sort_order), artifactId: String(last.artifact_id),
        })).toString('base64url')
        : null,
    };
  }

  listBeatHistoryImages(activityId: string, panel: ComicDocument['panels'][number], currentArtifactId: string | null) {
    const placeholders = panel.source.beatIds.map(() => '?').join(',');
    const rows = this.connection.prepare(`SELECT c.id AS candidate_id,c.created_at,c.call_id,c.source_fingerprint,c.status,
        COALESCE(o.artifact_id,c.artifact_id) AS artifact_id,a.media_type,a.file_status
      FROM activity_beat_render_candidates c
      LEFT JOIN activity_beat_render_candidate_outputs o ON o.candidate_id=c.id
      JOIN artifacts a ON a.id=COALESCE(o.artifact_id,c.artifact_id)
      WHERE c.activity_id=? AND c.stage_id=? AND c.scene_id=? AND c.beat_id IN (${placeholders})
        AND c.status IN ('succeeded','adopted') AND (a.media_type='image' OR a.media_type LIKE 'image/%')
      ORDER BY c.created_at DESC,c.id DESC,COALESCE(o.sort_order,0),a.id LIMIT 100`).all(
      activityId, panel.source.stageId, panel.source.sceneId, ...panel.source.beatIds,
    ) as Array<Record<string, unknown>>;
    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const artifactId = String(row.artifact_id ?? '');
      if (!artifactId || seen.has(artifactId)) return [];
      seen.add(artifactId);
      return [{
        artifactId, origin: 'beat_history' as const, renderJobId: null, createdAt: String(row.created_at),
        available: String(row.file_status) === 'ready', unavailableReason: String(row.file_status) === 'ready' ? null : '文件不可用',
        current: artifactId === currentArtifactId, sourceChanged: true, sourceFingerprint: String(row.source_fingerprint),
        callId: row.call_id ? String(row.call_id) : null,
        previewUrl: String(row.file_status) === 'ready' ? `/api/admin/artifacts/${encodeURIComponent(artifactId)}/file` : null,
      }];
    });
  }
}
