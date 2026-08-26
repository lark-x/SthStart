import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateApp, hasCapability, type AppIdentity } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { persistArtifact, readArtifact, removeArtifact } from './artifacts.js';
import { resolveAssignedLlmProfile, resolveProfile, safeJson, upstreamHeaders } from './providers.js';
import type { LlmModelRole } from '@sthstart/contracts';
import type { SecretStore } from './security.js';

function requireApp(database: ServiceDatabase, capability: 'llm' | 'vector' | 'image' | 'persona', request: FastifyRequest, reply: FastifyReply) {
  const identity = authenticateApp(database, request);
  if (!identity) { void reply.code(401).send({ error: 'invalid_app_token' }); return null; }
  if (!hasCapability(identity, capability)) { void reply.code(403).send({ error: 'capability_denied' }); return null; }
  return identity;
}

function requestedProfile(request: FastifyRequest) {
  const value = request.headers['x-sthstart-profile'];
  return typeof value === 'string' ? value : undefined;
}

function requestedLlmRole(request: FastifyRequest, body: Record<string, unknown>): LlmModelRole | null {
  const explicit = request.headers['x-sthstart-model-role'];
  if (explicit !== undefined) return explicit === 'text' || explicit === 'multimodal' ? explicit : null;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const multimodal = messages.some((message) => {
    if (!message || typeof message !== 'object') return false;
    const content = (message as { content?: unknown }).content;
    return Array.isArray(content) && content.some((part) => part && typeof part === 'object' && ['image_url', 'input_image', 'image'].includes(String((part as { type?: unknown }).type ?? '')));
  });
  return multimodal ? 'multimodal' : 'text';
}

async function proxyJson(fetcher: typeof fetch, url: string, body: unknown, secret: string | null, timeoutMs = 60_000, customHeaders: Record<string, string> = {}) {
  return fetcher(url, { method: 'POST', headers: { ...customHeaders, ...upstreamHeaders(secret) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
}

function storageNamespace(database: ServiceDatabase, identity: AppIdentity, body: Record<string, unknown>, access: 'read' | 'write') {
  const requested = typeof body.namespace === 'string' && body.namespace.trim() ? body.namespace.trim() : 'default';
  if (requested.startsWith('shared:')) {
    if (body.purpose === 'memory') throw new Error('long_term_memory_cannot_be_shared');
    const granted = database.connection.prepare('SELECT 1 FROM namespace_grants WHERE app_id=? AND namespace=? AND access=?')
      .get(identity.id, requested, access);
    if (!granted) throw new Error('namespace_not_granted');
    return requested;
  }
  return `app:${identity.id}:${requested}`;
}

function namespacedVectorBody(database: ServiceDatabase, identity: AppIdentity, raw: unknown, access: 'read' | 'write') {
  const body = safeJson(raw);
  const namespace = storageNamespace(database, identity, body, access);
  const mapId = (value: unknown) => typeof value === 'string' && value ? `${namespace}:${value}` : value;
  const mapConversation = (value: unknown): string | string[] => {
    if (Array.isArray(value)) return value.map((item) => `${namespace}:${String(item)}`);
    return `${namespace}:${typeof value === 'string' && value ? value : 'default'}`;
  };
  const next: Record<string, unknown> = { ...body, conversation_id: mapConversation(body.conversation_id) };
  delete next.namespace;
  delete next.purpose;
  if ('chroma_id' in next) next.chroma_id = mapId(next.chroma_id);
  if (Array.isArray(next.items)) next.items = next.items.map((item) => {
    const value = safeJson(item); const metadata = safeJson(value.metadata);
    return { ...value, chroma_id: mapId(value.chroma_id), metadata: { ...metadata, conversation_id: mapConversation(metadata.conversation_id), sthstart_namespace: namespace, sthstart_app_id: identity.id } };
  });
  const metadata = safeJson(next.metadata);
  next.metadata = { ...metadata, conversation_id: mapConversation(metadata.conversation_id ?? body.conversation_id), sthstart_namespace: namespace, sthstart_app_id: identity.id };
  return { body: next, namespace };
}

function stripNamespace(value: unknown, namespace: string): unknown {
  const prefix = `${namespace}:`;
  if (typeof value === 'string') return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (Array.isArray(value)) return value.map((item) => stripNamespace(item, namespace));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripNamespace(item, namespace)]));
  return value;
}

