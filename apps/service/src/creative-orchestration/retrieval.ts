import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CreativeRun, CreativeScope } from '@sthstart/contracts';
import type { CreativeContext, CreativeDomain } from './domain.js';
import { creativeHash } from './store.js';

const id = Type.String({ minLength: 1, maxLength: 200 });
export const CreativeEvidenceRequestSchema = Type.Object({
  kind: Type.Union([Type.Literal('facts'), Type.Literal('entries')]),
  query: Type.String({ minLength: 1, maxLength: 100 }),
  actorId: Type.Optional(id), locationId: Type.Optional(id), storyLineId: Type.Optional(id),
  entryKind: Type.Optional(Type.Union([Type.Literal('setting'), Type.Literal('foreshadowing')])),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
}, { additionalProperties: false });
export type CreativeEvidenceRequest = Static<typeof CreativeEvidenceRequestSchema>;
export interface CreativeEvidence extends Record<string, unknown> {
  schemaVersion: 1;
  scope: CreativeScope;
  request: CreativeEvidenceRequest;
  items: Array<Record<string, unknown>>;
  total: number;
  nextOffset: number | null;
  branchRevision: number | null;
  projectRevision: number | null;
  knowledgeScope: 'actor' | 'director-world';
  actorId: string | null;
  coverage: { included: number; available: number; omittedForSize: number; complete: boolean };
  sourceId: string;
  sourceHash: string;
}
const MAX_EVIDENCE_CHARACTERS = 24000;
function fail(code: string, message: string, statusCode = 409): never { throw Object.assign(new Error(message), { code, statusCode }); }
const same = (a: unknown, b: unknown) => creativeHash(a) === creativeHash(b);

/** Read-only and explicitly scoped. The model chooses a query, never a world/project identity. */
export function readCreativeEvidence(domain: CreativeDomain, scope: CreativeScope, input: unknown): CreativeEvidence {
  if (!Value.Check(CreativeEvidenceRequestSchema, input)) fail('creative_evidence_query', '检索需要 facts/entries、1–100 字符关键词和合法范围筛选。', 400);
  const request = structuredClone(input as CreativeEvidenceRequest);
  request.query = request.query.trim();
  if (!request.query) fail('creative_evidence_query', '请输入具体关键词。', 400);
  if (Boolean(scope.worldId) !== Boolean(scope.branchId) || (!scope.worldId && !scope.projectId)) fail('creative_scope_invalid', '检索必须绑定世界时间线或创作项目。', 400);
  const branch = scope.worldId ? domain.worlds.getBranch(scope.worldId, scope.branchId!) : null;
  const project = scope.projectId ? domain.stories.requireProject(scope.projectId) : null;
  if (request.kind === 'entries' && (request.actorId || request.locationId || request.storyLineId)) {
    fail('creative_evidence_knowledge_scope', '设定与伏笔是导演资料，不能当作某个角色已知的事实；请用 facts 与 actorId 查询角色知识。', 400);
  }
  if (request.kind === 'facts' && request.entryKind) fail('creative_evidence_query', '事实查询不能混用设定类型筛选。', 400);
  const page = request.kind === 'facts'
    ? domain.memory.readFacts(scope, { query: request.query, actorId: request.actorId, locationId: request.locationId,
      storyLineId: request.storyLineId, offset: request.offset, limit: 20 })
    : domain.memory.readEntries(scope, { query: request.query, kind: request.entryKind, offset: request.offset, limit: 20 });
  const items: Array<Record<string, unknown>> = [];
  let size = 0;
  for (const item of page.items) {
    const length = JSON.stringify(item).length;
    // Do not cut a fact, persona qualifier or source reference in the middle.
    if (size + length > MAX_EVIDENCE_CHARACTERS - 3000) break;
    items.push(structuredClone(item) as unknown as Record<string, unknown>); size += length;
  }
  const offset = request.offset ?? 0;
  const payload = { schemaVersion: 1 as const, scope: structuredClone(scope), request, items, total: page.total,
    nextOffset: offset + items.length < page.total ? offset + items.length : null,
    branchRevision: branch?.revision ?? null, projectRevision: project?.revision ?? null,
    knowledgeScope: request.actorId ? 'actor' as const : 'director-world' as const, actorId: request.actorId ?? null,
    coverage: { included: items.length, available: page.total, omittedForSize: page.items.length - items.length,
      complete: offset === 0 && items.length === page.total } };
  const sourceHash = creativeHash(payload);
  return { ...payload, sourceId: `evidence:${sourceHash.slice(0, 24)}`, sourceHash };
}

