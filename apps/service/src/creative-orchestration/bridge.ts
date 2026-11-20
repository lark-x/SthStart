import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CreativeCreateGrantSchema,
  CreativeGrantCreatedSchema,
  CreativeMessageRequestSchema,
  CreativeScopeSchema,
  CreativeStartRunSchema,
  type CreativeBudget,
  type CreativeGrant,
  type CreativeMessageRequest,
  type CreativeMessageResponse,
  type CreativeRun,
  type CreativeRunDetail,
  type CreativeScope,
  type CreativeStartRun,
} from '@sthstart/contracts';
import { authenticateAdmin, bearerToken } from '../access.js';
import type { ServiceConfig } from '../config.js';
import { nowIso } from '../database.js';
import { hashToken, issueToken } from '../security.js';
import {
  CreativeStore,
  CreativeStoreError,
  creativeHash,
} from './store.js';
import { isCreativeConversationWorkflow } from './conversation.js';

type GrantPermission = CreativeGrant['permissions'][number];
export type CreativeCreateGrant = Static<typeof CreativeCreateGrantSchema>;
export type CreativeGrantCreated = Static<typeof CreativeGrantCreatedSchema>;
const agentId = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^[A-Za-z0-9_-]+$',
});
const agentCandidateKind = Type.Union([
  Type.Literal('scene'),
  Type.Literal('visual-brief'),
  Type.Literal('video-plan'),
]);
const agentHash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const memoryPagination = {
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
};
export const CreativeAgentMemoryFactsQuerySchema = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 300 })),
  actorId: Type.Optional(agentId),
  locationId: Type.Optional(agentId),
  storyLineId: Type.Optional(agentId),
  nature: Type.Optional(Type.Union([
    Type.Literal('canon'),
    Type.Literal('author'),
    Type.Literal('ai'),
    Type.Literal('unverified'),
  ])),
  ...memoryPagination,
}, { additionalProperties: false });
export type CreativeAgentMemoryFactsQuery = Static<typeof CreativeAgentMemoryFactsQuerySchema>;
export const CreativeAgentMemoryEntriesQuerySchema = Type.Object({
  kind: Type.Optional(Type.Union([
    Type.Literal('setting'),
    Type.Literal('foreshadowing'),
  ])),
  status: Type.Optional(Type.Union([
    Type.Literal('confirmed'),
    Type.Literal('open'),
    Type.Literal('resolved'),
  ])),
  query: Type.Optional(Type.String({ maxLength: 300 })),
  ...memoryPagination,
}, { additionalProperties: false });
export type CreativeAgentMemoryEntriesQuery = Static<typeof CreativeAgentMemoryEntriesQuerySchema>;
export const CreativeAgentMemoryFactsRequestSchema = Type.Object({
  scope: CreativeScopeSchema,
  query: Type.Optional(CreativeAgentMemoryFactsQuerySchema),
}, { additionalProperties: false });
export type CreativeAgentMemoryFactsRequest = Static<typeof CreativeAgentMemoryFactsRequestSchema>;
export const CreativeAgentMemoryEntriesRequestSchema = Type.Object({
  scope: CreativeScopeSchema,
  options: Type.Optional(CreativeAgentMemoryEntriesQuerySchema),
}, { additionalProperties: false });
export type CreativeAgentMemoryEntriesRequest = Static<typeof CreativeAgentMemoryEntriesRequestSchema>;
export const CreativeAgentCandidateSubmissionSchema = Type.Object({
  idempotencyKey: agentId,
  scope: CreativeScopeSchema,
  kind: agentCandidateKind,
  content: Type.Record(Type.String(), Type.Unknown()),
  contextHash: agentHash,
}, { additionalProperties: false });
export type CreativeAgentCandidateSubmission = Static<typeof CreativeAgentCandidateSubmissionSchema>;
export const CreativeAgentCandidateReceiptSchema = Type.Object({
  candidate: Type.Object({
    id: agentId,
    runId: agentId,
    nodeRunId: agentId,
    kind: agentCandidateKind,
    status: Type.Literal('candidate'),
    contentHash: agentHash,
    contextHash: agentHash,
    createdAt: Type.String({ minLength: 1, maxLength: 60 }),
  }, { additionalProperties: false }),
  review: Type.Object({
    required: Type.Literal(true),
    status: Type.Literal('pending'),
  }, { additionalProperties: false }),
  replayed: Type.Boolean(),
}, { additionalProperties: false });
export type CreativeAgentCandidateReceipt = Static<typeof CreativeAgentCandidateReceiptSchema>;
export const CreativeAgentContextRequestSchema = Type.Object({
  scope: CreativeScopeSchema,
}, { additionalProperties: false });
export type CreativeAgentContextRequest = Static<typeof CreativeAgentContextRequestSchema>;
export const CreativeAgentContextResponseSchema = Type.Object({
  scope: CreativeScopeSchema,
  context: Type.Record(Type.String(), Type.Unknown()),
  contextHash: agentHash,
}, { additionalProperties: false });
export type CreativeAgentContextResponse = Static<typeof CreativeAgentContextResponseSchema>;
type UsageReservation = {
  runId: string | null;
  requestHash: string;
  budget: CreativeBudget;
  createdAt: string;
};
type AgentGrantUsage = {
  textCalls: number;
  images: number;
  tokens: number;
  reservations: Record<string, UsageReservation>;
};
type AgentGrantRow = {
  id: string;
  name: string;
  scope_json: string;
  permissions_json: string;
  budget_json: string;
  usage_json: string;
  token_hash: string;
  expires_at: string;
  revoked: number;
  created_at: string;
};
type AuthenticatedGrant = {
  id: string;
  name: string;
  scope: CreativeScope;
  permissions: GrantPermission[];
  budget: CreativeBudget;
  usage: AgentGrantUsage;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
};