function queueIds(raw: unknown) {
  const queue = Array.isArray(raw) ? raw : [];
  return new Set(queue.map((item) => Array.isArray(item) ? String(item[1] ?? '') : '').filter(Boolean));
}

function signArtifact(secret: string, artifactId: string, expires: number) {
  return createHmac('sha256', secret).update(`${artifactId}.${expires}`).digest('base64url');
}

export function registerPublicRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  app.get('/v1/models', async (request, reply) => {
    const identity = requireApp(database, 'llm', request, reply); if (!identity) return;
    const rows = database.connection.prepare(`SELECT p.id,p.model,o.capabilities_json FROM app_llm_assignments a
      JOIN provider_profiles p ON p.id=a.profile_id AND p.kind='llm' AND p.enabled=1
      LEFT JOIN provider_profile_options o ON o.profile_id=p.id WHERE a.app_id=? GROUP BY p.id,p.model,o.capabilities_json ORDER BY p.name`).all(identity.id) as { id: string; model: string | null; capabilities_json: string | null }[];
    return { object: 'list', data: rows.filter((row) => row.model).map((row) => ({ id: row.model, object: 'model', owned_by: row.id, sthstart_capabilities: JSON.parse(row.capabilities_json ?? '["text"]') })) };
  });

  app.post('/v1/chat/completions', async (request, reply) => {
    const identity = requireApp(database, 'llm', request, reply); if (!identity) return;
    const body = safeJson(request.body);
    const role = requestedLlmRole(request, body);
    if (!role) return reply.code(400).send({ error: 'invalid_model_role', message: 'X-SthStart-Model-Role 只支持 text 或 multimodal。' });
    const profile = await resolveAssignedLlmProfile(database, secrets, identity.id, role);
    if (!profile?.model) return reply.code(503).send({ error: 'llm_profile_not_assigned', role, message: `请先为应用 ${identity.name} 配置${role === 'text' ? '文本' : '多模态'}模型。` });
    body.model = profile.model;
    const upstreamBody = { ...profile.extraBody, ...body };
    if (profile.thinkingMode === 'enabled' && upstreamBody.thinking === undefined) upstreamBody.thinking = { type: 'enabled' };
    if (profile.thinkingMode === 'disabled' && upstreamBody.thinking === undefined) upstreamBody.thinking = { type: 'disabled' };
    if (profile.thinkingMode === 'omit') delete upstreamBody.thinking;
    let upstream: Response;
    try {
      upstream = await proxyJson(fetcher, `${profile.baseUrl}/chat/completions`, upstreamBody, profile.secret, 180_000, profile.headers);
    } catch (error) {
      return reply.code(502).send({ error: 'llm_upstream_unavailable', message: String(error) });
    }
    reply.code(upstream.status);
    const contentType = upstream.headers.get('content-type'); if (contentType) reply.header('content-type', contentType);
    if (upstreamBody.stream === true && upstream.body) {
      reply.hijack();
      reply.raw.statusCode = upstream.status;
      if (contentType) reply.raw.setHeader('content-type', contentType);
      Readable.fromWeb(upstream.body as never).pipe(reply.raw);
      return reply;
    }
    return reply.send(await upstream.text());
  });

  const vectorRoutes = [
    ['embed', '/embed', 'read'], ['search', '/search', 'read'], ['upsert', '/upsert', 'write'],
    ['upsert-batch', '/upsert-batch', 'write'], ['delete', '/delete', 'write'],
    ['delete-by-conversation', '/delete-by-conversation', 'write'],
  ] as const;
  for (const [route, upstreamPath, access] of vectorRoutes) {
    app.post(`/api/v1/vector/${route}`, async (request, reply) => {
      const identity = requireApp(database, 'vector', request, reply); if (!identity) return;
      const profile = await resolveProfile(database, secrets, 'vector', requestedProfile(request));
      const baseUrl = profile?.baseUrl ?? config.vectorDefaultUrl;
      try {
        const transformed = route === 'embed'
          ? { body: safeJson(request.body), namespace: `app:${identity.id}:default` }
          : namespacedVectorBody(database, identity, request.body, access);
        const upstream = await proxyJson(fetcher, `${baseUrl}${upstreamPath}`, transformed.body, profile?.secret ?? null);
        const payload = await upstream.json();
        return reply.code(upstream.status).send(stripNamespace(payload, transformed.namespace));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const denied = message === 'namespace_not_granted' || message === 'long_term_memory_cannot_be_shared';
        return reply.code(denied ? 403 : 503).send({ error: denied ? message : 'vector_unavailable', degraded: !denied });
      }
    });
  }

  app.post('/api/v1/images/tasks', async (request, reply) => {
    const identity = requireApp(database, 'image', request, reply); if (!identity) return;
    const idempotency = request.headers['idempotency-key'];
    if (typeof idempotency !== 'string' || idempotency.length < 8) return reply.code(400).send({ error: 'idempotency_key_required' });
    const existing = database.connection.prepare('SELECT id,status,provider_task_id FROM image_tasks WHERE app_id=? AND idempotency_key=?')
      .get(identity.id, idempotency);
    if (existing) return reply.send(existing);
    const profile = await resolveProfile(database, secrets, 'image', requestedProfile(request));
    if (!profile) return reply.code(503).send({ error: 'image_unavailable' });
    const taskId = randomUUID();
    const now = nowIso();
    try {
      const payload = safeJson(request.body);
      let workflow = payload.workflow ?? payload.prompt;
      if (!workflow && typeof payload.workflowId === 'string') {
        const stored = database.connection.prepare('SELECT definition_json FROM image_workflows WHERE id=?').get(payload.workflowId) as { definition_json: string } | undefined;
        if (!stored) return reply.code(404).send({ error: 'workflow_not_found' });
        workflow = JSON.parse(stored.definition_json);
      }
      if (!workflow) return reply.code(400).send({ error: 'workflow_required' });
      const upstream = await proxyJson(fetcher, `${profile.baseUrl}/prompt`, { prompt: workflow, client_id: taskId }, profile.secret, 30_000);
      if (!upstream.ok) return reply.code(502).send({ error: 'image_rejected', upstreamStatus: upstream.status });
      const result = safeJson(await upstream.json());
      const providerTaskId = String(result.prompt_id ?? result.task_id ?? '');
      if (!providerTaskId) return reply.code(502).send({ error: 'image_missing_task_id' });
      database.connection.prepare(`INSERT INTO image_tasks
        (id,app_id,profile_id,provider_task_id,idempotency_key,status,request_json,error,upstream_may_continue,cancellation_scope,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,0,'none',?,?)`)
        .run(taskId, identity.id, profile.id, providerTaskId, idempotency, 'accepted', JSON.stringify(payload), null, now, now);
      return reply.code(202).send({ id: taskId, status: 'accepted', providerTaskId });
    } catch (error) {
      return reply.code(503).send({ error: 'image_unavailable', message: String(error) });
    }
  });

  app.get<{ Params: { id: string } }>('/api/v1/images/tasks/:id', async (request, reply) => {
    const identity = requireApp(database, 'image', request, reply); if (!identity) return;
    const task = database.connection.prepare('SELECT * FROM image_tasks WHERE id=? AND app_id=?').get(request.params.id, identity.id) as Record<string, unknown> | undefined;
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (['accepted', 'running'].includes(String(task.status)) && task.profile_id && task.provider_task_id) {
      const profile = await resolveProfile(database, secrets, 'image', String(task.profile_id));
      if (profile) {
        try {
          const historyResponse = await fetcher(`${profile.baseUrl}/history/${task.provider_task_id}`, { headers: upstreamHeaders(profile.secret, false), signal: AbortSignal.timeout(15_000) });
          const history = safeJson(await historyResponse.json());
          const result = safeJson(history[String(task.provider_task_id)]);
          const outputs = safeJson(result.outputs);
          const images = Object.values(outputs).flatMap((output) => {
            const value = safeJson(output).images;
            return Array.isArray(value) ? value.map(safeJson) : [];
          });
          for (const image of images) {
            const query = new URLSearchParams({ filename: String(image.filename ?? ''), subfolder: String(image.subfolder ?? ''), type: String(image.type ?? 'output') });
            await persistArtifact(config, database, { appId: identity.id, taskId: request.params.id, sourceUrl: `${profile.baseUrl}/view?${query}`, contentType: 'image/png' });
          }
          if (images.length) database.connection.prepare("UPDATE image_tasks SET status='complete',upstream_may_continue=0,updated_at=? WHERE id=?").run(nowIso(), request.params.id);
          else {
            const queueResponse = await fetcher(`${profile.baseUrl}/queue`, { headers: upstreamHeaders(profile.secret, false), signal: AbortSignal.timeout(5_000) });
            if (queueResponse.ok) {
              const queue = safeJson(await queueResponse.json());
              if (queueIds(queue.queue_running).has(String(task.provider_task_id))) database.connection.prepare("UPDATE image_tasks SET status='running',updated_at=? WHERE id=?").run(nowIso(), request.params.id);
            }
          }
        } catch {
          // A task can remain accepted while ComfyUI is still running or briefly unavailable.
        }
      }
    }
    const refreshed = safeJson(database.connection.prepare('SELECT * FROM image_tasks WHERE id=?').get(request.params.id));
    const upstreamMayContinue = Boolean(refreshed.upstream_may_continue);
    const cancellationScope = String(refreshed.cancellation_scope ?? 'none');
    delete refreshed.upstream_may_continue; delete refreshed.cancellation_scope;
    const artifacts = database.connection.prepare('SELECT id,content_type,byte_size,pinned,created_at FROM artifacts WHERE task_id=? ORDER BY created_at').all(request.params.id) as { id: string }[];
    const expires = Date.now() + 5 * 60_000;
    return { ...refreshed, upstreamMayContinue, cancellationScope, artifacts: artifacts.map((artifact) => ({ ...artifact, url: `/api/v1/images/artifacts/${artifact.id}?expires=${expires}&signature=${signArtifact(config.imageSigningSecret, artifact.id, expires)}` })) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/images/tasks/:id/cancel', async (request, reply) => {
    const identity = requireApp(database, 'image', request, reply); if (!identity) return;
    const task = database.connection.prepare('SELECT id,status,profile_id,provider_task_id FROM image_tasks WHERE id=? AND app_id=?')
      .get(request.params.id, identity.id) as { id: string; status: string; profile_id: string | null; provider_task_id: string | null } | undefined;
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!['accepted', 'running'].includes(task.status)) return reply.code(409).send({ error: 'not_cancellable' });
    const profile = task.profile_id ? await resolveProfile(database, secrets, 'image', task.profile_id) : null;
    if (profile && task.provider_task_id) {
      try {
        const queueResponse = await fetcher(`${profile.baseUrl}/queue`, { headers: upstreamHeaders(profile.secret, false), signal: AbortSignal.timeout(5_000) });
        if (queueResponse.ok) {
          const queue = safeJson(await queueResponse.json());
          if (queueIds(queue.queue_pending).has(task.provider_task_id)) {
            const deleted = await proxyJson(fetcher, `${profile.baseUrl}/queue`, { delete: [task.provider_task_id] }, profile.secret, 10_000, profile.headers);
            if (!deleted.ok) throw new Error(`queue_delete_failed_${deleted.status}`);
            database.connection.prepare("UPDATE image_tasks SET status='cancelled',upstream_may_continue=0,cancellation_scope='queued',updated_at=? WHERE id=?").run(nowIso(), task.id);
            return { ok: true, status: 'cancelled', upstreamMayContinue: false, cancellationScope: 'queued' };
          }
          if (queueIds(queue.queue_running).has(task.provider_task_id)) {
            database.connection.prepare("UPDATE image_tasks SET status='abandoned',upstream_may_continue=1,cancellation_scope='local-tracking',updated_at=? WHERE id=?").run(nowIso(), task.id);
            return { ok: true, status: 'abandoned', upstreamMayContinue: true, cancellationScope: 'local-tracking' };
          }
        }
      } catch {
        database.connection.prepare("UPDATE image_tasks SET status='cancel_failed',upstream_may_continue=1,cancellation_scope='none',updated_at=? WHERE id=?").run(nowIso(), task.id);
        return reply.code(502).send({ error: 'cancel_failed', upstreamMayContinue: true, cancellationScope: 'none' });
      }
    }
    database.connection.prepare("UPDATE image_tasks SET status='abandoned',upstream_may_continue=1,cancellation_scope='local-tracking',updated_at=? WHERE id=?").run(nowIso(), task.id);
    return { ok: true, status: 'abandoned', upstreamMayContinue: true, cancellationScope: 'local-tracking' };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/images/tasks/:id', async (request, reply) => {
    const identity = requireApp(database, 'image', request, reply); if (!identity) return;
    const task = database.connection.prepare('SELECT status FROM image_tasks WHERE id=? AND app_id=?').get(request.params.id, identity.id) as { status: string } | undefined;
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (['accepted', 'running'].includes(task.status)) return reply.code(409).send({ error: 'cancel_before_delete' });
    const artifacts = database.connection.prepare('SELECT id FROM artifacts WHERE task_id=? AND app_id=?').all(request.params.id, identity.id) as { id: string }[];
    for (const artifact of artifacts) await removeArtifact(database, artifact.id, identity.id);
    database.connection.prepare('DELETE FROM image_tasks WHERE id=? AND app_id=?').run(request.params.id, identity.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { expires?: string; signature?: string } }>('/api/v1/images/artifacts/:id', async (request, reply) => {
    const expires = Number(request.query.expires); const supplied = request.query.signature ?? '';
    const expected = signArtifact(config.imageSigningSecret, request.params.id, expires);
    const valid = Number.isFinite(expires) && expires > Date.now() && supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!valid) return reply.code(403).send({ error: 'invalid_signature' });
    const artifact = await readArtifact(database, request.params.id).catch(() => null);
    if (!artifact) return reply.code(404).send({ error: 'not_found' });
    if (artifact.contentType) reply.header('content-type', artifact.contentType);
    return reply.send(artifact.bytes);
  });

  app.put<{ Params: { id: string }; Body: { pinned?: boolean } }>('/api/v1/images/artifacts/:id/pin', async (request, reply) => {
    const identity = requireApp(database, 'image', request, reply); if (!identity) return;
    const result = database.connection.prepare('UPDATE artifacts SET pinned=? WHERE id=? AND app_id=?').run(request.body?.pinned ? 1 : 0, request.params.id, identity.id);
    return result.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/images/artifacts/:id', async (request, reply) => {
    const identity = requireApp(database, 'image', request, reply); if (!identity) return;
    return await removeArtifact(database, request.params.id, identity.id) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v1/personas', async (request, reply) => {
    const identity = requireApp(database, 'persona', request, reply); if (!identity) return;
    const items = database.connection.prepare('SELECT id,display_name,tags_json,source,latest_version FROM personas ORDER BY display_name').all();
    return { items };
  });

  app.get<{ Params: { id: string } }>('/api/v1/personas/:id/versions', async (request, reply) => {
    const identity = requireApp(database, 'persona', request, reply); if (!identity) return;
    const items = database.connection.prepare('SELECT * FROM persona_versions WHERE persona_id=? ORDER BY version DESC').all(request.params.id);
    return { items };
  });

  app.post<{ Params: { id: string }; Body: { version?: number; localId?: string } }>('/api/v1/personas/:id/import', async (request, reply) => {
    const identity = requireApp(database, 'persona', request, reply); if (!identity) return;
    const persona = database.connection.prepare('SELECT latest_version FROM personas WHERE id=?').get(request.params.id) as { latest_version: number } | undefined;
    if (!persona) return reply.code(404).send({ error: 'not_found' });
    const version = request.body?.version ?? persona.latest_version;
    const snapshot = database.connection.prepare('SELECT * FROM persona_versions WHERE persona_id=? AND version=?').get(request.params.id, version);
    if (!snapshot) return reply.code(404).send({ error: 'version_not_found' });
    const localId = request.body?.localId?.trim() || randomUUID();
    database.connection.prepare('INSERT OR REPLACE INTO app_personas VALUES (?,?,?,?,?,?,?)')
      .run(identity.id, localId, request.params.id, version, JSON.stringify(snapshot), null, nowIso());
    return reply.code(201).send({ localId, sourcePersonaId: request.params.id, sourceVersion: version, snapshot });
  });

  app.get('/api/v1/app-personas', async (request, reply) => {
    const identity = requireApp(database, 'persona', request, reply); if (!identity) return;
    const items = database.connection.prepare('SELECT local_id,source_persona_id,source_version,snapshot_json,published_persona_id,created_at FROM app_personas WHERE app_id=? ORDER BY created_at').all(identity.id);
    return { items: (items as Record<string, unknown>[]).map((item) => ({ ...item, snapshot: JSON.parse(String(item.snapshot_json)), snapshot_json: undefined })) };
  });

  app.post<{ Body: { localId?: string; displayName?: string; personaPrompt?: string; appearancePrompt?: string; avatarArtifactId?: string; metadata?: Record<string, unknown> } }>('/api/v1/app-personas', async (request, reply) => {
    const identity = requireApp(database, 'persona', request, reply); if (!identity) return;
    const body = request.body ?? {};
    if (!body.displayName?.trim() || !body.personaPrompt?.trim()) return reply.code(400).send({ error: 'invalid_persona' });
    const localId = body.localId?.trim() || randomUUID();
    const snapshot = { display_name: body.displayName.trim(), persona_prompt: body.personaPrompt.trim(), appearance_prompt: body.appearancePrompt?.trim() || null, avatar_artifact_id: body.avatarArtifactId ?? null, metadata_json: JSON.stringify(body.metadata ?? {}) };
    database.connection.prepare('INSERT INTO app_personas VALUES (?,?,?,?,?,?,?)').run(identity.id, localId, null, null, JSON.stringify(snapshot), null, nowIso());
    return reply.code(201).send({ localId, snapshot });
  });

  app.post<{ Params: { localId: string }; Body: { version?: number } }>('/api/v1/app-personas/:localId/upgrade', async (request, reply) => {
    const identity = requireApp(database, 'persona', request, reply); if (!identity) return;
    const local = database.connection.prepare('SELECT source_persona_id FROM app_personas WHERE app_id=? AND local_id=?').get(identity.id, request.params.localId) as { source_persona_id: string | null } | undefined;
    if (!local) return reply.code(404).send({ error: 'not_found' });
    if (!local.source_persona_id) return reply.code(409).send({ error: 'manual_persona_has_no_upstream' });
    const persona = database.connection.prepare('SELECT latest_version FROM personas WHERE id=?').get(local.source_persona_id) as { latest_version: number };
    const version = request.body?.version ?? persona.latest_version;
    const snapshot = database.connection.prepare('SELECT * FROM persona_versions WHERE persona_id=? AND version=?').get(local.source_persona_id, version);
    if (!snapshot) return reply.code(404).send({ error: 'version_not_found' });
    database.connection.prepare('UPDATE app_personas SET source_version=?,snapshot_json=? WHERE app_id=? AND local_id=?')
      .run(version, JSON.stringify(snapshot), identity.id, request.params.localId);
    return { localId: request.params.localId, sourceVersion: version, snapshot };
  });
}
