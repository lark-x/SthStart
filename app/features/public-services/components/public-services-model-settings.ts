import type {
  LlmModelCapability,
  ManagedApp,
  ModelProfile,
  ModelRoute,
  ModelThinkingLevel,
  SaveModelRoute,
  ServiceConnection,
} from '@sthstart/contracts';

export const PUBLIC_SERVICES_TABS = ['models', 'extensions'] as const;
export type PublicServicesTab = (typeof PUBLIC_SERVICES_TABS)[number];

export interface PublicServicesLocation {
  tab: PublicServicesTab;
  openAppExceptions: boolean;
  highlightAppId: string | null;
  redirectTo: string | null;
}

const IMAGE_MODELS_REDIRECT = '/settings/generation';

function normalizeSearch(search: string) {
  return search.startsWith('?') ? search.slice(1) : search;
}

/** 旧页签与旧 section 入口都收敛到两页签；只有绘图入口继续跳生成配置。 */
export function parsePublicServicesLocation(search: string, hash = ''): PublicServicesLocation {
  const params = new URLSearchParams(normalizeSearch(search));
  const tab = params.get('tab');
  const section = params.get('section');
  const appId = params.get('app')?.trim() || null;
  const appsParam = params.get('apps') === '1';

  if (tab === 'image-models') {
    return {
      tab: 'models',
      openAppExceptions: false,
      highlightAppId: null,
      redirectTo: IMAGE_MODELS_REDIRECT,
    };
  }

  let nextTab: PublicServicesTab = 'models';
  let legacyAppExceptions = false;

  if (tab === 'other' || tab === 'extensions' || tab === 'services') {
    nextTab = 'extensions';
  } else if (tab === 'purposes') {
    nextTab = 'models';
    legacyAppExceptions = true;
  } else if (tab === 'connections' || tab === 'text-models' || tab === 'models') {
    nextTab = 'models';
  } else if (!tab && section) {
    if (section === 'access') {
      nextTab = 'extensions';
    } else if (section === 'routing') {
      nextTab = 'models';
      legacyAppExceptions = true;
    } else if (section === 'models') {
      nextTab = 'models';
    }
  } else if (!tab && !section && (hash === '#app-model-routing' || hash === '#model-routes')) {
    nextTab = 'models';
    legacyAppExceptions = true;
  }

  return {
    tab: nextTab,
    openAppExceptions: nextTab === 'models' && (appsParam || Boolean(appId) || legacyAppExceptions),
    highlightAppId: nextTab === 'models' ? appId : null,
    redirectTo: null,
  };
}

export function buildPublicServicesSearch(
  tab: PublicServicesTab,
  options: { openAppExceptions?: boolean; appId?: string | null } = {},
) {
  const params = new URLSearchParams();
  if (tab === 'extensions') params.set('tab', 'extensions');
  if (tab === 'models' && options.openAppExceptions) {
    params.set('apps', '1');
    if (options.appId) params.set('app', options.appId);
  }
  return params.toString();
}

export function isPublicServicesTab(value: string | null): value is PublicServicesTab {
  return value !== null && (PUBLIC_SERVICES_TABS as readonly string[]).includes(value);
}

export function modelSupportsCapability(
  model: ModelProfile | undefined,
  capability: LlmModelCapability,
) {
  return Boolean(model?.enabled && (model.modelType ?? 'chat') === 'chat' && model.capabilities.includes(capability));
}

export function publicRouteFor(routes: readonly ModelRoute[], capability: LlmModelCapability) {
  return routes.find(
    (route) =>
      route.scope === 'public' &&
      route.appId === null &&
      route.capability === capability,
  ) ?? null;
}

export function appRouteFor(
  routes: readonly ModelRoute[],
  appId: string,
  capability: LlmModelCapability,
) {
  return routes.find(
    (route) =>
      route.scope === 'app' &&
      route.appId === appId &&
      route.capability === capability,
  ) ?? null;
}

export function normalizeFallbackIds(
  primaryId: string,
  fallbackIds: readonly string[],
  maxFallbacks = 2,
) {
  const result: string[] = [];
  for (const rawId of fallbackIds) {
    const id = rawId.trim();
    if (!id || id === primaryId || result.includes(id)) continue;
    result.push(id);
    if (result.length >= maxFallbacks) break;
  }
  return result;
}

