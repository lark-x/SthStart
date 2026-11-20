import { AKASHA_MCP_PRESET_ID } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { McpClient, type McpToolResult } from '../mcp/client.js';
import { McpSourceStore } from '../mcp/store.js';
import { AkashaMcpConnector, type AkashaDocument, type AkashaSearchResult } from '../narrative-connectors.js';
import type { SecretStore } from '../security.js';
import { evidenceText, sceneSourceId, type SceneSourceReader } from './text-evidence.js';

interface SourceOptions { database: ServiceDatabase; config: ServiceConfig; secrets: SecretStore; fetcher?: typeof fetch }

const MODERN = ['searchAkasha', 'readSource'];
const LEGACY = ['akasha_search', 'akasha_read'];
const COMPLETE_SOURCE_LIMIT = 60_000;
const LEGACY_PAGE_LINES = 2_000;

function toolPayload(result: McpToolResult): Record<string, unknown> {
  if (!result.ok || result.isError) throw new Error(result.text.slice(0, 500));
  if (result.structuredContent) return result.structuredContent;
  if (result.text.length > 360_000) throw new Error('scene_mcp_payload_too_large');
  const parsed: unknown = JSON.parse(result.text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('scene_mcp_invalid_payload');
  return parsed as Record<string, unknown>;
}

function rows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(payload.results)) throw new Error('scene_mcp_results_missing');
  return payload.results.filter((row) => !!row && typeof row === 'object' && !Array.isArray(row));
}

function legacySearchText(raw: string): AkashaSearchResult[] | null {
  if (!/^\s*\[akasha_search\](?:\r?\n|$)/.test(raw) || raw.length > 360_000) return null;
  const documents = new Map<string, AkashaSearchResult>();
  let document: AkashaSearchResult | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const header = /^\s*-\s+(.+?)\s*\|\s*([^\s|]+)\s*\|\s*(\d+)\s*行(?:\s*\|\s*(.*))?$/i.exec(line);
    if (header) {
      const [, fileName, pathHash, totalLines, metadata] = header;
      const tags = Object.fromEntries((metadata ?? '').split(/\s*\|\s*/).flatMap((part) => {
        const equals = part.indexOf('=');
        return equals > 0 ? [[part.slice(0, equals).trim(), part.slice(equals + 1).trim()]] : [];
      }));
      document = documents.get(pathHash) ?? { fileName, pathHash, totalLines: Number(totalLines), tags, hits: [], sourceTier: 'primary' };
      documents.set(pathHash, document);
      continue;
    }
    const match = /^\s+L(\d+)\s*[:：]\s*(.+)$/i.exec(line);
    if (document && match) document.hits.push({ line: Number(match[1]), snippet: match[2].slice(0, 500) });
    else if (line.trim() && !/^\s/.test(line)) document = undefined;
  }
  return [...documents.values()];
}

function legacyReadText(raw: string, expectedPathHash: string): AkashaDocument | null {
  if (!/^\s*\[akasha_read\](?:\r?\n|$)/.test(raw) || raw.length > 360_000) return null;
  const normalized = raw.replace(/\r\n?/g, '\n');
  const marker = /^正文\s*[:：][ \t]*\n/m.exec(normalized);
  if (!marker) return null;
  const metadata = normalized.slice(0, marker.index);
  const file = /^文件\s*[:：]\s*(.+?)\s*\|\s*([^\s|]+)\s*$/mi.exec(metadata);
  const range = /^范围\s*[:：]\s*(\d+)\s*[-–—]\s*(\d+)\s*\/\s*共\s*(\d+)\s*行\s*$/m.exec(metadata);
  if (!file || file[2] !== expectedPathHash || !range) return null;
  const path = /^(?:文件)?目录\s*[:：=]\s*(.+)$/m.exec(metadata)?.[1].trim();
  const tags: Record<string, string> = path ? { 文件目录: path } : {};
  return {
    pathHash: file[2], fileName: file[1], totalLines: Number(range[3]), tags, lineRange: `${range[1]}-${range[2]}`,
    content: normalized.slice(marker.index + marker[0].length),
    remainingCharacters: Number(/^(?:剩余字符(?:数)?|remainingCharacters)\s*[:：=]\s*(\d+)\s*$/mi.exec(metadata)?.[1] ?? Number.NaN),
  };
}