/** Pure merge; callers persist the returned context as the scene's unique context dependency. */
export function mergeCreativeEvidence(context: CreativeContext, evidence: CreativeEvidence): CreativeContext {
  const { contextHash, ...payload } = context;
  if (creativeHash(payload) !== contextHash || context.sourcePolicy !== 'reference-data-not-instructions') fail('creative_context_hash_conflict', '原始上下文已变化，请重新读取。');
  const { sourceId, sourceHash, ...evidencePayload } = evidence;
  if (creativeHash(evidencePayload) !== sourceHash || sourceId !== `evidence:${sourceHash.slice(0, 24)}`) fail('creative_evidence_hash', '检索证据内容已变化，请重新检索。');
  if (!same(context.scope, evidence.scope)) fail('creative_evidence_scope', '检索结果不属于当前作品范围。');
  const allowedRevisions = context.speculation ? [context.base.branchRevision, context.base.branchRevision! - 1] : [context.base.branchRevision];
  if (!allowedRevisions.includes(evidence.branchRevision) || evidence.projectRevision !== context.base.projectRevision) {
    fail('creative_evidence_revision', '检索期间时间线或项目版本已变化，请重新采集上下文。');
  }
  const existing = Array.isArray(context.data.retrievedEvidence) ? context.data.retrievedEvidence as CreativeEvidence[] : [];
  if (existing.some((item) => item.sourceId === sourceId)) return structuredClone(context);
  if (existing.length >= 6) fail('creative_evidence_limit', '本场景已达到检索批次数上限，请缩小问题后重新创作。');
  const merged = { ...payload,
    sources: [...context.sources, { id: sourceId, kind: 'memory' as const, version: `${evidence.branchRevision ?? 'project'}/${evidence.projectRevision ?? ''}`, hash: sourceHash }],
    data: { ...context.data, retrievedEvidence: [...existing, structuredClone(evidence)] } };
  if (JSON.stringify(merged).length > 180000) fail('creative_context_too_large', '检索结果超过本次上下文上限，请缩小活跃角色或资料范围。');
  return { ...merged, contextHash: creativeHash(merged) } as CreativeContext;
}

/** Quotes are exact search terms. Otherwise prefer short subject words, not the whole Chinese instruction. */
export function creativeEvidenceKeywords(instruction: string): string[] {
  const quoted = [...instruction.matchAll(/[“「『"']([^”」』"'\n]{2,60})[”」』"']/gu)].map((match) => match[1].trim());
  const subjects = instruction.match(/密码|密信|信件|约定|钥匙|伤势|身份|秘密|伏笔|承诺|契约|线索|规则|组织|家族|印章|仓库|旧友/gu) ?? [];
  const ascii = instruction.match(/[A-Za-z][A-Za-z0-9_-]{2,39}/g) ?? [];
  const clauses = instruction.split(/[，。！？；、\s]+/u).map((part) => part
    .replace(/^(?:请|帮我|继续|回忆|描写|讲述|关于|之前|以前|让|写|角色|一下)+/u, '')
    .replace(/(?:的|了|一下|如何|什么|为什么|故事|场景|接下来)+$/u, ''))
    .filter((part) => /^[\p{Script=Han}]{2,8}$/u.test(part));
  return [...new Set([...quoted, ...subjects, ...ascii, ...clauses])].slice(0, 3);
}

/** Deterministic first-pass retrieval + entity/location graph expansion; never mutates history. */
export function extractSettingTriggers(title: string, content: string): string[] {
  const tags: string[] = [];
  const bracketed = [...content.matchAll(/(?:【(?:触发词|关键词)[：:]\s*([^】]+)】|\[(?:triggers|keywords):\s*([^\]]+)\])/giu)];
  for (const match of bracketed) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    for (const part of raw.split(/[,，、;\s]+/u)) {
      if (part.trim().length >= 2) tags.push(part.trim());
    }
  }
  if (title.trim().length >= 2 && title.trim().length <= 40) tags.push(title.trim());
  return [...new Set(tags)];
}

