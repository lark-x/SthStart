import type { GenerationConnectionTestResult, GenerationModelEntry, GenerationNodeDefinition } from '@sthstart/contracts';
import { discoverWorkerModels, discoverWorkerNodes, isWorkerDiscoveryUnsupported, workerHealth } from '../worker.js';
import { sanitizeErrorMessage } from './errors.js';

/**
 * 连接发现的统一适配层（规划 §5「只读发现」）：
 * ComfyUI 直连访问现有 API；Worker 模式走受鉴权的规范化发现端点。
 * 发现数据使用短期内存缓存（默认 60 秒），手动刷新绕过缓存；
 * 合并重复请求、限制上游响应大小与超时；失败保留最后成功结果并标记「可能过期」。
 */

const CACHE_TTL_MS = 60_000;
const MAX_OBJECT_INFO_BYTES = 48 * 1024 * 1024;
const MODEL_FILE_PATTERN = /\.(safetensors|ckpt|pt|sft|gguf|bin|pth)$/i;

/** 已知加载器节点 → 模型类别（models 子目录）。与 configuration.ts 的分析表一致。 */
const LOADER_NODE_CATEGORIES: Record<string, { inputName: string; category: string }> = {
  CheckpointLoaderSimple: { inputName: 'ckpt_name', category: 'checkpoints' },
  unCLIPCheckpointLoader: { inputName: 'ckpt_name', category: 'checkpoints' },
  checkpointLoader: { inputName: 'ckpt_name', category: 'checkpoints' },
  VAELoader: { inputName: 'vae_name', category: 'vae' },
  CLIPLoader: { inputName: 'clip_name', category: 'clip' },
  CLIPVisionLoader: { inputName: 'clip_name', category: 'clip_vision' },
  UNETLoader: { inputName: 'unet_name', category: 'unet' },
  LoraLoader: { inputName: 'lora_name', category: 'loras' },
  LoraLoaderModelOnly: { inputName: 'lora_name', category: 'loras' },
  ControlNetLoader: { inputName: 'control_net_name', category: 'controlnet' },
  StyleModelLoader: { inputName: 'style_name', category: 'style_models' },
  UpscaleModelLoader: { inputName: 'model_name', category: 'upscale_models' },
};

interface ObjectInfoCacheEntry {
  objectInfo?: Record<string, unknown>;
  fetchedAt?: number;
  inFlight?: Promise<Record<string, unknown> | null>;
  lastError?: string;
}

interface LastTestEntry {
  result: GenerationConnectionTestResult;
}

const objectInfoCache = new Map<string, ObjectInfoCacheEntry>();
const lastTestCache = new Map<string, LastTestEntry>();

export interface EngineTarget {
  id: string;
  kind: string;
  baseUrl: string;
  credentialAccount: string | null;
}

function cleanBaseUrl(baseUrl: string) {
  return String(baseUrl).replace(/\/+$/, '');
}

function objectInfoFresh(entry: ObjectInfoCacheEntry | undefined): entry is ObjectInfoCacheEntry & { objectInfo: Record<string, unknown>; fetchedAt: number } {
  return Boolean(entry?.objectInfo && entry.fetchedAt && Date.now() - entry.fetchedAt < CACHE_TTL_MS);
}

