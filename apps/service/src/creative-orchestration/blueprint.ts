import { createHash, randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  StoryBodyPackSchema,
  type CreativeApprovalScopePolicy,
  type CreativeScope,
  type StoryBodyActorSeed,
  type StoryBodyCharacterSeed,
  type StoryBodyImportResult,
  type StoryBodyOpenThread,
  type StoryBodyPack,
  type WorldActor,
  type WorldDefinition,
} from '@sthstart/contracts';
import { upsertCharacterBirthday } from '../characters/birthday.js';
import { toAuthorityDraft } from '../characters/draft.js';
import { upsertCharacterWorkHierarchy } from '../characters/organization.js';
import { publishCharacterSnapshot, syncCharacterSnapshotAfterChange } from '../characters/snapshots.js';
import { readConfig, type ServiceConfig } from '../config.js';
import { nowIso, type ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldAdoptions } from '../story-worlds/adoption.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { readCreativeScopePolicy, saveCreativeScopePolicy } from './policy.js';
import { CreativeStore } from './store.js';

export interface ImportStoryBodyOptions {
  config?: ServiceConfig;
  secrets?: SecretStore;
}

interface ResolvedCharacter {
  id: string;
  version: number;
  displayName: string;
}

function uniqueSlug(database: ServiceDatabase, input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54) || `character-${Date.now()}`;
  let candidate = base;
  let suffix = 2;
  while (database.connection.prepare('SELECT 1 FROM character_profiles WHERE slug=?').get(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

function parseJsonObject<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatOpenThreadsMarkdown(work: string, threads: StoryBodyOpenThread[]): string {
  if (threads.length === 0) return `# ${work} 开放伏笔账本\n\n暂无待揭示伏笔。`;
  return [
    `# ${work} · 开放伏笔与触发词账本`,
    '',
    '> 触发词供创意工作台条件检索（Lorebook-style activation）在对应意象或关键词出现时按需注入上下文，不强行预设正史未定答案。',
    '',
    ...threads.map((thread, index) => `## ${index + 1}. ${thread.title}\n\n${thread.detail}`),
  ].join('\n');
}

function formatSourcesMarkdown(work: string, definition: WorldDefinition): string {
  return [
    `# ${work} · 正式事实与设定来源`,
    '',
    '## 锁定硬约束（Locked Facts）',
    ...definition.lockedFacts.map((fact) => `- ${fact}`),
    '',
    '## 参考来源（Sources）',
    ...definition.sources.map((src) => [
      `### ${src.title} [${src.nature}]`,
      src.sourceUrl ? `- 来源：${src.sourceUrl}${src.sourceVersion ? ` (${src.sourceVersion})` : ''}` : '',
      '',
      src.content,
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

function upsertCharacter(
  database: ServiceDatabase,
  seed: StoryBodyCharacterSeed,
): { resolved: ResolvedCharacter; created: boolean } {
  const now = nowIso();
  const draft = toAuthorityDraft({
    displayName: seed.displayName,
    englishName: seed.englishName ?? '',
    aliases: seed.aliases ?? [],
    originType: seed.originType,
    work: seed.work,
    summary: seed.summary,
    personaText: seed.personaText,
    speechText: seed.speechText ?? '',
    dialogueExamples: seed.dialogueExamples ?? [],
    behaviorRules: seed.behaviorRules ?? '',
    appearance: seed.appearance,
    ...(seed.birthday ? { birthday: seed.birthday } : {}),
  });

  const existingRows = database.connection.prepare(
    'SELECT id, draft_json, latest_version FROM character_profiles WHERE display_name=? AND archived=0',
  ).all(draft.displayName) as Array<{ id: string; draft_json: string; latest_version: number | null }>;

  const matched = existingRows.find((row) => {
    const prev = parseJsonObject<Record<string, unknown>>(row.draft_json, {});
    return !prev.work || prev.work === seed.work;
  }) ?? existingRows[0];

  const tags = seed.tags ?? [seed.work];

  if (matched) {
    database.transaction(() => {
      database.connection.prepare(
        'UPDATE character_profiles SET display_name=?, draft_json=?, tags_json=?, draft_revision=draft_revision+1, updated_at=? WHERE id=?',
      ).run(draft.displayName, JSON.stringify(draft), JSON.stringify(tags), now, matched.id);
      upsertCharacterBirthday(database, matched.id, draft);
    });
    const synced = syncCharacterSnapshotAfterChange(database, matched.id);
    const versionNumber = synced?.version
      ?? (matched.latest_version != null
        ? Number(matched.latest_version)
        : (publishCharacterSnapshot(database, matched.id, { allowIncomplete: true })?.version ?? 1));
    return {
      resolved: { id: matched.id, version: versionNumber, displayName: draft.displayName },
      created: false,
    };
  }

  const id = randomUUID();
  const slug = uniqueSlug(database, seed.idHint || seed.englishName || seed.displayName);
  database.transaction(() => {
    database.connection.prepare(`INSERT INTO character_profiles
      (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision,variants_json,parent_character_id)
      VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1,?,NULL)`).run(
      id, slug, draft.displayName, JSON.stringify(draft), JSON.stringify(tags), now, now, JSON.stringify([]),
    );
    upsertCharacterBirthday(database, id, draft);
  });
  const version = syncCharacterSnapshotAfterChange(database, id)
    ?? publishCharacterSnapshot(database, id, { allowIncomplete: true });
  return {
    resolved: { id, version: version?.version ?? 1, displayName: draft.displayName },
    created: true,
  };
}

function normalizeActorRole(role: StoryBodyActorSeed['role']): WorldActor['role'] {
  if (role === 'main' || role === 'companion') return 'main';
  return 'supporting';
}

function resolveActors(
  actors: StoryBodyActorSeed[],
  charactersByHint: Map<string, ResolvedCharacter>,
): WorldActor[] {
  return actors.map((actor) => {
    const matched = (actor.characterHint ? charactersByHint.get(actor.characterHint) : undefined)
      ?? charactersByHint.get(actor.name);
    return {
      id: actor.id,
      name: actor.name,
      role: normalizeActorRole(actor.role),
      ...(actor.faction ? { faction: actor.faction } : {}),
      ...(actor.factionId ? { factionId: actor.factionId } : {}),
      ...(actor.regionId !== undefined ? { regionId: actor.regionId } : {}),
      characterId: actor.characterId ?? matched?.id ?? null,
      characterVersion: actor.characterVersion ?? matched?.version ?? null,
      background: actor.background,
      personality: actor.personality,
      speechStyle: actor.speechStyle,
      appearance: actor.appearance,
      goals: [...actor.goals],
      locationId: actor.locationId,
      referenceArtifactIds: [...actor.referenceArtifactIds],
    };
  });
}

function saveScopeStyleAndVoices(
  creativeStore: CreativeStore,
  scope: CreativeScope,
  pack: StoryBodyPack,
): void {
  const existing = readCreativeScopePolicy(creativeStore, scope);
  const policy: CreativeApprovalScopePolicy = {
    schemaVersion: 1,
    enabled: existing.policy.enabled,
    kind: 'ordinary_image',
    allowedSceneArtifactIds: existing.policy.allowedSceneArtifactIds,
    styleGuide: pack.styleGuide,
    characterVoices: pack.characterVoices,
  };
  saveCreativeScopePolicy(creativeStore, {
    scope,
    expectedRevision: existing.revision,
    policy,
  });
}

/** 验证并幂等导入 7 层通用故事主体包（角色库、世界观、分支主线、故事项目、绑定与声纹文风策略）。 */
export function importStoryBodyPack(
  database: ServiceDatabase,
  rawPack: unknown,
  options: ImportStoryBodyOptions = {},
): StoryBodyImportResult {
  if (!Value.Check(StoryBodyPackSchema, rawPack)) {
    const errors = [...Value.Errors(StoryBodyPackSchema, rawPack)]
      .slice(0, 6)
      .map((err) => `${err.path || '/'}: ${err.message}`)
      .join('; ');
    throw new Error(`Invalid StoryBodyPack: ${errors}`);
  }
  const pack = rawPack;

  // 1. 角色库与不可变版本快照（Layer 4a）
  const charactersByHint = new Map<string, ResolvedCharacter>();
  const characterIdsByHint: Record<string, string> = {};
  let charactersCreated = 0;
  let charactersUpdated = 0;

  for (const seed of pack.characters) {
    const { resolved, created } = upsertCharacter(database, seed);
    if (created) charactersCreated += 1;
    else charactersUpdated += 1;

    charactersByHint.set(seed.displayName, resolved);
    if (seed.englishName) charactersByHint.set(seed.englishName, resolved);
    if (seed.idHint) {
      charactersByHint.set(seed.idHint, resolved);
      characterIdsByHint[seed.idHint] = resolved.id;
    } else {
      characterIdsByHint[seed.displayName] = resolved.id;
    }
  }

  // 2. 世界定义 + 在场演员解析 + 开放伏笔来源（Layers 1-4）
  const resolvedActors = resolveActors(pack.worldDefinition.actors, charactersByHint);
  const openThreadsContent = formatOpenThreadsMarkdown(pack.work, pack.openThreads);
  const hasOpenThreadSource = pack.worldDefinition.sources.some((src) => src.id === 'src_open_threads_ledger');
  const sources = hasOpenThreadSource
    ? [...pack.worldDefinition.sources]
    : [
        ...pack.worldDefinition.sources,
        {
          id: 'src_open_threads_ledger',
          title: `${pack.work} 开放伏笔与触发词账本`,
          nature: 'author' as const,
          content: openThreadsContent,
          sourceUrl: '',
          sourceVersion: 'v1',
          capturedAt: nowIso(),
        },
      ];

  const definition: WorldDefinition = {
    title: pack.worldDefinition.title,
    summary: pack.worldDefinition.summary,
    timeLabel: pack.worldDefinition.timeLabel,
    workNature: pack.worldDefinition.workNature,
    parentWork: pack.worldDefinition.parentWork,
    ...(pack.worldDefinition.narrativeMode ? { narrativeMode: pack.worldDefinition.narrativeMode } : {}),
    ...(pack.worldDefinition.regions ? { regions: pack.worldDefinition.regions } : {}),
    ...(pack.worldDefinition.factions ? { factions: pack.worldDefinition.factions } : {}),
    ...(pack.worldDefinition.startMinuteOfDay !== undefined
      ? { startMinuteOfDay: pack.worldDefinition.startMinuteOfDay }
      : {}),
    locations: pack.worldDefinition.locations,
    visualReferences: pack.worldDefinition.visualReferences,
    actors: resolvedActors,
    sources,
    lockedFacts: pack.worldDefinition.lockedFacts,
    models: pack.worldDefinition.models,
    visualStyle: pack.worldDefinition.visualStyle,
  };

  // 3. 故事世界与初始分支创建/完成（Layers 1-5）
  const worldStore = new StoryWorldStore(database);
  let worldId: string;
  let branchId: string;
  let setupCompleted = false;
  let syncExistingWorld = false;

  if (pack.setupId) {
    const setupRow = database.connection.prepare(
      'SELECT id, revision, completed_branch_id FROM sw_world_setups WHERE id=?',
    ).get(pack.setupId) as { id: string; revision: number; completed_branch_id: string | null } | undefined;

    if (setupRow && !setupRow.completed_branch_id) {
      const result = worldStore.saveSetup(pack.setupId, {
        expectedRevision: Number(setupRow.revision),
        draft: { definition, initialBranch: pack.initialBranch },
        complete: true,
      });
      if (result.status !== 'ready') {
        throw new Error(`Failed to complete setup ${pack.setupId}`);
      }
      worldId = result.world.id;
      branchId = result.branch.id;
      setupCompleted = true;
    } else if (setupRow?.completed_branch_id) {
      worldId = pack.setupId;
      branchId = setupRow.completed_branch_id;
      syncExistingWorld = true;
    } else {
      const existingWorld = worldStore.list().items.find((item) => item.title === definition.title);
      if (existingWorld) {
        const overview = worldStore.overview(existingWorld.id);
        worldId = existingWorld.id;
        branchId = overview.branches[0]?.id ?? '';
        syncExistingWorld = true;
      } else {
        const idempotencyKey = `blueprint-${createHash('sha256').update(`${pack.work}:${definition.title}`).digest('hex').slice(0, 24)}`;
        const bundle = worldStore.createBundle({ idempotencyKey, definition, initialBranch: pack.initialBranch });
        worldId = bundle.world.id;
        branchId = bundle.branch.id;
      }
    }
  } else {
    const existingWorld = worldStore.list().items.find((item) => item.title === definition.title);
    if (existingWorld) {
      const overview = worldStore.overview(existingWorld.id);
      worldId = existingWorld.id;
      branchId = overview.branches[0]?.id ?? '';
      syncExistingWorld = true;
    } else {
      const idempotencyKey = `blueprint-${createHash('sha256').update(`${pack.work}:${definition.title}`).digest('hex').slice(0, 24)}`;
      const bundle = worldStore.createBundle({ idempotencyKey, definition, initialBranch: pack.initialBranch });
      worldId = bundle.world.id;
      branchId = bundle.branch.id;
    }
  }

  if (syncExistingWorld && branchId) {
    const currentWorld = worldStore.overview(worldId).world;
    worldStore.updateWorld(worldId, { expectedRevision: currentWorld.revision, definition });
    const activeRun = database.connection.prepare(
      "SELECT 1 FROM sw_runs WHERE branch_id=? AND status IN ('queued','running','paused','uncertain') LIMIT 1",
    ).get(branchId);
    if (!activeRun) {
      const currentBranch = worldStore.getBranch(worldId, branchId);
      worldStore.updateDefinitionAtCurrentTick(worldId, branchId, currentBranch.revision, definition);
    }
  }

  // 确保作品目录关联到新建或已更新的 worldId
  const workRecord = upsertCharacterWorkHierarchy(database, {
    name: pack.work,
    workNature: definition.workNature,
    parentWork: definition.parentWork,
    worldId,
    summary: definition.summary,
  }, { syncWorldDefinition: false });

  // 4. 分支故事线/篇章注入与增量同步（Layer 2 & 5）
  const existingLineRows = database.connection.prepare(
    'SELECT id, data_json FROM sw_story_lines WHERE branch_id=?',
  ).all(branchId) as Array<{ id: string; data_json: string }>;
  const existingLinesByTitle = new Map<string, { id: string; data: Record<string, unknown> }>();
  for (const row of existingLineRows) {
    const parsed = parseJsonObject<Record<string, unknown>>(row.data_json, {});
    if (typeof parsed.title === 'string' && parsed.title) {
      existingLinesByTitle.set(parsed.title, { id: row.id, data: parsed });
    }
  }
  let storyLinesCreated = 0;
  for (const line of pack.storyLines) {
    const existingLine = existingLinesByTitle.get(line.title);
    if (existingLine) {
      const merged = {
        ...existingLine.data,
        description: line.description,
        actorIds: line.actorIds,
        ...(line.arcKind ? { arcKind: line.arcKind } : {}),
        ...(line.chapterCode !== undefined ? { chapterCode: line.chapterCode } : {}),
        ...(line.mcpQueryHint !== undefined ? { mcpQueryHint: line.mcpQueryHint } : {}),
        ...(line.timeWindowLabel !== undefined ? { timeWindowLabel: line.timeWindowLabel } : {}),
        ...(line.regionIds ? { regionIds: line.regionIds } : {}),
        ...(line.locationIds ? { locationIds: line.locationIds } : {}),
        ...(line.status ? { status: line.status } : {}),
        ...(line.orderIndex !== undefined ? { orderIndex: line.orderIndex } : {}),
      };
      database.connection.prepare(
        'UPDATE sw_story_lines SET data_json=? WHERE branch_id=? AND id=?',
      ).run(JSON.stringify(merged), branchId, existingLine.id);
      continue;
    }
    const branch = worldStore.getBranch(worldId, branchId);
    worldStore.addStoryLine(worldId, branchId, {
      expectedRevision: branch.revision,
      title: line.title,
      description: line.description,
      actorIds: line.actorIds,
      ...(line.arcKind ? { arcKind: line.arcKind } : {}),
      ...(line.chapterCode !== undefined ? { chapterCode: line.chapterCode } : {}),
      ...(line.mcpQueryHint !== undefined ? { mcpQueryHint: line.mcpQueryHint } : {}),
      ...(line.timeWindowLabel !== undefined ? { timeWindowLabel: line.timeWindowLabel } : {}),
      ...(line.regionIds ? { regionIds: line.regionIds } : {}),
      ...(line.locationIds ? { locationIds: line.locationIds } : {}),
      ...(line.status ? { status: line.status } : {}),
      ...(line.orderIndex !== undefined ? { orderIndex: line.orderIndex } : {}),
    });
    existingLinesByTitle.set(line.title, { id: line.id ?? line.title, data: {} });
    storyLinesCreated += 1;
  }

  // 5. 写作项目、核心大纲、伏笔账本、绑定世界分支（Layers 6 & 7）
  const storyStore = new StoryStore(database);
  const existingProject = storyStore.listProjects().find((project) => project.title === pack.storyProject.title);
  const project = existingProject ?? storyStore.createProject({
    title: pack.storyProject.title,
    summary: pack.storyProject.summary,
    workId: workRecord.name,
    projectType: 'fiction',
  });

  const docs = storyStore.listDocuments(project.id);
  const outlineDoc = docs.find((doc) => doc.kind === 'outline');
  if (outlineDoc && outlineDoc.body !== pack.storyProject.outlineBody) {
    storyStore.updateDocument(project.id, outlineDoc.id, {
      title: pack.storyProject.outlineTitle,
      body: pack.storyProject.outlineBody,
      expectedRevision: outlineDoc.revision,
    });
  } else if (!outlineDoc) {
    storyStore.createDocument(project.id, {
      kind: 'outline',
      title: pack.storyProject.outlineTitle,
      body: pack.storyProject.outlineBody,
    });
  }

  const worldDocSpecs = [
    { title: `${pack.work} · 开放伏笔与触发词账本`, body: openThreadsContent },
    { title: `${pack.work} · 世界设定与硬约束`, body: formatSourcesMarkdown(pack.work, definition) },
  ];
  for (const spec of worldDocSpecs) {
    const existingDoc = docs.find((doc) => doc.kind === 'world' && doc.title === spec.title);
    if (!existingDoc) {
      storyStore.createDocument(project.id, { kind: 'world', title: spec.title, body: spec.body });
    } else if (existingDoc.body !== spec.body) {
      storyStore.updateDocument(project.id, existingDoc.id, {
        title: spec.title,
        body: spec.body,
        expectedRevision: existingDoc.revision,
      });
    }
  }

  const projectChars = storyStore.listCharacters(project.id);
  const linkedSourceIds = new Set(projectChars.map((item) => item.sourceCharacterId).filter(Boolean));
  for (const seed of pack.characters) {
    const resolved = charactersByHint.get(seed.displayName);
    if (!resolved || linkedSourceIds.has(resolved.id)) continue;
    storyStore.createCharacter(project.id, {
      name: seed.displayName,
      notes: seed.summary,
      sourceCharacterId: resolved.id,
      sourceVersion: resolved.version,
    });
    linkedSourceIds.add(resolved.id);
  }

  // 绑定 StoryProject 到当前故事世界分支
  const adoptions = new StoryWorldAdoptions({
    database,
    config: options.config ?? readConfig(),
    secrets: options.secrets ?? new SecretStore(),
    store: worldStore,
  });
  const currentBinding = database.connection.prepare(
    'SELECT world_id, branch_id FROM sw_project_bindings WHERE project_id=?',
  ).get(project.id) as { world_id: string; branch_id: string } | undefined;
  if (!currentBinding || currentBinding.world_id !== worldId || currentBinding.branch_id !== branchId) {
    const branch = worldStore.getBranch(worldId, branchId);
    adoptions.bindProject(project.id, worldId, branchId, branch.revision);
  }

  // 6. 写入创意工作台作用域策略（styleGuide + characterVoices）
  const creativeStore = new CreativeStore(database);
  const scopes: CreativeScope[] = [
    { workName: pack.work, worldId, branchId, projectId: null },
    { workName: pack.work, worldId, branchId, projectId: project.id },
    { workName: pack.work, worldId: null, branchId: null, projectId: project.id },
  ];
  for (const scope of scopes) {
    saveScopeStyleAndVoices(creativeStore, scope, pack);
  }

  return {
    work: pack.work,
    worldId,
    branchId,
    projectId: project.id,
    setupCompleted,
    charactersCreated,
    charactersUpdated,
    storyLinesCreated,
    characterIdsByHint,
  };
}
