import { createHash } from 'node:crypto';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveProfile, upstreamHeaders } from '../providers.js';
import { PARITY_KNOWLEDGE_ADULT_ITEMS, PARITY_KNOWLEDGE_ITEMS } from '../activities/image-prompt-knowledge-data.js';
import { knowledgeDatasetInfo, retrieveImagePromptKnowledge, type KnowledgeRetrievalResult } from '../activities/image-prompt-knowledge.js';

const CORPUS = 'image_prompt_knowledge';
/** 成人集独立语料：开关关闭时不同步、不检索，也不会污染安全集索引。 */
const ADULT_CORPUS = 'image_prompt_knowledge_adult';
type IndexState = { ready: string | null; cursor: number; syncKey: string | null; failures: number; cooldownUntil: number; syncing?: Promise<void>; stopped: boolean };
const states = new WeakMap<ServiceDatabase, IndexState>();
const stateFor = (database: ServiceDatabase) => {
  let state = states.get(database);
  if (!state) { state = { ready: null, cursor: 0, syncKey: null, failures: 0, cooldownUntil: 0, stopped: false }; states.set(database, state); }
  return state;
};
const version = () => knowledgeDatasetInfo().contentHash;
const vectorId = (id: string) => `sthstart-image-${version().slice(0, 16)}-${id}`;
const adultVersion = () => knowledgeDatasetInfo().adultContentHash;
const adultVectorId = (id: string) => `sthstart-image-adult-${adultVersion().slice(0, 16)}-${id}`;

async function endpoint(database: ServiceDatabase, secrets: SecretStore) {
  try {
    const profile = await resolveProfile(database, secrets, 'vector');
    return profile ? { baseUrl: profile.baseUrl.replace(/\/+$/, ''), identity: contextProfileIdentity(profile), headers: { ...upstreamHeaders(profile.secret), ...profile.headers } } : null;
  } catch { return null; }
}
const contextProfileIdentity = (profile: { id: string; model: string | null; baseUrl: string }) => `${profile.id}:${profile.model ?? ''}:${profile.baseUrl}`;

