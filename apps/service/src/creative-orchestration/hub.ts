import { existsSync } from 'node:fs';
import {
  type McpSource,
  type StoryWorld,
  type WorldHub,
  type WorldHubCharacterCard,
  type WorldHubDocSummary,
  type WorldHubLinkedProject,
  type WorldHubMcpSourceSummary,
  type WorldHubRecentRun,
  type WorldHubScopePolicy,
  type WorldMcpLookupItem,
  type WorldMcpLookupRequest,
  type WorldMcpLookupResponse,
  type WorldMcpReadRequest,
  type WorldMcpReadResponse,
} from '@sthstart/contracts';
import { toAuthorityDraft } from '../characters/draft.js';
import type { ServiceDatabase } from '../database.js';
import { McpClient, type McpDiscoveredTool } from '../mcp/client.js';
import { McpSourceStore } from '../mcp/store.js';
import { researchDocuments, researchWorld } from '../mcp/tool-arguments.js';
import { SecretStore } from '../security.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { readCreativeScopePolicy } from './policy.js';
import { CreativeStore } from './store.js';

function resolveCharacterAvatarUrl(database: ServiceDatabase, assetId: unknown): string | null {
  if (!assetId) return null;
  const artifact = database.connection.prepare(
    `SELECT art.local_path, art.file_status
     FROM character_assets a JOIN artifacts art ON art.id=a.artifact_id
     WHERE a.id=?`,
  ).get(String(assetId)) as { local_path: string | null; file_status: string } | undefined;
  return artifact?.file_status === 'ready' && artifact.local_path && existsSync(artifact.local_path)
    ? `/api/admin/characters/assets/${String(assetId)}`
    : null;
}

export function summarizeDoc(doc: {
  id: string;
  kind: WorldHubDocSummary['kind'];
  title: string;
  body: string;
  position: number;
  revision: number;
  updatedAt: string;
}): WorldHubDocSummary {
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    body: doc.body,
    position: doc.position,
    revision: doc.revision,
    updatedAt: doc.updatedAt,
    wordCount: doc.body.replace(/\s+/g, '').length,
  };
}

function loadCharacterCard(database: ServiceDatabase, characterId: string): WorldHubCharacterCard | null {
  const row = database.connection.prepare(
    'SELECT id, display_name, draft_json, tags_json, avatar_asset_id, latest_version FROM character_profiles WHERE id=? AND archived=0',
  ).get(characterId) as {
    id: string;
    display_name: string;
    draft_json: string;
    tags_json: string;
    avatar_asset_id: string | null;
    latest_version: number | null;
  } | undefined;
  if (!row) return null;

  const draft = toAuthorityDraft(JSON.parse(row.draft_json) as Record<string, unknown>);
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags_json) as string[];
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    displayName: row.display_name || draft.displayName,
    englishName: draft.englishName ?? '',
    originType: draft.originType ?? 'original',
    summary: draft.summary ?? '',
    personaText: draft.personaText ?? '',
    speechText: draft.speechText ?? '',
    dialogueExamples: draft.dialogueExamples ?? [],
    behaviorRules: draft.behaviorRules ?? '',
    appearance: {
      baseText: draft.appearance?.baseText ?? '',
      defaultOutfitText: draft.appearance?.defaultOutfitText ?? '',
    },
    tags,
    avatarUrl: resolveCharacterAvatarUrl(database, row.avatar_asset_id),
    latestVersion: row.latest_version,
  };
}

/**
 * 聚合作品主页（Work Overview Hub）所需跨模块读模型：
 * 世界定义/地域/阵营 + 分支详情 + 篇章（StoryLines）+ 绑定写作项目（大纲/章节/伏笔账本）+ 权威角色卡 + 文风声纹策略。
 */
