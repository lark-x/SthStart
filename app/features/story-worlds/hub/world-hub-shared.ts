import type {
  WorldActor,
  WorldDefinition,
  WorldHubDocSummary,
  WorldLocation,
  WorldStoryLine,
} from '@sthstart/contracts';

export const WORK_NATURE_LABELS = {
  canon: '原作',
  derivative: '同人',
  original: '原创',
} as const;

export const ARC_KIND_LABELS = {
  'canon-chapter': '正史章节',
  main: '主线',
  quest: '任务线',
  companion: '同行篇',
  side: '支线',
} as const;

export const ARC_STATUS_LABELS = {
  planned: '待展开',
  active: '进行中',
  completed: '已完成',
} as const;

export const ORIGIN_TYPE_LABELS = {
  ip: '原作档案',
  derivative: '衍生档案',
  original: '原创档案',
} as const;

export interface RegionGroup {
  id: string;
  name: string;
  description: string;
  locations: WorldLocation[];
}

export interface FactionGroup {
  id: string;
  name: string;
  description: string;
  alignment: string;
  actors: WorldActor[];
}

export interface ParsedOpenThread {
  id: string;
  title: string;
  triggers: string[];
  detail: string;
}

export function buildAiStudioHref(params: {
  workName?: string | null;
  worldId?: string | null;
  branchId?: string | null;
  projectId?: string | null;
  arcId?: string | null;
  arcTitle?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.workName) query.set('workName', params.workName);
  if (params.worldId) query.set('worldId', params.worldId);
  if (params.branchId) query.set('branchId', params.branchId);
  if (params.projectId) query.set('projectId', params.projectId);
  if (params.arcId) query.set('arcId', params.arcId);
  if (params.arcTitle) query.set('arcTitle', params.arcTitle);
  const qs = query.toString();
  return `/apps/ai-studio${qs ? `?${qs}` : ''}`;
}

export function buildStoryProjectHref(params: {
  projectId: string;
  entryId?: string | null;
  worldId?: string | null;
  branchId?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.entryId) query.set('entry', params.entryId);
  if (params.worldId && params.branchId) {
    query.set('back', `/apps/story-worlds?world=${encodeURIComponent(params.worldId)}&branch=${encodeURIComponent(params.branchId)}&view=plan`);
  }
  const qs = query.toString();
  return `/apps/story/${encodeURIComponent(params.projectId)}${qs ? `?${qs}` : ''}`;
}

export function groupLocationsByRegion(definition: WorldDefinition | null | undefined): RegionGroup[] {
  if (!definition) return [];
  const regionsMeta = new Map(
    (definition.regions ?? []).map((item) => [item.id, item]),
  );
  const groups = new Map<string, RegionGroup>();

  for (const reg of definition.regions ?? []) {
    groups.set(reg.id, {
      id: reg.id,
      name: reg.name,
      description: reg.description ?? '',
      locations: [],
    });
  }

  for (const loc of definition.locations) {
    const key = loc.regionId || loc.region || '_unassigned';
    const meta = loc.regionId ? regionsMeta.get(loc.regionId) : undefined;
    const existing = groups.get(key);
    if (existing) {
      existing.locations.push(loc);
    } else {
      groups.set(key, {
        id: key,
        name: loc.region || meta?.name || '常规舞台',
        description: meta?.description ?? '',
        locations: [loc],
      });
    }
  }

  return [...groups.values()].filter((group) => group.locations.length > 0);
}

export function groupActorsByFaction(definition: WorldDefinition | null | undefined): FactionGroup[] {
  if (!definition) return [];
  const factionsMeta = new Map(
    (definition.factions ?? []).map((item) => [item.id, item]),
  );
  const groups = new Map<string, FactionGroup>();

  for (const fac of definition.factions ?? []) {
    groups.set(fac.id, {
      id: fac.id,
      name: fac.name,
      description: fac.description ?? '',
      alignment: fac.alignment ?? '',
      actors: [],
    });
  }

  for (const actor of definition.actors) {
    const key = actor.factionId || actor.faction || '_unassigned';
    const meta = actor.factionId ? factionsMeta.get(actor.factionId) : undefined;
    const existing = groups.get(key);
    if (existing) {
      existing.actors.push(actor);
    } else {
      groups.set(key, {
        id: key,
        name: actor.faction || meta?.name || '核心阵容',
        description: meta?.description ?? '',
        alignment: meta?.alignment ?? '',
        actors: [actor],
      });
    }
  }

  return [...groups.values()].filter((group) => group.actors.length > 0);
}

export function parseOpenThreadsFromDocs(worldDocs: WorldHubDocSummary[]): ParsedOpenThread[] {
  const threadDoc = worldDocs.find((doc) => doc.title.includes('开放伏笔'))
    ?? worldDocs.find((doc) => doc.body.includes('【触发词'));
  if (!threadDoc) return [];

  const sections = threadDoc.body.split(/^##\s+/m).slice(1);
  return sections
    .map((section, index): ParsedOpenThread | null => {
      const lines = section.split(/\r?\n/);
      const rawTitle = lines[0]?.replace(/^\d+\.\s*/, '').trim() ?? '';
      if (!rawTitle) return null;
      const match = rawTitle.match(/【触发词[：:]\s*([^】]+)】/);
      const triggers = match
        ? match[1].split(/[，,、]/).map((token) => token.trim()).filter(Boolean)
        : [];
      const title = rawTitle.replace(/【触发词[：:][^】]+】/, '').trim();
      const detail = lines.slice(1).join('\n').trim();
      return {
        id: `thread-${index}`,
        title: title || rawTitle,
        triggers,
        detail,
      };
    })
    .filter((item): item is ParsedOpenThread => Boolean(item));
}

export function arcMatchesThread(arc: WorldStoryLine, thread: ParsedOpenThread, actorNames: string[]): boolean {
  if (thread.triggers.length === 0) return false;
  const haystack = `${arc.title} ${arc.description} ${arc.timeWindowLabel ?? ''} ${actorNames.join(' ')}`.toLowerCase();
  return thread.triggers.some((trigger) => haystack.includes(trigger.toLowerCase()));
}

export function splitStoryLines(storyLines: WorldStoryLine[]): {
  canonChapters: WorldStoryLine[];
  customArcs: WorldStoryLine[];
} {
  const ordered = [...storyLines].sort(
    (left, right) => (left.orderIndex ?? 9999) - (right.orderIndex ?? 9999),
  );
  return {
    canonChapters: ordered.filter((line) => line.arcKind === 'canon-chapter'),
    customArcs: ordered.filter((line) => line.arcKind !== 'canon-chapter'),
  };
}
