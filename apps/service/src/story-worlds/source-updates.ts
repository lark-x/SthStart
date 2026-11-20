import { isDeepStrictEqual } from 'node:util';
import { STORY_WORLD_METADATA_KEYS } from '@sthstart/contracts';
import type {
  StoryWorld, WorldActor, WorldDefinition, WorldLocation, WorldModelBindings, WorldSource,
} from '@sthstart/contracts';
import {
  type WorldCharacterVersionUpdate,
  type WorldSourceSnapshotNotice,
  type WorldSourceUpdateChange,
  type WorldSourceUpdateCounts,
  type WorldSourceUpdateEntity,
  type WorldSourceUpdateField,
  type WorldSourceUpdateKind,
  type WorldSourceUpdatePreview,
} from '@sthstart/contracts';
import { nowIso } from '../database.js';
import type { StoryWorldStore } from './store.js';

const SOURCE_NATURE_LABELS: Record<WorldSource['nature'], string> = {
  canon: '原作',
  author: '作者设定',
  ai: 'AI 创作',
  unverified: '待核实',
};

function worldDefinitionOf(world: StoryWorld): WorldDefinition {
  const metadata = new Set(STORY_WORLD_METADATA_KEYS);
  return structuredClone(
    Object.fromEntries(Object.entries(world).filter(([key]) => !metadata.has(key))),
  ) as WorldDefinition;
}