export interface CommonModelFormState {
  textPrimaryId: string;
  textFallbackIds: [string, string];
  visionPrimaryId: string;
  visionFallbackIds: [string, string];
}

function fallbackPair(ids: readonly string[]): [string, string] {
  return [ids[0] ?? '', ids[1] ?? ''];
}

export function commonModelFormFromRoutes(routes: readonly ModelRoute[]): CommonModelFormState {
  const text = publicRouteFor(routes, 'text');
  const vision = publicRouteFor(routes, 'multimodal');
  return {
    textPrimaryId: text?.primaryModelId ?? '',
    textFallbackIds: fallbackPair(text?.fallbackModelIds ?? []),
    visionPrimaryId: vision?.primaryModelId ?? '',
    visionFallbackIds: fallbackPair(vision?.fallbackModelIds ?? []),
  };
}

export function commonRouteFormSignature(routes: readonly ModelRoute[]) {
  return routes
    .filter((route) => route.scope === 'public')
    .map((route) => `${route.capability}:${route.updatedAt}:${route.primaryModelId}:${route.fallbackModelIds.join(',')}`)
    .sort()
    .join('|');
}

export function textPrimarySupportsVision(
  models: readonly ModelProfile[],
  textPrimaryId: string,
) {
  const primary = models.find((model) => model.id === textPrimaryId);
  return modelSupportsCapability(primary, 'multimodal');
}

export function showVisionCommonRow(
  models: readonly ModelProfile[],
  textPrimaryId: string,
) {
  return !textPrimarySupportsVision(models, textPrimaryId);
}

export function modelsForCapability(
  models: readonly ModelProfile[],
  capability: LlmModelCapability,
) {
  return models.filter((model) => modelSupportsCapability(model, capability));
}

export function fallbackOptions(
  models: readonly ModelProfile[],
  capability: LlmModelCapability,
  excludedIds: readonly string[],
) {
  const excluded = new Set(excludedIds.filter(Boolean));
  return modelsForCapability(models, capability).filter((model) => !excluded.has(model.id));
}

export interface PublicRouteBuildResult {
  routes: SaveModelRoute[];
  visionMirrorsText: boolean;
  error: string | null;
}

/**
 * 公共常用模型保存计划。文本主模型支持看图时，看图路由直接沿用文本主模型与备用链；
 * 否则必须单独选择看图模型。所有备用链在这里统一去重并截断为两个。
 */
export function buildPublicRouteSaves(
  input: CommonModelFormState,
  models: readonly ModelProfile[],
): PublicRouteBuildResult {
  const textPrimary = models.find((model) => model.id === input.textPrimaryId);
  if (!textPrimary || !modelSupportsCapability(textPrimary, 'text')) {
    return { routes: [], visionMirrorsText: false, error: '请选择可用的文本主模型。' };
  }

  const usableFallback = (id: string, capability: LlmModelCapability) =>
    models.some((model) => model.id === id && modelSupportsCapability(model, capability));
  const textFallbacks = normalizeFallbackIds(
    textPrimary.id,
    input.textFallbackIds.filter((id) => usableFallback(id, 'text')),
  );
  const visionMirrorsText = modelSupportsCapability(textPrimary, 'multimodal');
  const routes: SaveModelRoute[] = [
    {
      scope: 'public',
      capability: 'text',
      primaryModelId: textPrimary.id,
      fallbackModelIds: textFallbacks,
      inheritPublicFallbacks: false,
    },
  ];

  if (visionMirrorsText) {
    const mirroredVisionFallbacks = textFallbacks.filter((id) =>
      usableFallback(id, 'multimodal'),
    );
    routes.push({
      scope: 'public',
      capability: 'multimodal',
      primaryModelId: textPrimary.id,
      fallbackModelIds: mirroredVisionFallbacks,
      inheritPublicFallbacks: false,
    });
    return { routes, visionMirrorsText, error: null };
  }

  const visionPrimary = models.find((model) => model.id === input.visionPrimaryId);
  if (!visionPrimary || !modelSupportsCapability(visionPrimary, 'multimodal')) {
    return {
      routes,
      visionMirrorsText: false,
      error: '主模型不支持看图，请选择可用的看图模型。',
    };
  }

  const visionFallbacks = normalizeFallbackIds(
    visionPrimary.id,
    input.visionFallbackIds.filter((id) => usableFallback(id, 'multimodal')),
  );
  routes.push({
    scope: 'public',
    capability: 'multimodal',
    primaryModelId: visionPrimary.id,
    fallbackModelIds: visionFallbacks,
    inheritPublicFallbacks: false,
  });
  return { routes, visionMirrorsText: false, error: null };
}