export function getWorldHub(
  database: ServiceDatabase,
  worldId: string,
  requestedBranchId?: string,
): WorldHub {
  const worldStore = new StoryWorldStore(database);
  const overview = worldStore.overview(worldId);
  const activeBranch = (requestedBranchId
    ? overview.branches.find((item) => item.id === requestedBranchId)
    : undefined)
    ?? overview.branches[0]
    ?? null;

  const detail = activeBranch ? worldStore.detail(worldId, activeBranch.id) : null;
  const definition = detail?.definition ?? {
    title: overview.world.title,
    summary: overview.world.summary,
    timeLabel: overview.world.timeLabel,
    workNature: overview.world.workNature,
    parentWork: overview.world.parentWork,
    narrativeMode: overview.world.narrativeMode,
    regions: overview.world.regions,
    factions: overview.world.factions,
    startMinuteOfDay: overview.world.startMinuteOfDay,
    locations: overview.world.locations,
    visualReferences: overview.world.visualReferences,
    actors: overview.world.actors,
    sources: overview.world.sources,
    lockedFacts: overview.world.lockedFacts,
    models: overview.world.models,
    visualStyle: overview.world.visualStyle,
  };

  let eventCount = 0;
  let memoryCount = 0;
  if (activeBranch) {
    const evRow = database.connection.prepare(
      'SELECT COUNT(*) AS cnt FROM sw_events WHERE branch_id=?',
    ).get(activeBranch.id) as { cnt: number };
    eventCount = Number(evRow?.cnt ?? 0);

    const memRow = database.connection.prepare(
      'SELECT COUNT(*) AS cnt FROM sw_memories WHERE branch_id=?',
    ).get(activeBranch.id) as { cnt: number };
    const factRow = database.connection.prepare(
      'SELECT COUNT(*) AS cnt FROM co_memory_facts WHERE branch_id=?',
    ).get(activeBranch.id) as { cnt: number };
    memoryCount = Number(memRow?.cnt ?? 0) + Number(factRow?.cnt ?? 0);
  }

  // 加载绑定的写作项目（大纲、章节与世界设定/伏笔账本）
  const storyStore = new StoryStore(database);
  const bindings = database.connection.prepare(
    'SELECT project_id, branch_id, source_revision FROM sw_project_bindings WHERE world_id=? ORDER BY updated_at DESC',
  ).all(worldId) as Array<{ project_id: string; branch_id: string; source_revision: number }>;

  const seenProjectIds = new Set<string>();
  const linkedProjects: WorldHubLinkedProject[] = [];
  for (const binding of bindings) {
    if (seenProjectIds.has(binding.project_id)) continue;
    seenProjectIds.add(binding.project_id);
    const project = storyStore.getProject(binding.project_id);
    if (!project) continue;
    const docs = storyStore.listDocuments(project.id);
    const outlineDoc = docs.find((doc) => doc.kind === 'outline') ?? null;
    const chapters = docs
      .filter((doc) => doc.kind === 'chapter' || doc.kind === 'scene')
      .map(summarizeDoc);
    const worldDocs = docs.filter((doc) => doc.kind === 'world').map(summarizeDoc);
    linkedProjects.push({
      project: {
        id: project.id,
        title: project.title,
        summary: project.summary,
        workId: project.workId ?? null,
        projectType: project.projectType ?? 'fiction',
        revision: project.revision,
        updatedAt: project.updatedAt,
      },
      bindingRevision: Number(binding.source_revision ?? 0),
      outline: outlineDoc ? summarizeDoc(outlineDoc) : null,
      chapters,
      worldDocs,
    });
  }

  // 加载参演角色对应的权威角色档案卡片
  const characterCards: WorldHubCharacterCard[] = [];
  const seenCharIds = new Set<string>();
  for (const actor of definition.actors) {
    if (!actor.characterId || seenCharIds.has(actor.characterId)) continue;
    seenCharIds.add(actor.characterId);
    const card = loadCharacterCard(database, actor.characterId);
    if (card) characterCards.push(card);
  }

  // 读取创意作用域文风与角色声纹策略（优先分支级，回退作品目录名/项目级/匹配作用域）
  const creativeStore = new CreativeStore(database);
  const primaryProjectId = linkedProjects[0]?.project.id ?? null;
  const workRow = database.connection.prepare(
    'SELECT name FROM character_works WHERE world_id=? LIMIT 1',
  ).get(worldId) as { name: string } | undefined;
  const candidateWorkNames = [...new Set([workRow?.name ?? null, overview.world.title, null])];
  const candidateScopes = [
    ...candidateWorkNames.map((workName) => ({
      workName,
      worldId,
      branchId: activeBranch?.id ?? null,
      projectId: null as string | null,
    })),
    ...(primaryProjectId
      ? candidateWorkNames.flatMap((workName) => [
          { workName, worldId, branchId: activeBranch?.id ?? null, projectId: primaryProjectId },
          { workName, worldId: null as string | null, branchId: null as string | null, projectId: primaryProjectId },
        ])
      : []),
  ];

  let scopePolicy: WorldHubScopePolicy | null = null;
  for (const candidateScope of candidateScopes) {
    const view = readCreativeScopePolicy(creativeStore, candidateScope);
    if (view.revision > 0 || view.policy.styleGuide || view.policy.characterVoices) {
      scopePolicy = {
        revision: view.revision,
        styleGuide: view.policy.styleGuide,
        characterVoices: view.policy.characterVoices,
      };
      break;
    }
  }

  // 最近 AI 创作运行记录
  const runRows = database.connection.prepare(
    'SELECT id, status, instruction, scope_json, created_at, updated_at FROM co_runs ORDER BY updated_at DESC LIMIT 40',
  ).all() as Array<{
    id: string;
    status: string;
    instruction: string;
    scope_json: string;
    created_at: string;
    updated_at: string;
  }>;
  const recentRuns: WorldHubRecentRun[] = [];
  for (const row of runRows) {
    let parsedScope: { worldId?: string | null; branchId?: string | null; projectId?: string | null } = {};
    try {
      parsedScope = JSON.parse(row.scope_json) as typeof parsedScope;
    } catch {
      continue;
    }
    if (parsedScope.worldId !== worldId && !(primaryProjectId && parsedScope.projectId === primaryProjectId)) {
      continue;
    }
    recentRuns.push({
      id: row.id,
      status: row.status,
      instruction: row.instruction,
      branchId: parsedScope.branchId ?? null,
      projectId: parsedScope.projectId ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    if (recentRuns.length >= 10) break;
  }

  const worldCode = researchWorld(overview.world.title);
  const mcpStore = new McpSourceStore(database, new SecretStore());
  const mcpSources: WorldHubMcpSourceSummary[] = mcpStore
    .list()
    .filter((src) => {
      if (src.status !== 'enabled') return false;
      if (src.universal || src.applicableWorks.length === 0) return true;
      return src.applicableWorks.some((item) => {
        const normalized = researchWorld(item);
        return normalized === worldCode || item === overview.world.title;
      });
    })
    .map((src) => ({
      id: src.id,
      name: src.name,
      purpose: src.purpose,
      allowedTools: src.allowedTools,
      discoveredTools: (src.discoveredTools ?? []).map((tool) => tool.name),
      universal: src.universal,
    }));

  const sortedLines = [...(detail?.storyLines ?? [])].sort(
    (left, right) => (left.orderIndex ?? 9999) - (right.orderIndex ?? 9999),
  );

  return {
    world: overview.world,
    branches: overview.branches,
    activeBranch,
    definition,
    storyLines: sortedLines,
    states: detail?.states ?? [],
    images: detail?.images ?? [],
    eventCount,
    memoryCount,
    linkedProjects,
    characterCards,
    scopePolicy,
    recentRuns,
    mcpSources,
  };
}

function buildLookupArgs(
  schema: Record<string, unknown> | undefined,
  query: string,
  worldTitle: string,
): Record<string, unknown> {
  const properties = (schema?.properties || {}) as Record<string, Record<string, unknown>>;
  const args: Record<string, unknown> = {};
  const worldCode = researchWorld(worldTitle);

  for (const [key, spec] of Object.entries(properties)) {
    if (['query', 'keyword', 'q', 'search', 'searchTerm', 'title', 'name', 'text'].includes(key)) {
      args[key] = query;
    } else if (key === 'world' || key === 'game') {
      args[key] = worldCode;
    } else if (['maxResults', 'limit', 'count', 'pageSize'].includes(key)) {
      args[key] = 5;
    } else if (key === 'offset' || key === 'page') {
      args[key] = 1;
    } else if (spec.default !== undefined) {
      args[key] = spec.default;
    }
  }

  // 若工具没有声明 schema 属性，传通用 query 字段
  if (Object.keys(properties).length === 0) {
    args.query = query;
  }
  return args;
}

function extractLookupItems(
  structured: Record<string, unknown> | undefined,
  rawText: string,
): WorldMcpLookupItem[] {
  const docs = researchDocuments(structured, rawText);
  if (docs.length > 0) {
    return docs.slice(0, 8).map((doc) => ({
      title: String(doc.title ?? doc.name ?? doc.id ?? '检索条目').slice(0, 280),
      excerpt: String(doc.excerpt ?? doc.summary ?? doc.description ?? doc.content ?? JSON.stringify(doc)).slice(0, 4000),
      locator: String(doc.url ?? doc.pathHash ?? doc.id ?? doc.documentId ?? '').slice(0, 480) || undefined,
    }));
  }

  let parsed: unknown = structured;
  if (!parsed && rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.slice(0, 8).map((entry, idx) => {
      if (entry && typeof entry === 'object') {
        const rec = entry as Record<string, unknown>;
        return {
          title: String(rec.title ?? rec.name ?? `条目 ${idx + 1}`).slice(0, 280),
          excerpt: String(rec.excerpt ?? rec.summary ?? rec.content ?? rec.description ?? JSON.stringify(rec)).slice(0, 4000),
          locator: rec.url ? String(rec.url).slice(0, 480) : undefined,
        };
      }
      return { title: `条目 ${idx + 1}`, excerpt: String(entry).slice(0, 4000) };
    });
  }

  if (rawText.trim()) {
    const bulletItems: WorldMcpLookupItem[] = [];
    for (const line of rawText.split(/\r?\n/)) {
      const match = line.match(/^\s*-\s+([^|\n]+?)(?:\s*\|\s*([^\s|\n]+))?(?:\s*\|\s*(.+))?$/);
      if (match) {
        const title = match[1].trim().slice(0, 280);
        const locator = match[2]?.trim().slice(0, 480) || undefined;
        const meta = match[3]?.trim() ?? '';
        bulletItems.push({
          title,
          excerpt: meta || title,
          locator,
        });
      } else if (bulletItems.length > 0 && /^\s{2,}L\d+:/.test(line)) {
        const last = bulletItems[bulletItems.length - 1];
        last.excerpt = `${last.excerpt}\n${line.trim()}`.slice(0, 4000);
      }
    }
    if (bulletItems.length > 0) {
      return bulletItems.slice(0, 8);
    }
    return [{
      title: 'MCP 返回摘要',
      excerpt: rawText.trim().slice(0, 4000),
    }];
  }
  return [];
}

async function resolveWorldMcpSource(
  database: ServiceDatabase,
  secrets: SecretStore,
  worldId: string,
  sourceId?: string,
): Promise<{ world: StoryWorld; source: McpSource; secret: string | null }> {
  const worldStore = new StoryWorldStore(database);
  const world = worldStore.overview(worldId).world;
  const worldCode = researchWorld(world.title);
  const mcpStore = new McpSourceStore(database, secrets);
  const enabledSources = mcpStore.list().filter((src) => src.status === 'enabled');

  const source = sourceId
    ? enabledSources.find((src) => src.id === sourceId)
    : (enabledSources.find((src) =>
      src.applicableWorks.some((w) => researchWorld(w) === worldCode || w === world.title),
    ) ?? enabledSources.find((src) => src.universal || src.applicableWorks.length === 0) ?? enabledSources[0]);

  if (!source) {
    throw Object.assign(new Error('没有可用的已启用 MCP 资料源，请先在「系统设置 → 模型与连接」中新增或启用。'), {
      code: 'mcp_source_unavailable',
      statusCode: 404,
    });
  }

  const secret = await mcpStore.getSecret(source);
  return { world, source, secret };
}

function selectMcpTool(
  discovered: McpDiscoveredTool[],
  allowedTools: string[],
  requestedToolName: string | undefined,
  pattern: RegExp,
): McpDiscoveredTool | undefined {
  const allowedSet = allowedTools.length > 0 ? new Set(allowedTools) : null;
  const candidates = allowedSet ? discovered.filter((tool) => allowedSet.has(tool.name)) : discovered;
  const pool = candidates.length > 0 ? candidates : discovered;

  if (requestedToolName) {
    return candidates.find((tool) => tool.name === requestedToolName)
      ?? discovered.find((tool) => tool.name === requestedToolName);
  }
  return candidates.find((tool) => pattern.test(tool.name))
    ?? discovered.find((tool) => pattern.test(tool.name))
    ?? pool[0];
}

async function discoverAndChooseMcpTool(
  client: McpClient,
  source: McpSource,
  requestedToolName: string | undefined,
  pattern: RegExp,
  errorCode: string,
): Promise<McpDiscoveredTool> {
  let discovered: McpDiscoveredTool[];
  try {
    discovered = await client.listTools();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`连接资料源「${source.name}」失败（${detail}）。请检查 MCP 地址与鉴权设置。`), {
      code: errorCode,
      statusCode: 502,
    });
  }
  const chosen = selectMcpTool(discovered, source.allowedTools, requestedToolName, pattern);
  if (!chosen) {
    throw Object.assign(new Error(`资料源「${source.name}」未发现可调用的工具。`), {
      code: 'mcp_tool_unavailable',
      statusCode: 400,
    });
  }
  return chosen;
}

