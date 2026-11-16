import { Value } from '@sinclair/typebox/value';
import {
  WorldAuthoringDraftSchema,
  WorldSuggestionResponseSchema,
  WorldBundleResultSchema,
  StoryWorldSchema,
  WorldBranchSchema,
  type WorldActor,
  type WorldAuthoringDraft,
  type WorldBranch,
  type WorldBranchMode,
  type WorldBundleResult,
  type WorldDefinition,
  type WorldLocation,
  type WorldSource,
  type WorldSuggestionCandidate,
  type WorldSuggestionRequest,
  type WorldSuggestionResponse,
  type StoryWorld,
} from '@sthstart/contracts';
import type { WebSearchResult } from '@sthstart/contracts';
import { postJson, putJson } from '@/app/lib/api-client';

/**
 * 世界独立配置页的纯模型层：默认值、草稿规范化、指纹、候选应用与保存请求。
 * 这里不读写浏览器状态，便于在 node 测试里直接验证；会话与存储见 use-authoring-session.ts。
 */

export const WORLD_AUTHORING_STORAGE_PREFIX = 'sthstart:story-worlds:draft:';

export const DEFAULT_VISUAL_STYLE =
  '日式动画赛璐璐画风，清晰的线稿与平涂上色，柔和渐变光影，二次元角色五官，非写实照片、非三维渲染、非欧美卡通';

export const BRANCH_MODE_LABELS: Record<WorldBranchMode, string> = {
  'canon-gap': '原作间隙',
  adaptation: '改编',
  alternate: '平行世界',
};

export const BRANCH_MODE_HINTS: Record<WorldBranchMode, string> = {
  'canon-gap': '补完原作没有写到的时段与人物，不改写既有事实。',
  adaptation: '把原作或既有故事改写为新的叙述口径，保留角色与核心事件。',
  alternate: '从分歧点分叉，允许与原作走向不同。',
};

export const WORLD_TARGET_LABELS: Record<WorldSuggestionCandidate['target'], string> = {
  title: '世界名称',
  summary: '世界简介',
  timeLabel: '时间标签',
  startMinuteOfDay: '起点时刻',
  visualStyle: '画面风格',
  lockedFacts: '锁定事实',
  actor: '人物',
  location: '地点',
  direction: '故事方向',
};

/** 高级区默认收起；这里只定义字段顺序，便于折叠区稳定渲染。 */
export const MODEL_PURPOSES = ['action', 'adjudication', 'narration'] as const;
export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

export const MODEL_PURPOSE_LABELS: Record<ModelPurpose, string> = {
  action: '人物行动模型',
  adjudication: '环境裁定模型',
  narration: '叙事整理模型',
};

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createEmptyLocation(index = 0): WorldLocation {
  return {
    id: newId('location'),
    name: index === 0 ? '主要地点' : `地点 ${index + 1}`,
    description: '',
  };
}

export function createEmptyActor(locationId: string): WorldActor {
  return {
    id: newId('actor'),
    name: '',
    role: 'main',
    characterId: null,
    characterVersion: null,
    background: '',
    personality: '',
    speechStyle: '',
    appearance: '',
    goals: [],
    locationId,
    referenceArtifactIds: [],
  };
}

export function createEmptySource(): WorldSource {
  return {
    id: newId('source'),
    title: '',
    nature: 'author',
    content: '',
    sourceUrl: '',
    sourceVersion: 'manual',
    capturedAt: new Date().toISOString(),
  };
}

export function createEmptyDraft(): WorldAuthoringDraft {
  const location = createEmptyLocation(0);
  return {
    definition: {
      title: '',
      summary: '',
      timeLabel: '故事时间',
      locations: [location],
      visualReferences: [],
      actors: [],
      sources: [],
      lockedFacts: [],
      models: { action: null, adjudication: null, narration: null },
      visualStyle: DEFAULT_VISUAL_STYLE,
    },
    initialBranch: { title: '主线', mode: 'canon-gap', direction: '' },
  };
}

/** 世界定义 → 配置页草稿；分支字段由调用方提供（编辑页来自 ?branch= 或首个分支）。 */
export function draftFromWorld(
  world: StoryWorld,
  branch: Pick<WorldBranch, 'title' | 'mode' | 'direction'> | null,
): WorldAuthoringDraft {
  return {
    definition: {
      title: world.title,
      summary: world.summary,
      timeLabel: world.timeLabel,
      ...(world.workNature ? { workNature: world.workNature } : {}),
      ...(world.parentWork !== undefined ? { parentWork: world.parentWork } : {}),
      ...(typeof world.startMinuteOfDay === 'number' ? { startMinuteOfDay: world.startMinuteOfDay } : {}),
      locations: world.locations.map((location) => ({ ...location })),
      visualReferences: (world.visualReferences ?? []).map((reference) => ({
        ...reference,
        referenceArtifactIds: [...reference.referenceArtifactIds],
      })),
      actors: world.actors.map((actor) => ({
        ...actor,
        goals: [...actor.goals],
        referenceArtifactIds: [...actor.referenceArtifactIds],
      })),
      sources: world.sources.map((source) => ({ ...source })),
      lockedFacts: [...world.lockedFacts],
      models: { ...world.models },
      visualStyle: world.visualStyle,
    },
    initialBranch: branch
      ? { title: branch.title, mode: branch.mode, direction: branch.direction }
      : { title: '主线', mode: 'canon-gap', direction: '' },
  };
}

/** 兼容旧 world-form 存储的裸 WorldDefinition。 */
export function isLegacyWorldDefinition(value: unknown): value is WorldDefinition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === 'string'
    && Array.isArray(candidate.locations)
    && Array.isArray(candidate.actors)
    && Array.isArray(candidate.sources)
    && Boolean(candidate.models && typeof candidate.models === 'object');
}

export function draftFromLegacyDefinition(definition: WorldDefinition): WorldAuthoringDraft {
  return {
    definition: {
      ...definition,
      locations: definition.locations.map((location) => ({ ...location })),
      visualReferences: (definition.visualReferences ?? []).map((reference) => ({
        ...reference,
        referenceArtifactIds: [...reference.referenceArtifactIds],
      })),
      actors: definition.actors.map((actor) => ({
        ...actor,
        goals: [...actor.goals],
        referenceArtifactIds: [...actor.referenceArtifactIds],
      })),
      sources: definition.sources.map((source) => ({ ...source })),
      lockedFacts: [...definition.lockedFacts],
      models: { ...definition.models },
    },
    initialBranch: { title: '主线', mode: 'canon-gap', direction: '' },
  };
}

export function storageKeyFor(worldId?: string): string {
  return worldId ? `edit:${worldId}` : 'create';
}

export interface AuthoringSuggestionRecord {
  fingerprint: string;
  scope: WorldSuggestionRequest['scope'];
  instruction: string;
  candidates: WorldSuggestionCandidate[];
  gaps: string[];
  selectedIds: string[];
  /** 用户显式勾选的候选；旧信封缺失时按 selectedIds 兼容。 */
  manualIds?: string[];
  /** 用户显式取消的候选；自动依赖不得重新勾选。 */
  excludedIds?: string[];
  createdAt: string;
  /** 面板恢复用的原始草稿快照；缺失时按当前草稿处理。 */
  baseDraft?: WorldAuthoringDraft;
  /** 作者逐项核对记录；结构由 AI 面板定义，这里只原样保存。 */
  confirmations?: Array<{ candidateId: string; fieldSnapshot: string; sourceSnapshot: string }>;
}

/** 某个分支上尚未保存的分支字段；切走时按 branchId 留存，切回可继续编辑。 */
export interface BranchFieldDraft {
  title: string;
  mode: WorldBranchMode;
  direction: string;
  /** 作者编辑时所依据的分支修订；恢复后据此判断是否已过期。 */
  branchRevision?: number;
  updatedAt: number;
}