export interface CreativeBridgeHandlers {
  startRun(input: CreativeStartRun): Promise<CreativeRun>;
  stopRun(id: string): Promise<CreativeRun> | CreativeRun;
  propose(input: CreativeMessageRequest): Promise<CreativeMessageResponse>;
  submitCandidate(input: CreativeAgentCandidateSubmission): Promise<CreativeAgentCandidateReceipt>;
  readContext(scope: CreativeScope): Promise<Record<string, unknown>>;
  readMemoryFacts(
    scope: CreativeScope,
    query: CreativeAgentMemoryFactsQuery,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
  readMemoryEntries(
    scope: CreativeScope,
    options: CreativeAgentMemoryEntriesQuery,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export { CREATIVE_AGENT_GRANT_STATEMENTS } from './agent-migration.js';

class CreativeAgentError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CreativeAgentError';
  }
}

function reject(statusCode: number, code: string, message: string): never {
  throw new CreativeAgentError(statusCode, code, message);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function parseJson<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function assertSchema(value: unknown, schema: Parameters<typeof Value.Check>[0], code: string, label: string): void {
  if (Value.Check(schema, value)) return;
  const first = [...Value.Errors(schema, value)][0];
  reject(400, code, `${label}${first?.path ?? '/'} 格式错误：${first?.message ?? '不符合契约'}。`);
}

function scopeHasIdentity(scope: CreativeScope): boolean {
  return Boolean(scope.workName || scope.worldId || scope.projectId);
}

/** Trim display text while preserving opaque IDs exactly. */
export function normalizeCreativeScope(
  input: CreativeScope,
  options: { allowGlobal?: boolean } = {},
): CreativeScope {
  assertSchema(input, CreativeCreateGrantSchema.properties.scope, 'creative_agent_scope_invalid', '范围');
  const normalized: CreativeScope = {
    workName: input.workName?.trim() || null,
    worldId: input.worldId,
    branchId: input.branchId,
    projectId: input.projectId,
  };
  if (!scopeHasIdentity(normalized) && options.allowGlobal !== true) {
    reject(
      400,
      'creative_agent_scope_required',
      '范围至少需要 workName、worldId 或 projectId 之一。',
    );
  }
  return normalized;
}

/**
 * A run is in a grant when every constrained grant dimension is equal. A null
 * grant dimension is unconstrained; it never relaxes another dimension.
 */
export function creativeScopeWithin(runScope: CreativeScope, grantScope: CreativeScope): boolean {
  const run = normalizeCreativeScope(runScope);
  const grant = normalizeCreativeScope(grantScope);
  return run.workName === (grant.workName === null ? run.workName : grant.workName)
    && run.worldId === (grant.worldId === null ? run.worldId : grant.worldId)
    && run.branchId === (grant.branchId === null ? run.branchId : grant.branchId)
    && run.projectId === (grant.projectId === null ? run.projectId : grant.projectId);
}

function emptyUsage(): AgentGrantUsage {
  return { textCalls: 0, images: 0, tokens: 0, reservations: {} };
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function usageFromJson(value: unknown): AgentGrantUsage {
  const parsed = parseJson<Record<string, unknown>>(value);
  if (!nonNegativeInteger(parsed.textCalls)
    || !nonNegativeInteger(parsed.images)
    || !nonNegativeInteger(parsed.tokens)
    || !parsed.reservations
    || typeof parsed.reservations !== 'object'
    || Array.isArray(parsed.reservations)) {
    throw new Error('creative grant usage state is invalid');
  }
  const reservations: Record<string, UsageReservation> = {};
  for (const [key, raw] of Object.entries(parsed.reservations)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('creative grant reservation state is invalid');
    }
    const entry = raw as Record<string, unknown>;
    assertSchema(entry.budget, CreativeStartRunSchema.properties.budget, 'creative_agent_state_invalid', '预留额度');
    if ((entry.runId !== null && (typeof entry.runId !== 'string' || !entry.runId))
      || typeof entry.requestHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(entry.requestHash)
      || typeof entry.createdAt !== 'string') {
      throw new Error('creative grant reservation state is invalid');
    }
    reservations[key] = {
      runId: entry.runId,
      requestHash: entry.requestHash,
      budget: structuredClone(entry.budget as CreativeBudget),
      createdAt: entry.createdAt,
    };
  }
  return {
    textCalls: parsed.textCalls,
    images: parsed.images,
    tokens: parsed.tokens,
    reservations,
  };
}

function rowFromGrantStore(store: CreativeStore, id: string): AgentGrantRow | undefined {
  return store.database.connection.prepare(
    'SELECT * FROM co_agent_grants WHERE id=?',
  ).get(id) as AgentGrantRow | undefined;
}

function rowFromToken(store: CreativeStore, token: string): AgentGrantRow | undefined {
  return store.database.connection.prepare(
    'SELECT * FROM co_agent_grants WHERE token_hash=?',
  ).get(hashToken(token)) as AgentGrantRow | undefined;
}

function authenticatedGrant(row: AgentGrantRow): AuthenticatedGrant {
  try {
    const permissions = parseJson<GrantPermission[]>(row.permissions_json);
    const budget = parseJson<CreativeBudget>(row.budget_json);
    assertSchema(budget, CreativeStartRunSchema.properties.budget, 'creative_agent_state_invalid', 'grant 预算');
    if (!Array.isArray(permissions)
      || permissions.some((permission) =>
        !['read', 'propose', 'run', 'stop'].includes(permission))) {
      throw new Error('creative grant permissions are invalid');
    }
    return {
      id: row.id,
      name: row.name,
      scope: normalizeCreativeScope(parseJson<CreativeScope>(row.scope_json)),
      permissions,
      budget,
      usage: usageFromJson(row.usage_json),
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      createdAt: row.created_at,
    };
  } catch (error) {
    if (error instanceof CreativeAgentError) throw error;
    throw new Error('creative grant state is invalid');
  }
}

function publicGrant(grant: AuthenticatedGrant): CreativeGrant {
  return {
    id: grant.id,
    name: grant.name,
    scope: grant.scope,
    permissions: grant.permissions,
    expiresAt: grant.expiresAt,
    revoked: grant.revoked,
    createdAt: grant.createdAt,
  };
}

function assertNotExpired(grant: AuthenticatedGrant): void {
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    reject(401, 'creative_agent_grant_expired', '创作 Agent 凭据已过期。');
  }
}

function authenticateAgentGrant(
  request: FastifyRequest,
  store: CreativeStore,
  permission: GrantPermission,
): AuthenticatedGrant {
  const token = bearerToken(request);
  if (!token) reject(401, 'creative_agent_unauthorized', '需要创作 Agent 范围凭据。');
  const row = rowFromToken(store, token);
  if (!row) reject(401, 'creative_agent_unauthorized', '创作 Agent 凭据无效。');
  const grant = authenticatedGrant(row);
  if (grant.revoked) reject(401, 'creative_agent_grant_revoked', '创作 Agent 凭据已撤销。');
  assertNotExpired(grant);
  if (!grant.permissions.includes(permission)) {
    reject(403, 'creative_agent_forbidden', `当前凭据没有 ${permission} 权限。`);
  }
  return grant;
}

function grantOwnsRun(grant: AuthenticatedGrant, runId: string): boolean {
  return Object.values(grant.usage.reservations).some((entry) => entry.runId === runId);
}

function ownedRun(
  grant: AuthenticatedGrant,
  store: CreativeStore,
  runId: string,
): CreativeRun {
  const run = store.getRun(runId);
  if (!run || !grantOwnsRun(grant, run.id)) {
    reject(404, 'creative_agent_run_not_found', '该取值范围下不存在此运行。');
  }
  if (!creativeScopeWithin(run.scope, grant.scope)) {
    reject(403, 'creative_agent_scope_forbidden', '运行范围超出当前凭据。');
  }
  return run;
}

function assertBudgetWithinGrant(grant: AuthenticatedGrant, budget: CreativeBudget): void {
  if (budget.maxRevisions > grant.budget.maxRevisions) {
    reject(409, 'creative_agent_budget_exceeded', '运行返修上限超过 grant 允许额度。');
  }
  if (grant.usage.textCalls + budget.maxTextCalls > grant.budget.maxTextCalls
    || grant.usage.images + budget.maxImages > grant.budget.maxImages
    || grant.usage.tokens + budget.maxTokens > grant.budget.maxTokens) {
    reject(409, 'creative_agent_budget_exceeded', '累计运行预留将超过 grant 额度。');
  }
}

function runKey(store: CreativeStore, idempotencyKey: string): { run_id: string } | undefined {
  return store.database.connection.prepare(
    'SELECT run_id FROM co_run_keys WHERE idempotency_key=?',
  ).get(idempotencyKey) as { run_id: string } | undefined;
}

function hydrateReservation(
  grant: AuthenticatedGrant,
  key: string,
  runId: string,
): void {
  const reservation = grant.usage.reservations[key];
  if (!reservation) throw new Error('creative grant reservation is missing');
  reservation.runId = runId;
}

/**
 * Reserve the whole run envelope before dispatch. Replays reuse the reservation,
 * while distinct runs draw from the same cumulative grant counters.
 */
function reserveRun(
  store: CreativeStore,
  grantId: string,
  input: CreativeStartRun,
): CreativeRun | null {
  return store.atomic(() => {
    const row = rowFromGrantStore(store, grantId);
    if (!row) reject(401, 'creative_agent_unauthorized', '创作 Agent 凭据无效。');
    const grant = authenticatedGrant(row);
    if (grant.revoked) reject(401, 'creative_agent_grant_revoked', '创作 Agent 凭据已撤销。');
    assertNotExpired(grant);
    if (!creativeScopeWithin(input.scope, grant.scope)) {
      reject(403, 'creative_agent_scope_forbidden', '运行范围超出当前凭据。');
    }

    const requestHash = creativeHash(input);
    const existingReservation = grant.usage.reservations[input.idempotencyKey];
    const existingKey = runKey(store, input.idempotencyKey);
    if (existingReservation) {
      if (existingReservation.requestHash !== requestHash) {
        reject(409, 'creative_run_idempotency_conflict', '同一提交键对应了不同的运行请求。');
      }
      if (existingReservation.runId) {
        return ownedRun(grant, store, existingReservation.runId);
      }
      if (existingKey) {
        const run = store.getRun(existingKey.run_id);
        if (!run || !creativeScopeWithin(run.scope, grant.scope)) {
          reject(409, 'creative_agent_run_conflict', '提交键对应的运行无法绑定到当前凭据。');
        }
        hydrateReservation(grant, input.idempotencyKey, run.id);
        store.database.connection.prepare(
          'UPDATE co_agent_grants SET usage_json=? WHERE id=?',
        ).run(canonicalJson(grant.usage), grant.id);
        return run;
      }
      return null;
    }
    if (existingKey) {
      reject(409, 'creative_agent_run_conflict', '该幂等键已由其他运行占用。');
    }
    assertBudgetWithinGrant(grant, input.budget);
    grant.usage.textCalls += input.budget.maxTextCalls;
    grant.usage.images += input.budget.maxImages;
    grant.usage.tokens += input.budget.maxTokens;
    grant.usage.reservations[input.idempotencyKey] = {
      runId: null,
      requestHash,
      budget: structuredClone(input.budget),
      createdAt: nowIso(),
    };
    store.database.connection.prepare(
      'UPDATE co_agent_grants SET usage_json=? WHERE id=?',
    ).run(canonicalJson(grant.usage), grant.id);
    return null;
  });
}

function attachRun(
  store: CreativeStore,
  grantId: string,
  input: CreativeStartRun,
  run: CreativeRun,
): CreativeRun {
  return store.atomic(() => {
    const row = rowFromGrantStore(store, grantId);
    if (!row) throw new Error('creative grant disappeared during run start');
    const grant = authenticatedGrant(row);
    if (grant.revoked) {
      reject(401, 'creative_agent_grant_revoked', '创作 Agent 凭据已撤销。');
    }
    assertNotExpired(grant);
    if (!creativeScopeWithin(run.scope, grant.scope)) {
      throw new Error('creative run escaped grant scope');
    }
    const reservation = grant.usage.reservations[input.idempotencyKey];
    if (!reservation || reservation.requestHash !== creativeHash(input)) {
      throw new Error('creative run reservation does not match the request');
    }
    if (reservation.runId && reservation.runId !== run.id) {
      throw new Error('creative run reservation points to another run');
    }
    reservation.runId = run.id;
    store.database.connection.prepare(
      'UPDATE co_agent_grants SET usage_json=? WHERE id=?',
    ).run(canonicalJson(grant.usage), grant.id);
    return run;
  });
}

function reconcileFailedStart(
  store: CreativeStore,
  grantId: string,
  input: CreativeStartRun,
): CreativeRun | null {
  return store.atomic(() => {
    const row = rowFromGrantStore(store, grantId);
    if (!row) return null;
    const grant = authenticatedGrant(row);
    const reservation = grant.usage.reservations[input.idempotencyKey];
    if (!reservation || reservation.requestHash !== creativeHash(input)) return null;
    const storedKey = runKey(store, input.idempotencyKey);
    if (storedKey) {
      const run = store.getRun(storedKey.run_id);
      if (!run || !creativeScopeWithin(run.scope, grant.scope)) return null;
      reservation.runId = run.id;
      store.database.connection.prepare(
        'UPDATE co_agent_grants SET usage_json=? WHERE id=?',
      ).run(canonicalJson(grant.usage), grant.id);
      return run;
    }
    if (reservation.runId) return null;
    grant.usage.textCalls -= reservation.budget.maxTextCalls;
    grant.usage.images -= reservation.budget.maxImages;
    grant.usage.tokens -= reservation.budget.maxTokens;
    delete grant.usage.reservations[input.idempotencyKey];
    store.database.connection.prepare(
      'UPDATE co_agent_grants SET usage_json=? WHERE id=?',
    ).run(canonicalJson(grant.usage), grant.id);
    return null;
  });
}

function noStore(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store');
  reply.header('pragma', 'no-cache');
}

const MAX_CANDIDATE_BYTES = 256 * 1024;
const MAX_CONTEXT_BYTES = 4 * 1024 * 1024;

function bridgeError(reply: FastifyReply, error: unknown): FastifyReply {
  noStore(reply);
  if (error instanceof CreativeAgentError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  if (error instanceof CreativeStoreError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  return reply.code(503).send({
    error: 'creative_agent_unavailable',
    message: '创作 Agent 服务暂时无法完成请求。',
  });
}

function route(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown,
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (request, reply) => {
    noStore(reply);
    try {
      return await handler(request, reply);
    } catch (error) {
      return bridgeError(reply, error);
    }
  };
}

async function memoryResponse(
  service: Promise<Record<string, unknown>> | Record<string, unknown>,
  label: string,
): Promise<Record<string, unknown>> {
  const result = await service;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    reject(502, 'creative_agent_memory_contract', `${label}没有返回 JSON 对象。`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    reject(502, 'creative_agent_memory_contract', `${label}返回了无法序列化的数据。`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTEXT_BYTES) {
    reject(502, 'creative_agent_memory_too_large', `${label}超过 4 MiB 返回上限。`);
  }
  return result;
}

function createGrant(
  config: ServiceConfig,
  store: CreativeStore,
  request: FastifyRequest,
  reply: FastifyReply,
): CreativeGrantCreated | FastifyReply {
  if (!authenticateAdmin(config.adminToken, request)) {
    return reply.code(401).send({ error: 'unauthorized', message: '需要管理员权限。' });
  }
  assertSchema(request.body, CreativeCreateGrantSchema, 'creative_agent_grant_invalid', 'grant');
  const input = request.body as CreativeCreateGrant;
  const name = input.name.trim();
  if (!name) reject(400, 'creative_agent_grant_invalid', 'grant 名称不能为空。');
  const scope = normalizeCreativeScope(input.scope);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    reject(400, 'creative_agent_grant_invalid', 'expiresAt 必须是将来的 ISO 时间。');
  }
  if (new Set(input.permissions).size !== input.permissions.length) {
    reject(400, 'creative_agent_grant_invalid', 'permissions 不能重复。');
  }

  const id = randomUUID();
  const token = issueToken('coa');
  const createdAt = nowIso();
  store.database.connection.prepare(
    `INSERT INTO co_agent_grants
      (id,name,scope_json,permissions_json,budget_json,usage_json,
       token_hash,expires_at,revoked,created_at)
     VALUES (?,?,?,?,?,?,?,?,0,?)`,
  ).run(
    id,
    name,
    canonicalJson(scope),
    canonicalJson(input.permissions),
    canonicalJson(input.budget),
    canonicalJson(emptyUsage()),
    hashToken(token),
    input.expiresAt,
    createdAt,
  );
  const grant: CreativeGrant = {
    id,
    name,
    scope,
    permissions: [...input.permissions],
    expiresAt: input.expiresAt,
    revoked: false,
    createdAt,
  };
  assertSchema(
    { grant, token },
    CreativeGrantCreatedSchema,
    'creative_agent_grant_invalid',
    '创建的 grant',
  );
  return { grant, token };
}

function revokeGrant(
  config: ServiceConfig,
  store: CreativeStore,
  request: FastifyRequest,
  reply: FastifyReply,
): CreativeGrant | FastifyReply {
  if (!authenticateAdmin(config.adminToken, request)) {
    return reply.code(401).send({ error: 'unauthorized', message: '需要管理员权限。' });
  }
  const { id } = request.params as { id?: string };
  if (!id) reject(400, 'creative_agent_grant_invalid', '缺少 grant ID。');
  const row = rowFromGrantStore(store, id);
  if (!row) reject(404, 'creative_agent_grant_not_found', 'grant 不存在。');
  store.database.connection.prepare(
    'UPDATE co_agent_grants SET revoked=1 WHERE id=?',
  ).run(id);
  return publicGrant(authenticatedGrant({ ...row, revoked: 1 }));
}

export function registerCreativeBridge(
  app: FastifyInstance,
  config: ServiceConfig,
  store: CreativeStore,
  handlers: CreativeBridgeHandlers,
): void {
  void app.register(async (routes) => {
    routes.addHook('onSend', async (_request, reply, payload) => {
      reply.header('cache-control', 'no-store');
      reply.header('pragma', 'no-cache');
      return payload;
    });
    routes.addHook('onRequest', async (request, reply) => {
      noStore(reply);
      if ('origin' in request.headers) {
        return reply.code(403).send({
          error: 'creative_agent_browser_forbidden',
          message: '外部 Agent API 不接受浏览器 Origin。',
        });
      }
    });

    routes.post('/grants', route(async (request, reply) =>
      createGrant(config, store, request, reply)));
    routes.delete<{ Params: { id: string } }>('/grants/:id', route(async (request, reply) =>
      revokeGrant(config, store, request, reply)));

    routes.get('/runs', route(async (request) => {
      const grant = authenticateAgentGrant(request, store, 'read');
      return {
        items: store.listRuns().items.filter((run) =>
          creativeScopeWithin(run.scope, grant.scope)),
      };
    }));

    routes.get<{ Params: { id: string } }>('/runs/:id', route(async (request): Promise<CreativeRunDetail> => {
      const grant = authenticateAgentGrant(request, store, 'read');
      const { id } = request.params as { id: string };
      const run = ownedRun(grant, store, id);
      return store.detail(run.id);
    }));

    routes.post('/context', route(async (request) => {
      const grant = authenticateAgentGrant(request, store, 'read');
      assertSchema(
        request.body,
        CreativeAgentContextRequestSchema,
        'creative_agent_context_invalid',
        '上下文请求',
      );
      const input = request.body as CreativeAgentContextRequest;
      const scope = normalizeCreativeScope(input.scope);
      if (!creativeScopeWithin(scope, grant.scope)) {
        reject(403, 'creative_agent_scope_forbidden', '上下文范围超出当前凭据。');
      }
      const context = await handlers.readContext(scope);
      if (!context || typeof context !== 'object' || Array.isArray(context)) {
        reject(502, 'creative_agent_context_contract', '上下文服务没有返回 JSON 对象。');
      }
      if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_CONTEXT_BYTES) {
        reject(502, 'creative_agent_context_too_large', '上下文超过 4 MiB 返回上限。');
      }
      const { contextHash, ...payload } = context;
      if (typeof contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(contextHash)
        || creativeHash(payload) !== contextHash) {
        reject(502, 'creative_agent_context_hash', '上下文 hash 与 domain payload 不一致。');
      }
      const response: CreativeAgentContextResponse = {
        scope,
        context,
        contextHash,
      };
      if (!Value.Check(CreativeAgentContextResponseSchema, response)) {
        reject(502, 'creative_agent_context_contract', '上下文服务返回了无效数据。');
      }
      return response;
    }));

    routes.post('/memory/facts', route(async (request) => {
      const grant = authenticateAgentGrant(request, store, 'read');
      assertSchema(
        request.body,
        CreativeAgentMemoryFactsRequestSchema,
        'creative_agent_memory_invalid',
        '事实查询',
      );
      const input = request.body as CreativeAgentMemoryFactsRequest;
      const scope = normalizeCreativeScope(input.scope);
      if (!creativeScopeWithin(scope, grant.scope)) {
        reject(403, 'creative_agent_scope_forbidden', '事实查询范围超出当前凭据。');
      }
      return memoryResponse(
        handlers.readMemoryFacts(scope, structuredClone(input.query ?? {})),
        '长期事实索引',
      );
    }));

    routes.post('/memory/entries', route(async (request) => {
      const grant = authenticateAgentGrant(request, store, 'read');
      assertSchema(
        request.body,
        CreativeAgentMemoryEntriesRequestSchema,
        'creative_agent_memory_invalid',
        '记忆条目查询',
      );
      const input = request.body as CreativeAgentMemoryEntriesRequest;
      const scope = normalizeCreativeScope(input.scope);
      if (!creativeScopeWithin(scope, grant.scope)) {
        reject(403, 'creative_agent_scope_forbidden', '记忆条目查询范围超出当前凭据。');
      }
      return memoryResponse(
        handlers.readMemoryEntries(scope, structuredClone(input.options ?? {})),
        '长期设定与伏笔索引',
      );
    }));

    routes.post('/propose', route(async (request) => {
      const grant = authenticateAgentGrant(request, store, 'propose');
      assertSchema(
        request.body,
        CreativeMessageRequestSchema,
        'creative_agent_proposal_invalid',
        '对话建议',
      );
      const input = structuredClone(request.body as CreativeMessageRequest);
      input.scope = normalizeCreativeScope(input.scope);
      if (input.mode === 'ai' || input.budget !== undefined || input.idempotencyKey !== undefined) {
        reject(
          403,
          'creative_agent_ai_forbidden',
          'AI 总管运行必须由站内人工通过显式 run 预览和预算入口启动，外部 propose 不能隐式付费。',
        );
      }
      if (!creativeScopeWithin(input.scope, grant.scope)) {
        reject(403, 'creative_agent_scope_forbidden', '建议范围超出当前凭据。');
      }
      return handlers.propose(input);
    }));

    routes.post('/candidates', route(async (request, reply) => {
      const grant = authenticateAgentGrant(request, store, 'propose');
      assertSchema(
        request.body,
        CreativeAgentCandidateSubmissionSchema,
        'creative_agent_candidate_invalid',
        '外部候选',
      );
      const input = structuredClone(request.body as CreativeAgentCandidateSubmission);
      input.scope = normalizeCreativeScope(input.scope);
      if (!creativeScopeWithin(input.scope, grant.scope)) {
        reject(403, 'creative_agent_scope_forbidden', '候选范围超出当前凭据。');
      }
      if (Buffer.byteLength(JSON.stringify(input.content), 'utf8') > MAX_CANDIDATE_BYTES) {
        reject(413, 'creative_agent_candidate_too_large', '候选内容超过 256 KiB 上限。');
      }
      const result = await handlers.submitCandidate(input);
      if (!Value.Check(CreativeAgentCandidateReceiptSchema, result)) {
        reject(502, 'creative_agent_candidate_contract', '候选服务没有返回安全的待审回执。');
      }
      if (result.candidate.kind !== input.kind
        || result.candidate.contextHash !== input.contextHash
        || result.candidate.contentHash !== creativeHash(input.content)) {
        reject(502, 'creative_agent_candidate_contract', '候选回执与被提交内容不一致。');
      }
      reply.code(result.replayed ? 200 : 201);
      return result;
    }));

    routes.post('/runs', route(async (request) => {
      const grant = authenticateAgentGrant(request, store, 'run');
      assertSchema(
        request.body,
        CreativeStartRunSchema,
        'creative_agent_run_invalid',
        '运行请求',
      );
      const input = structuredClone(request.body as CreativeStartRun);
      input.scope = normalizeCreativeScope(input.scope);
      const version = store.getVersion(input.workflowId, input.workflowVersion);
      if (version && isCreativeConversationWorkflow(version.document)) {
        reject(
          403,
          'creative_agent_assistant_forbidden',
          '外部 Agent 不能启动 AI 创作总管；该入口仅限站内管理员对话。',
        );
      }
      if (!creativeScopeWithin(input.scope, grant.scope)) {
        reject(403, 'creative_agent_scope_forbidden', '运行范围超出当前凭据。');
      }

      const replay = reserveRun(store, grant.id, input);
      if (replay) return replay;
      let run: CreativeRun;
      try {
        run = await handlers.startRun(input);
      } catch (error) {
        const reconciled = reconcileFailedStart(store, grant.id, input);
        if (reconciled) return reconciled;
        throw error;
      }
      return attachRun(store, grant.id, input, run);
    }));

    routes.post<{ Params: { id: string } }>('/runs/:id/stop', route(async (request) => {
      const grant = authenticateAgentGrant(request, store, 'stop');
      const { id } = request.params as { id: string };
      const run = ownedRun(grant, store, id);
      if (run.status === 'cancelled') return run;
      return handlers.stopRun(run.id);
    }));
  }, { prefix: '/api/v1/creative-agent' });
}