/** 按章节或关键词按需查询已启用的 MCP 资料源（仅按需检索，不将大段原文提前堆进数据库）。 */
export async function lookupWorldChapterViaMcp(
  database: ServiceDatabase,
  secrets: SecretStore,
  worldId: string,
  input: WorldMcpLookupRequest,
  fetcher?: typeof fetch,
): Promise<WorldMcpLookupResponse> {
  const { world, source, secret } = await resolveWorldMcpSource(database, secrets, worldId, input.sourceId);
  const client = new McpClient(source, secret, { timeoutMs: source.timeoutMs, fetcher });
  try {
    const chosen = await discoverAndChooseMcpTool(
      client,
      source,
      input.toolName,
      /(search|find|query|quests|catalog|list)/i,
      'mcp_lookup_failed',
    );
    const searchQuery = input.query.trim() || input.chapterTitle?.trim() || world.title;
    const args = buildLookupArgs(chosen.inputSchema, searchQuery, world.title);
    let result;
    try {
      result = await client.callTool(chosen.name, args);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`调用工具 ${chosen.name} 失败（${detail}）。`), {
        code: 'mcp_lookup_failed',
        statusCode: 502,
      });
    }
    const items = extractLookupItems(result.structuredContent, result.text);

    return {
      sourceId: source.id,
      sourceName: source.name,
      toolUsed: chosen.name,
      items,
      rawText: result.text.slice(0, 12000),
    };
  } finally {
    await client.close();
  }
}