async function fetchComfyObjectInfo(target: EngineTarget, secret: string | null, fetcher: typeof fetch, refresh: boolean): Promise<Record<string, unknown> | null> {
  const key = target.id;
  const entry = objectInfoCache.get(key) ?? {};
  if (!refresh && objectInfoFresh(entry)) return entry.objectInfo!;
  if (!refresh && entry.inFlight) return entry.inFlight;

  const fetchOnce = (async (): Promise<Record<string, unknown> | null> => {
    try {
      const response = await fetcher(`${cleanBaseUrl(target.baseUrl)}/object_info`, {
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
      if (Number.isFinite(declared) && declared > MAX_OBJECT_INFO_BYTES) throw new Error('object_info 响应过大');
      const text = await response.text();
      if (text.length > MAX_OBJECT_INFO_BYTES) throw new Error('object_info 响应过大');
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object_info 格式无效');
      const objectInfo = parsed as Record<string, unknown>;
      objectInfoCache.set(key, { objectInfo, fetchedAt: Date.now() });
      return objectInfo;
    } catch (error) {
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 200);
      const keep = objectInfoCache.get(key) ?? {};
      objectInfoCache.set(key, { ...keep, lastError: message });
      return null;
    } finally {
      const current = objectInfoCache.get(key);
      if (current) delete current.inFlight;
    }
  })();

  if (!refresh) {
    objectInfoCache.set(key, { ...entry, inFlight: fetchOnce });
  }
  return fetchOnce;
}

function objectInfoState(target: EngineTarget): { stale: boolean; fetchedAt: string | null; error: string | null } {
  const entry = objectInfoCache.get(target.id);
  const fresh = objectInfoFresh(entry);
  return {
    stale: !fresh && Boolean(entry?.objectInfo || entry?.lastError),
    fetchedAt: entry?.fetchedAt ? new Date(entry.fetchedAt).toISOString() : null,
    error: entry?.lastError ?? null,
  };
}

/** 从 object_info 提取「类别 → 模型文件」视图：加载器节点的枚举即库存（规划 §7.1）。 */
function extractModelsFromObjectInfo(objectInfo: Record<string, unknown>): GenerationModelEntry[] {
  const byCategory = new Map<string, Set<string>>();
  for (const [classType, rawNode] of Object.entries(objectInfo)) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const input = (rawNode as { input?: Record<string, Record<string, unknown>> }).input;
    if (!input || typeof input !== 'object') continue;
    for (const group of ['required', 'optional'] as const) {
      const inputs = input[group];
      if (!inputs || typeof inputs !== 'object') continue;
      for (const [inputName, spec] of Object.entries(inputs)) {
        if (!Array.isArray(spec) || !Array.isArray(spec[0])) continue;
        const values = (spec[0] as unknown[]).filter((item): item is string => typeof item === 'string');
        if (!values.length) continue;
        const looksLikeModels = values.some((value) => MODEL_FILE_PATTERN.test(value) || value.includes('/'));
        if (!looksLikeModels) continue;
        const adapter = LOADER_NODE_CATEGORIES[classType];
        const category = adapter && adapter.inputName === inputName
          ? adapter.category
          : classType;
        const bucket = byCategory.get(category) ?? new Set<string>();
        for (const value of values) bucket.add(value);
        byCategory.set(category, bucket);
      }
    }
  }
  const items: GenerationModelEntry[] = [];
  for (const [category, names] of byCategory) {
    for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
      items.push({ name, category });
    }
  }
  return items;
}

export interface DiscoveryListOptions {
  refresh?: boolean;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DiscoveryModelList {
  items: GenerationModelEntry[];
  stale: boolean;
  fetchedAt: string | null;
  error: string | null;
}

async function workerDiscovery(
  target: EngineTarget,
  secret: string,
  kind: 'models' | 'nodes',
  classTypes: string[],
  refresh: boolean,
  fetcher: typeof fetch,
): Promise<{ items: unknown[]; stale: boolean; fetchedAt: string | null; error: string | null }> {
  try {
    const payload = kind === 'models'
      ? await discoverWorkerModels(cleanBaseUrl(target.baseUrl), secret, { refresh }, fetcher)
      : await discoverWorkerNodes(cleanBaseUrl(target.baseUrl), secret, classTypes, fetcher);
    const items = Array.isArray(payload.items) ? payload.items : [];
    return {
      items,
      stale: payload.stale === true,
      fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : null,
      error: typeof payload.error === 'string' ? payload.error : null,
    };
  } catch (error) {
    if (isWorkerDiscoveryUnsupported(error)) {
      return { items: [], stale: true, fetchedAt: null, error: error.message };
    }
    throw error;
  }
}

/** 供导入分析读取完整节点枚举；使用同一 60 秒缓存与去重通道。 */
export async function loadObjectInfo(
  target: EngineTarget,
  secret: string | null,
  fetcher: typeof fetch,
  refresh = false,
): Promise<{ objectInfo: Record<string, unknown> | null; error: string | null }> {
  if (target.kind !== 'comfyui') return { objectInfo: null, error: '只有 ComfyUI 直连支持节点枚举。' };
  const objectInfo = await fetchComfyObjectInfo(target, secret, fetcher, refresh);
  const state = objectInfoState(target);
  return { objectInfo, error: objectInfo ? null : state.error ?? '无法读取 /object_info。' };
}

/** 连接测试由后端发起；浏览器不持有 ComfyUI/Worker 凭据（规划 §3/§13）。 */
export async function testConnection(
  target: EngineTarget,
  secret: string | null,
  fetcher: typeof fetch = fetch,
): Promise<GenerationConnectionTestResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const base: Omit<GenerationConnectionTestResult, 'ok'> = {
    kind: target.kind as GenerationConnectionTestResult['kind'],
    latencyMs: null,
    checkedAt,
    summary: null,
    discoverySupported: null,
    errorCode: null,
    errorMessage: null,
  };