export interface AppRouteDraft {
  scope: 'app';
  appId: string;
  capability: LlmModelCapability;
  primaryModelId: string;
  fallbackModelIds: string[];
  inheritPublicFallbacks: boolean;
}

export function buildAppRouteSave(
  appId: string,
  capability: LlmModelCapability,
  primaryModelId: string,
): AppRouteDraft {
  return {
    scope: 'app',
    appId,
    capability,
    primaryModelId,
    fallbackModelIds: [],
    inheritPublicFallbacks: true,
  };
}

export interface AppExceptionRow {
  app: ManagedApp;
  textRoute: ModelRoute | null;
  multimodalRoute: ModelRoute | null;
  customCapabilities: LlmModelCapability[];
  custom: boolean;
}

export function buildAppExceptionRows(
  apps: readonly ManagedApp[],
  routes: readonly ModelRoute[],
): AppExceptionRow[] {
  return apps
    .filter((app) => app.capabilities.includes('llm'))
    .map((app) => {
      const textRoute = appRouteFor(routes, app.id, 'text');
      const multimodalRoute = appRouteFor(routes, app.id, 'multimodal');
      const customCapabilities: LlmModelCapability[] = [];
      if (textRoute) customCapabilities.push('text');
      if (multimodalRoute) customCapabilities.push('multimodal');
      return {
        app,
        textRoute,
        multimodalRoute,
        customCapabilities,
        custom: customCapabilities.length > 0,
      };
    });
}

export function summarizeAppExceptions(rows: readonly AppExceptionRow[]) {
  const custom = rows.filter((row) => row.custom).length;
  return {
    total: rows.length,
    custom,
    inherited: rows.length - custom,
  };
}

export function modelNameById(
  models: readonly ModelProfile[],
  modelId: string | null | undefined,
) {
  if (!modelId) return null;
  return models.find((model) => model.id === modelId)?.name ?? modelId;
}

const THINKING_LABELS: Record<ModelThinkingLevel, string> = {
  auto: '自动',
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
};

export function thinkingLevelLabel(level: ModelThinkingLevel | null | undefined) {
  return THINKING_LABELS[level ?? 'auto'];
}

export function formatTokenCount(value: number | null | undefined) {
  if (!value) return '未设置';
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return String(value);
}

export function modelParameterSummary(model: ModelProfile) {
  const capabilities = [
    model.capabilities.includes('text') ? '文本' : null,
    model.capabilities.includes('multimodal') ? '看图' : null,
  ].filter(Boolean);
  const status =
    model.testStatus === 'passed'
      ? '测试通过'
      : model.testStatus === 'failed'
        ? '测试失败'
        : '未测试';
  if (model.modelType === 'embedding' || model.modelType === 'image') {
    return [model.modelType === 'embedding' ? '向量计算' : '绘图', status].join(' · ');
  }
  return [
    capabilities.length ? capabilities.join('/') : '能力未标',
    `上下文 ${formatTokenCount(model.contextLength)}`,
    `输出 ${formatTokenCount(model.maxOutputTokens)}`,
    `思考 ${thinkingLevelLabel(model.thinkingLevel)}`,
    model.enabled ? '已启用' : '已停用',
    status,
  ].join(' · ');
}

const CONNECTION_KIND_LABELS: Record<ServiceConnection['kind'], string> = {
  'openai-compatible-text': 'OpenAI 兼容',
  'openai-compatible-image': 'OpenAI 兼容',
  comfyui: 'ComfyUI',
  worker: 'Windows Worker',
  vector: '向量服务',
};