function buildReadArgs(
  schema: Record<string, unknown> | undefined,
  worldTitle: string,
  input: WorldMcpReadRequest,
): Record<string, unknown> {
  const properties = (schema?.properties || {}) as Record<string, Record<string, unknown>>;
  const args: Record<string, unknown> = {};
  const worldCode = researchWorld(worldTitle);
  const hasPathHash = 'pathHash' in properties;
  const hasChunkId = 'chunkId' in properties;

  for (const [key, spec] of Object.entries(properties)) {
    if (key === 'world' || key === 'game') {
      args[key] = worldCode;
    } else if (key === 'pathHash') {
      args[key] = input.locator;
    } else if (key === 'chunkId') {
      args[key] = Number.parseInt(input.locator, 10) || 1;
    } else if (['id', 'documentId', 'uri', 'locator', 'articleId'].includes(key)) {
      args[key] = input.locator;
    } else if (key === 'offset') {
      args[key] = input.offset ?? (hasPathHash ? 1 : 0);
    } else if (key === 'limit') {
      const rawMax = Number(spec?.maximum ?? 200);
      const maxLimit = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 200;
      const defaultLimit = hasChunkId ? 5 : 80;
      args[key] = Math.min(input.limit ?? defaultLimit, maxLimit);
    } else if (spec.default !== undefined) {
      args[key] = spec.default;
    }
  }

  if (Object.keys(properties).length === 0) {
    args.locator = input.locator;
    if (input.offset !== undefined) args.offset = input.offset;
    if (input.limit !== undefined) args.limit = input.limit;
  }

  return args;
}

