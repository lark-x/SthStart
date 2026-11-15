import { ApiClientError } from '@/app/lib/api-client';
import {
  DEFAULT_WORLD_RUN_SETTINGS,
  toCharacterRuntime,
} from '@sthstart/contracts';
import type {
  AppLlmAssignment,
  CharacterProfile,
  CharacterVersion,
  CreativeNote,
  KnowledgePendingItem,
  NarrativeReading,
  NarrativeStoryNode,
  NarrativeWork,
  PurposeBinding,
  ProviderProfile,
  WorldActor,
  WorldBranch,
  WorldDefinition,
  WorldEvent,
  WorldEventPage,
  WorldImage,
  WorldLocation,
  WorldRun,
  WorldRunSettings,
  WorldSource,
} from '@sthstart/contracts';

export const BRANCH_MODE_META = {
  'canon-gap': {
    label: '原作留白',
    short: '留白',
    description: '沿用原作已给出的约束，只补写原作没有交代的空白。仍属于同人创作。',
  },
  adaptation: {
    label: '原作改编',
    short: '改编',
    description: '允许改变原作走向，但必须保留你设定的禁止改动项。',
  },
  alternate: {
    label: '平行世界',
    short: '平行',
    description: '使用同一批人物与地点，允许世界规则和既定经历不同。',
  },
} as const;

export const SOURCE_NATURE_META = {
  canon: { label: '原作有据', tone: 'online' as const },
  author: { label: '作者设定', tone: 'accent' as const },
  ai: { label: 'AI 创作', tone: 'secondary' as const },
  unverified: { label: '待核实', tone: 'warning' as const },
} as const;

export const RUN_STATUS_META = {
  queued: { label: '排队中', tone: 'warning' as const },
  running: { label: '运行中', tone: 'running' as const },
  paused: { label: '已暂停', tone: 'stopped' as const },
  completed: { label: '已完成', tone: 'online' as const },
  uncertain: { label: '结果不明', tone: 'warning' as const },
  failed: { label: '已失败', tone: 'error' as const },
} as const;

export const INTERVENTION_KIND_META = {
  goal: { label: '增加目标', description: '给指定人物增加未来目标或动机。' },
  constraint: { label: '增加约束', description: '限制人物在接下来一段时间内不能做什么。' },
  'external-event': { label: '外部事件', description: '从外部推入一个会发生的事件或变化。' },
} as const;

export const IMAGE_PHASE_META = {
  establishing: { label: '场景建立' },
  action: { label: '关键行动' },
  result: { label: '结果变化' },
} as const;

export const IMAGE_STATUS_META = {
  planned: { label: '待提交', tone: 'secondary' as const },
  queued: { label: '排队中', tone: 'warning' as const },
  running: { label: '生成中', tone: 'running' as const },
  succeeded: { label: '已完成', tone: 'online' as const },
  failed: { label: '失败', tone: 'error' as const },
  uncertain: { label: '结果不明', tone: 'warning' as const },
  stale: { label: '待重做', tone: 'stopped' as const },
} as const;

export function branchModeLabel(mode: WorldBranch['mode']) {
  return BRANCH_MODE_META[mode].label;
}

