import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { AiCallStatus } from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';

const aiCallRedactionContext = new AsyncLocalStorage<readonly string[]>();
const SECRET_VALUE_KEY = /authorization|api[-_]?key|(?:^|[_-])key(?:$|[_-])|access[-_]?token|refresh[-_]?token|(?:^|[_-])token(?:$|[_-])|secret|password|cookie|credential|bearer/i;

function normalizedSecrets(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => b.length - a.length);
}

function currentSecrets(extra?: readonly string[]): string[] {
  return normalizedSecrets(aiCallRedactionContext.getStore(), extra);
}

export function collectAiCallRedactionSecrets(...values: unknown[]): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, key = '', inheritedSensitive = false) => {
    const sensitive = inheritedSensitive || SECRET_VALUE_KEY.test(key);
    if (typeof value === 'string') {
      if (sensitive && value.length) found.add(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach((child) => visit(child, key, sensitive)); return; }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) visit(child, childKey, sensitive);
    }
  };
  values.forEach((value) => visit(value));
  return normalizedSecrets([...found]);
}

export function withAiCallRedactionSecrets<T>(secrets: readonly string[], operation: () => T): T {
  return aiCallRedactionContext.run(normalizedSecrets(aiCallRedactionContext.getStore(), secrets), operation);
}

export interface AiCallContext {
  traceId?: string;
  parentId?: string | null;
  retryOf?: string | null;
  applicationId: string;
  feature: string;
  businessEvent: string;
  objectType?: string | null;
  objectId?: string | null;
  callType: string;
  provider?: string | null;
  models?: string[];
  workflowId?: string | null;
  workflowVersion?: number | null;
  upstreamTaskId?: string | null;
  parameters?: Record<string, unknown>;
  positivePrompt?: string | null;
  negativePrompt?: string | null;
  requestSnapshot?: unknown;
  sourceUrl?: string | null;
  generationTaskId?: string | null;
  artifactIds?: string[];
  /** In-memory values used only to redact this call; never serialized. */
  redactionSecrets?: string[];
}

export function redactAiValue(value: unknown, key = '', knownSecrets?: readonly string[]): unknown {
  if (SECRET_VALUE_KEY.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    let redacted = value
      .replace(/data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+|data:application\/(?:pdf|octet-stream);base64,[a-z0-9+/=\r\n]+/gi, '[REDACTED_MEDIA_DATA_URL]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:api[-_]?key|key|access[-_]?token|token|secret|password|signature)=)[^&#\s]*/gi, '$1[REDACTED]')
      .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
    for (const secret of currentSecrets(knownSecrets)) redacted = redacted.split(secret).join('[REDACTED]');
    return redacted;
  }
  if (Array.isArray(value)) return value.map((item) => redactAiValue(item, '', knownSecrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactAiValue(child, childKey, knownSecrets)]));
  }
  return value;
}

function json(value: unknown, knownSecrets?: readonly string[]): string {
  return JSON.stringify(redactAiValue(value, '', knownSecrets) ?? {});
}