  if (target.kind === 'worker') {
    if (!secret) {
      const result: GenerationConnectionTestResult = { ...base, ok: false, errorCode: 'worker_token_missing', errorMessage: 'Windows Worker 凭据未配置。' };
      lastTestCache.set(target.id, { result });
      return result;
    }
    try {
      const health = await workerHealth(cleanBaseUrl(target.baseUrl), secret, fetcher);
      const latencyMs = Date.now() - startedAt;
      const result: GenerationConnectionTestResult = {
        ...base,
        ok: Boolean(health.ready ?? health.ok ?? true),
        latencyMs,
        summary: health.ready ? `Worker 就绪 · 队列 ${Number(health.queueDepth ?? 0)}` : 'Worker 可达但未就绪',
        system: { workerId: String(health.workerId ?? target.id), queueDepth: Number(health.queueDepth ?? 0), disk: health.disk ?? null },
        discoverySupported: Array.isArray(health.supportedFeatures) ? (health.supportedFeatures as string[]).includes('discovery') : false,
      };
      lastTestCache.set(target.id, { result });
      return result;
    } catch (error) {
      const result: GenerationConnectionTestResult = {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        errorCode: 'worker_unavailable',
        errorMessage: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300),
      };
      lastTestCache.set(target.id, { result });
      return result;
    }
  }

  // ComfyUI 直连：先取 /system_stats（含版本与设备信息），404 时回退探测根路径。
  let ok = false;
  let system: Record<string, unknown> | undefined;
  let errorMessage: string | null = null;
  try {
    const response = await fetcher(`${cleanBaseUrl(target.baseUrl)}/system_stats`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object') {
        system = payload as Record<string, unknown>;
        ok = true;
      }
    } else if (response.status === 404) {
      const fallback = await fetcher(cleanBaseUrl(target.baseUrl), { headers: secret ? { authorization: `Bearer ${secret}` } : {}, signal: AbortSignal.timeout(10_000) });
      ok = fallback.ok;
      if (!ok) errorMessage = `ComfyUI 根路径返回 HTTP ${fallback.status}`;
    } else {
      errorMessage = `ComfyUI 返回 HTTP ${response.status}`;
    }
  } catch (error) {
    errorMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300);
  }

  // 拿不到 GPU 信息不代表连接失败（规划 §5）：这里只依据 HTTP 可达性判定。
  const latencyMs = Date.now() - startedAt;
  const result: GenerationConnectionTestResult = {
    ...base,
    ok,
    latencyMs,
    summary: ok ? `ComfyUI 可达 · ${latencyMs}ms` : '无法连接 ComfyUI',
    system,
    discoverySupported: ok,
    errorCode: ok ? null : 'comfyui_unreachable',
    errorMessage,
  };
  lastTestCache.set(target.id, { result });
  return result;
}

/** 列表页连接状态：仅读最近一次测试缓存，不逐项发起上游请求。 */
export function cachedConnectionStatus(engineId: string): GenerationConnectionTestResult | null {
  return lastTestCache.get(engineId)?.result ?? null;
}

