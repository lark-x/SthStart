import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateStoryCharacterSchema, CreateStoryDocumentSchema, CreateStoryProjectSchema,
  CreateNativeStoryProposalSchema, CreateStoryProposalSchema, CreateStorySessionSchema, SendStoryMessageSchema,
  StoryDocumentKindSchema,
  SendStoryMessageResponseSchema, StoryCompactResponseSchema,
  StoryCharacterListSchema, StoryCharacterSchema, StoryDocumentListSchema, StoryDocumentSchema,
  StoryBridgeEntriesQuerySchema, StoryBridgeEntryListSchema, StoryBridgeEntryQuerySchema, StoryBridgeEntrySchema,
  StoryBridgeHeartbeatResponseSchema, StoryBridgeHeartbeatSchema, StoryBridgeProjectSchema, StoryBridgeProposalResponseSchema,
  StoryBridgeSearchResponseSchema, StoryBridgeStatusSchema,
  StoryEntryRevisionListSchema, StoryEntrySchema,
  StoryMessageListSchema, StoryProjectListSchema, StoryProjectSchema, StoryProposalListSchema,
  StoryProposalSchema, StorySessionListSchema, StorySessionSchema,
  ReorderStoryChaptersSchema, RestoreStoryEntryRevisionSchema, StorySearchQuerySchema, StorySearchResponseSchema,
  UpdateStoryCharacterSchema, UpdateStoryDocumentSchema, UpdateStoryProjectSchema,
  type CreateStoryCharacter, type CreateStoryDocument, type CreateStoryProject,
  type CreateNativeStoryProposal, type CreateStoryProposal, type SendStoryMessage, type StoryDocumentKind, type UpdateStoryCharacter,
  type UpdateStoryDocument, type UpdateStoryProject,
} from '@sthstart/contracts';
import { Type } from '@sinclair/typebox';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import { StoryError, StoryStore } from './store.js';
import { StoryRuntime } from './runtime.js';

const ProjectParams = Type.Object({ projectId: Type.String() });
const ItemParams = Type.Object({ projectId: Type.String(), id: Type.String() });
const SessionParams = Type.Object({ projectId: Type.String(), sessionId: Type.String() });
const InternalProposalBody = Type.Intersect([
  Type.Omit(CreateStoryProposalSchema, ['sessionId']),
  Type.Object({ runtimeSessionId: Type.String({ minLength: 8, maxLength: 128 }) }),
]);

