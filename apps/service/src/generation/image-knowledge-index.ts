import { createHash } from 'node:crypto';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveProfile, upstreamHeaders } from '../providers.js';
import { PARITY_KNOWLEDGE_ITEMS } from '../activities/image-prompt-knowledge-data.js';
import { knowledgeDatasetInfo, retrieveImagePromptKnowledge, type KnowledgeRetrievalResult } from '../activities/image-prompt-knowledge.js';

const CORPUS = 'image_prompt_knowledge';
type IndexState = { ready: string | null; cursor: number; syncKey: string | null; failures: number; cooldownUntil: number; syncing?: Promise<void>; stopped: boolean };
const states = new WeakMap<ServiceDatabase, IndexState>();
const stateFor = (database: ServiceDatabase) => {
  let state = states.get(database);
  if (!state) { state = { ready: null, cursor: 0, syncKey: null, failures: 0, cooldownUntil: 0, stopped: false }; states.set(database, state); }
  return state;
};
const version = () => knowledgeDatasetInfo().contentHash;
const vectorId = (id: string) => `sthstart-image-${version().slice(0, 16)}-${id}`;

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

export async function retrieveHybridImageKnowledge(database: ServiceDatabase, secrets: SecretStore, query: string, scene: string,
  fetcher: typeof fetch = fetch): Promise<KnowledgeRetrievalResult & { actualMode: 'keyword' | 'hybrid'; degraded: string | null }> {
  const keyword = retrieveImagePromptKnowledge(query, { scene, limit: 24 });
  const fallback = (degraded: string) => ({ ...keyword, actualMode: 'keyword' as const, degraded });
  const state = stateFor(database);
  if (state.cooldownUntil > Date.now()) return fallback('vector-cooldown');
  const target = await endpoint(database, secrets);
  if (!target || state.ready !== createHash('sha256').update(`${target.identity}:${version()}`).digest('hex')) return fallback('index-not-ready');
  try {
    const response = await fetcher(`${target.baseUrl}/search`, { method: 'POST', headers: { ...target.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ corpus: CORPUS, text: query, top_k: 72 }), signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error('vector-unavailable');
    const body = await response.json() as { results?: Array<{ id: string; score: number; metadata?: { sthstart_image_version?: string } }> };
    const byId = new Map(PARITY_KNOWLEDGE_ITEMS.filter(item => !item.scenes.length || item.scenes.includes(scene)).map(item => [vectorId(item.knowledgeId), item]));
    const vector = (body.results ?? []).filter(item => item.metadata?.sthstart_image_version === version() && item.score >= 0.22 && byId.has(item.id));
    if (!vector.length) return fallback('no-matching-index-results');
    const scores = new Map<string, number>();
    keyword.items.forEach((item, rank) => scores.set(item.knowledgeId, 1 / (60 + rank + 1)));
    vector.forEach((hit, rank) => { const id = byId.get(hit.id)!.knowledgeId; scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1)); });
    const items = [...scores].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([id]) => PARITY_KNOWLEDGE_ITEMS.find(item => item.knowledgeId === id)!);
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
    if (!active) void syncImageKnowledgeIndex(database, secrets, fetcher).catch(() => {});
  };
  const initial = setTimeout(tick, 15_000); initial.unref();
  const timer = setInterval(tick, 60_000); timer.unref();
  return async () => { state.stopped = true; clearTimeout(initial); clearInterval(timer); await state.syncing; states.delete(database); };
}