/** Background only; foreground preparation never synchronizes or waits for indexing. */
export async function syncImageKnowledgeIndex(database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  const state = stateFor(database);
  if (state.syncing) return state.syncing;
  const sync = async () => {
    if (state.stopped || state.cooldownUntil > Date.now()) return;
    const target = await endpoint(database, secrets);
    if (!target) return;
    const key = createHash('sha256').update(`${target.identity}:${version()}`).digest('hex');
    if (state.ready === key) return;
    if (state.syncKey !== key) { state.syncKey = key; state.cursor = 0; }
    try {
      for (let offset = state.cursor; offset < PARITY_KNOWLEDGE_ITEMS.length; offset += 12) {
        if (state.stopped) return;
        const items = PARITY_KNOWLEDGE_ITEMS.slice(offset, offset + 12).map(item => ({
          chroma_id: vectorId(item.knowledgeId), text: `${item.title}\n${item.searchTerms}\n${item.content}`,
          metadata: { sthstart_image_version: version(), knowledgeId: item.knowledgeId },
        }));
        const response = await fetcher(`${target.baseUrl}/upsert-batch`, { method: 'POST', headers: { ...target.headers, 'content-type': 'application/json' },
          body: JSON.stringify({ corpus: CORPUS, items }), signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`index HTTP ${response.status}`);
        state.cursor = offset + items.length;
      }
      state.ready = key; state.failures = 0;
    } catch {
      state.ready = null;
      if (++state.failures >= 3) { state.cooldownUntil = Date.now() + 300_000; state.failures = 0; }
    }
  };
  state.syncing = sync().finally(() => { state.syncing = undefined; });
  return state.syncing;
}

/**
 * 只在有策略显式开启成人词表时同步成人语料；关闭时不发起任何请求。
 * 与安全集共用同一状态机，避免两套同步各自超时。
 */
export async function syncAdultImageKnowledgeIndex(database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  const enabled = database.connection.prepare(
    'SELECT 1 FROM activity_image_prompt_policy_versions WHERE adult_knowledge_enabled=1 LIMIT 1',
  ).get();
  if (!enabled) return;
  const state = stateFor(database);
  if (state.stopped || state.cooldownUntil > Date.now()) return;
  const target = await endpoint(database, secrets);
  if (!target) return;
  try {
    for (let offset = 0; offset < PARITY_KNOWLEDGE_ADULT_ITEMS.length; offset += 12) {
      if (state.stopped) return;
      const items = PARITY_KNOWLEDGE_ADULT_ITEMS.slice(offset, offset + 12).map(item => ({
        chroma_id: adultVectorId(item.knowledgeId), text: `${item.title}\n${item.searchTerms}\n${item.content}`,
        metadata: { sthstart_image_adult_version: adultVersion(), knowledgeId: item.knowledgeId },
      }));
      const response = await fetcher(`${target.baseUrl}/upsert-batch`, { method: 'POST', headers: { ...target.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ corpus: ADULT_CORPUS, items }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`adult index HTTP ${response.status}`);
    }
  } catch {
    // 成人语料同步失败不影响安全集检索；下次调度重试。
  }
}

export async function retrieveHybridImageKnowledge(database: ServiceDatabase, secrets: SecretStore, query: string, scene: string,
  fetcher: typeof fetch = fetch, includeAdult = false): Promise<KnowledgeRetrievalResult & { actualMode: 'keyword' | 'hybrid'; degraded: string | null }> {
  const keyword = retrieveImagePromptKnowledge(query, { scene, limit: 24, includeAdult });
  const fallback = (degraded: string) => ({ ...keyword, actualMode: 'keyword' as const, degraded });
  const state = stateFor(database);
  if (state.cooldownUntil > Date.now()) return fallback('vector-cooldown');
  const target = await endpoint(database, secrets);
  if (!target || state.ready !== createHash('sha256').update(`${target.identity}:${version()}`).digest('hex')) return fallback('index-not-ready');
  try {
    const response = await fetcher(`${target.baseUrl}/search`, { method: 'POST', headers: { ...target.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ corpus: CORPUS, text: query, top_k: 72 }), signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error('vector-unavailable');
    const body = await response.json() as { results?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> };
    const safeById = new Map(PARITY_KNOWLEDGE_ITEMS.filter(item => !item.scenes.length || item.scenes.includes(scene)).map(item => [vectorId(item.knowledgeId), item]));
    const adultById = includeAdult
      ? new Map(PARITY_KNOWLEDGE_ADULT_ITEMS.filter(item => !item.scenes.length || item.scenes.includes(scene)).map(item => [adultVectorId(item.knowledgeId), item]))
      : new Map<string, typeof PARITY_KNOWLEDGE_ADULT_ITEMS[number]>();
    const byId = new Map([...safeById, ...adultById]);
    // 两个语料都查：安全集命中照旧，成人集只在开关打开时才纳入。
    const results = [...(body.results ?? [])];
    if (includeAdult) {
      const adultResponse = await fetcher(`${target.baseUrl}/search`, { method: 'POST', headers: { ...target.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ corpus: ADULT_CORPUS, text: query, top_k: 48 }), signal: AbortSignal.timeout(2500) });
      if (adultResponse.ok) {
        const adultBody = await adultResponse.json() as { results?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> };
        results.push(...(adultBody.results ?? []).filter(hit => hit.metadata?.sthstart_image_adult_version === adultVersion()));
      }
    }
    // 旧版本向量（重建前后残留）必须被丢弃：只接受当前数据集版本的元数据。
    const vector = results.filter(item => item.score >= 0.22 && byId.has(item.id)
      && (includeAdult && adultById.has(item.id)
        ? item.metadata?.sthstart_image_adult_version === adultVersion()
        : item.metadata?.sthstart_image_version === version()));
    if (!vector.length) return fallback('no-matching-index-results');
    const scores = new Map<string, number>();
    keyword.items.forEach((item, rank) => scores.set(item.knowledgeId, 1 / (60 + rank + 1)));
    vector.forEach((hit, rank) => { const id = byId.get(hit.id)!.knowledgeId; scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1)); });
    const all = includeAdult ? [...PARITY_KNOWLEDGE_ITEMS, ...PARITY_KNOWLEDGE_ADULT_ITEMS] : PARITY_KNOWLEDGE_ITEMS;
    const items = [...scores].sort((a, b) => b[1] - a[1]).slice(0, 24)
      .map(([id]) => all.find(item => item.knowledgeId === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    state.failures = 0;
    return { ...keyword, items, actualMode: 'hybrid', degraded: null };
  } catch {
    if (++state.failures >= 3) { state.cooldownUntil = Date.now() + 300_000; state.failures = 0; }
    return fallback('vector-unavailable');
  }
}

export function startImageKnowledgeScheduler(database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch = fetch) {
  const state = stateFor(database); state.stopped = false;
  const tick = () => {
    if (!database.connection.prepare("SELECT 1 FROM activity_image_prompt_policy_versions WHERE knowledge_mode='hybrid' LIMIT 1").get()) return;
    const active = database.connection.prepare("SELECT 1 FROM generation_tasks WHERE status IN ('submitting','accepted','running') LIMIT 1").get();
    if (!active) {
      void syncImageKnowledgeIndex(database, secrets, fetcher).catch(() => {});
      void syncAdultImageKnowledgeIndex(database, secrets, fetcher).catch(() => {});
    }
  };
  const initial = setTimeout(tick, 15_000); initial.unref();
  const timer = setInterval(tick, 60_000); timer.unref();
  return async () => { state.stopped = true; clearTimeout(initial); clearInterval(timer); await state.syncing; states.delete(database); };
}
