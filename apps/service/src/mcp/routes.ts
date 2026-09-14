import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { McpSourceSave } from '@sthstart/contracts';
import { AKASHA_MCP_PRESET_ID, AKASHA_MCP_TOOLS } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { McpSourceStore } from './store.js';
import { McpClient } from './client.js';
import type { NarrativeSourceConnector } from '../narrative-types.js';
import type { AkashaMcpConnector } from '../narrative-connectors.js';

export interface McpServiceOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  secrets: SecretStore;
  fetcher?: typeof fetch;
  narrativeConnectors?: readonly NarrativeSourceConnector[];
}

function errorResponse(reply: FastifyReply, error: unknown) {
  const status = (error as { statusCode?: number }).statusCode || 400;
  const code = (error as { code?: string }).code || 'mcp_source_failed';
  return reply.code(status).send({ error: code, message: (error as Error).message });
}

function checkAdmin(config: ServiceConfig, request: FastifyRequest, reply: FastifyReply): boolean {
  if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
    reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
    return false;
  }
  return true;
}

/**
 * 虚空终端既有适配器兼容路径：环境变量 STHSTART_AKASHA_MCP_URL / KEY 仍然有效。
 * 注册一个只读的“虚空终端”资料源，研究任务可直接引用。
 */
export function registerAkashaPresetSource(options: McpServiceOptions) {
  const { config, database, secrets } = options;
  const store = new McpSourceStore(database, secrets);
  if (!config.akashaMcpUrl) return;
  const existing = store.get(AKASHA_MCP_PRESET_ID);
  if (existing) return;
  const account = 'mcp-source:' + AKASHA_MCP_PRESET_ID;
  const now = new Date().toISOString();
  try {
    database.connection.prepare('INSERT INTO mcp_sources '
      + '(id,name,url,auth_mode,auth_header_name,credential_account,applicable_works_json,universal,purpose,allowed_tools_json,discovered_tools_json,timeout_ms,status,last_test_json,created_at,updated_at) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(
        AKASHA_MCP_PRESET_ID, '虚空终端 Story MCP', config.akashaMcpUrl,
        config.akashaMcpKey ? 'bearer' : 'none', null, account,
        JSON.stringify(['gi', 'hsr', 'bh3']), 0,
        '剧情原文检索与角色/地点资料（虚空终端预设）',
        JSON.stringify([...AKASHA_MCP_TOOLS]), '[]',
        config.mcpTimeoutMs || 45_000, 'enabled', null, now, now,
      );
    if (config.akashaMcpKey) {
      void secrets.set(account, config.akashaMcpKey).catch(() => undefined);
    }
  } catch {
    // 预设注册失败不阻塞启动；用户仍可在设置页手动配置。
  }
}

/** 虚空终端预设在研究执行中的兼容适配：复用既有适配器的检索与读取结果。 */
export function createAkashaResearchAdapter(options: McpServiceOptions): {
  sourceId: string;
  search: (world: string, keyword: string) => Promise<unknown>;
  read: (world: string, pathHash: string) => Promise<unknown>;
} | null {
  const connector = options.narrativeConnectors?.find(
    (item): item is AkashaMcpConnector => (item as { id?: string }).id === 'akasha-mcp',
  );
  if (!connector) return null;
  return {
    sourceId: AKASHA_MCP_PRESET_ID,
    search: async (world: string, keyword: string) => {
      try {
        return { items: await connector.search(world as 'gi' | 'hsr' | 'bh3', keyword, 10) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    read: async (world: string, pathHash: string) => {
      try {
        const document = await connector.read(world as 'gi' | 'hsr' | 'bh3', pathHash, 1, 500);
        return { document };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export function registerMcpSourceRoutes(app: FastifyInstance, options: McpServiceOptions) {
  const { database, secrets, config, fetcher } = options;
  const store = new McpSourceStore(database, secrets);
  registerAkashaPresetSource(options);

  app.get('/api/v1/admin/mcp-sources', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: store.list() };
  });

  app.post<{ Body: McpSourceSave }>('/api/v1/admin/mcp-sources', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const saved = await store.save(request.body || ({} as McpSourceSave), null);
      return reply.code(201).send(saved);
    } catch (error) { return errorResponse(reply, error); }
  });

  app.put<{ Params: { id: string }; Body: McpSourceSave }>('/api/v1/admin/mcp-sources/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const existing = store.get(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'mcp_source_not_found' });
      const saved = await store.save({ ...request.body, id: request.params.id }, existing);
      return saved;
    } catch (error) { return errorResponse(reply, error); }
  });

  app.patch<{ Params: { id: string }; Body: { status?: 'enabled' | 'disabled' } }>('/api/v1/admin/mcp-sources/:id/status', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const existing = store.get(request.params.id);
    if (!existing) return reply.code(404).send({ error: 'mcp_source_not_found' });
    const status = request.body?.status === 'disabled' ? 'disabled' : 'enabled';
    database.connection.prepare('UPDATE mcp_sources SET status=?,updated_at=? WHERE id=?').run(status, new Date().toISOString(), request.params.id);
    return store.get(request.params.id);
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/mcp-sources/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const removed = await store.delete(request.params.id);
    return removed ? { ok: true } : reply.code(404).send({ error: 'mcp_source_not_found' });
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/mcp-sources/:id/test', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const source = store.get(request.params.id);
    if (!source) return reply.code(404).send({ error: 'mcp_source_not_found' });
    if (source.status === 'disabled') return reply.code(409).send({ error: 'mcp_source_disabled' });
    const secret = await store.getSecret(source);
    const client = new McpClient(source, secret, { timeoutMs: source.timeoutMs, fetcher });
    const result = await client.testConnection();
    await client.close();
    await store.updateTestResult(source.id, result);
    if (result.ok) await store.updateDiscoveredTools(source.id, result.tools);
    return result;
  });

  app.post<{ Body: { sourceId?: string; url?: string; authMode?: McpSourceSave['authMode']; authHeaderName?: string; secret?: string; timeoutMs?: number } }>(
    '/api/v1/admin/mcp-sources/discover',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      const body = request.body || {};
      const url = body.url?.trim();
      if (!url) return reply.code(400).send({ error: 'url_required' });
      try {
        const source = {
          url,
          authMode: body.authMode || 'none',
          authHeaderName: body.authHeaderName || undefined,
        };
        const saved = body.sourceId ? store.get(body.sourceId) : null;
        const sameEndpoint = saved && saved.url === url && saved.authMode === source.authMode && (saved.authHeaderName || '') === (source.authHeaderName || '');
        const secret = body.secret?.trim() || (sameEndpoint ? await store.getSecret(saved) : null);
        const client = new McpClient(source, secret, { timeoutMs: body.timeoutMs || 45_000, fetcher });
        const result = await client.testConnection();
        await client.close();
        return result;
      } catch (error) { return errorResponse(reply, error); }
    },
  );
}

export { McpSourceStore };