export function formatTick(tick: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(tick) ? tick : 0));
  const day = Math.floor(value / 1_440) + 1;
  const minuteOfDay = value % 1_440;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `第 ${day} 天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  if (value < 60) return `${value} 分钟`;
  const days = Math.floor(value / 1_440);
  const hours = Math.floor((value % 1_440) / 60);
  const rest = value % 60;
  return [
    days ? `${days} 天` : '',
    hours ? `${hours} 小时` : '',
    rest ? `${rest} 分钟` : '',
  ].filter(Boolean).join(' ');
}

export function formatWindow(from: number, to: number): string {
  return `${formatTick(from)} – ${formatTick(to)}`;
}

export function formatQuota(used: number, max: number): string {
  return `${Math.max(0, used)} / ${Math.max(0, max)}`;
}

export function quotaPercent(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / max) * 100)));
}

export function defaultWindow(branch?: Pick<WorldBranch, 'currentTick'> | null): { from: number; to: number } {
  if (!branch) return { from: 0, to: 1_440 };
  const current = Math.max(0, branch.currentTick);
  return { from: Math.max(0, current - 1_440), to: Math.max(current, 1_440) };
}

export function createEmptyLocation(index: number): WorldLocation {
  return {
    id: `location-${crypto.randomUUID()}`,
    name: index === 0 ? '主要地点' : `地点 ${index + 1}`,
    description: '',
  };
}

export function createEmptyActor(locationId: string): WorldActor {
  return {
    id: `actor-${crypto.randomUUID()}`,
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
    id: `source-${crypto.randomUUID()}`,
    title: '',
    nature: 'author',
    content: '',
    sourceUrl: '',
    sourceVersion: 'manual',
    capturedAt: new Date().toISOString(),
  };
}

export function actorFromCharacter(profile: CharacterProfile, locationId: string): WorldActor {
  const runtime = toCharacterRuntime(profile.draft);
  const raw = profile.draft as Record<string, unknown>;
  const motivations = Array.isArray(raw.motivations)
    ? raw.motivations.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
    : [];
  return {
    id: `actor-${crypto.randomUUID()}`,
    name: profile.displayName,
    role: 'main',
    characterId: profile.id,
    characterVersion: profile.latestVersion ?? null,
    background: runtime.personaText || runtime.summary,
    personality: runtime.summary,
    speechStyle: runtime.speechText,
    appearance: [runtime.appearance.baseText, runtime.appearance.defaultOutfitText].filter(Boolean).join('\n'),
    goals: motivations,
    locationId,
    referenceArtifactIds: [],
  };
}

/**
 * World actors must copy a published character version, not the editable
 * current draft. Otherwise the stored characterVersion would claim a snapshot
 * whose text is newer than that version.
 */
export function actorFromCharacterVersion(
  profile: CharacterProfile,
  version: CharacterVersion,
  locationId: string,
): WorldActor {
  const runtime = toCharacterRuntime(version.data);
  const raw = version.data as Record<string, unknown>;
  const motivations = Array.isArray(raw.motivations)
    ? raw.motivations.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
    : [];
  return {
    id: `actor-${crypto.randomUUID()}`,
    name: runtime.displayName || profile.displayName,
    role: 'main',
    characterId: profile.id,
    characterVersion: version.version,
    background: runtime.personaText || runtime.summary,
    personality: runtime.summary,
    speechStyle: runtime.speechText,
    appearance: [runtime.appearance.baseText, runtime.appearance.defaultOutfitText].filter(Boolean).join('\n'),
    goals: motivations,
    locationId,
    referenceArtifactIds: [],
  };
}

export function sourceFromKnowledge(item: KnowledgePendingItem): WorldSource {
  return {
    id: `source-${item.id}`,
    title: item.title,
    nature: 'unverified',
    content: item.excerpt || `资料库条目「${item.title}」没有可用的正文摘要。`,
    sourceUrl: item.url ?? '',
    sourceVersion: item.retrievedAt,
    capturedAt: item.retrievedAt,
  };
}

function noteText(note: CreativeNote): string {
  const parts: string[] = [];
  for (const block of note.content) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'image') parts.push(`[图片] ${block.caption || block.src}`);
    else if (block.type === 'link') parts.push(`[链接] ${block.label || block.url} ${block.url}${block.note ? `（${block.note}）` : ''}`);
    else if (block.type === 'character-reference') parts.push(`[角色引用] ${block.characterId}${block.note ? `（${block.note}）` : ''}`);
    else if (block.type === 'archive-reference') parts.push(`[原作片段] ${block.quote}${block.locator ? `（${block.locator}）` : ''}`);
  }
  return parts.map((part) => part.trim()).filter(Boolean).join('\n\n') || note.summary || note.title;
}

const NOTE_NATURE_MAP: Record<string, WorldSource['nature']> = {
  canon: 'canon',
  personal: 'author',
  community: 'unverified',
  unconfirmed: 'unverified',
};

export function sourceFromNote(note: CreativeNote): WorldSource {
  const nature = NOTE_NATURE_MAP[note.knowledge?.nature ?? 'unconfirmed'] ?? 'unverified';
  const content = noteText(note);
  const identity = hashString([
    note.title,
    note.kind,
    note.knowledge?.nature ?? 'unconfirmed',
    content,
  ].join('\u0000'));
  return {
    id: `source-note-${note.id ?? identity}`,
    title: note.title,
    nature,
    content,
    sourceUrl: '',
    sourceVersion: note.revision
      ? `note:${note.id ?? identity}:r${note.revision}`
      : `note:${note.id ?? identity}`,
    capturedAt: note.updatedAt ?? new Date().toISOString(),
  };
}

export function sourceFromNarrative(
  work: NarrativeWork,
  node: NarrativeStoryNode,
  reading: NarrativeReading,
): WorldSource {
  const scenes = reading.scenes.map((scene) => {
    const utterances = scene.utterances
      .map((utterance) => `${utterance.speaker ? `${utterance.speaker}：` : ''}${utterance.text}`)
      .join('\n');
    return [`## ${scene.title}`, scene.summary, utterances].filter(Boolean).join('\n');
  });
  return {
    id: `source-narrative-${node.id}`,
    title: `${work.title} · ${node.title}`,
    nature: 'unverified',
    content: scenes.join('\n\n') || reading.node.summary || node.summary || node.title,
    sourceUrl: '',
    sourceVersion: `narrative:${work.id}:${node.id}`,
    capturedAt: new Date().toISOString(),
  };
}