export function activateLoreEntries(
  entries: Array<{ id: string; kind: string; title: string; content: string; status: string }>,
  cueText: string,
  limit = 12,
): Array<{ id: string; title: string; matchedTriggers: string[]; excerpt: string }> {
  const lowerCue = cueText.toLowerCase();
  const scored = entries
    .map((entry) => {
      const triggers = extractSettingTriggers(entry.title, entry.content);
      const matched = triggers.filter((term) => lowerCue.includes(term.toLowerCase()));
      return {
        id: entry.id,
        title: entry.title,
        matchedTriggers: matched,
        excerpt: entry.content.slice(0, 600),
        score: matched.length * 10 + (entry.kind === 'foreshadowing' && entry.status === 'open' ? 2 : 0),
      };
    })
    .filter((item) => item.matchedTriggers.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ id: entryId, title, matchedTriggers, excerpt }) => ({
    id: entryId,
    title,
    matchedTriggers,
    excerpt,
  }));
}

export function augmentCreativeContext(domain: CreativeDomain, run: Pick<CreativeRun, 'scope' | 'instruction' | 'input'>, context: CreativeContext): CreativeContext {
  if (!same(run.scope, context.scope)) fail('creative_evidence_scope', '创作运行与上下文范围不同。');
  let merged = context;
  const manual = run.input?.evidenceQueries;
  if (manual !== undefined && (!Array.isArray(manual) || manual.length > 3
    || manual.some((query) => typeof query !== 'string' || !query.trim() || query.length > 100))) {
    fail('creative_evidence_queries', '手动检索最多 3 个关键词，每个关键词为 1–100 字符。', 400);
  }
  const world = context.data.world as {
    activeActorIds?: string[];
    actorDirectory?: Array<{ id: string; name: string; locationId: string }>;
    definition?: { locations?: Array<{ id: string; name: string }> };
    states?: Array<{ actorId: string; locationId: string }>;
  } | undefined;
  const actorIds = world?.activeActorIds ?? [];
  const activeNames = (world?.actorDirectory ?? [])
    .filter((actor) => actorIds.includes(actor.id))
    .map((actor) => actor.name)
    .filter((name) => name.length >= 2 && name.length <= 40);
  const activeLocIds = new Set(
    (world?.states ?? []).filter((state) => actorIds.includes(state.actorId)).map((state) => state.locationId),
  );
  const locationNames = (world?.definition?.locations ?? [])
    .filter((loc) => activeLocIds.has(loc.id))
    .map((loc) => loc.name)
    .filter((name) => name.length >= 2 && name.length <= 40);
  const keywords = [...new Set([
    ...(manual as string[] | undefined ?? []).map((query) => query.trim()),
    ...creativeEvidenceKeywords(run.instruction),
    ...activeNames,
    ...locationNames,
  ])].slice(0, 6);
  const actorId = actorIds.length === 1 ? actorIds[0] : undefined;
  let remaining = 20;
  for (const query of keywords) {
    for (const kind of context.scope.worldId ? ['facts', 'entries'] as const : ['entries'] as const) {
      if (remaining <= 0) return merged;
      const existingCount = Array.isArray(merged.data.retrievedEvidence) ? merged.data.retrievedEvidence.length : 0;
      if (existingCount >= 6) return merged;
      const evidence = readCreativeEvidence(domain, run.scope, { kind, query, ...(kind === 'facts' && actorId ? { actorId } : {}) });
      if (!evidence.items.length) continue;
      if (evidence.items.length > remaining) {
        const { sourceId: _id, sourceHash: _hash, ...rest } = evidence;
        void _id; void _hash;
        rest.items = rest.items.slice(0, remaining);
        rest.coverage = { ...rest.coverage, included: rest.items.length, complete: false };
        rest.nextOffset = (rest.request.offset ?? 0) + rest.items.length;
        const hash = creativeHash(rest);
        merged = mergeCreativeEvidence(merged, { ...rest, sourceId: `evidence:${hash.slice(0, 24)}`, sourceHash: hash });
      } else merged = mergeCreativeEvidence(merged, evidence);
      remaining -= evidence.items.length;
    }
  }
  return merged;
}