function parseMcpReadResponse(
  source: McpSource,
  toolUsed: string,
  input: WorldMcpReadRequest,
  structured: Record<string, unknown> | undefined,
  rawText: string,
): WorldMcpReadResponse {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const bodyMarker = normalized.match(/(?:^|\n)正文:(?:\n|$)/);

  let title = input.locator;
  let content = normalized.trim();
  let startOffset = input.offset ?? 0;
  let endOffset = startOffset;
  let totalLines: number | null = null;
  let hasMore = false;

  if (bodyMarker && bodyMarker.index !== undefined) {
    const markerStart = bodyMarker.index;
    const headerPart = normalized.slice(0, markerStart);
    const bodyPart = normalized.slice(markerStart + bodyMarker[0].length);

    const fileMatch = headerPart.match(/^文件:\s*(.+?)(?:\s*\|\s*\S+)?$/m);
    if (fileMatch?.[1]?.trim()) {
      title = fileMatch[1].trim();
    }

    const rangeMatch = headerPart.match(/^范围:\s*(\d+)-(\d+)\s*\/\s*共(\d+)行$/m);
    if (rangeMatch) {
      startOffset = Number.parseInt(rangeMatch[1], 10);
      endOffset = Number.parseInt(rangeMatch[2], 10);
      totalLines = Number.parseInt(rangeMatch[3], 10);
      hasMore = endOffset < totalLines;
    } else {
      const lineCount = bodyPart ? bodyPart.split('\n').length : 0;
      endOffset = startOffset + lineCount;
    }

    content = bodyPart.slice(0, 40_000);
  } else {
    let payload: Record<string, unknown> | undefined = structured;
    if (!payload && normalized.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(normalized.trim()) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = undefined;
      }
    }

    if (payload) {
      const rawTitle = payload.title ?? payload.fileName ?? payload.name;
      if (typeof rawTitle === 'string' && rawTitle.trim()) {
        title = rawTitle.trim();
      }
      const rawContent = payload.content ?? payload.text ?? payload.body;
      if (typeof rawContent === 'string') {
        content = rawContent;
      } else if (rawContent !== undefined) {
        content = JSON.stringify(rawContent, null, 2);
      } else {
        content = normalized.trim() || JSON.stringify(payload, null, 2);
      }

      const rawStart = Number(payload.startOffset ?? payload.offset);
      if (Number.isInteger(rawStart) && rawStart >= 0) {
        startOffset = rawStart;
      }
      const rawTotal = payload.totalLines === null || payload.totalLines === undefined ? null : Number(payload.totalLines);
      if (rawTotal !== null && Number.isInteger(rawTotal) && rawTotal >= 0) {
        totalLines = rawTotal;
      }
      const rawEnd = Number(payload.endOffset);
      if (Number.isInteger(rawEnd) && rawEnd >= 0) {
        endOffset = rawEnd;
      } else {
        const lineCount = content ? content.split('\n').length : 0;
        endOffset = startOffset + lineCount;
      }
      if (typeof payload.hasMore === 'boolean') {
        hasMore = payload.hasMore;
      } else if (totalLines !== null) {
        hasMore = endOffset < totalLines;
      }
    } else {
      const fileMatch = normalized.match(/^文件:\s*(.+?)(?:\s*\|\s*\S+)?$/m);
      if (fileMatch?.[1]?.trim()) {
        title = fileMatch[1].trim();
      }
      const rangeMatch = normalized.match(/^范围:\s*(\d+)-(\d+)\s*\/\s*共(\d+)行$/m);
      if (rangeMatch) {
        startOffset = Number.parseInt(rangeMatch[1], 10);
        endOffset = Number.parseInt(rangeMatch[2], 10);
        totalLines = Number.parseInt(rangeMatch[3], 10);
        hasMore = endOffset < totalLines;
      } else {
        const lineCount = content ? content.split('\n').length : 0;
        endOffset = startOffset + lineCount;
      }
    }
  }

  return {
    sourceId: source.id,
    sourceName: source.name.slice(0, 200),
    toolUsed: toolUsed.slice(0, 120),
    locator: input.locator.slice(0, 500),
    title: title.slice(0, 300),
    content: content.slice(0, 40_000),
    startOffset: Math.max(0, startOffset),
    endOffset: Math.max(0, endOffset),
    totalLines,
    hasMore,
  };
}