/** 已知的服务端分支值，用于判断“分支字段是否真的被改过”。 */
export interface ServerBranchSnapshot {
  branchId: string;
  title: string;
  mode: WorldBranchMode;
  direction: string;
  revision: number;
}

/**
 * 页面自己的编辑信封：比共享 useStoredDraft 多保存分支字段、基准修订与幂等键。
 * `baseRevision`/`branchRevision` 是保存时的捕获基准，不写进 strict definition。
 */
export interface WorldAuthoringEnvelope {
  version: 1;
  isDirty: boolean;
  updatedAt: number;
  /** 编辑页记住信封属于哪个分支；切换分支时世界字段保留、分支字段以服务端为准。 */
  branchId?: string;
  /** 从旧 world-form 草稿迁移而来；页面提示作者核对后再保存。 */
  legacy?: boolean;
  baseRevision?: number;
  branchRevision?: number;
  /** 本次内容第一次尝试创建时使用的键；内容变化后会轮换。 */
  idempotencyKey: string;
  /** 上一次发起创建时的内容指纹，用于判断是否需要换键。 */
  attemptedFingerprint?: string;
  values: WorldAuthoringDraft;
  suggestion?: AuthoringSuggestionRecord | null;
  /** 各分支尚未保存的分支字段草稿。 */
  branchDrafts?: Record<string, BranchFieldDraft>;
  /** 当前分支在服务端的值；用于区分“改了”和“本来如此”。 */
  serverBranch?: ServerBranchSnapshot;
}

export function createEnvelope(
  values: WorldAuthoringDraft,
  options: { branchId?: string; baseRevision?: number; branchRevision?: number } = {},
): WorldAuthoringEnvelope {
  return {
    version: 1,
    isDirty: false,
    updatedAt: Date.now(),
    ...(options.branchId ? { branchId: options.branchId } : {}),
    ...(options.baseRevision === undefined ? {} : { baseRevision: options.baseRevision }),
    ...(options.branchRevision === undefined ? {} : { branchRevision: options.branchRevision }),
    idempotencyKey: newIdempotencyKey(),
    values,
    suggestion: null,
  };
}

export function newIdempotencyKey(): string {
  return `world-${crypto.randomUUID()}`;
}

/** 读取新信封；旧版 world-form 的 {isDirty,data:WorldDefinition} 与裸 JSON 都按草稿迁移。 */
export function parseAuthoringEnvelope(raw: string | null): WorldAuthoringEnvelope | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;

  if (record.version === 1 && record.values && typeof record.values === 'object') {
    const values = record.values as WorldAuthoringDraft;
    if (!values.definition || !values.initialBranch) return null;
    return {
      version: 1,
      isDirty: record.isDirty !== false,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      ...(typeof record.branchId === 'string' && record.branchId ? { branchId: record.branchId } : {}),
      ...(record.legacy === true ? { legacy: true } : {}),
      ...(typeof record.baseRevision === 'number' ? { baseRevision: record.baseRevision } : {}),
      ...(typeof record.branchRevision === 'number' ? { branchRevision: record.branchRevision } : {}),
      idempotencyKey: typeof record.idempotencyKey === 'string' && record.idempotencyKey
        ? record.idempotencyKey
        : newIdempotencyKey(),
      ...(typeof record.attemptedFingerprint === 'string'
        ? { attemptedFingerprint: record.attemptedFingerprint }
        : {}),
      values,
      suggestion: isSuggestionRecord(record.suggestion) ? record.suggestion : null,
      ...(isBranchDraftMap(record.branchDrafts) ? { branchDrafts: record.branchDrafts } : {}),
      ...(isServerBranchSnapshot(record.serverBranch) ? { serverBranch: record.serverBranch } : {}),
    };
  }

  const legacy = isLegacyWorldDefinition(record.data)
    ? record.data
    : isLegacyWorldDefinition(record)
      ? record
      : null;
  if (!legacy) return null;
  return {
    ...createEnvelope(draftFromLegacyDefinition(legacy)),
    isDirty: true,
    legacy: true,
    ...(typeof record.expectedRevision === 'number' ? { baseRevision: record.expectedRevision } : {}),
  };
}

function isSuggestionRecord(value: unknown): value is AuthoringSuggestionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.fingerprint === 'string' && Array.isArray(record.candidates);
}

function isBranchDraftMap(value: unknown): value is Record<string, BranchFieldDraft> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const draft = entry as Record<string, unknown>;
    return typeof draft.title === 'string'
      && typeof draft.direction === 'string'
      && (draft.mode === 'canon-gap' || draft.mode === 'adaptation' || draft.mode === 'alternate');
  });
}

function isServerBranchSnapshot(value: unknown): value is ServerBranchSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.branchId === 'string'
    && typeof snapshot.title === 'string'
    && typeof snapshot.direction === 'string'
    && (snapshot.mode === 'canon-gap' || snapshot.mode === 'adaptation' || snapshot.mode === 'alternate')
    && typeof snapshot.revision === 'number';
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry === undefined) continue;
    sorted[key] = sortDeep(entry);
  }
  return sorted;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 草稿内容指纹：只随内容变化，不含基准修订、幂等键和界面状态。
 * 服务端会原样回显，用于判断“建议是否基于旧草稿”。
 */
export function draftFingerprint(draft: WorldAuthoringDraft): string {
  const canonical = JSON.stringify(sortDeep(draft));
  return `swd-${canonical.length.toString(36)}-${fnv1a(canonical)}`;
}