function structuredLegacyDocument(payload: Record<string, unknown>, expectedPathHash: string): AkashaDocument {
  if (payload.pathHash !== expectedPathHash) throw new Error('scene_mcp_source_identity_changed');
  return {
    pathHash: expectedPathHash, fileName: String(payload.fileName ?? ''), totalLines: Number(payload.totalLines ?? 0),
    tags: payload.tags && typeof payload.tags === 'object' ? payload.tags as Record<string, string> : {},
    content: String(payload.content ?? ''), lineRange: String(payload.lineRange ?? ''),
    remainingCharacters: Number(payload.remainingCharacters ?? Number.NaN),
  };
}

function parseLineRange(value: string) {
  const match = /^(\d+)\s*[-–—]\s*(\d+)(?:\s*\/.*)?$/.exec(value.trim());
  if (!match) throw new Error('scene_mcp_invalid_line_range');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) throw new Error('scene_mcp_invalid_line_range');
  return { start, end };
}

function officialChunk(text: string) {
  // Identify the source from the corpus header and never from a model claim.
  return /^\[(?:角色故事\s*\/\s*Character Story|角色语音\s*\/\s*Voice[- ]?Over|Readable|Quest(?:\s+Dialogue)?|Dialog(?:ue)?|Subtitles?|Item|Codex|Geography|Achievement|Loading Tip)\]/i.test(text.trimStart());
}

function modernReader(client: McpClient, identities: string[]): SceneSourceReader {
  const chunksBySource = new Map<string, { id: number; score: number; cite: string; header: string; recognized: boolean }>();
  const identityWords = identities.map(evidenceText).filter(Boolean);
  const matchesIdentity = (line: string) => identityWords.some((word) => evidenceText(line).includes(word));
  return {
    async search(_world, keyword, maxResults) {
      const payload = toolPayload(await client.callTool('searchAkasha', { query: keyword, topK: maxResults }));
      return rows(payload).slice(0, maxResults).flatMap((row) => {
        if (!Number.isSafeInteger(row.chunkId) || typeof row.cite !== 'string' || !row.cite || typeof row.excerpt !== 'string') return [];
        const lines = row.excerpt.replace(/\r\n?/g, '\n').split('\n');
        const header = lines[0].trim();
        const chunkId = row.chunkId as number;
        const recognized = officialChunk(header);
        const pathHash = sceneSourceId('modern', row.cite, recognized ? header : chunkId);
        const matchingLine = lines.findIndex((line, index) => index > 0 && matchesIdentity(line));
        const score = matchingLine >= 0 ? 2 : matchesIdentity(header) ? 1 : 0;
        if ((chunksBySource.get(pathHash)?.score ?? -1) < score) chunksBySource.set(pathHash, {
          id: chunkId, score, cite: row.cite, header, recognized,
        });
        const tags: Record<string, string> = recognized ? { type: '官方文本', document: header.startsWith('[Readable]') ? '书籍' : /Character Story/i.test(header) ? '角色故事' : '' } : {};
        return [{
          pathHash, fileName: row.cite, totalLines: lines.length,
          hits: matchingLine >= 0 ? [{ line: matchingLine + 1, snippet: lines[matchingLine] }] : [],
          tags,
          sourceTier: 'primary' as const,
        }];
      });
    },
    async read(_world, pathHash, offset, limit) {
      const source = chunksBySource.get(pathHash);
      if (!source) throw new Error('scene_mcp_unknown_chunk');
      const chunkId = source.id;
      const payload = toolPayload(await client.callTool('readSource', { chunkId, scope: 'source', limit: 3 }));
      const row = rows(payload).find((entry) => entry.chunkId === chunkId);
      if (typeof row?.excerpt !== 'string') throw new Error('scene_mcp_chunk_not_returned');
      const lines = row.excerpt.replace(/\r\n?/g, '\n').split('\n');
      const matchingLine = lines.findIndex((line, index) => index > 0 && matchesIdentity(line));
      const start = matchingLine >= 0 ? Math.max(0, matchingLine - 5) : Math.min(offset - 1, lines.length - 1);
      const end = Math.min(lines.length, start + limit);
      const content = lines.slice(start, end).join('\n');
      return {
        pathHash, excerptLocator: `akasha:gi:chunk:${chunkId}`, fileName: typeof row.cite === 'string' ? row.cite : pathHash,
        content, lineRange: `${start + 1}-${end}`, totalLines: lines.length, remainingCharacters: Math.max(0, row.excerpt.length - content.length),
        tags: { type: officialChunk(row.excerpt) ? '官方文本' : '出处待确认' },
      };
    },
    async readRecord(_world, pathHash) {
      const source = chunksBySource.get(pathHash);
      if (!source) throw new Error('scene_mcp_unknown_chunk');
      const parts: string[] = [];
      const seenOffsets = new Set<number>();
      let offset = 0;
      let totalCharacters = 0;
      let complete = false;
      for (let page = 0; page < 1_000; page += 1) {
        const payload = toolPayload(await client.callTool('readSource', { chunkId: source.id, scope: 'source', offset, limit: 3 }));
        const pageRows = rows(payload);
        if (!pageRows.length) throw new Error('scene_mcp_chunk_not_returned');
        const matching = pageRows.filter((row) => {
          if (row.cite !== source.cite || typeof row.excerpt !== 'string') return false;
          if (!source.recognized) return true;
          const header = (row.excerpt as string).replace(/\r\n?/g, '\n').split('\n')[0].trim();
          return !officialChunk(header) || header === source.header;
        });
        if (matching.length !== pageRows.length) throw new Error('scene_mcp_source_identity_changed');
        let truncated = false;
        for (const row of matching) {
          if (typeof row.chunkId !== 'number' || !Number.isSafeInteger(row.chunkId)) throw new Error('scene_mcp_invalid_chunk');
          const excerpt = (row.excerpt as string).replace(/\r\n?/g, '\n');
          const separator = parts.length ? '\n' : '';
          const remaining = COMPLETE_SOURCE_LIMIT - totalCharacters - separator.length;
          const part = excerpt.slice(0, Math.max(0, remaining));
          if (part) {
            parts.push(part);
            totalCharacters += separator.length + part.length;
          }
          if (part.length < excerpt.length) {
            truncated = true;
            break;
          }
        }
        if (!Object.hasOwn(payload, 'nextOffset')) throw new Error('scene_mcp_next_offset_missing');
        const nextOffset = payload.nextOffset;
        if (truncated || totalCharacters >= COMPLETE_SOURCE_LIMIT && nextOffset !== null && nextOffset !== undefined) break;
        if (nextOffset === null || nextOffset === undefined) {
          complete = true;
          break;
        }
        if (typeof nextOffset !== 'number' || !Number.isSafeInteger(nextOffset) || nextOffset <= offset || seenOffsets.has(nextOffset)) throw new Error('scene_mcp_invalid_next_offset');
        seenOffsets.add(nextOffset);
        offset = nextOffset;
      }
      return { text: parts.join('\n'), complete };
    },
    close: () => client.close(),
  };
}

