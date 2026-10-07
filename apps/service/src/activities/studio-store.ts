import { randomUUID, createHash } from 'node:crypto';
import type { StudioJob, StudioJobKind, StudioJobStatus, StudioJobPage, StudioJobListQuery, StudioAppliedResult } from '@sthstart/contracts';
import { nowIso, type ServiceDatabase } from '../database.js';
import { createArtifactReference } from '../artifacts.js';

export function studioError(code: string, message: string, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
export function studioHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const terminal: StudioJobStatus[] = ['succeeded','partially_succeeded','failed','cancelled','interrupted','unknown'];
const transitions: Partial<Record<StudioJobStatus, StudioJobStatus[]>> = {
  queued: ['preparing','cancelled','interrupted'], preparing: ['running','failed','cancelled','interrupted','unknown'],
  running: ['awaiting_review','failed','cancelled','interrupted','unknown'], awaiting_review: ['succeeded','cancelled'],
};
function rowJob(row: Record<string, unknown>): StudioJob {
  const json = <T,>(name: string): T | null => row[name] == null ? null : JSON.parse(String(row[name])) as T;
  return { id: String(row.id), activityId: String(row.activity_id), parentJobId: row.parent_job_id == null ? null : String(row.parent_job_id),
    kind: row.kind as StudioJobKind, status: row.status as StudioJobStatus, revision: Number(row.revision),
    idempotencyKey: String(row.idempotency_key), requestHash: String(row.request_hash), input: json<StudioJob['input']>('input_json')!,
    result: json<StudioJob['result']>('result_json'), planHash: row.plan_hash == null ? null : String(row.plan_hash), traceId: String(row.trace_id),
    callId: row.call_id == null ? null : String(row.call_id), stopRequested: Boolean(row.stop_requested), applyState: row.apply_state as StudioJob['applyState'],
    appliedResult: json<StudioAppliedResult>('applied_result_json'), errorCode: row.error_code == null ? null : String(row.error_code),
    errorMessage: row.error_message == null ? null : String(row.error_message), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    sourceUrl: `/apps/activities/${row.activity_id}?tab=studio&panel=smart-create&studioJobId=${row.id}`,readOnly:json<StudioJob['input']>('input_json')?.readOnly===true };
}
export class StudioStore {
  constructor(readonly database: ServiceDatabase) {}
  get(activityId: string, id: string): StudioJob | null {
    const row = this.database.connection.prepare('SELECT * FROM activity_studio_jobs WHERE activity_id=? AND id=?').get(activityId,id);
    return row ? rowJob(row) : null;
  }
  findIdempotent(activityId: string, key: string, requestHash: string): StudioJob | null {
    const row = this.database.connection.prepare('SELECT * FROM activity_studio_jobs WHERE activity_id=? AND idempotency_key=?').get(activityId,key);
    if (!row) return null;
    if (row.request_hash !== requestHash) throw studioError('idempotency_conflict','同一个提交标识对应了不同内容，请明确新建任务。',409);
    return rowJob(row);
  }
  /** Freeze validation and insertion share a transaction; no network is allowed in freeze(). */
  create(input: { activityId: string; kind: StudioJobKind; idempotencyKey: string; request: unknown;
    freeze(): Record<string,unknown>; artifactIds?: string[]; parentJobId?: string; planHash?: string },
    options: { skipTransaction?: boolean } = {}): { job: StudioJob; existing: boolean } {
    const create = () => {
      const requestHash = studioHash(input.request);
      const existing = this.findIdempotent(input.activityId,input.idempotencyKey,requestHash);
      if (existing) return { job: existing, existing: true };
      const snapshot = input.freeze();
      const id = randomUUID(), now = nowIso();
      this.database.connection.prepare(`INSERT INTO activity_studio_jobs
        (id,activity_id,kind,status,idempotency_key,request_hash,input_json,trace_id,created_at,updated_at,parent_job_id,plan_hash)
        VALUES (?,?,?,'queued',?,?,?,?,?,?,?,?)`).run(id,input.activityId,input.kind,input.idempotencyKey,requestHash,JSON.stringify(snapshot),randomUUID(),now,now,input.parentJobId ?? null,input.planHash ?? null);
      const artifactIds = input.artifactIds ?? (Array.isArray(snapshot.referenceArtifactIds) ? snapshot.referenceArtifactIds.filter((id): id is string => typeof id === 'string') : []);
      for (const artifactId of artifactIds) {
        if (!this.database.connection.prepare('SELECT 1 FROM activity_assets WHERE activity_id=? AND artifact_id=?').get(input.activityId,artifactId))
          throw studioError('studio_artifact_unavailable','参考图不属于本活动。',409);
        createArtifactReference(this.database, { artifactId, appId: 'activities', refType: 'activity_studio_job', refId: `studio-job:${id}` });
      }
      return { job: this.get(input.activityId,id)!, existing: false };
    };
    return options.skipTransaction ? create() : this.database.transaction(create);
  }
  list(activityId: string, query: StudioJobListQuery = {}): StudioJobPage {
    const limit = query.limit ?? 20;
    let cursor: { time: string; id: string } | null = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor,'base64url').toString()); }
      catch { throw studioError('studio_invalid_cursor','分页游标不合法。'); }
      if (!cursor || typeof cursor.time !== 'string' || typeof cursor.id !== 'string') throw studioError('studio_invalid_cursor','分页游标不合法。');
    }
    const clauses = ['activity_id=?'], values: Array<string|number> = [activityId];
    if (query.kind) { clauses.push('kind=?'); values.push(query.kind); }
    if (query.status) { clauses.push('status=?'); values.push(query.status); }
    if (cursor) { clauses.push('(created_at<? OR (created_at=? AND id<?))'); values.push(cursor.time,cursor.time,cursor.id); }
    const rows = this.database.connection.prepare(`SELECT * FROM activity_studio_jobs WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...values,limit+1);
    const items = rows.slice(0,limit).map(rowJob), last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ time: last.createdAt,id: last.id })).toString('base64url') : null };
  }
  claim(activityId: string, id: string, owner: string): boolean {
    if(this.get(activityId,id)?.readOnly)return false;
    const now = nowIso(), until = new Date(Date.now()+180_000).toISOString();
    return this.database.connection.prepare(`UPDATE activity_studio_jobs SET status='preparing',revision=revision+1,lease_owner=?,lease_expires_at=?,updated_at=?
      WHERE activity_id=? AND id=? AND status='queued' AND stop_requested=0`).run(owner,until,now,activityId,id).changes === 1;
  }
  renew(activityId: string, id: string, owner: string): boolean {
    return this.database.connection.prepare(`UPDATE activity_studio_jobs SET lease_expires_at=? WHERE activity_id=? AND id=? AND lease_owner=?
      AND status IN ('preparing','running') AND stop_requested=0`).run(new Date(Date.now()+180_000).toISOString(),activityId,id,owner).changes === 1;
  }
  transition(activityId: string, id: string, expectedRevision: number, status: StudioJobStatus,
    patch: { result?: NonNullable<StudioJob['result']>; callId?: string|null; errorCode?: string; errorMessage?: string } = {}): StudioJob {
    const old = this.get(activityId,id);
    if (!old || old.revision !== expectedRevision) throw studioError('studio_job_conflict','任务状态已改变，请刷新任务。',409);
    const renderComplete = old.kind === 'render_batch' && old.status === 'running' && ['succeeded','partially_succeeded','paused'].includes(status);
    const fallbackPaused=old.input.fallback!=null&&['preparing','running'].includes(old.status)&&status==='paused';
    if (!renderComplete && !fallbackPaused && !transitions[old.status]?.includes(status)) throw studioError('studio_job_conflict','此任务不能进行该状态转换。',409);
    const result = this.database.connection.prepare(`UPDATE activity_studio_jobs SET status=?,revision=revision+1,result_json=?,call_id=?,error_code=?,error_message=?,updated_at=?,
      lease_owner=CASE WHEN ? IN ('preparing','running') THEN lease_owner ELSE NULL END,
      lease_expires_at=CASE WHEN ? IN ('preparing','running') THEN lease_expires_at ELSE NULL END
      WHERE activity_id=? AND id=? AND revision=?`).run(status,patch.result ? JSON.stringify(patch.result) : old.result ? JSON.stringify(old.result) : null,
      patch.callId ?? old.callId, patch.errorCode ?? old.errorCode, patch.errorMessage ?? old.errorMessage,nowIso(),status,status,activityId,id,expectedRevision);
    if (result.changes !== 1) throw studioError('studio_job_conflict','任务状态已改变，请刷新任务。',409);
    return this.get(activityId,id)!;
  }
  stop(activityId: string, id: string, revision: number): StudioJob {
    const old = this.get(activityId,id);
    if (!old) throw studioError('studio_job_not_found','任务不属于此活动。',404);
    if(old.readOnly)throw studioError('studio_job_read_only','导入的历史任务只读，不会重新执行。',409);
    if (old.stopRequested || terminal.includes(old.status)) return old;
    if (old.revision !== revision) throw studioError('studio_job_conflict','任务已更新，请刷新后停止。',409);
    if (this.database.connection.prepare(`UPDATE activity_studio_jobs SET stop_requested=1,status='cancelled',revision=revision+1,
      lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE activity_id=? AND id=? AND revision=?`).run(nowIso(),activityId,id,revision).changes !== 1)
      throw studioError('studio_job_conflict','任务已更新，请刷新后停止。',409);
    return this.get(activityId,id)!;
  }
  /** Caller transaction includes all content writes. A retry reads this before version checks. */
  recordApplied(activityId: string, id: string, revision: number, result: StudioAppliedResult): StudioJob {
    if(this.get(activityId,id)?.readOnly)throw studioError('studio_job_read_only','导入的历史提案只读，不能重复应用。',409);
    const changed = this.database.connection.prepare(`UPDATE activity_studio_jobs SET status='succeeded',apply_state='applied',applied_result_json=?,revision=revision+1,updated_at=?
      WHERE activity_id=? AND id=? AND revision=? AND status='awaiting_review' AND apply_state='not_applied' AND stop_requested=0`)
      .run(JSON.stringify(result),nowIso(),activityId,id,revision).changes;
    if (changed !== 1) throw studioError('studio_job_conflict','提案状态已改变，未写入内容。',409);
    return this.get(activityId,id)!;
  }
}
