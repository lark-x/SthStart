import { existsSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AiCallListQuerySchema, AiCallStorageStatsSchema } from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import { createArtifactReadStream, readArtifact } from './artifacts.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import type { SQLInputValue } from 'node:sqlite';
import { redactAiValue, summarizeAiCall } from './ai-call-trace.js';

export function registerAiCallRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase) {
  const authorized = (request: Parameters<typeof authenticateAdmin>[1], reply: import('fastify').FastifyReply) => {
    if (!config.adminToken) { reply.code(503).send({ error: 'admin_not_configured' }); return false; }
    if (!authenticateAdmin(config.adminToken, request)) { reply.code(401).send({ error: 'unauthorized' }); return false; }
    return true;
  };
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/v1/admin/ai-calls', { schema: { querystring: AiCallListQuerySchema } }, (request, reply) => {
    if (!authorized(request, reply)) return;
    const query = request.query;
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const conditions: string[] = [];
    const args: SQLInputValue[] = [];
    const add = (clause: string, value: string) => { conditions.push(clause); args.push(value); };
    if (query.applicationId) add('application_id=?', query.applicationId);
    if (query.businessEvent) add('business_event=?', query.businessEvent);
    if (query.status) add('status=?', query.status);
    if (query.model) add('models_json LIKE ?', `%${query.model}%`);
    if (query.workflowId) add('workflow_id=?', query.workflowId);
    if (query.from) add('requested_at>=?', query.from);
    if (query.to) add('requested_at<=?', query.to);
    if (query.objectType) add('object_type=?', query.objectType);
    if (query.objectId) add('object_id=?', query.objectId);
    if (query.traceId) add('trace_id=?', query.traceId);
    if (query.q) {
    const term = `%${String(redactAiValue(query.q))}%`;
      conditions.push('(business_event LIKE ? OR feature LIKE ? OR object_id LIKE ? OR positive_prompt LIKE ? OR negative_prompt LIKE ? OR request_snapshot_json LIKE ? OR error_message LIKE ?)');
      args.push(term, term, term, term, term, term, term);
    }
    if (query.cursor) {
      let decoded = '';
      try { decoded = Buffer.from(query.cursor, 'base64url').toString('utf8'); } catch { return reply.code(400).send({ error: 'invalid_cursor' }); }
      const [timestamp, id] = decoded.split('|');
      if (!timestamp || !id || !Number.isFinite(Date.parse(timestamp)) || timestamp.includes('|') || id.includes('|')) return reply.code(400).send({ error: 'invalid_cursor' });
      if (timestamp && id) { conditions.push('(requested_at < ? OR (requested_at = ? AND id < ?))'); args.push(timestamp, timestamp, id); }
    }
    const rows = database.connection.prepare(`SELECT * FROM ai_call_records ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY requested_at DESC,id DESC LIMIT ?`)
      .all(...args, limit + 1) as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => {
      const item = summarizeAiCall(row);
      return {
        id: item.id, traceId: item.traceId, parentId: item.parentId, retryOf: item.retryOf,
        applicationId: item.applicationId, feature: item.feature, businessEvent: item.businessEvent,
        objectType: item.objectType, objectId: item.objectId, callType: item.callType, status: item.status,
        requestedAt: item.requestedAt, endedAt: item.endedAt, durationMs: item.durationMs,
        provider: item.provider, models: item.models, workflowId: item.workflowId, workflowVersion: item.workflowVersion,
        upstreamTaskId: item.upstreamTaskId, artifactIds: item.artifactIds, errorCode: item.errorCode, error: item.error,
      };
    });
    const last = rows[Math.min(limit, rows.length) - 1];
    return { items, nextCursor: hasMore && last ? Buffer.from(`${last.requested_at}|${last.id}`).toString('base64url') : null };
  });

  app.get('/api/v1/admin/ai-calls/stats', { schema: { response: { 200: AiCallStorageStatsSchema } } }, (request, reply) => {
    if (!authorized(request, reply)) return;
    const databasePath = typeof config.databasePath === 'string' ? config.databasePath : '';
    const fileBytes = (path: string) => {
      if (!path) return 0;
      try { return statSync(path).size; } catch { return 0; }
    };
    const databaseBytes = fileBytes(databasePath);
    const walBytes = fileBytes(`${databasePath}-wal`);
    const recordCount = Number((database.connection.prepare('SELECT COUNT(*) count FROM ai_call_records').get() as { count: number }).count);
    const eventCount = Number((database.connection.prepare('SELECT COUNT(*) count FROM ai_call_events').get() as { count: number }).count);
    return { databaseBytes, walBytes, totalBytes: databaseBytes + walBytes, recordCount, eventCount };
  });

  app.get<{ Params: { id: string; artifactId: string } }>('/api/v1/admin/ai-calls/:id/artifacts/:artifactId', async (request, reply) => {
    if (!authorized(request, reply)) return;
    const row = database.connection.prepare('SELECT artifact_ids_json FROM ai_call_records WHERE id=?').get(request.params.id) as { artifact_ids_json: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'ai_call_not_found' });
    let artifactIds: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.artifact_ids_json);
      if (Array.isArray(parsed)) artifactIds = parsed.filter((item): item is string => typeof item === 'string');
    } catch { /* malformed legacy link */ }
    if (!artifactIds.includes(request.params.artifactId)) return reply.code(404).send({ error: 'artifact_not_found' });
    const artifact = await readArtifact(database, request.params.artifactId);
    if (!artifact?.localPath || artifact.fileStatus !== 'ready' || !existsSync(artifact.localPath)) return reply.code(404).send({ error: 'artifact_not_found' });
    if (!artifact.contentType?.startsWith('image/')) return reply.code(415).send({ error: 'artifact_not_image' });
    reply.type(artifact.contentType).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff');
    return reply.send(createArtifactReadStream(artifact.localPath));
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/ai-calls/:id', (request, reply) => {
    if (!authorized(request, reply)) return;
    const row = database.connection.prepare('SELECT * FROM ai_call_records WHERE id=?').get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'ai_call_not_found' });
    const events = database.connection.prepare('SELECT id,created_at,phase,detail_json FROM ai_call_events WHERE call_id=? ORDER BY id')
      .all(request.params.id) as Array<Record<string, unknown>>;
    const item = summarizeAiCall(row);
    const details = item.artifactIds.map((artifactId) => {
      const artifact = database.connection.prepare('SELECT sha256,file_status,local_path FROM artifacts WHERE id=?').get(artifactId) as { sha256: string | null; file_status: string; local_path: string | null } | undefined;
      const available = artifact?.file_status === 'ready' && Boolean(artifact.local_path && existsSync(artifact.local_path));
      return { id: artifactId, sha256: artifact?.sha256 ?? null, available,
        previewUrl: available ? `/api/admin/ai-calls/${encodeURIComponent(item.id)}/artifacts/${encodeURIComponent(artifactId)}` : null };
    });
    const traceRows = database.connection.prepare('SELECT * FROM ai_call_records WHERE trace_id=? ORDER BY requested_at,id')
      .all(item.traceId) as Record<string, unknown>[];
    const traceCalls = traceRows.map((traceRow) => {
      const call = summarizeAiCall(traceRow);
      return { id: call.id, businessEvent: call.businessEvent, callType: call.callType, status: call.status,
        requestedAt: call.requestedAt, endedAt: call.endedAt, durationMs: call.durationMs,
        models: call.models, errorCode: call.errorCode, error: call.error };
    });
    return {
      ...summarizeAiCall(row),
      traceCalls,
      artifactDetails: details,
      events: events.map((event) => {
        let detail: Record<string, unknown> = {};
        try { detail = JSON.parse(String(event.detail_json)) as Record<string, unknown>; } catch { /* malformed legacy event */ }
        return { id: Number(event.id), createdAt: String(event.created_at), phase: String(event.phase), detail: redactAiValue(detail) as Record<string, unknown> };
      }),
    };
  });
}