function legacyReader(client: McpClient): SceneSourceReader {
  return {
    async search(world, keyword, maxResults) {
      const result = await client.callTool('akasha_search', { world, keyword, maxResults });
      if (result.ok && !result.isError && !result.structuredContent) {
        const text = legacySearchText(result.text);
        if (text) return text.slice(0, maxResults);
      }
      const payload = toolPayload(result);
      return rows(payload).slice(0, maxResults).flatMap((row) => {
        if (typeof row.pathHash !== 'string') return [];
        const tags = row.tags && typeof row.tags === 'object' ? row.tags as Record<string, string> : {};
        const hits = Array.isArray(row.hits) ? row.hits.filter((hit) => !!hit && Number.isSafeInteger(hit.line)) : [];
        return [{ pathHash: row.pathHash, fileName: String(row.fileName ?? ''), totalLines: Number(row.totalLines ?? 0), tags, hits, sourceTier: 'primary' as const }];
      });
    },
    async read(world, pathHash, offset, limit) {
      const result = await client.callTool('akasha_read', { world, pathHash, offset, limit });
      if (result.ok && !result.isError && !result.structuredContent) {
        const text = legacyReadText(result.text, pathHash);
        if (text) return text;
      }
      const payload = toolPayload(result);
      if (payload.pathHash !== undefined && payload.pathHash !== pathHash) throw new Error('scene_mcp_source_identity_changed');
      return {
        pathHash: String(payload.pathHash ?? pathHash), fileName: String(payload.fileName ?? ''),
        totalLines: Number(payload.totalLines ?? 0), tags: payload.tags && typeof payload.tags === 'object' ? payload.tags as Record<string, string> : {},
        content: String(payload.content ?? ''), lineRange: String(payload.lineRange ?? ''), remainingCharacters: Number(payload.remainingCharacters ?? 0),
      };
    },
    async readRecord(world, pathHash) {
      const parts: string[] = [];
      const seenOffsets = new Set<number>();
      let offset = 1;
      let expectedTotalLines: number | undefined;
      let totalCharacters = 0;
      let complete = false;
      for (let page = 0; page < 1_000; page += 1) {
        const result = await client.callTool('akasha_read', { world, pathHash, offset, limit: LEGACY_PAGE_LINES });
        let document: AkashaDocument | null = null;
        if (result.ok && !result.isError && !result.structuredContent) document = legacyReadText(result.text, pathHash);
        if (!document) document = structuredLegacyDocument(toolPayload(result), pathHash);
        const range = parseLineRange(document.lineRange);
        if (range.start !== offset || !Number.isSafeInteger(document.totalLines) || document.totalLines < range.end
          || (expectedTotalLines !== undefined && document.totalLines !== expectedTotalLines)) throw new Error('scene_mcp_discontinuous_source');
        expectedTotalLines = document.totalLines;
        const separator = parts.length ? '\n' : '';
        const remaining = COMPLETE_SOURCE_LIMIT - totalCharacters - separator.length;
        const part = document.content.slice(0, Math.max(0, remaining));
        if (part) {
          parts.push(part);
          totalCharacters += separator.length + part.length;
        }
        if (part.length < document.content.length) break;
        if (document.remainingCharacters === 0 || range.end >= document.totalLines) {
          complete = true;
          break;
        }
        if (totalCharacters >= COMPLETE_SOURCE_LIMIT) break;
        if (Number.isFinite(document.remainingCharacters) && document.remainingCharacters < 0) {
          throw new Error('scene_mcp_invalid_pagination');
        }
        const nextOffset = range.end + 1;
        if (nextOffset <= offset || seenOffsets.has(nextOffset)) throw new Error('scene_mcp_discontinuous_source');
        seenOffsets.add(nextOffset);
        offset = nextOffset;
      }
      return { text: parts.join('\n'), complete };
    },
    close: () => client.close(),
  };
}