function excerpt(value: unknown, maxLength = 600): string {
  if (value === null || value === undefined) return '（无）';
  const text = String(value).replace(/\r\n/g, '\n').trim();
  if (!text) return '（空）';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function listText(value: unknown): string {
  const items = Array.isArray(value) ? value : [];
  return items.length ? items.map(String).join('、') : '（空）';
}

function versionText(value: unknown): string {
  return typeof value === 'number' ? `v${value}` : '（未记录）';
}

function optionalIdText(value: unknown): string {
  return typeof value === 'string' ? value : '（原创人物）';
}

function field(
  name: string,
  label: string,
  before: unknown,
  after: unknown,
  format: (value: unknown) => string = (value) => String(value ?? '（无）'),
): WorldSourceUpdateField | null {
  if (isDeepStrictEqual(before, after)) return null;
  return {
    field: name,
    label,
    before: excerpt(format(before)),
    after: excerpt(format(after)),
  };
}

function compactFields(fields: Array<WorldSourceUpdateField | null>): WorldSourceUpdateField[] {
  return fields.filter((item): item is WorldSourceUpdateField => item !== null);
}

function compareActors(before: WorldActor, after: WorldActor): WorldSourceUpdateField[] {
  return compactFields([
    field('name', '名称', before.name, after.name),
    field('role', '身份', before.role, after.role, (value) => value === 'main' ? '主要人物' : '配角'),
    field('characterId', '角色库 ID', before.characterId, after.characterId, optionalIdText),
    field('characterVersion', '角色库版本', before.characterVersion, after.characterVersion, versionText),
    field('background', '背景', before.background, after.background),
    field('personality', '性格', before.personality, after.personality),
    field('speechStyle', '说话方式', before.speechStyle, after.speechStyle),
    field('appearance', '外观', before.appearance, after.appearance),
    field('goals', '目标', before.goals, after.goals, listText),
    field('locationId', '地点', before.locationId, after.locationId),
    field('referenceArtifactIds', '参考图', before.referenceArtifactIds, after.referenceArtifactIds, listText),
  ]);
}

function compareSources(before: WorldSource, after: WorldSource): WorldSourceUpdateField[] {
  return compactFields([
    field('title', '标题', before.title, after.title),
    field('nature', '资料性质', before.nature, after.nature, (value) => SOURCE_NATURE_LABELS[value as WorldSource['nature']] ?? String(value)),
    field('content', '内容', before.content, after.content),
    field('sourceUrl', '原文链接', before.sourceUrl, after.sourceUrl, (value) => String(value ?? '').trim() || '（没有链接）'),
    field('sourceVersion', '来源版本', before.sourceVersion, after.sourceVersion, (value) => String(value ?? '').trim() || '（未标版本）'),
    field('capturedAt', '采集时间', before.capturedAt, after.capturedAt, (value) => String(value ?? '').trim() || '（未记录）'),
  ]);
}

function compareLocations(before: WorldLocation, after: WorldLocation): WorldSourceUpdateField[] {
  return compactFields([
    field('name', '名称', before.name, after.name),
    field('description', '描述', before.description, after.description),
  ]);
}

function modelBindingsText(value: unknown): string {
  const models = (value && typeof value === 'object' ? value : {}) as Partial<WorldModelBindings>;
  const label = (item: string | null | undefined) => item?.trim() || '未绑定';
  return `行动 ${label(models.action)}；裁定 ${label(models.adjudication)}；叙事 ${label(models.narration)}`;
}

const HANDLED_WORLD_FIELDS = new Set([
  'title', 'summary', 'timeLabel', 'locations', 'actors', 'sources',
  'lockedFacts', 'models', 'visualStyle', 'startMinuteOfDay',
]);

const WORLD_FIELD_LABELS: Record<string, string> = {
  visualReferences: '场景与道具参考',
};

function structuredWorldText(value: unknown): string {
  if (value === null || value === undefined) return '（无）';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function minuteOfDayText(value: unknown): string {
  if (value === undefined || value === null) return '（未定义）';
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1439) {
    return String(value);
  }
  const hour = String(Math.floor(value / 60)).padStart(2, '0');
  const minute = String(value % 60).padStart(2, '0');
  return `${value} 分钟（${hour}:${minute}）`;
}

function compareExtraWorldSettings(before: WorldDefinition, after: WorldDefinition): WorldSourceUpdateField[] {
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  const fields: WorldSourceUpdateField[] = [];
  for (const key of keys) {
    if (HANDLED_WORLD_FIELDS.has(key)) continue;
    const beforeValue = beforeRecord[key];
    const afterValue = afterRecord[key];
    if (isDeepStrictEqual(beforeValue, afterValue)) continue;
    const changed = field(
      key,
      WORLD_FIELD_LABELS[key] ?? key,
      beforeValue,
      afterValue,
      structuredWorldText,
    );
    if (changed) fields.push(changed);
  }
  return fields;
}

function compareWorldSettings(before: WorldDefinition, after: WorldDefinition): WorldSourceUpdateField[] {
  return compactFields([
    field('title', '世界名称', before.title, after.title),
    field('summary', '世界摘要', before.summary, after.summary),
    field('timeLabel', '时间标签', before.timeLabel, after.timeLabel),
    field(
      'startMinuteOfDay',
      '世界起点的日内分钟',
      minuteOfDayText(before.startMinuteOfDay),
      minuteOfDayText(after.startMinuteOfDay),
    ),
    field('lockedFacts', '锁定设定', before.lockedFacts, after.lockedFacts, listText),
    field('models', '模型绑定', modelBindingsText(before.models), modelBindingsText(after.models)),
    field('visualStyle', '视觉风格', before.visualStyle, after.visualStyle),
    ...compareExtraWorldSettings(before, after),
  ]);
}

function changeNote(kind: WorldSourceUpdateKind, change: WorldSourceUpdateChange): string {
  if (change === 'removed' && kind === 'actor') {
    return '世界定义中已移除；纳入时分支独有角色会保留，不会被静默删除。既有事件与记忆不改写。';
  }
  if (change === 'removed' && kind === 'location') {
    return '世界定义中已移除；纳入时分支独有地点会保留，既有事件仍可引用原地点。';
  }
  if (change === 'removed' && kind === 'source') {
    return '纳入后从分支来源列表移除；既有事件、正文和记忆不会改写。';
  }
  if (change === 'modified' && kind === 'source') {
    return '纳入后只更新后续运行使用的来源快照；既有事件不改写。';
  }
  if (change === 'modified' && kind === 'actor') {
    return '纳入后只更新后续运行使用的人物定义；分支当前状态、记忆和既有事件不改写。';
  }
  if (change === 'modified' && kind === 'world') {
    return '纳入后只更新后续运行使用的世界基设；既有事件、正文、记忆和人物状态不改写。';
  }
  return '';
}

function entityName(kind: WorldSourceUpdateKind, value: WorldActor | WorldSource | WorldLocation): string {
  if (kind === 'source') return (value as WorldSource).title || (value as WorldSource).id;
  return (value as WorldActor | WorldLocation).name || value.id;
}

function pushChange(
  target: WorldSourceUpdateEntity[],
  kind: WorldSourceUpdateKind,
  change: WorldSourceUpdateChange,
  value: WorldActor | WorldSource | WorldLocation,
  fields: WorldSourceUpdateField[] = [],
) {
  target.push({
    kind,
    id: value.id,
    name: entityName(kind, value),
    change,
    fields,
    note: changeNote(kind, change),
  });
}

function pushWorldChange(target: WorldSourceUpdateEntity[], fields: WorldSourceUpdateField[]) {
  target.push({
    kind: 'world',
    id: 'world',
    name: '世界设定',
    change: 'modified',
    fields,
    note: changeNote('world', 'modified'),
  });
}

/**
 * Compare the branch snapshot with the latest world definition.
 * This is intentionally pure: a preview must never mutate the world, branch or character library.
 */
export function diffWorldDefinitions(current: WorldDefinition, next: WorldDefinition): WorldSourceUpdateEntity[] {
  const changes: WorldSourceUpdateEntity[] = [];

  const currentActors = new Map(current.actors.map((actor) => [actor.id, actor]));
  const nextActors = new Map(next.actors.map((actor) => [actor.id, actor]));
  for (const actor of next.actors) {
    const before = currentActors.get(actor.id);
    if (!before) pushChange(changes, 'actor', 'added', actor);
    else {
      const fields = compareActors(before, actor);
      if (fields.length) pushChange(changes, 'actor', 'modified', actor, fields);
    }
  }
  for (const actor of current.actors) {
    if (!nextActors.has(actor.id)) pushChange(changes, 'actor', 'removed', actor);
  }

  const currentSources = new Map(current.sources.map((source) => [source.id, source]));
  const nextSources = new Map(next.sources.map((source) => [source.id, source]));
  for (const source of next.sources) {
    const before = currentSources.get(source.id);
    if (!before) pushChange(changes, 'source', 'added', source);
    else {
      const fields = compareSources(before, source);
      if (fields.length) pushChange(changes, 'source', 'modified', source, fields);
    }
  }
  for (const source of current.sources) {
    if (!nextSources.has(source.id)) pushChange(changes, 'source', 'removed', source);
  }

  const currentLocations = new Map(current.locations.map((location) => [location.id, location]));
  const nextLocations = new Map(next.locations.map((location) => [location.id, location]));
  for (const location of next.locations) {
    const before = currentLocations.get(location.id);
    if (!before) pushChange(changes, 'location', 'added', location);
    else {
      const fields = compareLocations(before, location);
      if (fields.length) pushChange(changes, 'location', 'modified', location, fields);
    }
  }
  for (const location of current.locations) {
    if (!nextLocations.has(location.id)) pushChange(changes, 'location', 'removed', location);
  }

  const worldFields = compareWorldSettings(current, next);
  if (worldFields.length) pushWorldChange(changes, worldFields);

  return changes;
}

export function countWorldDefinitionChanges(changes: readonly WorldSourceUpdateEntity[]): WorldSourceUpdateCounts {
  const counts: WorldSourceUpdateCounts = { added: 0, modified: 0, removed: 0 };
  for (const change of changes) counts[change.change] += 1;
  return counts;
}

function stableSourceLink(value: string): boolean {
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sourceSnapshotNotices(sources: readonly WorldSource[]): WorldSourceSnapshotNotice[] {
  return sources
    .filter((source) => !stableSourceLink(source.sourceUrl))
    .map((source) => {
      const version = (source.sourceVersion.trim() || '未标版本').slice(0, 200);
      const capturedAt = (source.capturedAt.trim() || '未记录采集时间').slice(0, 100);
      return {
        sourceId: source.id,
        title: source.title || source.id,
        sourceVersion: version,
        capturedAt,
        reason: 'no-stable-link' as const,
        note: `没有可稳定核对的原文链接；只按本库快照（版本 ${version}，采集于 ${capturedAt}）展示，不能据此确认原文已刷新。`,
      };
    });
}

export class StoryWorldSourceUpdates {
  constructor(readonly store: StoryWorldStore) {}

  private characterVersionUpdates(actors: readonly WorldActor[]): WorldCharacterVersionUpdate[] {
    const statement = this.store.database.connection.prepare(`
      SELECT p.display_name AS character_name,p.latest_version,v.created_at AS published_at
      FROM character_profiles p
      JOIN character_versions v ON v.character_id=p.id AND v.version=p.latest_version
      WHERE p.id=? AND p.archived=0
    `);
    const updates: WorldCharacterVersionUpdate[] = [];
    for (const actor of actors) {
      if (!actor.characterId) continue;
      const row = statement.get(actor.characterId) as Record<string, unknown> | undefined;
      if (!row) continue;
      const latestVersion = Number(row.latest_version);
      if (!Number.isInteger(latestVersion) || latestVersion < 1) continue;
      if ((actor.characterVersion ?? 0) >= latestVersion) continue;
      const fromVersion = actor.characterVersion;
      updates.push({
        actorId: actor.id,
        actorName: actor.name,
        characterId: actor.characterId,
        characterName: String(row.character_name ?? actor.name),
        fromVersion,
        latestVersion,
        publishedAt: row.published_at == null ? null : String(row.published_at),
        canImport: true,
        note: `角色库已发布 v${latestVersion}，世界快照仍是 ${fromVersion === null ? '未记录版本' : `v${fromVersion}`}；可在世界设置中手动核对并更新人物快照，预览不会自动覆盖。`,
      });
    }
    return updates;
  }

  preview(worldId: string, branchId: string): WorldSourceUpdatePreview {
    const world = this.store.getWorld(worldId);
    const branch = this.store.getBranch(worldId, branchId);
    const worldDefinition = worldDefinitionOf(world);
    const branchDefinition = this.store.definition(worldId, branchId);
    const changes = diffWorldDefinitions(branchDefinition, worldDefinition);

    const affectedBranches = this.store.overview(worldId).branches
      .filter((item) => world.revision > item.sourceRevision)
      .map((item) => {
        const snapshot = this.store.definition(worldId, item.id);
        const branchChanges = item.id === branch.id
          ? changes
          : diffWorldDefinitions(snapshot, worldDefinition);
        return {
          branchId: item.id,
          title: item.title,
          mode: item.mode,
          currentTick: item.currentTick,
          sourceRevision: item.sourceRevision,
          isCurrent: item.id === branch.id,
          counts: countWorldDefinitionChanges(branchChanges),
        };
      });

    return {
      worldId,
      branchId,
      worldRevision: world.revision,
      branchRevision: branch.revision,
      branchSourceRevision: branch.sourceRevision,
      currentBranchPending: world.revision > branch.sourceRevision,
      generatedAt: nowIso(),
      counts: countWorldDefinitionChanges(changes),
      changes,
      affectedBranches,
      characterVersionUpdates: this.characterVersionUpdates(worldDefinition.actors),
      sourceSnapshotNotices: sourceSnapshotNotices(worldDefinition.sources),
      historyPreserved: true,
    };
  }
}
