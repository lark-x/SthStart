import { searchWithProvider, extractWithProvider, SearchProviderError } from './providers.js';
import type { WebSearchProvider } from '@sthstart/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  ExtractWebSearchRequestSchema,
  ExtractWebSearchResponseSchema,
  SaveWebSearchSettingsSchema,
  WebSearchRequestSchema,
  WebSearchResponseSchema,
  WebSearchResultSchema,
  WebSearchSettingsSchema,
  WebSearchTestResultSchema,
  SaveWebSearchSourceSchema,
  SaveWebSearchSourceResultSchema,
  type ExtractWebSearchResponse,
  type WebSearchResponse,
  type WebSearchSettings,
  type WebSearchTestResult,
  type SaveWebSearchSourceResult,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import {
  hydrateWebSearchSettings,
  readStoredWebSearchSettings,
  resolveWebSearchCredential,
  type StoredWebSearchSettings,
  writeStoredWebSearchSettings,
} from './settings.js';
import {
  TavilyRequestError,
  WEB_SEARCH_MAX_RESULTS,
} from './tavily.js';
import { isPublicHttpUrl } from './urls.js';
import {
  saveWebSearchSource,
  WebSearchSourceSaveError,
} from './source-save.js';

export interface WebSearchRouteOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  secrets: SecretStore;
  fetcher?: typeof fetch;
}

const RESPONSE_INVALID = {
  error: 'web_search_response_invalid',
  message: '内置搜索生成了不符合契约的响应，已拒绝返回。',
} as const;

function safeMessage(error: unknown) {
  if (error instanceof TavilyRequestError || error instanceof SearchProviderError) return error.message;
  return '搜索请求失败，请稍后重试。';
}