export function createAiCallRecord(database: ServiceDatabase, input: AiCallContext): string {
  const id = randomUUID();
  const secrets = currentSecrets(input.redactionSecrets);
  const traceId = String(redactAiValue(input.traceId || randomUUID(), '', secrets));
  const requestedAt = nowIso();
  const snapshot = redactAiValue(input.requestSnapshot ?? {}, '', secrets) as Record<string, unknown>;
  const models = input.models ?? extractModelNames(snapshot);
  database.connection.prepare(`INSERT INTO ai_call_records (
    id,trace_id,parent_id,retry_of,application_id,feature,business_event,object_type,object_id,call_type,status,
    requested_at,provider,models_json,workflow_id,workflow_version,upstream_task_id,parameters_json,
    positive_prompt,negative_prompt,request_snapshot_json,source_url,generation_task_id,artifact_ids_json
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, traceId, input.parentId ?? null, input.retryOf ?? null,
    String(redactAiValue(input.applicationId, '', secrets)), String(redactAiValue(input.feature, '', secrets)), String(redactAiValue(input.businessEvent, '', secrets)),
    input.objectType == null ? null : String(redactAiValue(input.objectType, '', secrets)), input.objectId == null ? null : String(redactAiValue(input.objectId, '', secrets)),
    String(redactAiValue(input.callType, '', secrets)), 'requested', requestedAt, input.provider == null ? null : String(redactAiValue(input.provider, '', secrets)),
    json(models, secrets), input.workflowId == null ? null : String(redactAiValue(input.workflowId, '', secrets)), input.workflowVersion ?? null,
    input.upstreamTaskId == null ? null : String(redactAiValue(input.upstreamTaskId, '', secrets)),
    json(input.parameters ?? {}, secrets), input.positivePrompt == null ? null : String(redactAiValue(input.positivePrompt, '', secrets)),
    input.negativePrompt == null ? null : String(redactAiValue(input.negativePrompt, '', secrets)), json(snapshot, secrets),
    input.sourceUrl ? String(redactAiValue(input.sourceUrl, '', secrets)) : null, input.generationTaskId ?? null, json(input.artifactIds ?? [], secrets),
  );
  appendAiCallEvent(database, id, 'requested', { businessEvent: input.businessEvent, feature: input.feature }, secrets);
  return id;
}

export function appendAiCallEvent(database: ServiceDatabase, callId: string, phase: string, detail: unknown = {}, knownSecrets?: readonly string[]): void {
  database.connection.prepare('INSERT INTO ai_call_events(call_id,created_at,phase,detail_json) VALUES (?,?,?,?)')
    .run(callId, nowIso(), phase, json(detail, knownSecrets));
}

export function updateAiCallRecord(
  database: ServiceDatabase,
  callId: string,
  update: {
    status?: AiCallStatus; event?: string; detail?: unknown; provider?: string | null; models?: string[];
    workflowId?: string | null; workflowVersion?: number | null; upstreamTaskId?: string | null;
    parameters?: Record<string, unknown>; requestSnapshot?: unknown; responseText?: string | null;
    usage?: Record<string, unknown>; errorCode?: string | null; errorMessage?: string | null; sourceUrl?: string | null;
    artifactIds?: string[]; artifactDetails?: Array<{ id: string; sha256: string | null; available: boolean }>;
    redactionSecrets?: string[];
  },
): void {
  const secrets = currentSecrets(update.redactionSecrets);
  const now = nowIso();
  const fields: string[] = [];
  const values: SQLInputValue[] = [];
  const set = (column: string, value: unknown) => { fields.push(`${column}=?`); values.push(value as SQLInputValue); };
  if (update.status) {
    set('status', update.status);
    if (['succeeded', 'failed', 'abandoned', 'not_dispatched'].includes(update.status)) {
      set('ended_at', now);
      fields.push('duration_ms=CAST((julianday(?) - julianday(requested_at)) * 86400000 AS INTEGER)');
      values.push(now);
    }
  }
  if (update.provider !== undefined) set('provider', update.provider === null ? null : String(redactAiValue(update.provider, '', secrets)));
  if (update.models !== undefined) set('models_json', json(update.models, secrets));
  if (update.workflowId !== undefined) set('workflow_id', update.workflowId);
  if (update.workflowVersion !== undefined) set('workflow_version', update.workflowVersion);
  if (update.upstreamTaskId !== undefined) set('upstream_task_id', update.upstreamTaskId);
  if (update.parameters !== undefined) set('parameters_json', json(update.parameters, secrets));
  if (update.requestSnapshot !== undefined) set('request_snapshot_json', json(update.requestSnapshot, secrets));
  if (update.responseText !== undefined) set('response_text', update.responseText === null ? null : String(redactAiValue(update.responseText, '', secrets)));
  if (update.usage !== undefined) set('usage_json', json(update.usage, secrets));
  if (update.errorCode !== undefined) set('error_code', update.errorCode === null ? null : String(redactAiValue(update.errorCode, '', secrets)));
  if (update.errorMessage !== undefined) set('error_message', update.errorMessage === null ? null : String(redactAiValue(update.errorMessage, '', secrets)));
  if (update.sourceUrl !== undefined) set('source_url', update.sourceUrl === null ? null : String(redactAiValue(update.sourceUrl, '', secrets)));
  if (update.artifactIds !== undefined) set('artifact_ids_json', json(update.artifactIds, secrets));
  if (update.artifactDetails !== undefined) set('artifact_details_json', json(update.artifactDetails, secrets));
  if (fields.length) database.connection.prepare(`UPDATE ai_call_records SET ${fields.join(',')} WHERE id=?`).run(...values, callId);
  if (update.event) appendAiCallEvent(database, callId, update.event, update.detail ?? {}, secrets);
}

export function appendAiCallResponseChunk(database: ServiceDatabase, callId: string, chunk: string, knownSecrets?: readonly string[]): void {
  // Chunks are appended as they are forwarded; this does not buffer the provider stream.
  const safe = String(redactAiValue(chunk, '', knownSecrets));
  database.connection.prepare('UPDATE ai_call_records SET response_text=COALESCE(response_text,\'\') || ? WHERE id=?').run(safe, callId);
}

/** Stream-safe redaction: image data URLs can span arbitrary upstream chunks. */
class IncrementalAiTextRedactor {
  private pending = '';
  private insideMedia = false;

  constructor(private readonly knownSecrets: readonly string[] = []) {}

  push(chunk: string, final = false): string {
    this.pending += chunk;
    let safe = '';
    while (this.pending) {
      if (this.insideMedia) {
        const end = this.pending.search(/[^A-Za-z0-9+/=\r\n]/);
        if (end < 0) {
          if (final) this.pending = '';
          break;
        }
        this.pending = this.pending.slice(end);
        this.insideMedia = false;
        continue;
      }
      const start = this.pending.search(/data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,|data:application\/(?:pdf|octet-stream);base64,/i);
      if (start >= 0) {
        safe += redactAiValue(this.pending.slice(0, start), '', this.knownSecrets) as string;
        safe += '[REDACTED_MEDIA_DATA_URL]';
        const match = this.pending.slice(start).match(/^data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,|^data:application\/(?:pdf|octet-stream);base64,/i)?.[0];
        this.pending = this.pending.slice(start + (match?.length ?? 0));
        this.insideMedia = true;
        continue;
      }
      // Keep a short overlap so a MIME header split between chunks is detected.
      const overlapLength = Math.max(128, ...this.knownSecrets.map((secret) => secret.length));
      let emitLength = final ? this.pending.length : Math.max(0, this.pending.length - overlapLength);
      // The overlap alone is not enough when a credential begins immediately
      // before the cut. Move the boundary back over any partial secret so that
      // a secret split across arbitrary provider chunks is never persisted.
      let moved = true;
      while (moved && emitLength > 0) {
        moved = false;
        for (const secret of this.knownSecrets) {
          const right = this.pending.slice(emitLength);
          const maxPrefix = Math.min(secret.length - 1, emitLength);
          for (let prefixLength = maxPrefix; prefixLength > 0; prefixLength -= 1) {
            if (this.pending.slice(emitLength - prefixLength, emitLength) === secret.slice(0, prefixLength)
              && secret.slice(prefixLength).startsWith(right)) {
              emitLength -= prefixLength;
              moved = true;
              break;
            }
          }
          if (moved) break;
        }
      }
      const emitted = this.pending.slice(0, emitLength);
      safe += redactAiValue(emitted, '', this.knownSecrets) as string;
      this.pending = this.pending.slice(emitted.length);
      break;
    }
    if (final && this.pending) {
      safe += this.insideMedia ? '' : redactAiValue(this.pending, '', this.knownSecrets) as string;
      this.pending = '';
      this.insideMedia = false;
    }
    return safe;
  }
}

export function recordAiCallStream(database: ServiceDatabase, callId: string, stream: ReadableStream<Uint8Array>, resultStatus: 'succeeded' | 'failed' = 'succeeded', knownSecrets?: readonly string[]): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const secrets = currentSecrets(knownSecrets);
  const redactor = new IncrementalAiTextRedactor(secrets);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          const tail = decoder.decode();
          const safeTail = redactor.push(tail, true);
          if (safeTail) appendAiCallResponseChunk(database, callId, safeTail, secrets);
          updateAiCallRecord(database, callId, { status: resultStatus, event: resultStatus === 'succeeded' ? 'stream_completed' : 'provider_error', redactionSecrets: [...secrets] });
          controller.close();
          return;
        }
        const safeChunk = redactor.push(decoder.decode(value, { stream: true }));
        if (safeChunk) appendAiCallResponseChunk(database, callId, safeChunk, secrets);
        controller.enqueue(value);
      } catch (error) {
        updateAiCallRecord(database, callId, { status: 'abandoned', event: 'stream_interrupted', errorCode: 'stream_interrupted', errorMessage: error instanceof Error ? error.message : String(error), redactionSecrets: [...secrets] });
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch { /* stream is already closed */ }
      updateAiCallRecord(database, callId, { status: 'abandoned', event: 'client_disconnected', detail: { reason: String(reason ?? 'cancelled') }, redactionSecrets: [...secrets] });
    },
  });
}

export async function fetchAuditedAiResponse(
  database: ServiceDatabase,
  input: AiCallContext,
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; callId: string; redactionSecrets: string[] }> {
  const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body) as unknown; } catch { return init.body; } })() : init.body;
  const redactionSecrets = currentSecrets(input.redactionSecrets);
  const callId = createAiCallRecord(database, {
    ...input,
    redactionSecrets,
    requestSnapshot: { url: redactAiValue(url, '', redactionSecrets), method: init.method ?? 'GET', headerNames: Object.keys(init.headers ?? {}), body },
    models: input.models ?? (body && typeof body === 'object' && !Array.isArray(body) && typeof (body as Record<string, unknown>).model === 'string' ? [String((body as Record<string, unknown>).model)] : []),
    sourceUrl: url,
  });
  updateAiCallRecord(database, callId, { status: 'submitted', event: 'submitted', detail: { method: init.method ?? 'GET' }, redactionSecrets });
  try {
    const response = await fetcher(url, init);
    const rawText = await response.clone().text();
    let outputText = rawText;
    let usage: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      if (parsed.usage && typeof parsed.usage === 'object' && !Array.isArray(parsed.usage)) usage = parsed.usage as Record<string, unknown>;
      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const content = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
      if (typeof content?.content === 'string') outputText = content.content;
    } catch { /* provider may return plain text */ }
    updateAiCallRecord(database, callId, {
      status: response.ok ? 'succeeded' : 'failed', event: response.ok ? 'response_received' : 'provider_error',
      detail: { httpStatus: response.status }, responseText: outputText, usage, redactionSecrets,
      ...(response.ok ? {} : { errorCode: `http_${response.status}`, errorMessage: outputText }),
    });
    return { response, callId, redactionSecrets };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateAiCallRecord(database, callId, { status: 'abandoned', event: 'transport_error', errorCode: 'upstream_unavailable', errorMessage: message, redactionSecrets });
    throw error;
  }
}

export function generationCallId(database: ServiceDatabase, taskId: string): string | null {
  const row = database.connection.prepare('SELECT id FROM ai_call_records WHERE generation_task_id=?').get(taskId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function syncGenerationAiCall(
  database: ServiceDatabase,
  taskId: string,
  event: string,
  detail: Record<string, unknown> = {},
): void {
  const callId = generationCallId(database, taskId);
  if (callId) {
    const callStatus: Partial<Record<string, AiCallStatus>> = {
      submitting: 'submitted', execution_dispatch_snapshot: 'submitted', accepted: 'accepted', running: 'running',
      completed: 'succeeded', succeeded: 'succeeded', failed: 'failed', abandoned: 'abandoned',
    };
    const update: Parameters<typeof updateAiCallRecord>[2] = { event, detail };
    if (callStatus[event]) update.status = callStatus[event];
    if (typeof detail.providerTaskId === 'string') update.upstreamTaskId = detail.providerTaskId;
    if (typeof detail.errorCode === 'string') update.errorCode = detail.errorCode;
    if (typeof detail.errorMessage === 'string') update.errorMessage = detail.errorMessage;
    if (detail.actualInputs && typeof detail.actualInputs === 'object') update.requestSnapshot = detail.actualInputs;
    if (detail.actualInputs && typeof detail.actualInputs === 'object') update.models = extractModelNames(detail.actualInputs);
    if (Array.isArray(detail.artifactIds)) update.artifactIds = detail.artifactIds.filter((item): item is string => typeof item === 'string');
    updateAiCallRecord(database, callId, update);
  }
  // Candidate state must not depend on an optional AI-call audit row. Older
  // tasks and interrupted writes can have a task + artifacts but no call row.
  syncBeatRenderCandidateFromTask(database, taskId, event, detail, callId);
}

export function syncBeatRenderCandidateFromTask(
  database: ServiceDatabase,
  taskId: string,
  event: string,
  detail: Record<string, unknown> = {},
  callId: string | null = generationCallId(database, taskId),
): void {
  const candidateStatus: Partial<Record<string, string>> = { queued: 'queued', submitting: 'running', accepted: 'running', running: 'running', completed: 'succeeded', succeeded: 'succeeded', failed: 'failed', abandoned: 'failed' };
  const candidateState = candidateStatus[event];
  if (candidateState) {
    database.connection.prepare(`UPDATE activity_beat_render_candidates SET status=?,error_message=COALESCE(?,error_message)
      WHERE task_id=? AND adopted_at IS NULL`).run(candidateState, typeof detail.errorMessage === 'string' ? String(redactAiValue(detail.errorMessage)) : null, taskId);
  }
  if (event === 'succeeded' || event === 'completed') {
    const artifacts = database.connection.prepare(`SELECT a.id,a.media_type,a.file_status,a.sha256 FROM generation_task_artifacts ta JOIN artifacts a ON a.id=ta.artifact_id
      WHERE ta.task_id=? ORDER BY ta.sort_order`).all(taskId) as Array<{ id: string; media_type: string | null; file_status: string; sha256: string | null }>;
    const details = artifacts.map((artifact) => ({
      id: String(artifact.id),
      sha256: artifact.sha256,
      available: artifact.file_status === 'ready',
    }));
    const ids = details.map((artifact) => artifact.id);
    if (callId) updateAiCallRecord(database, callId, { artifactIds: ids, artifactDetails: details, event: 'artifacts_attached', detail: { artifactIds: ids } });
    const imageArtifacts = artifacts.filter((artifact) => artifact.media_type === 'image' || artifact.media_type?.startsWith('image/'));
    const candidate = database.connection.prepare('SELECT id FROM activity_beat_render_candidates WHERE task_id=?').get(taskId) as { id: string } | undefined;
    if (candidate) database.transaction(() => {
      database.connection.prepare('DELETE FROM activity_beat_render_candidate_outputs WHERE candidate_id IN (SELECT id FROM activity_beat_render_candidates WHERE task_id=?)').run(taskId);
      imageArtifacts.forEach((artifact, index) => {
        database.connection.prepare(`INSERT INTO activity_beat_render_candidate_outputs(candidate_id,artifact_id,sort_order,created_at)
          VALUES (?,?,?,?) ON CONFLICT(candidate_id,artifact_id) DO NOTHING`).run(candidate.id, artifact.id, index, nowIso());
      });
      const first = imageArtifacts.find((artifact) => artifact.file_status === 'ready');
      if (first) database.connection.prepare(`UPDATE activity_beat_render_candidates SET artifact_id=?,artifact_sha256=?,media_url=?,status='succeeded'
        WHERE task_id=? AND adopted_at IS NULL`).run(first.id, first.sha256, `/api/admin/artifacts/${encodeURIComponent(first.id)}/file`, taskId);
      else database.connection.prepare(`UPDATE activity_beat_render_candidates SET status='failed',error_message='任务完成，但没有可读取的图片产物。'
        WHERE task_id=? AND adopted_at IS NULL`).run(taskId);
    });
  }
}

export function extractModelNames(value: unknown): string[] {
  const names = new Set<string>();
  const visit = (item: unknown, parent = '') => {
    if (Array.isArray(item)) {
      // ComfyUI API links are [nodeId, outputIndex] pairs. The input key
      // "model" describes the link target, not a model filename.
      if (item.length === 2 && typeof item[0] === 'string' && /^\d+$/.test(item[0]) && typeof item[1] === 'number') return;
      item.forEach((child) => visit(child, parent));
      return;
    }
    if (!item || typeof item !== 'object') {
      if (/model|checkpoint|ckpt|unet|lora_name|vae_name|clip_name/i.test(parent) && typeof item === 'string' && item.trim()) names.add(item);
      return;
    }
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) visit(child, key);
  };
  visit(value);
  return [...names];
}

export function summarizeAiCall(row: Record<string, unknown>) {
  const parseArray = (value: unknown): string[] => { try { const out: unknown = JSON.parse(String(value ?? '[]')); return Array.isArray(out) ? out.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };
  const parseObject = (value: unknown): Record<string, unknown> => { try { const out: unknown = JSON.parse(String(value ?? '{}')); return out && typeof out === 'object' && !Array.isArray(out) ? out as Record<string, unknown> : {}; } catch { return {}; } };
  return {
    id: String(row.id), traceId: String(row.trace_id), parentId: row.parent_id == null ? null : String(row.parent_id), retryOf: row.retry_of == null ? null : String(row.retry_of),
    applicationId: String(row.application_id), feature: String(row.feature), businessEvent: String(row.business_event),
    objectType: row.object_type == null ? null : String(row.object_type), objectId: row.object_id == null ? null : String(row.object_id),
    callType: String(row.call_type), status: String(row.status) as AiCallStatus, requestedAt: String(row.requested_at),
    endedAt: row.ended_at == null ? null : String(row.ended_at), durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    provider: row.provider == null ? null : String(row.provider), models: parseArray(row.models_json),
    workflowId: row.workflow_id == null ? null : String(row.workflow_id), workflowVersion: row.workflow_version == null ? null : Number(row.workflow_version),
    upstreamTaskId: row.upstream_task_id == null ? null : String(row.upstream_task_id), artifactIds: parseArray(row.artifact_ids_json),
    errorCode: row.error_code == null ? null : String(row.error_code),
    error: row.error_message == null ? null : String(redactAiValue(row.error_message)),
    parameters: redactAiValue(parseObject(row.parameters_json)) as Record<string, unknown>, positivePrompt: row.positive_prompt == null ? null : String(redactAiValue(row.positive_prompt)),
    negativePrompt: row.negative_prompt == null ? null : String(redactAiValue(row.negative_prompt)), requestSnapshot: redactAiValue(parseObject(row.request_snapshot_json)) as Record<string, unknown>,
    responseText: row.response_text == null ? null : String(redactAiValue(row.response_text)), usage: redactAiValue(parseObject(row.usage_json)) as Record<string, unknown>,
    sourceUrl: row.source_url == null ? null : String(redactAiValue(row.source_url)), generationTaskId: row.generation_task_id == null ? null : String(row.generation_task_id),
    artifactDetails: (() => { try { const result: unknown = JSON.parse(String(row.artifact_details_json ?? '[]')); return Array.isArray(redactAiValue(result)) ? redactAiValue(result) as unknown[] : []; } catch { return []; } })(),
  };
}

export function hashAiSource(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