export async function listModels(
  target: EngineTarget,
  secret: string | null,
  options: DiscoveryListOptions,
  fetcher: typeof fetch = fetch,
): Promise<DiscoveryModelList> {
  if (target.kind === 'worker') {
    if (!secret) {
      return { items: [], stale: false, fetchedAt: null, error: 'Windows Worker 凭据未配置，无法读取模型列表。' };
    }
    try {
      const payload = await workerDiscovery(target, secret, 'models', [], Boolean(options.refresh), fetcher);
      const items = payload.items.filter((item): item is GenerationModelEntry =>
        Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string' && typeof (item as Record<string, unknown>).category === 'string'));
      return { items, stale: payload.stale, fetchedAt: payload.fetchedAt, error: payload.error };
    } catch (error) {
      return { items: [], stale: false, fetchedAt: null, error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300) };
    }
  }

  const objectInfo = await fetchComfyObjectInfo(target, secret, fetcher, Boolean(options.refresh));
  const state = objectInfoState(target);
  if (!objectInfo) {
    return {
      items: [],
      stale: state.stale,
      fetchedAt: state.fetchedAt,
      error: state.error ?? '无法从 ComfyUI 读取节点信息（/object_info）。',
    };
  }
  const all = extractModelsFromObjectInfo(objectInfo);
  const category = options.category?.trim().toLowerCase();
  const search = options.search?.trim().toLowerCase();
  const filtered = all.filter((item) => {
    if (category && item.category.toLowerCase() !== category) return false;
    if (search && !item.name.toLowerCase().includes(search)) return false;
    return true;
  });
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 1000);
  return {
    items: filtered.slice(offset, offset + limit),
    stale: state.stale,
    fetchedAt: state.fetchedAt,
    error: null,
  };
}

/** 缓存的模型视图（不发起上游请求），用于创作中心选项投影。 */
export function cachedModels(target: EngineTarget): { items: GenerationModelEntry[]; stale: boolean; fetchedAt: string | null } | null {
  const entry = objectInfoCache.get(target.id);
  if (!entry?.objectInfo) return null;
  const state = objectInfoState(target);
  return { items: extractModelsFromObjectInfo(entry.objectInfo), stale: state.stale, fetchedAt: state.fetchedAt };
}

export async function getNodeDefinitions(
  target: EngineTarget,
  secret: string | null,
  classTypes: string[],
  fetcher: typeof fetch = fetch,
): Promise<{ items: GenerationNodeDefinition[]; stale: boolean; fetchedAt: string | null; error: string | null }> {
  if (!classTypes.length) return { items: [], stale: false, fetchedAt: null, error: null };
  if (target.kind === 'worker') {
    if (!secret) return { items: [], stale: false, fetchedAt: null, error: 'Windows Worker 凭据未配置，无法读取节点信息。' };
    try {
      const payload = await workerDiscovery(target, secret, 'nodes', classTypes.slice(0, 64), false, fetcher);
      const items = payload.items.filter((item): item is GenerationNodeDefinition =>
        Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).classType === 'string'));
      return { items, stale: payload.stale, fetchedAt: payload.fetchedAt, error: payload.error };
    } catch (error) {
      return { items: [], stale: false, fetchedAt: null, error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300) };
    }
  }
  const objectInfo = await fetchComfyObjectInfo(target, secret, fetcher, false);
  const state = objectInfoState(target);
  if (!objectInfo) return { items: [], stale: state.stale, fetchedAt: state.fetchedAt, error: state.error ?? '无法从 ComfyUI 读取节点信息。' };
  const items: GenerationNodeDefinition[] = [];
  for (const classType of classTypes.slice(0, 64)) {
    const node = objectInfo[classType];
    if (!node || typeof node !== 'object') continue;
    const input = (node as { input?: Record<string, unknown> }).input;
    items.push({ classType, input: input && typeof input === 'object' ? input as Record<string, unknown> : {} });
  }
  return { items, stale: state.stale, fetchedAt: state.fetchedAt, error: null };
}