export function formatMinuteOfDay(minute: number | undefined | null): string {
  if (typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > 1439) return '';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** 空字符串 → undefined（未定义）；非法输入 → null，由表单报错而不是猜一个时刻。 */
export function parseMinuteOfDay(value: string): number | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function shortText(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '（空）';
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function currentTargetValue(draft: WorldAuthoringDraft, target: WorldSuggestionCandidate['target']): string {
  const definition = draft.definition;
  switch (target) {
    case 'title': return definition.title;
    case 'summary': return definition.summary;
    case 'timeLabel': return definition.timeLabel;
    case 'startMinuteOfDay':
      return typeof definition.startMinuteOfDay === 'number'
        ? `${formatMinuteOfDay(definition.startMinuteOfDay)}（${definition.startMinuteOfDay} 分钟）`
        : '';
    case 'visualStyle': return definition.visualStyle;
    case 'lockedFacts': return definition.lockedFacts.join('\n');
    case 'direction': return draft.initialBranch.direction;
    default: return '';
  }
}

function actorSummary(actor: WorldActor): string {
  return `${actor.name}（${actor.role === 'main' ? '主角' : '配角'}）`;
}

function locationSummary(location: WorldLocation): string {
  return location.description ? `${location.name} · ${location.description}` : location.name;
}

/** 候选应用前的当前值；用于 before/after 对照。 */
export function candidateBefore(draft: WorldAuthoringDraft, candidate: WorldSuggestionCandidate): string {
  const target = candidate.target;
  if (target === 'actor') {
    const existing = candidate.entityId
      ? draft.definition.actors.find((actor) => actor.id === candidate.entityId)
      : undefined;
    return existing ? actorSummary(existing) : '（新增人物）';
  }
  if (target === 'location') {
    const existing = candidate.entityId
      ? draft.definition.locations.find((location) => location.id === candidate.entityId)
      : undefined;
    return existing ? locationSummary(existing) : '（新增地点）';
  }
  if (target === 'direction' && !draft.initialBranch.direction.trim()) {
    return '（未填写故事方向）';
  }
  return shortText(currentTargetValue(draft, target), 240);
}

/** 候选将写入的值；只做展示格式化，不改数据。 */
export function candidateAfter(candidate: WorldSuggestionCandidate): string {
  const value = candidate.value;
  if (candidate.target === 'startMinuteOfDay') {
    return typeof value === 'number'
      ? `${formatMinuteOfDay(value)}（${value} 分钟）`
      : '（未定义）';
  }
  if (candidate.target === 'lockedFacts') {
    return Array.isArray(value) ? value.join('\n') : String(value);
  }
  if (candidate.target === 'actor') {
    const actor = value as WorldActor;
    return `${actorSummary(actor)} · ${shortText(actor.background || actor.personality || '无背景', 200)}`;
  }
  if (candidate.target === 'location') {
    return locationSummary(value as WorldLocation);
  }
  if (Array.isArray(value)) return value.join('\n');
  return shortText(String(value), 240);
}

/** 内容是否真的会改变草稿；AI 面板用来避免“采纳后无变化”。 */
export function candidateChangesDraft(draft: WorldAuthoringDraft, candidate: WorldSuggestionCandidate): boolean {
  if (candidate.target === 'actor') {
    const actor = candidate.value as WorldActor;
    const existing = candidate.entityId
      ? draft.definition.actors.find((item) => item.id === candidate.entityId)
      : undefined;
    if (!existing) return true;
    return JSON.stringify(existing) !== JSON.stringify(actor);
  }
  if (candidate.target === 'location') {
    const location = candidate.value as WorldLocation;
    const existing = candidate.entityId
      ? draft.definition.locations.find((item) => item.id === candidate.entityId)
      : undefined;
    if (!existing) return true;
    return JSON.stringify(existing) !== JSON.stringify(location);
  }
  if (candidate.target === 'startMinuteOfDay') {
    return draft.definition.startMinuteOfDay !== candidate.value;
  }
  if (candidate.target === 'lockedFacts') {
    return JSON.stringify(draft.definition.lockedFacts) !== JSON.stringify(candidate.value);
  }
  return currentTargetValue(draft, candidate.target) !== String(candidate.value);
}

export interface SelectionValidation {
  ok: boolean;
  errors: string[];
}

/**
 * 采纳前校验：依赖必须存在且被同时选中，人物地点不能静默回退到首个地点。
 * 与 AI 面板的展示校验分开：这里给出可用于阻止提交的确定结论。
 */
export function validateSelection(
  draft: WorldAuthoringDraft,
  selected: WorldSuggestionCandidate[],
): SelectionValidation {
  const errors: string[] = [];
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const existingActorIds = new Set(draft.definition.actors.map((actor) => actor.id));
  const existingLocationIds = new Set(draft.definition.locations.map((location) => location.id));
  const existingSourceIds = new Set(draft.definition.sources.map((source) => source.id));
  const newLocationIds = new Set(
    selected
      .filter((candidate) => candidate.target === 'location' && !candidate.entityId)
      .map((candidate) => (candidate.value as WorldLocation).id),
  );

  if (selectedIds.size !== selected.length) errors.push('同一候选被重复勾选，请取消重复项后重试。');

  for (const candidate of selected) {
    for (const dependency of candidate.dependsOn) {
      if (selectedIds.has(dependency) || existingActorIds.has(dependency) || existingLocationIds.has(dependency)) {
        continue;
      }
      errors.push(`「${WORLD_TARGET_LABELS[candidate.target]}」依赖 ${dependency}，但该依赖未被选中或已不存在。`);
    }
    for (const sourceId of candidate.sourceIds) {
      if (!existingSourceIds.has(sourceId)) {
        errors.push(`「${WORLD_TARGET_LABELS[candidate.target]}」引用了已不存在的来源 ${sourceId}。`);
      }
    }
    if (candidate.target === 'actor') {
      const actor = candidate.value as WorldActor;
      if (candidate.entityId && !existingActorIds.has(candidate.entityId)) {
        errors.push(`人物候选指向的 ${candidate.entityId} 已不在草稿中，请重新生成建议，不能按新增写入。`);
      }
      if (!candidate.entityId && existingActorIds.has(actor.id)) {
        errors.push(`新人物 ${actor.id} 与现有人物 ID 重复。`);
      }
      if (existingLocationIds.has(actor.locationId) || newLocationIds.has(actor.locationId)) continue;
      errors.push(`人物「${actor.name || actor.id}」的地点 ${actor.locationId} 不在草稿或已选地点中，请先补选地点。`);
    }
    if (candidate.target === 'location') {
      const location = candidate.value as WorldLocation;
      if (candidate.entityId && !existingLocationIds.has(candidate.entityId)) {
        errors.push(`地点候选指向的 ${candidate.entityId} 已不在草稿中，请重新生成建议，不能按新增写入。`);
      }
      if (!candidate.entityId && existingLocationIds.has(location.id)) {
        errors.push(`新地点 ${location.id} 与现有地点 ID 重复。`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 按依赖顺序排列候选，保证新地点先于引用它的人物写入。 */
export function orderCandidates(selected: WorldSuggestionCandidate[]): WorldSuggestionCandidate[] {
  const byId = new Map(selected.map((candidate) => [candidate.id, candidate]));
  const ordered: WorldSuggestionCandidate[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (candidate: WorldSuggestionCandidate) => {
    const current = state.get(candidate.id);
    if (current === 2) return;
    if (current === 1) return;
    state.set(candidate.id, 1);
    for (const dependency of candidate.dependsOn) {
      const dependencyCandidate = byId.get(dependency);
      if (dependencyCandidate) visit(dependencyCandidate);
    }
    state.set(candidate.id, 2);
    ordered.push(candidate);
  };
  for (const candidate of selected) visit(candidate);
  return ordered;
}

/**
 * 把已选候选写进草稿。direction 落在 initialBranch，其余落在 definition；
 * 已有实体按 entityId 原位替换，新实体追加，绝不覆盖未勾选的同名字段。
 */
export function applyCandidates(
  draft: WorldAuthoringDraft,
  selected: WorldSuggestionCandidate[],
): WorldAuthoringDraft {
  const definition: WorldDefinition = {
    ...draft.definition,
    locations: draft.definition.locations.map((location) => ({ ...location })),
    actors: draft.definition.actors.map((actor) => ({
      ...actor,
      goals: [...actor.goals],
      referenceArtifactIds: [...actor.referenceArtifactIds],
    })),
    lockedFacts: [...draft.definition.lockedFacts],
  };
  let direction = draft.initialBranch.direction;

  for (const candidate of orderCandidates(selected)) {
    switch (candidate.target) {
      case 'title':
        definition.title = String(candidate.value);
        break;
      case 'summary':
        definition.summary = String(candidate.value);
        break;
      case 'timeLabel':
        definition.timeLabel = String(candidate.value);
        break;
      case 'startMinuteOfDay':
        if (typeof candidate.value === 'number') definition.startMinuteOfDay = candidate.value;
        break;
      case 'visualStyle':
        definition.visualStyle = String(candidate.value);
        break;
      case 'lockedFacts':
        if (Array.isArray(candidate.value)) definition.lockedFacts = [...candidate.value] as string[];
        break;
      case 'direction':
        direction = String(candidate.value);
        break;
      case 'actor': {
        const actor = candidate.value as WorldActor;
        const index = candidate.entityId
          ? definition.actors.findIndex((item) => item.id === candidate.entityId)
          : -1;
        if (candidate.entityId && index < 0) break;
        if (index >= 0) {
          const existing = definition.actors[index];
          definition.actors[index] = {
            ...actor,
            characterId: existing.characterId,
            characterVersion: existing.characterVersion,
            referenceArtifactIds: [...existing.referenceArtifactIds],
          };
        } else {
          definition.actors.push({ ...actor });
        }
        break;
      }
      case 'location': {
        const location = candidate.value as WorldLocation;
        const index = candidate.entityId
          ? definition.locations.findIndex((item) => item.id === candidate.entityId)
          : -1;
        if (candidate.entityId && index < 0) break;
        if (index >= 0) definition.locations[index] = { ...location };
        else definition.locations.push({ ...location });
        break;
      }
      default:
        break;
    }
  }

  return {
    definition,
    initialBranch: { ...draft.initialBranch, direction },
  };
}

function uniqueIds(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export interface DraftValidationIssue {
  path: string;
  message: string;
}

export interface DraftValidation {
  ok: boolean;
  issues: DraftValidationIssue[];
}

/** 面向表单的校验：先给可读文案，再用契约兜底，避免两端规则漂移。 */
export function validateDraft(draft: WorldAuthoringDraft): DraftValidation {
  const issues: DraftValidationIssue[] = [];
  const definition = draft.definition;

  if (!definition.title.trim()) issues.push({ path: 'title', message: '世界名称不能为空。' });
  if (definition.title.length > 200) issues.push({ path: 'title', message: '世界名称最多 200 字。' });
  if (definition.summary.length > 20000) issues.push({ path: 'summary', message: '世界简介最多 20000 字。' });
  if (definition.timeLabel.length > 200) issues.push({ path: 'timeLabel', message: '时间标签最多 200 字。' });
  if (definition.visualStyle.length > 8000) issues.push({ path: 'visualStyle', message: '画面风格最多 8000 字。' });

  if (definition.locations.length === 0) issues.push({ path: 'locations', message: '至少需要一个开场地点。' });
  if (!uniqueIds(definition.locations.map((location) => location.id))) {
    issues.push({ path: 'locations', message: '地点 ID 重复，请删除重复地点后重试。' });
  }
  definition.locations.forEach((location, index) => {
    if (!location.name.trim()) issues.push({ path: `locations.${index}.name`, message: '每个地点都需要名称。' });
    if (location.description.length > 5000) {
      issues.push({ path: `locations.${index}.description`, message: '地点描述最多 5000 字。' });
    }
  });

  const locationIds = new Set(definition.locations.map((location) => location.id));
  if (definition.actors.length === 0) issues.push({ path: 'actors', message: '至少需要一名登场人物。' });
  if (!uniqueIds(definition.actors.map((actor) => actor.id))) {
    issues.push({ path: 'actors', message: '人物 ID 重复，请删除重复人物后重试。' });
  }
  definition.actors.forEach((actor, index) => {
    if (!actor.name.trim()) issues.push({ path: `actors.${index}.name`, message: '每个人物都需要名称。' });
    if (!locationIds.has(actor.locationId)) {
      issues.push({ path: `actors.${index}.locationId`, message: `人物「${actor.name || '未命名'}」还没有有效地点。` });
    }
    if ((actor.characterId === null) !== (actor.characterVersion === null)) {
      issues.push({
        path: `actors.${index}.characterId`,
        message: '角色库绑定必须同时有角色 ID 与真实版本；不需要绑定请清空两者。',
      });
    }
    if (actor.goals.length > 30) issues.push({ path: `actors.${index}.goals`, message: '每个人物最多 30 条目标。' });
    if (actor.referenceArtifactIds.length > 10) {
      issues.push({ path: `actors.${index}.referenceArtifactIds`, message: '每个人物最多 10 个参考素材。' });
    }
  });

  definition.sources.forEach((source, index) => {
    if (!source.title.trim()) issues.push({ path: `sources.${index}.title`, message: '每条来源都需要标题；不要的来源请删除。' });
    if (source.content.length > 100000) {
      issues.push({ path: `sources.${index}.content`, message: '单条来源正文最多 100000 字。' });
    }
  });

  if (definition.lockedFacts.length > 100) {
    issues.push({ path: 'lockedFacts', message: '锁定事实最多 100 条。' });
  }
  if (definition.lockedFacts.some((fact) => fact.length > 3000)) {
    issues.push({ path: 'lockedFacts', message: '单条锁定事实最多 3000 字。' });
  }
  if ((definition.visualReferences ?? []).length > 100) {
    issues.push({ path: 'visualReferences', message: '画面参考最多 100 条。' });
  }

  if (!draft.initialBranch.title.trim()) issues.push({ path: 'branch.title', message: '分支名称不能为空。' });
  if (draft.initialBranch.title.length > 200) issues.push({ path: 'branch.title', message: '分支名称最多 200 字。' });
  if (draft.initialBranch.direction.length > 8000) {
    issues.push({ path: 'branch.direction', message: '故事方向最多 8000 字。' });
  }

  if (issues.length === 0 && !Value.Check(WorldAuthoringDraftSchema, draft)) {
    const first = [...Value.Errors(WorldAuthoringDraftSchema, draft)][0];
    issues.push({ path: 'draft', message: `草稿结构不符合契约：${first?.path ?? '/'} ${first?.message ?? ''}`.trim() });
  }

  return { ok: issues.length === 0, issues };
}

export function issueFor(validation: DraftValidation, path: string): string | undefined {
  return validation.issues.find((issue) => issue.path === path)?.message;
}

/**
 * 提交前收敛：去掉空行与首尾空白、清理失效的画面参考锚点。
 * 人物地点不在这里回退——无效地点必须由校验拦住。
 */
export function normalizeDraftForSubmit(draft: WorldAuthoringDraft): WorldAuthoringDraft {
  const locations = draft.definition.locations
    .map((location) => ({
      ...location,
      name: location.name.trim(),
      description: location.description.trim(),
    }))
    .filter((location) => location.name.length > 0);
  const locationIds = new Set(locations.map((location) => location.id));

  const actors = draft.definition.actors
    .map((actor) => ({
      ...actor,
      name: actor.name.trim(),
      background: actor.background.trim(),
      personality: actor.personality.trim(),
      speechStyle: actor.speechStyle.trim(),
      appearance: actor.appearance.trim(),
      goals: actor.goals.map((goal) => goal.trim()).filter(Boolean),
      referenceArtifactIds: [...new Set(actor.referenceArtifactIds.map((id) => id.trim()).filter(Boolean))],
    }))
    .filter((actor) => actor.name.length > 0);

  const visualReferences = (draft.definition.visualReferences ?? [])
    .map((reference) => ({
      ...reference,
      name: reference.name.trim(),
      description: reference.description.trim(),
      referenceArtifactIds: [...new Set(reference.referenceArtifactIds.map((id) => id.trim()).filter(Boolean))],
    }))
    .filter((reference) => {
      if (!reference.name) return false;
      if (reference.kind === 'location') {
        const anchor = reference.locationId ?? reference.id;
        return locationIds.has(anchor);
      }
      return !reference.locationId || locationIds.has(reference.locationId);
    });

  return {
    definition: {
      ...draft.definition,
      title: draft.definition.title.trim(),
      timeLabel: draft.definition.timeLabel.trim(),
      locations,
      actors,
      visualReferences,
      sources: draft.definition.sources
        .map((source) => ({
          ...source,
          title: source.title.trim(),
          content: source.content.trim(),
          sourceUrl: source.sourceUrl.trim(),
          sourceVersion: source.sourceVersion.trim(),
        }))
        .filter((source) => source.title.length > 0 || source.content.length > 0),
      lockedFacts: draft.definition.lockedFacts.map((fact) => fact.trim()).filter(Boolean),
    },
    initialBranch: {
      ...draft.initialBranch,
      title: draft.initialBranch.title.trim(),
      direction: draft.initialBranch.direction.trim(),
    },
  };
}

export function sourceFromWeb(item: WebSearchResult, savedSourceId?: string): WorldSource {
  return {
    id: `source-web-${item.id}`,
    title: item.title || item.url,
    nature: 'unverified',
    content: item.content || item.snippet || `网页「${item.title || item.url}」没有可用正文。`,
    sourceUrl: item.url,
    sourceVersion: savedSourceId ? `web:${savedSourceId}` : `web:${item.contentHash || item.id}`,
    capturedAt: item.retrievedAt || new Date().toISOString(),
  };
}

/** 与页面草稿合并时去重：同 id 来源保留先到的一条。 */
export function mergeSources(existing: WorldSource[], incoming: WorldSource[]): WorldSource[] {
  const merged = [...existing];
  for (const source of incoming) {
    const index = merged.findIndex((item) => item.id === source.id);
    if (index < 0) {
      merged.push(source);
      continue;
    }
    if (merged[index].sourceVersion === source.sourceVersion) continue;
    merged[index] = { ...source, id: merged[index].id };
  }
  return merged;
}

export function mergeActors(existing: WorldActor[], incoming: WorldActor[]): WorldActor[] {
  const merged = [...existing];
  for (const actor of incoming) {
    const index = merged.findIndex((item) => item.id === actor.id);
    if (index < 0) {
      merged.push(actor);
      continue;
    }
    const current = merged[index];
    if (current.characterId === actor.characterId && current.characterVersion === actor.characterVersion) continue;
    merged[index] = {
      ...actor,
      id: current.id,
      locationId: current.locationId,
      role: current.role,
      referenceArtifactIds: [...current.referenceArtifactIds],
    };
  }
  return merged;
}

export interface VersionReplaceRejection {
  id: string;
  reason: string;
}

export interface VersionReplaceResult<T> {
  items: T[];
  replaced: number;
  rejected: VersionReplaceRejection[];
}

/**
 * 资源库“版本更新”专用：只更新仍在当前草稿且角色绑定未变的同 id 人物。
 * 保留作者当前的地点、角色定位与媒体绑定，未知或已解绑人物不会被恢复。
 */
export function replaceActors(
  existing: WorldActor[],
  incoming: WorldActor[],
): VersionReplaceResult<WorldActor> {
  const merged = [...existing];
  const rejected: VersionReplaceRejection[] = [];
  let replaced = 0;
  for (const actor of incoming) {
    const index = merged.findIndex((item) => item.id === actor.id);
    if (index < 0) {
      rejected.push({
        id: actor.id,
        reason: `人物「${actor.name || '未命名人物'}」已不在当前世界，未更新。`,
      });
      continue;
    }
    const current = merged[index];
    if (!current.characterId || actor.characterId !== current.characterId) {
      rejected.push({
        id: current.id,
        reason: `人物「${current.name || '未命名人物'}」的角色绑定已变化或已解绑，不能按旧版本更新。`,
      });
      continue;
    }
    merged[index] = {
      ...actor,
      id: current.id,
      characterId: current.characterId,
      locationId: current.locationId,
      role: current.role,
      referenceArtifactIds: [...current.referenceArtifactIds],
    };
    replaced += 1;
  }
  return { items: merged, replaced, rejected };
}

/** 来源版本更新专用：只更新仍在当前草稿的同 id 来源，不恢复已删除的来源。 */
export function replaceSources(
  existing: WorldSource[],
  incoming: WorldSource[],
): VersionReplaceResult<WorldSource> {
  const merged = [...existing];
  const rejected: VersionReplaceRejection[] = [];
  let replaced = 0;
  for (const source of incoming) {
    const index = merged.findIndex((item) => item.id === source.id);
    if (index < 0) {
      rejected.push({
        id: source.id,
        reason: `资料「${source.title || source.id}」已不在当前世界，未更新。`,
      });
      continue;
    }
    merged[index] = { ...source, id: merged[index].id };
    replaced += 1;
  }
  return { items: merged, replaced, rejected };
}

export function postWorldSuggestions(request: WorldSuggestionRequest): Promise<WorldSuggestionResponse> {
  return postJson<WorldSuggestionResponse>(
    'story-worlds/suggestions',
    request,
    undefined,
    WorldSuggestionResponseSchema,
  );
}

export function createWorldBundle(input: {
  idempotencyKey: string;
  definition: WorldDefinition;
  initialBranch: WorldAuthoringDraft['initialBranch'];
}): Promise<WorldBundleResult> {
  return postJson<WorldBundleResult>(
    'story-worlds/create-bundle',
    input,
    undefined,
    WorldBundleResultSchema,
  );
}

export function saveWorldDefinition(
  worldId: string,
  expectedRevision: number,
  definition: WorldDefinition,
): Promise<StoryWorld> {
  return putJson<StoryWorld>(
    `story-worlds/${encodeURIComponent(worldId)}`,
    { expectedRevision, definition },
    undefined,
    StoryWorldSchema,
  );
}

/** 把服务端 StoryWorld 收敛回 strict definition，避免把 id/revision/时间戳写回表单。 */
export function definitionFromWorld(world: StoryWorld): WorldDefinition {
  const definition: Record<string, unknown> = { ...world };
  delete definition.id;
  delete definition.revision;
  delete definition.createdAt;
  delete definition.updatedAt;
  return definition as WorldDefinition;
}

export function saveWorldBranch(
  worldId: string,
  branchId: string,
  expectedRevision: number,
  branch: Pick<WorldBranch, 'title' | 'mode' | 'direction'>,
): Promise<WorldBranch> {
  return putJson<WorldBranch>(
    `story-worlds/${encodeURIComponent(worldId)}/branches/${encodeURIComponent(branchId)}`,
    {
      expectedRevision,
      title: branch.title,
      mode: branch.mode,
      direction: branch.direction,
    },
    undefined,
    WorldBranchSchema,
  );
}

export const ACTIVE_RUN_STATUSES = new Set(['queued', 'running', 'paused', 'uncertain']);

export function isRunBlockingBranch(status: string | undefined | null): boolean {
  return Boolean(status && ACTIVE_RUN_STATUSES.has(status));
}

export interface BranchComparison {
  changed: boolean;
  fields: Array<{ field: 'title' | 'mode' | 'direction'; label: string; server: string; draft: string }>;
}

const BRANCH_FIELD_LABELS = {
  title: '分支名称',
  mode: '分支模式',
  direction: '故事方向',
} as const;

/** 比较分支字段与服务器当前值；保存按钮据此说明哪些字段会写到分支。 */
export function compareBranchFields(
  draft: Pick<WorldAuthoringDraft, 'initialBranch'>,
  branch: Pick<WorldBranch, 'title' | 'mode' | 'direction'> | null | undefined,
): BranchComparison {
  if (!branch) return { changed: false, fields: [] };
  const fields: BranchComparison['fields'] = [];
  for (const field of ['title', 'mode', 'direction'] as const) {
    const serverValue = branch[field];
    const draftValue = draft.initialBranch[field];
    if (serverValue === draftValue) continue;
    fields.push({
      field,
      label: BRANCH_FIELD_LABELS[field],
      server: field === 'mode' ? BRANCH_MODE_LABELS[serverValue as WorldBranchMode] : serverValue,
      draft: field === 'mode' ? BRANCH_MODE_LABELS[draftValue as WorldBranchMode] : draftValue,
    });
  }
  return { changed: fields.length > 0, fields };
}

/** 分支字段是否与已知的服务端值不同；没有服务端快照时无法判断，按“未改”处理。 */
export function branchFieldsChanged(
  draft: Pick<WorldAuthoringDraft, 'initialBranch'>,
  server: ServerBranchSnapshot | null | undefined,
): boolean {
  if (!server) return false;
  return draft.initialBranch.title !== server.title
    || draft.initialBranch.mode !== server.mode
    || draft.initialBranch.direction !== server.direction;
}

/**
 * 把当前分支字段存进 branchId 对应的草稿槽。
 * 已知服务端基线时只在确实改过才存；没有基线（force）时宁可多存，也不丢作者输入。
 */
export function stashBranchDraft(
  envelope: WorldAuthoringEnvelope,
  branchId: string | undefined,
  now = Date.now(),
  force = false,
): Record<string, BranchFieldDraft> | undefined {
  if (!branchId) return envelope.branchDrafts;
  if (!force && !branchFieldsChanged(envelope.values, envelope.serverBranch)) return envelope.branchDrafts;
  return {
    ...(envelope.branchDrafts ?? {}),
    [branchId]: {
      title: envelope.values.initialBranch.title,
      mode: envelope.values.initialBranch.mode,
      direction: envelope.values.initialBranch.direction,
      ...(envelope.branchRevision === undefined ? {} : { branchRevision: envelope.branchRevision }),
      updatedAt: now,
    },
  };
}

/** 切回某个分支时取回它自己的未保存草稿；没有则用服务端值。 */
export function restoreBranchDraft(
  branchDrafts: Record<string, BranchFieldDraft> | undefined,
  branchId: string | undefined,
  server: Pick<WorldBranch, 'title' | 'mode' | 'direction'> | null | undefined,
): WorldAuthoringDraft['initialBranch'] {
  const stashed = branchId ? branchDrafts?.[branchId] : undefined;
  if (stashed) {
    return { title: stashed.title, mode: stashed.mode, direction: stashed.direction };
  }
  return server
    ? { title: server.title, mode: server.mode, direction: server.direction }
    : { title: '主线', mode: 'canon-gap', direction: '' };
}

export interface FieldComparison {
  field: string;
  label: string;
  server: string;
  draft: string;
}

/**
 * 冲突确认用的对照：只列作者草稿与服务器当前值不同的字段。
 * 用于“使用最新修订”之前让作者看清会保留哪一侧，而不是盲推基准。
 */
export function compareDraftToServer(
  draft: WorldAuthoringDraft,
  server: { definition: WorldDefinition; branch: Pick<WorldBranch, 'title' | 'mode' | 'direction'> },
): FieldComparison[] {
  const fields: FieldComparison[] = [];
  const push = (field: string, label: string, serverValue: string, draftValue: string) => {
    if (serverValue === draftValue) return;
    fields.push({ field, label, server: serverValue || '（空）', draft: draftValue || '（空）' });
  };
  const show = (value: unknown): string => {
    if (value === undefined || value === null || value === '') return '（空）';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      if (value.length === 0) return '（空列表）';
      return value.map((item) => show(item)).join('\n');
    }
    return JSON.stringify(value, null, 2);
  };
  const pushValue = (field: string, label: string, serverValue: unknown, draftValue: unknown) => {
    const left = show(serverValue);
    const right = show(draftValue);
    if (left === right) return;
    fields.push({ field, label, server: left, draft: right });
  };
  push('title', '世界名称', server.definition.title, draft.definition.title);
  push('summary', '世界简介', server.definition.summary, draft.definition.summary);
  push('timeLabel', '时间标签', server.definition.timeLabel, draft.definition.timeLabel);
  push(
    'startMinuteOfDay',
    '起点时刻',
    typeof server.definition.startMinuteOfDay === 'number'
      ? `${formatMinuteOfDay(server.definition.startMinuteOfDay)}（${server.definition.startMinuteOfDay}）`
      : '未定义',
    typeof draft.definition.startMinuteOfDay === 'number'
      ? `${formatMinuteOfDay(draft.definition.startMinuteOfDay)}（${draft.definition.startMinuteOfDay}）`
      : '未定义',
  );
  push('visualStyle', '画面风格', server.definition.visualStyle, draft.definition.visualStyle);
  pushValue('lockedFacts', '锁定事实', server.definition.lockedFacts, draft.definition.lockedFacts);
  pushValue('models', '模型绑定', server.definition.models, draft.definition.models);

  const serverActors = new Map(server.definition.actors.map((actor) => [actor.id, actor]));
  const draftActors = new Map(draft.definition.actors.map((actor) => [actor.id, actor]));
  for (const actor of server.definition.actors) {
    const mine = draftActors.get(actor.id);
    const label = `人物「${actor.name || actor.id}」`;
    if (!mine) {
      fields.push({ field: `actors.${actor.id}`, label, server: `存在：${show(actor)}`, draft: '（草稿中已删除）' });
      continue;
    }
    pushValue(`actors.${actor.id}.name`, `${label} · 名称`, actor.name, mine.name);
    pushValue(`actors.${actor.id}.role`, `${label} · 定位`, actor.role, mine.role);
    pushValue(`actors.${actor.id}.characterId`, `${label} · 角色库 ID`, actor.characterId, mine.characterId);
    pushValue(`actors.${actor.id}.characterVersion`, `${label} · 角色库版本`, actor.characterVersion, mine.characterVersion);
    pushValue(`actors.${actor.id}.locationId`, `${label} · 所在地点`, actor.locationId, mine.locationId);
    pushValue(`actors.${actor.id}.background`, `${label} · 背景`, actor.background, mine.background);
    pushValue(`actors.${actor.id}.personality`, `${label} · 性格`, actor.personality, mine.personality);
    pushValue(`actors.${actor.id}.speechStyle`, `${label} · 说话方式`, actor.speechStyle, mine.speechStyle);
    pushValue(`actors.${actor.id}.appearance`, `${label} · 外貌`, actor.appearance, mine.appearance);
    pushValue(`actors.${actor.id}.goals`, `${label} · 目标`, actor.goals, mine.goals);
    pushValue(`actors.${actor.id}.referenceArtifactIds`, `${label} · 参考素材`, actor.referenceArtifactIds, mine.referenceArtifactIds);
  }
  for (const actor of draft.definition.actors) {
    if (serverActors.has(actor.id)) continue;
    fields.push({
      field: `actors.${actor.id}`,
      label: `人物「${actor.name || actor.id}」`,
      server: '（服务器没有此人物）',
      draft: `新增：${show(actor)}`,
    });
  }

  const serverLocations = new Map(server.definition.locations.map((location) => [location.id, location]));
  const draftLocations = new Map(draft.definition.locations.map((location) => [location.id, location]));
  for (const location of server.definition.locations) {
    const mine = draftLocations.get(location.id);
    const label = `地点「${location.name || location.id}」`;
    if (!mine) {
      fields.push({ field: `locations.${location.id}`, label, server: `存在：${show(location)}`, draft: '（草稿中已删除）' });
      continue;
    }
    pushValue(`locations.${location.id}.name`, `${label} · 名称`, location.name, mine.name);
    pushValue(`locations.${location.id}.description`, `${label} · 描述`, location.description, mine.description);
  }
  for (const location of draft.definition.locations) {
    if (serverLocations.has(location.id)) continue;
    fields.push({
      field: `locations.${location.id}`,
      label: `地点「${location.name || location.id}」`,
      server: '（服务器没有此地点）',
      draft: `新增：${show(location)}`,
    });
  }

  const serverSources = new Map(server.definition.sources.map((source) => [source.id, source]));
  const draftSources = new Map(draft.definition.sources.map((source) => [source.id, source]));
  for (const source of server.definition.sources) {
    const mine = draftSources.get(source.id);
    const label = `资料「${source.title || source.id}」`;
    if (!mine) {
      fields.push({ field: `sources.${source.id}`, label, server: `存在：${show(source)}`, draft: '（草稿中已删除）' });
      continue;
    }
    pushValue(`sources.${source.id}.title`, `${label} · 标题`, source.title, mine.title);
    pushValue(`sources.${source.id}.nature`, `${label} · 性质`, source.nature, mine.nature);
    pushValue(`sources.${source.id}.content`, `${label} · 正文`, source.content, mine.content);
    pushValue(`sources.${source.id}.sourceUrl`, `${label} · 链接`, source.sourceUrl, mine.sourceUrl);
    pushValue(`sources.${source.id}.sourceVersion`, `${label} · 版本`, source.sourceVersion, mine.sourceVersion);
  }
  for (const source of draft.definition.sources) {
    if (serverSources.has(source.id)) continue;
    fields.push({
      field: `sources.${source.id}`,
      label: `资料「${source.title || source.id}」`,
      server: '（服务器没有此资料）',
      draft: `新增：${show(source)}`,
    });
  }

  const serverVisuals = new Map((server.definition.visualReferences ?? []).map((reference) => [reference.id, reference]));
  const draftVisuals = new Map((draft.definition.visualReferences ?? []).map((reference) => [reference.id, reference]));
  for (const reference of server.definition.visualReferences ?? []) {
    const mine = draftVisuals.get(reference.id);
    const label = `画面参考「${reference.name || reference.id}」`;
    if (!mine) {
      fields.push({ field: `visualReferences.${reference.id}`, label, server: `存在：${show(reference)}`, draft: '（草稿中已删除）' });
      continue;
    }
    pushValue(`visualReferences.${reference.id}.name`, `${label} · 名称`, reference.name, mine.name);
    pushValue(`visualReferences.${reference.id}.kind`, `${label} · 类型`, reference.kind, mine.kind);
    pushValue(`visualReferences.${reference.id}.locationId`, `${label} · 锚定地点`, reference.locationId, mine.locationId);
    pushValue(`visualReferences.${reference.id}.description`, `${label} · 说明`, reference.description, mine.description);
    pushValue(`visualReferences.${reference.id}.referenceArtifactIds`, `${label} · 参考素材`, reference.referenceArtifactIds, mine.referenceArtifactIds);
  }
  for (const reference of draft.definition.visualReferences ?? []) {
    if (serverVisuals.has(reference.id)) continue;
    fields.push({
      field: `visualReferences.${reference.id}`,
      label: `画面参考「${reference.name || reference.id}」`,
      server: '（服务器没有此参考）',
      draft: `新增：${show(reference)}`,
    });
  }

  for (const field of compareBranchFields(draft, server.branch).fields) {
    fields.push({ field: `branch.${field.field}`, label: field.label, server: field.server || '（空）', draft: field.draft || '（空）' });
  }
  return fields;
}

export type SaveScope = 'all' | 'world' | 'branch';

export interface SavePlanInput {
  isEdit: boolean;
  scope: SaveScope;
  /** 页面/会话判定的冲突（含缺基准、旧基准、分支切换）。 */
  hasConflict: boolean;
  baseRevision: number | undefined;
  /** 分支保存的捕获基准；写分支时必须存在。 */
  branchRevision?: number;
  branchChanged: boolean;
  branchLocked: boolean;
  /** 编辑页是否已有可用的服务端分支快照。 */
  serverReady: boolean;
}

export type SavePlan =
  | { kind: 'blocked'; message: string; conflict: boolean }
  | { kind: 'create' }
  | {
    kind: 'save';
    writeWorld: boolean;
    writeBranch: boolean;
    expectedRevision: number;
    branchRevision?: number;
  };

/**
 * 保存前唯一的决策点：写世界、写分支、两者都写，或直接阻断。
 * 不允许在缺基准时回退到“当前修订”，也不允许在分支运行时写分支。
 */
export function resolveSavePlan(input: SavePlanInput): SavePlan {
  if (!input.isEdit) return { kind: 'create' };

  if (input.scope === 'branch' && !input.branchChanged) {
    return { kind: 'blocked', message: '分支名称、模式与方向没有改动，无需单独保存。', conflict: false };
  }
  if (input.scope === 'branch' && input.branchChanged && input.branchLocked) {
    return {
      kind: 'blocked',
      message: '该分支有活动运行，暂停或结束后才能保存分支字段。可以先只保存世界设定。',
      conflict: false,
    };
  }
  if (input.hasConflict) {
    return {
      kind: 'blocked',
      message: '草稿基于旧修订、另一个分支，或没有可确认的基准。请先核对服务器当前值与草稿差异并确认。',
      conflict: true,
    };
  }
  if (input.baseRevision === undefined) {
    return {
      kind: 'blocked',
      message: '这份草稿没有可确认的世界修订基底，不能按当前修订保存。请先核对差异并确认基准。',
      conflict: true,
    };
  }
  if (!input.serverReady) {
    return { kind: 'blocked', message: '世界或分支尚未加载完成，请稍后重试。', conflict: false };
  }

  const writeWorld = input.scope !== 'branch';
  const writeBranch = input.scope !== 'world' && input.branchChanged && !input.branchLocked;
  if (writeBranch && input.branchRevision === undefined) {
    return {
      kind: 'blocked',
      message: '分支没有可确认的修订基底，不能按当前修订保存分支字段。请先核对差异并确认基准。',
      conflict: true,
    };
  }

  return {
    kind: 'save',
    writeWorld,
    writeBranch,
    expectedRevision: input.baseRevision,
    ...(input.branchRevision === undefined ? {} : { branchRevision: input.branchRevision }),
  };
}

export interface SavedStateInput {
  scope: SaveScope;
  writeBranch: boolean;
  /** 保存前作者草稿。 */
  draft: WorldAuthoringDraft;
  /** 保存后服务端的世界定义。 */
  savedDefinition: WorldDefinition;
  /** 保存后服务端的分支（未写分支时即保存前的服务端值）。 */
  savedBranch: Pick<WorldBranch, 'title' | 'mode' | 'direction'>;
}

export interface SavedState {
  values: WorldAuthoringDraft;
  /** 是否仍有另一侧未保存的输入。 */
  keepDirty: boolean;
  worldPending: boolean;
  branchPending: boolean;
}

export interface SaveCompletionInput extends SavedStateInput {
  /** 请求发出时的草稿快照。 */
  submitted: WorldAuthoringDraft;
  /** 响应回来时的草稿；期间可能又有作者输入。 */
  late: WorldAuthoringDraft;
}

export interface SaveCompletion extends SavedState {
  lateWorldEdits: boolean;
  lateBranchEdits: boolean;
}

function branchDiffers(
  left: Pick<WorldAuthoringDraft, 'initialBranch'>,
  right: Pick<WorldBranch, 'title' | 'mode' | 'direction'>,
): boolean {
  return left.initialBranch.title !== right.title
    || left.initialBranch.mode !== right.mode
    || left.initialBranch.direction !== right.direction;
}

/**
 * 保存完成时重建草稿：响应期间的新输入不能被请求快照覆盖。
 * 已写入的一侧用“晚到的输入”优先，未写入的一侧保留作者内容。
 */
export function resolveSaveCompletion(input: SaveCompletionInput): SaveCompletion {
  const lateWorldEdits = input.scope !== 'branch'
    && !definitionsEqual(input.late.definition, input.submitted.definition);
  const lateBranchEdits = input.writeBranch
    && (input.late.initialBranch.title !== input.submitted.initialBranch.title
      || input.late.initialBranch.mode !== input.submitted.initialBranch.mode
      || input.late.initialBranch.direction !== input.submitted.initialBranch.direction);

  const definition = input.scope === 'branch'
    ? input.late.definition
    : lateWorldEdits
      ? input.late.definition
      : input.savedDefinition;
  const initialBranch = input.writeBranch
    ? lateBranchEdits
      ? input.late.initialBranch
      : input.savedBranch
    : input.late.initialBranch;

  const values: WorldAuthoringDraft = {
    definition,
    initialBranch: {
      title: initialBranch.title,
      mode: initialBranch.mode,
      direction: initialBranch.direction,
    },
  };
  const worldPending = !definitionsEqual(values.definition, input.savedDefinition);
  const branchPending = branchDiffers(values, input.savedBranch);
  return {
    values,
    keepDirty: worldPending || branchPending,
    worldPending,
    branchPending,
    lateWorldEdits,
    lateBranchEdits,
  };
}

/**
 * 部分保存后重建草稿：只替换真正写入服务器的那一侧，另一侧保留作者输入。
 * 世界/分支任一侧仍有未保存差异时保持 dirty，避免“保存一半就显示已保存”。
 */
export function resolveSavedState(input: SavedStateInput): SavedState {
  const { values, keepDirty, worldPending, branchPending } = resolveSaveCompletion({
    ...input,
    submitted: input.draft,
    late: input.draft,
  });
  return { values, keepDirty, worldPending, branchPending };
}

/** 定义等值比较；忽略键顺序，用于判断世界字段是否仍有未保存差异。 */
export function definitionsEqual(left: WorldDefinition, right: WorldDefinition): boolean {
  return JSON.stringify(sortDeep(left)) === JSON.stringify(sortDeep(right));
}

/** AI 采纳后可撤销的字段：记录“采纳前”和“AI 写入”的值，撤销时只回退仍等于写入值的字段。 */
export interface AppliedFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AppliedChanges {
  label: string;
  fields: AppliedFieldChange[];
}

function readPath(definition: WorldDefinition, path: string): unknown {
  let current: unknown = definition;
  for (const segment of path.split('.')) {
    if (current === undefined || current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writePath(definition: WorldDefinition, path: string, value: unknown) {
  const segments = path.split('.');
  const last = segments.pop()!;
  let current: Record<string, unknown> = definition as unknown as Record<string, unknown>;
  for (const segment of segments) {
    const next = current[segment];
    if (!next || typeof next !== 'object') return;
    current = next as Record<string, unknown>;
  }
  if (value === undefined) delete current[last];
  else current[last] = value;
}

/** 记录采纳前后的差异，供精确撤销使用。 */
export function diffAppliedChanges(
  before: WorldAuthoringDraft,
  after: WorldAuthoringDraft,
  label: string,
): AppliedChanges {
  const fields: AppliedFieldChange[] = [];
  const scalarPaths = [
    'title', 'summary', 'timeLabel', 'startMinuteOfDay', 'visualStyle', 'lockedFacts', 'models',
  ];
  for (const path of scalarPaths) {
    const left = readPath(before.definition, path);
    const right = readPath(after.definition, path);
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    fields.push({ field: `definition.${path}`, before: left, after: right });
  }
  if (before.initialBranch.direction !== after.initialBranch.direction) {
    fields.push({
      field: 'initialBranch.direction',
      before: before.initialBranch.direction,
      after: after.initialBranch.direction,
    });
  }
  const entityGroups: Array<{ key: 'actors' | 'locations' | 'visualReferences' | 'sources' }> = [
    { key: 'actors' }, { key: 'locations' }, { key: 'visualReferences' }, { key: 'sources' },
  ];
  for (const { key } of entityGroups) {
    const beforeItems = (before.definition[key] ?? []) as Array<{ id: string }>;
    const afterItems = (after.definition[key] ?? []) as Array<{ id: string }>;
    const beforeById = new Map(beforeItems.map((item) => [item.id, item]));
    const afterById = new Map(afterItems.map((item) => [item.id, item]));
    for (const [id, item] of afterById) {
      const previous = beforeById.get(id);
      if (JSON.stringify(previous) === JSON.stringify(item)) continue;
      if (!previous) {
        fields.push({ field: `definition.${key}.${id}`, before: undefined, after: item });
        continue;
      }
      const previousRecord = previous as Record<string, unknown>;
      const itemRecord = item as Record<string, unknown>;
      for (const property of Object.keys(itemRecord)) {
        if (JSON.stringify(previousRecord[property]) === JSON.stringify(itemRecord[property])) continue;
        fields.push({
          field: `definition.${key}.${id}.${property}`,
          before: previousRecord[property],
          after: itemRecord[property],
        });
      }
      for (const property of Object.keys(previousRecord)) {
        if (property in itemRecord) continue;
        fields.push({
          field: `definition.${key}.${id}.${property}`,
          before: previousRecord[property],
          after: undefined,
        });
      }
    }
    for (const id of beforeById.keys()) {
      if (afterById.has(id)) continue;
      fields.push({ field: `definition.${key}.${id}`, before: beforeById.get(id), after: undefined });
    }
  }
  return { label, fields };
}

export interface UndoResult {
  values: WorldAuthoringDraft;
  /** 因作者已手改而保留的字段数。 */
  kept: number;
  /** 真正回退的字段数。 */
  reverted: number;
}

/**
 * 精确撤销：只回退“当前值仍等于 AI 写入值”的字段。
 * 作者在采纳后手改过的字段、以及新加的实体/来源都保留。
 */
export function revertAppliedChanges(
  current: WorldAuthoringDraft,
  changes: AppliedChanges,
): UndoResult {
  const definition = JSON.parse(JSON.stringify(current.definition)) as WorldDefinition;
  let direction = current.initialBranch.direction;
  let kept = 0;
  let reverted = 0;

  for (const change of changes.fields) {
    if (change.field === 'initialBranch.direction') {
      if (direction !== change.after) {
        kept += 1;
        continue;
      }
      direction = typeof change.before === 'string' ? change.before : '';
      reverted += 1;
      continue;
    }
    if (!change.field.startsWith('definition.')) continue;
    const path = change.field.slice('definition.'.length);
    const segments = path.split('.');
    const isEntity = ['actors', 'locations', 'visualReferences', 'sources'].includes(segments[0]);

    if (isEntity && segments.length >= 2) {
      const key = segments[0] as 'actors' | 'locations' | 'visualReferences' | 'sources';
      const list = (definition[key] ?? []) as Array<{ id: string }>;

      if (segments.length === 2) {
        const id = segments[1];
        const index = list.findIndex((item) => item.id === id);
        const currentItem = index >= 0 ? list[index] : undefined;
        if (JSON.stringify(currentItem) !== JSON.stringify(change.after)) {
          kept += 1;
          continue;
        }
        if (change.before === undefined) list.splice(index, 1);
        else if (index >= 0) list[index] = change.before as { id: string };
        else list.push(change.before as { id: string });
        reverted += 1;
        continue;
      }

      const property = segments[segments.length - 1];
      const id = segments.slice(1, -1).join('.');
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) {
        kept += 1;
        continue;
      }
      const currentItem = list[index] as unknown as Record<string, unknown>;
      if (JSON.stringify(currentItem[property]) !== JSON.stringify(change.after)) {
        kept += 1;
        continue;
      }
      if (change.before === undefined) delete currentItem[property];
      else currentItem[property] = change.before;
      reverted += 1;
      continue;
    }

    if (JSON.stringify(readPath(definition, path)) !== JSON.stringify(change.after)) {
      kept += 1;
      continue;
    }
    writePath(definition, path, change.before);
    reverted += 1;
  }

  return {
    values: { definition, initialBranch: { ...current.initialBranch, direction } },
    kept,
    reverted,
  };
}

export function branchHref(worldId: string, branchId: string): string {
  return `/apps/story-worlds?world=${encodeURIComponent(worldId)}&branch=${encodeURIComponent(branchId)}`;
}

/** 创建成功后把新世界并入列表缓存，避免工作台仍选中旧世界。 */
export function insertCreatedWorld<T extends { items: StoryWorld[] }>(
  list: T | undefined,
  world: StoryWorld,
): T | undefined {
  if (!list) return list;
  if (list.items.some((item) => item.id === world.id)) return list;
  return { ...list, items: [world, ...list.items] };
}

export function worldEditHref(worldId: string, branchId?: string): string {
  const suffix = branchId ? `?branch=${encodeURIComponent(branchId)}` : '';
  return `/apps/story-worlds/${encodeURIComponent(worldId)}/edit${suffix}`;
}

export type { WorldAuthoringDraft };