export function normalizeWorldDefinition(definition: WorldDefinition): WorldDefinition {
  const locations = definition.locations
    .map((location) => ({ ...location, name: location.name.trim(), description: location.description.trim() }))
    .filter((location) => location.name.length > 0);
  const locationIds = new Set(locations.map((location) => location.id));
  const fallbackLocation = locations[0]?.id ?? '';
  const actors = definition.actors
    .map((actor) => ({
      ...actor,
      name: actor.name.trim(),
      personality: actor.personality.trim(),
      background: actor.background.trim(),
      speechStyle: actor.speechStyle.trim(),
      appearance: actor.appearance.trim(),
      goals: actor.goals.map((goal) => goal.trim()).filter(Boolean),
      locationId: locationIds.has(actor.locationId) ? actor.locationId : fallbackLocation,
      referenceArtifactIds: [...new Set(actor.referenceArtifactIds.map((id) => id.trim()).filter(Boolean))],
    }))
    .filter((actor) => actor.name.length > 0);
  const sources = definition.sources
    .map((source) => ({
      ...source,
      title: source.title.trim(),
      content: source.content.trim(),
      sourceUrl: source.sourceUrl.trim(),
      sourceVersion: source.sourceVersion.trim(),
    }))
    .filter((source) => source.title.length > 0);
  return {
    ...definition,
    title: definition.title.trim(),
    summary: definition.summary.trim(),
    timeLabel: definition.timeLabel.trim(),
    visualStyle: definition.visualStyle.trim(),
    locations,
    actors,
    sources,
    lockedFacts: definition.lockedFacts.map((fact) => fact.trim()).filter(Boolean),
  };
}

export function validateWorldDefinition(definition: WorldDefinition): string | null {
  if (!definition.title.trim()) return '世界名称不能为空。';
  if (definition.locations.length === 0) return '至少需要一个地点。';
  if (definition.actors.length === 0) return '至少需要一名人物。';
  const locationIds = new Set<string>();
  for (const location of definition.locations) {
    if (!location.name.trim()) return '每个地点都需要名称。';
    if (locationIds.has(location.id)) return `地点 ID 重复：${location.id}`;
    locationIds.add(location.id);
  }
  for (const actor of definition.actors) {
    if (!actor.name.trim()) return '每个人物都需要名称。';
    if (!locationIds.has(actor.locationId)) return `人物「${actor.name}」还没有有效地点。`;
  }
  for (const source of definition.sources) {
    if (!source.title.trim()) return '每条来源都需要标题；不需要的来源请先删除。';
  }
  return null;
}

export function hashString(input: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}

export function idempotencyKey(prefix: string, payload: unknown): string {
  return `sw-${prefix}-${hashString(JSON.stringify(payload))}`;
}

export function modelLabel(id: string | null | undefined, profiles: ProviderProfile[]): string {
  if (!id) return '未单独绑定，按公共模型配置';
  const profile = profiles.find((item) => item.id === id);
  if (!profile) return `配置缺失（${id}）`;
  if (!profile.enabled) return `已停用 · ${profile.name}`;
  return profile.model ? `${profile.name} · ${profile.model}` : profile.name;
}

export interface ModelProfileOption {
  id: string;
  name: string;
  model: string | null;
  enabled: boolean;
  capabilities: string[];
}