export async function connectSceneReader(options: SourceOptions, world: 'gi' | 'hsr', identities: string[], signal?: AbortSignal, budgetMs = 85_000): Promise<SceneSourceReader | null> {
  const { database, config, secrets } = options;
  const sourceStore = new McpSourceStore(database, secrets);
  const registered = sourceStore.list();
  const preset = registered.find(({ id }) => id === AKASHA_MCP_PRESET_ID);
  const supports = (allowed: string[], expected: string[]) => expected.every((tool) => allowed.includes(tool));
  const compatible = registered.filter((source) => source.id !== AKASHA_MCP_PRESET_ID && source.status === 'enabled'
    && (supports(source.allowedTools, LEGACY) || (world === 'gi' && supports(source.allowedTools, MODERN))));
  const dedicated = compatible.find((source) => source.applicableWorks.includes(world))
    ?? compatible.find((source) => source.universal || source.applicableWorks.length === 0);
  const resolved = dedicated ?? preset;
  if (resolved?.status === 'disabled') return null;
  const endpoint = resolved?.url ?? config.akashaMcpUrl;
  if (!endpoint) return null;

  const secret = (resolved ? await sourceStore.getSecret(resolved) : null) ?? (endpoint === config.akashaMcpUrl ? config.akashaMcpKey : null);
  const underlying = options.fetcher ?? fetch;
  const budget = AbortSignal.timeout(budgetMs);
  const fetcher: typeof fetch = (request, init) => underlying(request, {
    ...init, signal: AbortSignal.any([budget, ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]),
  });
  const timeoutMs = resolved?.timeoutMs ?? config.mcpTimeoutMs ?? 45_000;
  const source = resolved ?? { url: endpoint, authMode: secret ? 'bearer' as const : 'none' as const };
  const client = new McpClient(source, secret, { timeoutMs, fetcher });
  try {
    const tools = (await client.listTools()).map(({ name }) => name);
    const allowed = (names: string[]) => !dedicated || supports(dedicated.allowedTools, names);
    if (world === 'gi' && allowed(MODERN) && supports(tools, MODERN)) return modernReader(client, identities);
    if (allowed(LEGACY) && supports(tools, LEGACY)) return legacyReader(client);
    await client.close();
    return null;
  } catch (error) {
    await client.close();
    if (resolved || signal?.aborted || budget.aborted) throw error;
    // The original environment adapter also supports legacy servers with no MCP session handshake.
    return new AkashaMcpConnector(endpoint, timeoutMs, fetcher, secret);
  }
}