export function registerWebSearchRoutes(app: FastifyInstance, options: WebSearchRouteOptions) {
  const { config, database, secrets, fetcher = fetch } = options;
  const checkAdmin = (request: FastifyRequest, reply: FastifyReply) => {
    if (!authenticateAdmin(config.adminToken, request)) {
      void reply.code(401).send({ error: 'unauthorized', message: '需要管理员凭据。' });
      return false;
    }
    return true;
  };

  const requireEnabled = (reply: FastifyReply, stored: StoredWebSearchSettings) => {
    if (stored.enabled) return true;
    void reply.code(409).send({ error: 'web_search_disabled', message: '联网搜索已停用。' });
    return false;
  };
  const requireContext = async (reply: FastifyReply, stored: StoredWebSearchSettings) => {
    if (!requireEnabled(reply, stored)) return null;
    const { provider, anonymous } = stored;
    if (provider === 'anysearch' && anonymous) return { provider, credential: null, fetcher };
    const credential = await resolveWebSearchCredential(secrets, provider);
    if (credential.value) return { provider, credential: credential.value, fetcher };
    void reply.code(400).send({
      error: 'web_search_credential_missing',
      message: '尚未配置当前搜索服务的 API Key。',
    });
    return null;
  };

  app.get('/api/v1/admin/web-search/settings', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const settings: WebSearchSettings = await hydrateWebSearchSettings(database, secrets);
    if (!Value.Check(WebSearchSettingsSchema, settings)) {
      return reply.code(500).send(RESPONSE_INVALID);
    }
    return reply.code(200).send(settings);
  });

  app.put<{ Body: unknown }>('/api/v1/admin/web-search/settings', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(SaveWebSearchSettingsSchema, request.body)) {
      return reply.code(400).send({
        error: 'invalid_web_search_settings',
        message: '设置必须包含 enabled 布尔值，apiKey 可选。',
      });
    }

    const body = request.body as { enabled: boolean; apiKey?: string; provider?: WebSearchProvider; anonymous?: boolean };
    const stored = readStoredWebSearchSettings(database);
    const provider = body.provider ?? stored.provider;
    const anonymous = provider === 'anysearch' && (body.anonymous ?? (stored.provider === 'anysearch' ? stored.anonymous : true));
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey.length > 1000) {
      return reply.code(400).send({
        error: 'invalid_web_search_credential',
        message: 'API Key 长度超出限制。',
      });
    }

    if (apiKey) {
      try {
        const keyring = await secrets.status();
        if (!keyring.available) throw new Error('credential store unavailable');
        await secrets.set(`web-search-${provider}`, apiKey);
        const saved = await resolveWebSearchCredential(secrets, provider);
        if (saved.source !== 'keyring' || saved.value !== apiKey) {
          return reply.code(503).send({
            error: 'web_search_credential_not_stored',
            message: '新密钥未能写入安全凭据库，未保存设置。',
          });
        }
      } catch {
        return reply.code(503).send({
          error: 'web_search_credential_store_unavailable',
          message: `安全凭据库不可用，未保存设置。可配置 STHSTART_${provider.toUpperCase()}_API_KEY 作为环境变量后备。`,
        });
      }
    }

    writeStoredWebSearchSettings(database, body.enabled, provider, anonymous);
    const settings: WebSearchSettings = await hydrateWebSearchSettings(database, secrets);
    if (!Value.Check(WebSearchSettingsSchema, settings)) {
      return reply.code(500).send(RESPONSE_INVALID);
    }
    return reply.code(200).send(settings);
  });

  app.post('/api/v1/admin/web-search/test', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    const context = await requireContext(reply, readStoredWebSearchSettings(database));
    if (!context) return;
    try {
      await searchWithProvider({
        ...context,
        query: 'SthStart 搜索连接测试',
        maxResults: 1,
      });
      const result: WebSearchTestResult = { ok: true, message: '搜索服务连接成功。' };
      if (!Value.Check(WebSearchTestResultSchema, result)) {
        return reply.code(500).send(RESPONSE_INVALID);
      }
      return reply.code(200).send(result);
    } catch (error) {
      const result: WebSearchTestResult = { ok: false, message: safeMessage(error) };
      if (!Value.Check(WebSearchTestResultSchema, result)) {
        return reply.code(500).send(RESPONSE_INVALID);
      }
      return reply.code(200).send(result);
    }
  });

  app.post<{ Body: unknown }>('/api/v1/admin/web-search/search', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(WebSearchRequestSchema, request.body)) {
      return reply.code(400).send({
        error: 'invalid_web_search_request',
        message: '搜索请求必须包含 query，maxResults 可选。',
      });
    }
    const body = request.body as { query: string; maxResults?: number };
    const query = body.query.trim();
    const maxResults = body.maxResults ?? 5;
    if (!query || query.length > 1000 || !Number.isInteger(maxResults)
      || maxResults < 1 || maxResults > WEB_SEARCH_MAX_RESULTS) {
      return reply.code(400).send({
        error: 'invalid_web_search_request',
        message: `query 不能为空，maxResults 必须为 1–${WEB_SEARCH_MAX_RESULTS} 的整数。`,
      });
    }
    const context = await requireContext(reply, readStoredWebSearchSettings(database));
    if (!context) return;

    try {
      const response: WebSearchResponse = await searchWithProvider({
        ...context,
        query,
        maxResults,
      });
      if (!Value.Check(WebSearchResponseSchema, response)) {
        return reply.code(500).send(RESPONSE_INVALID);
      }
      return reply.code(200).send(response);
    } catch (error) {
      return reply.code(502).send({
        error: 'web_search_failed',
        message: safeMessage(error),
      });
    }
  });

  app.post<{ Body: unknown }>('/api/v1/admin/web-search/extract', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(ExtractWebSearchRequestSchema, request.body)) {
      return reply.code(400).send({
        error: 'invalid_web_search_extract_request',
        message: '提取请求必须包含搜索结果条目。',
      });
    }
    const body = request.body as { items: unknown[] };
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > WEB_SEARCH_MAX_RESULTS) {
      return reply.code(400).send({
        error: 'invalid_web_search_extract_request',
        message: `每次只能提取 1–${WEB_SEARCH_MAX_RESULTS} 个网址。`,
      });
    }
    if (body.items.some((item) => !Value.Check(WebSearchResultSchema, item))) {
      return reply.code(400).send({
        error: 'invalid_web_search_extract_request',
        message: '提取条目必须符合搜索结果结构。',
      });
    }
    const items = body.items as Array<import('@sthstart/contracts').WebSearchResult>;
    const stored = readStoredWebSearchSettings(database);
    if (items.some(item => (item.provider ?? 'tavily') !== stored.provider)) return reply.code(409).send({ error: 'search_provider_changed', message: '搜索服务已切换，请重新搜索后提取正文。' });
    if (items.some((item) => !isPublicHttpUrl(item.url))) {
      return reply.code(400).send({
        error: 'invalid_web_search_url',
        message: '只能提取 http/https 公共网址，不接受本机、内网或字面 IP 地址。',
      });
    }
    const context = await requireContext(reply, stored);
    if (!context) return;

    try {
      const response: ExtractWebSearchResponse = await extractWithProvider({
        ...context,
        items,
      });
      if (!Value.Check(ExtractWebSearchResponseSchema, response)) {
        return reply.code(500).send(RESPONSE_INVALID);
      }
      return reply.code(200).send(response);
    } catch (error) {
      return reply.code(502).send({
        error: 'web_search_extract_failed',
        message: safeMessage(error),
      });
    }
  });

  app.post<{ Body: unknown }>('/api/v1/admin/web-search/save-source', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(SaveWebSearchSourceSchema, request.body)) {
      return reply.code(400).send({
        error: 'invalid_web_search_source',
        message: '另存请求必须包含一条完整的搜索结果。',
      });
    }
    const body = request.body as { item: import('@sthstart/contracts').WebSearchResult };
    try {
      const result: SaveWebSearchSourceResult = saveWebSearchSource(database, body.item);
      if (!Value.Check(SaveWebSearchSourceResultSchema, result)) {
        return reply.code(500).send(RESPONSE_INVALID);
      }
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof WebSearchSourceSaveError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      return reply.code(500).send({
        error: 'web_search_source_save_failed',
        message: '保存网页资料失败，未写入部分数据。',
      });
    }
  });
}