export function connectionKindLabel(kind: ServiceConnection['kind']) {
  return CONNECTION_KIND_LABELS[kind] ?? kind;
}

export interface ModelLibraryGroup {
  key: string;
  name: string;
  kindLabel: string;
  models: ModelProfile[];
}

export type SupplierModelType = 'chat' | 'embedding' | 'image';

export interface SupplierGroup {
  key: string;
  name: string;
  baseUrl: string;
  kindLabel: string;
  connections: ServiceConnection[];
  models: ModelProfile[];
  primary: ServiceConnection | null;
  enabled: boolean;
  partiallyDisabled: boolean;
  hasCredential: boolean;
  modelCounts: Record<SupplierModelType, number>;
}

export function supplierModelType(model: ModelProfile): SupplierModelType {
  return model.modelType ?? 'chat';
}

export function supplierModelTypeLabel(model: ModelProfile): string {
  const type = supplierModelType(model);
  if (type === 'embedding') return '向量计算';
  if (type === 'image') return '绘图';
  return model.capabilities.includes('multimodal') ? '文本 / 看图' : '文本';
}

export function supplierConnectionSupportsType(kind: ServiceConnection['kind'], type: SupplierModelType): boolean {
  if (kind === 'openai-compatible-text' || kind === 'openai-compatible-image') return true;
  if (kind === 'vector') return type === 'embedding';
  return type === 'image';
}

function normalizedSupplierBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  }
}

function supplierDisplayBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function supplierGroupKey(connection: ServiceConnection): string {
  const family = connection.kind === 'openai-compatible-text' || connection.kind === 'openai-compatible-image'
    ? 'openai'
    : connection.kind;
  return `${family}|${normalizedSupplierBaseUrl(connection.baseUrl)}`;
}

function preferredConnection(connections: readonly ServiceConnection[], models: readonly ModelProfile[]): ServiceConnection {
  const modelCounts = new Map<string, number>();
  for (const model of models) modelCounts.set(model.connectionId, (modelCounts.get(model.connectionId) ?? 0) + 1);
  return [...connections].sort((left, right) =>
    (modelCounts.get(right.id) ?? 0) - (modelCounts.get(left.id) ?? 0)
    || Number(right.enabled) - Number(left.enabled)
    || Number(right.hasCredential) - Number(left.hasCredential)
    || left.createdAt.localeCompare(right.createdAt)
    || left.name.localeCompare(right.name),
  )[0];
}

/**
 * 供应商是用户眼中的一个账号；历史系统曾为同一个 Base URL 建立多条连接。
 * 展示层按协议族与规范化地址归并，保留底层连接供预览、编辑和删除。
 */