export function modelCatalog(
  providerProfiles: ProviderProfile[],
  modelProfiles: Array<{ id: string; name: string; modelId: string; enabled: boolean; capabilities: string[] }>,
): ModelProfileOption[] {
  const options = new Map<string, ModelProfileOption>();
  for (const profile of providerProfiles) {
    options.set(profile.id, {
      id: profile.id,
      name: profile.name,
      model: profile.model,
      enabled: profile.enabled,
      capabilities: profile.capabilities,
    });
  }
  for (const profile of modelProfiles) {
    options.set(profile.id, {
      id: profile.id,
      name: profile.name,
      model: profile.modelId,
      enabled: profile.enabled,
      capabilities: profile.capabilities,
    });
  }
  return [...options.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export type EffectiveModelSource = 'explicit' | 'purpose' | 'app' | 'missing' | 'unavailable';

export interface EffectiveModel {
  id: string | null;
  label: string;
  source: EffectiveModelSource;
  warning?: string;
}

function resolveCatalogProfile(id: string | null | undefined, catalog: ModelProfileOption[]): { profile?: ModelProfileOption; warning?: string } {
  if (!id) return {};
  const profile = catalog.find((item) => item.id === id);
  if (!profile) return { warning: `模型配置「${id}」不存在，运行会被服务端拒绝。` };
  if (!profile.enabled) return { profile, warning: `模型「${profile.name}」已停用，运行会被服务端拒绝。` };
  return { profile };
}

/**
 * Mirrors the service's resolution order: world binding, purpose binding, app
 * text assignment. The story-worlds app is the runtime owner in all cases.
 */
export function resolveEffectiveModel(
  purpose: keyof WorldDefinition['models'],
  explicitId: string | null,
  input: {
    catalog: ModelProfileOption[];
    purposeBindings: PurposeBinding[];
    assignments: AppLlmAssignment[];
  },
): EffectiveModel {
  if (explicitId) {
    const resolved = resolveCatalogProfile(explicitId, input.catalog);
    return {
      id: explicitId,
      label: resolved.profile ? modelOptionLabel(resolved.profile) : `配置缺失（${explicitId}）`,
      source: resolved.warning ? 'unavailable' : 'explicit',
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    };
  }
  const binding = input.purposeBindings.find((item) => item.appId === 'story-worlds' && item.purposeKey === purpose);
  if (binding && !binding.inheritAppDefault) {
    if (binding.targetType !== 'model') {
      return {
        id: null,
        label: '用途绑定不是模型',
        source: 'unavailable',
        warning: `用途「${purpose}」绑定到了非模型目标，运行会被服务端拒绝。`,
      };
    }
    const resolved = resolveCatalogProfile(binding.targetId, input.catalog);
    return {
      id: binding.targetId,
      label: resolved.profile ? modelOptionLabel(resolved.profile) : `配置缺失（${binding.targetId}）`,
      source: resolved.warning ? 'unavailable' : 'purpose',
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    };
  }
  const assignment = input.assignments.find((item) => item.appId === 'story-worlds');
  if (assignment?.textProfileId) {
    const resolved = resolveCatalogProfile(assignment.textProfileId, input.catalog);
    return {
      id: assignment.textProfileId,
      label: resolved.profile ? modelOptionLabel(resolved.profile) : `配置缺失（${assignment.textProfileId}）`,
      source: resolved.warning ? 'unavailable' : 'app',
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    };
  }
  return {
    id: null,
    label: '没有可用的文本模型',
    source: 'missing',
    warning: '公共模型配置没有为故事世界提供可用文本模型。',
  };
}

export function modelOptionLabel(profile: ModelProfileOption): string {
  return profile.model ? `${profile.name} · ${profile.model}` : profile.name;
}

export interface EngineOption {
  id: string;
  name: string;
  kind: string;
}

export interface WorkflowOption {
  id: string;
  name: string;
  engine_kind?: string;
  latest_version?: number;
  versions?: Array<{ version: number; engineId: string | null }>;
}

export function workflowsForEngine<T extends WorkflowOption>(
  workflows: T[],
  engine: EngineOption | undefined,
): T[] {
  if (!engine) return [];
  return workflows.filter((workflow) =>
    workflow.versions?.some((version) => version.engineId === engine.id)
    || (!workflow.versions?.length && workflow.engine_kind === engine.kind));
}

export function runStatusTone(status: string | undefined | null) {
  if (!status) return 'secondary' as const;
  return RUN_STATUS_META[status as keyof typeof RUN_STATUS_META]?.tone ?? 'secondary';
}

export function runStatusLabel(status: string | undefined | null) {
  if (!status) return '未运行';
  return RUN_STATUS_META[status as keyof typeof RUN_STATUS_META]?.label ?? status;
}

export function imageStatusTone(status: WorldImage['status']) {
  return IMAGE_STATUS_META[status].tone;
}

export function sourceNatureTone(nature: WorldSource['nature']) {
  return SOURCE_NATURE_META[nature].tone;
}

export function runSettingsFromRun(run?: WorldRun | null): WorldRunSettings {
  return run ? { ...run.settings } : { ...DEFAULT_WORLD_RUN_SETTINGS };
}

const IMAGE_POLLING_STATUSES = new Set<WorldImage['status']>(['queued', 'running', 'uncertain']);

/**
 * Branch detail owns both the run and image projections. A completed run must
 * keep refreshing while an image task is still queued/running, or the UI would
 * leave a submitted picture stuck in its last observed state.
 */
export function branchPollInterval(
  runStatus: WorldRun['status'] | null | undefined,
  images: Array<Pick<WorldImage, 'status'>> | null | undefined,
): number | false {
  if (runStatus === 'queued' || runStatus === 'running') return 3_000;
  if (images?.some((image) => IMAGE_POLLING_STATUSES.has(image.status))) return 6_000;
  return false;
}

export function runTargetTick(branch: Pick<WorldBranch, 'currentTick'>, settings: WorldRunSettings) {
  return branch.currentTick + settings.durationTicks;
}

export function resumeTargetTick(run: Pick<WorldRun, 'startTick'>, settings: WorldRunSettings) {
  return run.startTick + settings.durationTicks;
}

/**
 * Resuming may increase budgets or extend the target, but never shrink below
 * work already consumed or pull the target backwards.
 */
export function validateResumeSettings(
  run: Pick<WorldRun, 'textCallsUsed' | 'imagesSubmitted' | 'startTick' | 'targetTick'>,
  settings: WorldRunSettings,
): string | null {
  if (settings.maxTextCalls < run.textCallsUsed) {
    return `文本调用额度不能低于已使用的 ${run.textCallsUsed} 次。`;
  }
  if (settings.maxImages < run.imagesSubmitted) {
    return `配图额度不能低于已提交的 ${run.imagesSubmitted} 幅。`;
  }
  if (run.startTick + settings.durationTicks < run.targetTick) {
    return '目标时刻只能延长，不能缩短到既有目标之前。';
  }
  return null;
}

export function describeError(error: unknown): string {
  if (!error) return '操作失败，未返回具体原因。';
  if (error instanceof ApiClientError) {
    const conflict = error.status === 409 || error.status === 412
      || /conflict|revision/i.test(error.code ?? '');
    const details = error.details?.length ? ` (${error.details.join('；')})` : '';
    const mainMsg = error.message?.trim() || error.code || `HTTP ${error.status}`;
    const prefix = conflict ? '数据版本已更新，请更新修订基底后重试。' : '';
    const full = `${prefix}${prefix && mainMsg ? ' ' : ''}${mainMsg}${details}`.trim();
    return full || '请求未成功，服务端未返回具体错误。';
  }
  if (error instanceof Error) {
    return error.message?.trim() || error.name || '操作失败，请重试。';
  }
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const msg = (typeof obj.message === 'string' && obj.message.trim())
      || (typeof obj.error === 'string' && obj.error.trim())
      || (typeof obj.code === 'string' && obj.code.trim());
    if (msg) return msg;
  }
  if (typeof error === 'string') {
    return error.trim() || '操作失败。';
  }
  const str = String(error).trim();
  return str === '[object Object]' ? '操作失败，请检查网络或服务端状态。' : (str || '操作失败。');
}

export function mergeEventPages(pages: WorldEventPage[] | undefined): WorldEvent[] {
  if (!pages?.length) return [];
  const seen = new Set<string>();
  const items: WorldEvent[] = [];
  for (const page of pages) {
    for (const event of page.items) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      items.push(event);
    }
  }
  return items.sort((left, right) => left.tick - right.tick || left.createdAt.localeCompare(right.createdAt));
}

export function bucketHeights(buckets: WorldEventPage['buckets'] | undefined): number[] {
  if (!buckets?.length) return [];
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return buckets.map((bucket) => Math.max(bucket.count > 0 ? 8 : 2, Math.round((bucket.count / max) * 100)));
}