export function registerStoryRoutes(app: FastifyInstance, config: ServiceConfig, store: StoryStore, runtime: StoryRuntime) {
  const listeners = new Map<string, Set<(type: string, payload: unknown) => void>>();
  const active = new Set<Promise<void>>();
  const bridgePresence = new Map<string, { instanceId: string; port: number; lastHeartbeatAt: string; timestamp: number }>();
  store.recoverInterruptedSessions();
  const notify = (id: string, type: string, payload: unknown) => {
    for (const send of listeners.get(id) ?? []) send(type, payload);
  };
  const guarded = async <T>(reply: FastifyReply, operation: () => Promise<T> | T) => {
    try { return await operation(); }
    catch (error) {
      if (error instanceof StoryError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      throw error;
    }
  };
  const check = (request: FastifyRequest, reply: FastifyReply) => {
    if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
      reply.code(401).send({ error: 'unauthorized', message: '未授权的剧情工作室请求。' });
      return false;
    }
    return true;
  };
  const bridgeCheck = (request: FastifyRequest, reply: FastifyReply, projectId: string) => {
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    if (!store.authorizeBridge(projectId, token)) {
      reply.code(401).header('cache-control', 'no-store').send({ error: 'story_bridge_unauthorized', message: '剧情项目桥接凭据无效或已撤销。' });
      return false;
    }
    reply.header('cache-control', 'no-store');
    return true;
  };

  // Process-local capability: only the Story MCP subprocess for this project can read it.
  // The ordinary admin token is deliberately not accepted here.
  app.get<{ Params: { projectId: string } }>('/api/v1/internal/story/projects/:projectId/snapshot',
    { schema: { params: ProjectParams } }, async (request, reply) => {
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
      if (!runtime.authorizeMcp(request.params.projectId, token)) {
        return reply.code(401).send({ error: 'story_mcp_unauthorized' });
      }
      return guarded(reply, () => ({
        project: store.requireProject(request.params.projectId),
        documents: store.listDocuments(request.params.projectId),
        characters: store.listCharacters(request.params.projectId).map((item) => ({
          ...item, sourceSnapshot: store.getCharacterSourceSnapshot(item),
        })),
      }));
    });
  app.post<{ Params: { projectId: string }; Body: Omit<CreateStoryProposal, 'sessionId'> & { runtimeSessionId: string } }>(
    '/api/v1/internal/story/projects/:projectId/proposals',
    { schema: { params: ProjectParams, body: InternalProposalBody, response: { 201: StoryProposalSchema } } },
    async (request, reply) => {
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
      if (!runtime.authorizeMcp(request.params.projectId, token)) return reply.code(401).send({ error: 'story_mcp_unauthorized' });
      return guarded(reply, () => {
        const { runtimeSessionId, ...input } = request.body;
        const session = store.getSessionByRuntimeId(request.params.projectId, runtimeSessionId);
        if (!session) throw new StoryError('story_session_not_found', 404, '提案所属的 AI 会话不存在。');
        return reply.code(201).send(store.createProposal(request.params.projectId, { ...input, sessionId: session.id }));
      });
    });

  const BridgeEntryParams = Type.Object({ projectId: Type.String(), kind: Type.Union([StoryDocumentKindSchema, Type.Literal('character')]), id: Type.String() });
  const BridgeProposalParams = Type.Object({ projectId: Type.String(), proposalId: Type.String() });
  app.get<{ Params: { projectId: string } }>('/api/v1/story-bridge/projects/:projectId',
    { schema: { params: ProjectParams, response: { 200: StoryBridgeProjectSchema } } }, async (request, reply) => {
      if (!bridgeCheck(request, reply, request.params.projectId)) return;
      return guarded(reply, () => ({ project: store.requireProject(request.params.projectId) }));
    });
  app.get<{ Params: { projectId: string }; Querystring: { kind?: StoryDocumentKind | 'character'; limit?: number; cursor?: number } }>(
    '/api/v1/story-bridge/projects/:projectId/entries',
    { schema: { params: ProjectParams, querystring: StoryBridgeEntriesQuerySchema, response: { 200: StoryBridgeEntryListSchema } } }, async (request, reply) => {
      if (!bridgeCheck(request, reply, request.params.projectId)) return;
      return guarded(reply, () => {
        const documents = request.query.kind === 'character' ? [] : store.listDocuments(request.params.projectId)
          .filter((item) => !request.query.kind || item.kind === request.query.kind)
          .map((item) => ({ kind: item.kind, id: item.id, title: item.title, revision: item.revision }));
        const characters = !request.query.kind || request.query.kind === 'character'
          ? store.listCharacters(request.params.projectId).map((item) => ({ kind: 'character' as const, id: item.id, title: item.name, revision: item.revision })) : [];
        const all = [...documents, ...characters];
        const cursor = request.query.cursor ?? 0;
        const page = all.slice(cursor, cursor + Math.min(request.query.limit ?? 200, 200));
        return { items: page, nextCursor: cursor + page.length < all.length ? cursor + page.length : null };
      });
    });
  app.get<{ Params: { projectId: string; kind: StoryDocumentKind | 'character'; id: string }; Querystring: { offset?: number; limit?: number } }>(
    '/api/v1/story-bridge/projects/:projectId/entries/:kind/:id',
    { schema: { params: BridgeEntryParams, querystring: StoryBridgeEntryQuerySchema, response: { 200: StoryBridgeEntrySchema } } }, async (request, reply) => {
      if (!bridgeCheck(request, reply, request.params.projectId)) return;
      return guarded(reply, () => {
        const { projectId, kind, id } = request.params;
        const item = kind === 'character' ? store.getCharacter(projectId, id) : store.getDocument(projectId, id);
        if (!item) throw new StoryError('story_target_not_found', 404, '剧情条目不存在。');
        if ('name' in item && kind === 'character') {
          const offset = request.query.offset ?? 0;
          const limit = Math.min(request.query.limit ?? 20_000, 20_000);
          const body = item.notes.slice(offset, offset + limit);
          return { kind, id: item.id, title: item.name, body, revision: item.revision,
            totalLength: item.notes.length, offset, truncated: offset + body.length < item.notes.length };
        }
        if (!('title' in item) || kind === 'character' || item.kind !== kind) throw new StoryError('story_target_not_found', 404, '剧情条目不存在。');
        const offset = request.query.offset ?? 0;
        const limit = Math.min(request.query.limit ?? 20_000, 20_000);
        const content = item.body.slice(offset, offset + limit);
        return { kind, id: item.id, title: item.title, body: content, revision: item.revision,
          totalLength: item.body.length, offset, truncated: offset + content.length < item.body.length };
      });
    });
  app.get<{ Params: { projectId: string }; Querystring: { q: string; kind?: import('@sthstart/contracts').StoryProposalKind; limit?: number; cursor?: number } }>(
    '/api/v1/story-bridge/projects/:projectId/search',
    { schema: { params: ProjectParams, querystring: StorySearchQuerySchema, response: { 200: StoryBridgeSearchResponseSchema } } }, async (request, reply) => {
      if (!bridgeCheck(request, reply, request.params.projectId)) return;
      return guarded(reply, () => store.searchEntries(request.params.projectId, request.query.q, request.query.kind, request.query.limit, request.query.cursor));
    });
  app.post<{ Params: { projectId: string }; Body: CreateNativeStoryProposal }>(
    '/api/v1/story-bridge/projects/:projectId/proposals',
    { schema: { params: ProjectParams, body: CreateNativeStoryProposalSchema, response: { 201: StoryBridgeProposalResponseSchema } } }, async (request, reply) => {
      if (!bridgeCheck(request, reply, request.params.projectId)) return;
      return guarded(reply, () => reply.code(201).send(store.createNativeProposal(request.params.projectId, request.body)));
    });
  app.get<{ Params: { projectId: string; proposalId: string } }>(
    '/api/v1/story-bridge/projects/:projectId/proposals/:proposalId',
    { schema: { params: BridgeProposalParams, response: { 200: StoryProposalSchema } } }, async (request, reply) => {
      if (!bridgeCheck(request, reply, request.params.projectId)) return;
      return guarded(reply, () => {
        const item = store.getProposal(request.params.projectId, request.params.proposalId);
        if (!item) throw new StoryError('story_proposal_not_found', 404, '提案不存在。');
        return item;
      });
    });
  app.post<{ Params: { projectId: string }; Body: { instanceId: string; port: 3081 } }>(
    '/api/v1/story-bridge/projects/:projectId/heartbeat',
    { schema: { params: ProjectParams, body: StoryBridgeHeartbeatSchema, response: { 200: StoryBridgeHeartbeatResponseSchema } } }, async (request, reply) => {
      if (!bridgeCheck(request, reply, request.params.projectId)) return;
      const receivedAt = new Date().toISOString();
      bridgePresence.set(request.params.projectId, { instanceId: request.body.instanceId, port: request.body.port, lastHeartbeatAt: receivedAt, timestamp: Date.now() });
      return { receivedAt, running: true };
    });

  app.get('/api/v1/admin/story/projects', { schema: { response: { 200: StoryProjectListSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return { items: store.listProjects() }; });
  app.post<{ Body: CreateStoryProject }>('/api/v1/admin/story/projects', { schema: { body: CreateStoryProjectSchema, response: { 201: StoryProjectSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return reply.code(201).send(store.createProject(request.body)); });
  app.get<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId', { schema: { params: ProjectParams, response: { 200: StoryProjectSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.requireProject(request.params.projectId)); });
  app.put<{ Params: { projectId: string }; Body: UpdateStoryProject }>('/api/v1/admin/story/projects/:projectId',
    { schema: { params: ProjectParams, body: UpdateStoryProjectSchema, response: { 200: StoryProjectSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.updateProject(request.params.projectId, request.body)); });

  const EntryParams = Type.Object({ projectId: Type.String(), kind: Type.Union([StoryDocumentKindSchema, Type.Literal('character')]), id: Type.String() });
  app.get<{ Params: { projectId: string; kind: StoryDocumentKind | 'character'; id: string } }>(
    '/api/v1/admin/story/projects/:projectId/entries/:kind/:id/revisions',
    { schema: { params: EntryParams, response: { 200: StoryEntryRevisionListSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => ({ items: store.listEntryRevisions(request.params.projectId, request.params.kind, request.params.id) })); });
  app.post<{ Params: { projectId: string; kind: StoryDocumentKind | 'character'; id: string }; Body: { revisionId: string; expectedRevision: number } }>(
    '/api/v1/admin/story/projects/:projectId/entries/:kind/:id/revisions/restore',
    { schema: { params: EntryParams, body: RestoreStoryEntryRevisionSchema, response: { 200: StoryEntrySchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.restoreEntryRevision(
      request.params.projectId, request.params.kind, request.params.id, request.body.revisionId, request.body.expectedRevision)); });
  app.put<{ Params: { projectId: string }; Body: { expectedProjectRevision: number; chapterIds: string[] } }>(
    '/api/v1/admin/story/projects/:projectId/chapters/order',
    { schema: { params: ProjectParams, body: ReorderStoryChaptersSchema, response: { 200: StoryProjectSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.reorderChapters(
      request.params.projectId, request.body.expectedProjectRevision, request.body.chapterIds)); });
  app.get<{ Params: { projectId: string }; Querystring: { q: string; kind?: import('@sthstart/contracts').StoryProposalKind; limit?: number; cursor?: number } }>(
    '/api/v1/admin/story/projects/:projectId/search',
    { schema: { params: ProjectParams, querystring: StorySearchQuerySchema, response: { 200: StorySearchResponseSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.searchEntries(
      request.params.projectId, request.query.q, request.query.kind, request.query.limit, request.query.cursor)); });
  app.post<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId/bridge-grant',
    { schema: { params: ProjectParams } }, async (request, reply) => {
      if (!check(request, reply)) return;
      return guarded(reply, () => {
        const grant = store.createBridgeGrant(request.params.projectId);
        bridgePresence.delete(request.params.projectId);
        return reply.code(201).header('cache-control', 'no-store').send({ projectId: request.params.projectId, ...grant });
      });
    });
  app.delete<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId/bridge-grant',
    { schema: { params: ProjectParams } }, async (request, reply) => {
      if (!check(request, reply)) return;
      return guarded(reply, () => { store.revokeBridgeGrant(request.params.projectId); bridgePresence.delete(request.params.projectId); return reply.code(204).send(); });
    });
  app.get<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId/bridge-status',
    { schema: { params: ProjectParams, response: { 200: StoryBridgeStatusSchema } } }, async (request, reply) => {
      if (!check(request, reply)) return;
      return guarded(reply, () => {
        const active = bridgePresence.get(request.params.projectId);
        const fresh = active && Date.now() - active.timestamp <= 90_000 ? active : undefined;
        if (active && !fresh) bridgePresence.delete(request.params.projectId);
        return store.getBridgeGrantStatus(request.params.projectId, { running: Boolean(fresh), lastHeartbeatAt: fresh?.lastHeartbeatAt ?? null });
      });
    });

  app.get<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId/documents',
    { schema: { params: ProjectParams, response: { 200: StoryDocumentListSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => ({ items: store.listDocuments(request.params.projectId) })); });
  app.post<{ Params: { projectId: string }; Body: CreateStoryDocument }>('/api/v1/admin/story/projects/:projectId/documents',
    { schema: { params: ProjectParams, body: CreateStoryDocumentSchema, response: { 201: StoryDocumentSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => reply.code(201).send(store.createDocument(request.params.projectId, request.body))); });
  app.put<{ Params: { projectId: string; id: string }; Body: UpdateStoryDocument }>('/api/v1/admin/story/projects/:projectId/documents/:id',
    { schema: { params: ItemParams, body: UpdateStoryDocumentSchema, response: { 200: StoryDocumentSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.updateDocument(request.params.projectId, request.params.id, request.body)); });

  app.get<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId/characters',
    { schema: { params: ProjectParams, response: { 200: StoryCharacterListSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => ({ items: store.listCharacters(request.params.projectId) })); });
  app.post<{ Params: { projectId: string }; Body: CreateStoryCharacter }>('/api/v1/admin/story/projects/:projectId/characters',
    { schema: { params: ProjectParams, body: CreateStoryCharacterSchema, response: { 201: StoryCharacterSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => reply.code(201).send(store.createCharacter(request.params.projectId, request.body))); });
  app.put<{ Params: { projectId: string; id: string }; Body: UpdateStoryCharacter }>('/api/v1/admin/story/projects/:projectId/characters/:id',
    { schema: { params: ItemParams, body: UpdateStoryCharacterSchema, response: { 200: StoryCharacterSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.updateCharacter(request.params.projectId, request.params.id, request.body)); });

  app.get<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId/sessions',
    { schema: { params: ProjectParams, response: { 200: StorySessionListSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => ({ items: store.listSessions(request.params.projectId) })); });
  app.post<{ Params: { projectId: string }; Body: { title: string } }>('/api/v1/admin/story/projects/:projectId/sessions',
    { schema: { params: ProjectParams, body: CreateStorySessionSchema, response: { 201: StorySessionSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => reply.code(201).send(store.createSession(request.params.projectId, request.body.title))); });
  app.get<{ Params: { projectId: string; sessionId: string } }>('/api/v1/admin/story/projects/:projectId/sessions/:sessionId/messages',
    { schema: { params: SessionParams, response: { 200: StoryMessageListSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => ({ items: store.listMessages(request.params.projectId, request.params.sessionId) })); });
  app.post<{ Params: { projectId: string; sessionId: string }; Body: SendStoryMessage }>('/api/v1/admin/story/projects/:projectId/sessions/:sessionId/messages',
    { schema: { params: SessionParams, body: SendStoryMessageSchema, response: { 202: SendStoryMessageResponseSchema } } }, async (request, reply) => {
      if (!check(request, reply)) return;
      return guarded(reply, () => {
        const { projectId, sessionId } = request.params;
        const sent = store.beginMessage(projectId, sessionId, request.body.content, request.body.idempotencyKey);
        if (sent.created) {
          const runtimeSessionId = store.requireSession(projectId, sessionId).runtimeSessionId;
          const job = runtime.run(projectId, runtimeSessionId, request.body.content, (event) => {
            if (event.method !== 'session.event') return;
            const record = event.params.event as { type?: string; data?: { name?: string } } | undefined;
            if (!record?.type || !['step/start', 'tool/call', 'tool/result'].includes(record.type)) return;
            const tool = record.type === 'tool/call' && record.data?.name?.startsWith('mcp__story__')
              ? record.data.name.slice('mcp__story__'.length) : undefined;
            notify(sessionId, 'progress', { stage: record.type, ...(tool ? { tool } : {}) });
          }).then((response) => {
            store.completeMessage(projectId, sessionId, sent.item.id, response);
            notify(sessionId, 'completed', { messageId: sent.item.id });
          }).catch((error: unknown) => {
            store.interruptMessage(projectId, sessionId, sent.item.id);
            notify(sessionId, 'failed', { message: error instanceof Error ? error.message : String(error) });
          });
          active.add(job); void job.finally(() => active.delete(job));
        }
        return reply.code(202).send({ message: sent.item, created: sent.created });
      });
    });
  app.post<{ Params: { projectId: string; sessionId: string } }>('/api/v1/admin/story/projects/:projectId/sessions/:sessionId/acknowledge',
    { schema: { params: SessionParams, response: { 200: StorySessionSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.acknowledgeInterruptedSession(request.params.projectId, request.params.sessionId)); });
  app.post<{ Params: { projectId: string; sessionId: string } }>('/api/v1/admin/story/projects/:projectId/sessions/:sessionId/compact',
    { schema: { params: SessionParams, response: { 200: StoryCompactResponseSchema } } }, async (request, reply) => {
      if (!check(request, reply)) return;
      return guarded(reply, async () => {
        const item = store.requireSession(request.params.projectId, request.params.sessionId);
        if (item.status !== 'idle') throw new StoryError('story_session_busy', 409, '只能压缩空闲会话。');
        const result = await runtime.compact(item.projectId, item.runtimeSessionId);
        notify(item.id, 'compacted', result);
        return result;
      });
    });
  app.get<{ Params: { projectId: string; sessionId: string } }>('/api/v1/admin/story/projects/:projectId/sessions/:sessionId/events',
    { schema: { params: SessionParams } }, async (request, reply) => {
      if (!check(request, reply)) return;
      const item = await guarded(reply, () => store.requireSession(request.params.projectId, request.params.sessionId));
      if (!item || reply.sent) return;
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
      reply.raw.write(': connected\n\n');
      const send = (type: string, payload: unknown) => reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      const set = listeners.get(item.id) ?? new Set(); set.add(send); listeners.set(item.id, set);
      const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
      reply.raw.once('close', () => {
        clearInterval(heartbeat); set.delete(send); if (set.size === 0) listeners.delete(item.id);
      });
    });

  app.get<{ Params: { projectId: string } }>('/api/v1/admin/story/projects/:projectId/proposals',
    { schema: { params: ProjectParams, response: { 200: StoryProposalListSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => ({ items: store.listProposals(request.params.projectId) })); });
  app.post<{ Params: { projectId: string }; Body: CreateStoryProposal }>('/api/v1/admin/story/projects/:projectId/proposals',
    { schema: { params: ProjectParams, body: CreateStoryProposalSchema, response: { 201: StoryProposalSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => reply.code(201).send(store.createProposal(request.params.projectId, request.body))); });
  app.post<{ Params: { projectId: string; id: string }; Body: { decision: 'accepted' | 'rejected' } }>('/api/v1/admin/story/projects/:projectId/proposals/:id/decision',
    { schema: { params: ItemParams, body: Type.Object({ decision: Type.Union([Type.Literal('accepted'), Type.Literal('rejected')]) }), response: { 200: StoryProposalSchema } } },
    async (request, reply) => { if (!check(request, reply)) return; return guarded(reply, () => store.decideProposal(request.params.projectId, request.params.id, request.body.decision)); });

  app.addHook('onClose', async () => {
    for (const set of listeners.values()) set.clear();
    await runtime.close();
    await Promise.allSettled([...active]);
  });
}