/** 按定位符按需分段精读 MCP 原文（例如 akasha_read 分页行读取）。 */
export async function readWorldMcpDocument(
  database: ServiceDatabase,
  secrets: SecretStore,
  worldId: string,
  input: WorldMcpReadRequest,
  fetcher?: typeof fetch,
): Promise<WorldMcpReadResponse> {
  const { world, source, secret } = await resolveWorldMcpSource(database, secrets, worldId, input.sourceId);
  const client = new McpClient(source, secret, { timeoutMs: source.timeoutMs, fetcher });
  try {
    const chosen = await discoverAndChooseMcpTool(
      client,
      source,
      input.toolName,
      /(read|source|doc|get|fetch)/i,
      'mcp_read_failed',
    );
    const args = buildReadArgs(chosen.inputSchema, world.title, input);
    let result;
    try {
      result = await client.callTool(chosen.name, args);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`读取资料「${source.name}」失败（${detail}）。`), {
        code: 'mcp_read_failed',
        statusCode: 502,
      });
    }
    if (!result.ok || result.isError) {
      throw Object.assign(new Error(`调用工具 ${chosen.name} 读取原文失败（${result.text || '工具返回错误'}）。`), {
        code: 'mcp_read_failed',
        statusCode: 502,
      });
    }
    return parseMcpReadResponse(source, chosen.name, input, result.structuredContent, result.text);
  } finally {
    await client.close();
  }
}