export function groupModelsBySupplier(
  models: readonly ModelProfile[],
  connections: readonly ServiceConnection[],
): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  const handledModelIds = new Set<string>();
  for (const connection of connections) {
    const key = supplierGroupKey(connection);
    const existing = groups.get(key);
    if (existing) existing.connections.push(connection);
    else groups.set(key, {
      key,
      name: connection.name,
      baseUrl: connection.baseUrl,
      kindLabel: connectionKindLabel(connection.kind),
      connections: [connection],
      models: [],
      primary: connection,
      enabled: connection.enabled,
      partiallyDisabled: false,
      hasCredential: connection.hasCredential,
      modelCounts: { chat: 0, embedding: 0, image: 0 },
    });
  }

  for (const model of models) {
    const connection = connections.find((item) => item.id === model.connectionId);
    if (!connection) continue;
    const group = groups.get(supplierGroupKey(connection));
    if (!group) continue;
    group.models.push(model);
    group.modelCounts[supplierModelType(model)] += 1;
    handledModelIds.add(model.id);
  }

  for (const group of groups.values()) {
    group.models.sort((left, right) =>
      supplierModelType(left).localeCompare(supplierModelType(right)) || left.name.localeCompare(right.name),
    );
    group.primary = preferredConnection(group.connections, group.models);
    group.name = [...group.connections]
      .map((connection) => connection.name.trim())
      .filter(Boolean)
      .sort((left, right) => left.length - right.length || left.localeCompare(right))[0] ?? group.name;
    group.baseUrl = supplierDisplayBaseUrl(group.primary?.baseUrl ?? group.baseUrl);
    group.kindLabel = new Set(group.connections.map((connection) => connectionKindLabel(connection.kind))).size > 1
      ? 'OpenAI 兼容'
      : connectionKindLabel(group.primary?.kind ?? group.connections[0].kind);
    group.enabled = group.connections.every((connection) => connection.enabled);
    group.partiallyDisabled = !group.enabled && group.connections.some((connection) => connection.enabled);
    group.hasCredential = group.connections.some((connection) => connection.hasCredential);
  }

  const orphaned = models
    .filter((model) => !handledModelIds.has(model.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const result = [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
  if (orphaned.length > 0) {
    result.push({
      key: '__orphaned__',
      name: '未归属连接',
      baseUrl: '',
      kindLabel: '连接可能已移除',
      connections: [],
      models: orphaned,
      primary: null,
      enabled: false,
      partiallyDisabled: false,
      hasCredential: false,
      modelCounts: {
        chat: orphaned.filter((model) => supplierModelType(model) === 'chat').length,
        embedding: orphaned.filter((model) => supplierModelType(model) === 'embedding').length,
        image: orphaned.filter((model) => supplierModelType(model) === 'image').length,
      },
    });
  }
  return result;
}

/** Pick the connection that should receive a new model of this type. */
export function selectConnectionForModelType(
  connections: readonly ServiceConnection[],
  type: SupplierModelType,
): ServiceConnection | null {
  const candidates = connections.filter((connection) => supplierConnectionSupportsType(connection.kind, type));
  if (candidates.length === 0) return null;
  const preferredKinds = type === 'embedding'
    ? ['vector', 'openai-compatible-text', 'openai-compatible-image']
    : type === 'image'
      ? ['openai-compatible-image', 'openai-compatible-text']
      : ['openai-compatible-text', 'openai-compatible-image'];
  return [...candidates].sort((left, right) =>
    Number(right.enabled) - Number(left.enabled)
    || preferredKinds.indexOf(left.kind) - preferredKinds.indexOf(right.kind)
    || Number(right.hasCredential) - Number(left.hasCredential)
    || left.createdAt.localeCompare(right.createdAt),
  )[0] ?? null;
}

export function supplierConnectionForType(
  group: SupplierGroup,
  type: SupplierModelType,
): ServiceConnection | null {
  return selectConnectionForModelType(group.connections, type);
}

export function groupModelsByConnection(
  models: readonly ModelProfile[],
  connections: readonly ServiceConnection[],
): ModelLibraryGroup[] {
  const groups: ModelLibraryGroup[] = [];
  const handledModelIds = new Set<string>();

  for (const connection of connections) {
    const grouped = models
      .filter((model) => model.connectionId === connection.id)
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const model of grouped) handledModelIds.add(model.id);
    groups.push({
      key: connection.id,
      name: connection.name,
      kindLabel: connectionKindLabel(connection.kind),
      models: grouped,
    });
  }

  const orphaned = models
    .filter((model) => !handledModelIds.has(model.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (orphaned.length > 0) {
    groups.push({
      key: '__orphaned__',
      name: '未归属连接',
      kindLabel: '连接可能已移除',
      models: orphaned,
    });
  }

  return groups;
}

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/g, '');
}

/** 内部 ID 自动生成；调用方可提供 suffix 或冲突集合，用户无需填写。 */
export function generateInternalId(
  prefix: 'conn' | 'model',
  seed: string,
  existingIds: ReadonlySet<string>,
  suffix = Date.now().toString(36),
) {
  const slug = slugPart(seed) || 'entry';
  const base = `${prefix}-${slug}`.slice(0, 48);
  let candidate = base;
  if (existingIds.has(candidate)) {
    candidate = `${base}-${slugPart(suffix) || 'new'}`.slice(0, 63);
  }
  let counter = 2;
  while (existingIds.has(candidate)) {
    const suffixText = `-${counter}`;
    candidate = `${candidate.slice(0, 63 - suffixText.length)}${suffixText}`;
    counter += 1;
  }
  return candidate;
}

export function optionalPositiveInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function optionalTimeout(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 600000) return null;
  return parsed;
}
