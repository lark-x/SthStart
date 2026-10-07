import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ServiceDatabase } from '../../apps/service/src/database.js';
import { StoryStore } from '../../apps/service/src/story/store.js';
import { createService } from '../../apps/service/src/server.js';
import { readConfig } from '../../apps/service/src/config.js';
import { SecretStore, hashToken } from '../../apps/service/src/security.js';
import type { ResolvedProfile } from '../../apps/service/src/providers.js';
import type { StoryDocumentKind } from '@sthstart/contracts';

export interface Scenario {
  id: string; skill: string; prompt: string; expected: string; assertions: string[]; rubric: string[];
  documents: Array<{ key: string; kind: StoryDocumentKind; title: string; body: string; padding?: number; tail?: string }>;
  concurrentBody?: string; expectedSpeakers?: string[]; forbiddenSpeakers?: string[];
}
export interface ToolTrace { method: string; path: string; body?: unknown; status: number; response: unknown }

export async function storyFixture(scenario?: Scenario, profile?: ResolvedProfile, fetcher: typeof fetch = fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'sthstart-testing-'));
  const db = new ServiceDatabase(join(directory, 'service.db'));
  let app: Awaited<ReturnType<typeof createService>>['app'] | undefined;
  let http: ReturnType<typeof createServer> | undefined;
  const clients: Client[] = [];
  const adminToken = `test-admin-${randomUUID()}`;
  const appToken = `test-app-${randomUUID()}`;
  const secrets = new SecretStore({ STHSTART_SECRET_EVAL_PROVIDER: profile?.secret ?? '' });
  try {
    const config = { ...readConfig({ STHSTART_ADMIN_TOKEN: adminToken,
      STHSTART_DATABASE_PATH: join(directory, 'service.db'), STHSTART_NARRATIVE_DATABASE_PATH: join(directory, 'narrative.db'),
      STHSTART_ARTIFACT_DIR: join(directory, 'media'), STHSTART_LOG_DIR: join(directory, 'logs') }), port: 0 };
    ({ app } = await createService({ config, database: db, secrets, fetcher }));
    if (profile) {
      const now = new Date().toISOString();
      db.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
        VALUES ('eval-provider','测试模型','llm',?,?, 'eval-credential',1,?,?)`).run(profile.baseUrl, profile.model, now, now);
      db.connection.prepare(`INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json)
        VALUES ('eval-provider',?,?,?)`).run(profile.thinkingMode, JSON.stringify(profile.headers), JSON.stringify(profile.extraBody));
      db.connection.prepare(`UPDATE managed_apps SET token_hash=? WHERE id='story'`).run(hashToken(appToken));
      db.connection.prepare(`INSERT OR REPLACE INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('story','text','eval-provider',?)`).run(now);
    }
    const store = new StoryStore(db);
    const project = store.createProject({ title: `测试-${scenario?.id ?? '剧情链路'}` });
    const documents = new Map<string, ReturnType<StoryStore['createDocument']>>();
    for (const input of scenario?.documents ?? [{ key: 'chapter', kind: 'chapter' as const, title: '第一章', body: '林遥说：等钟响后再走。' }]) {
      documents.set(input.key, store.createDocument(project.id, { kind: input.kind, title: input.title,
        body: input.body + (input.padding ? '资料背景。'.repeat(Math.ceil(input.padding / 5)).slice(0, input.padding) : '') + (input.tail ?? '') }));
    }
    const grant = store.createBridgeGrant(project.id);
    const trace: ToolTrace[] = [];
    let concurrentEditApplied = false;
    let canonical = store.listDocuments(project.id).map(item => ({ id: item.id, revision: item.revision, body: item.body }));
    const activeApp = app;
    // Native MCP expects a Portal bridge prefix. This local adapter forwards to real service routes.
    http = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString('utf8');
        const path = (request.url ?? '').replace('/api/story-bridge/', '/api/v1/story-bridge/');
        if (scenario?.concurrentBody && !concurrentEditApplied && request.method === 'POST' && path.endsWith('/proposals')) {
          const chapter = documents.get('chapter')!;
          store.updateDocument(project.id, chapter.id, { expectedRevision: chapter.revision, title: chapter.title, body: scenario.concurrentBody });
          concurrentEditApplied = true;
          canonical = store.listDocuments(project.id).map(item => ({ id: item.id, revision: item.revision, body: item.body }));
        }
        const result = await activeApp.inject({ method: (request.method ?? 'GET') as 'GET' | 'POST' | 'DELETE', url: path,
          headers: { authorization: request.headers.authorization ?? '', ...(raw ? { 'content-type': 'application/json' } : {}) },
          ...(raw ? { payload: raw } : {}) });
        let parsed: unknown; try { parsed = JSON.parse(result.body); } catch { parsed = result.body; }
        trace.push({ method: request.method ?? 'GET', path, ...(raw ? { body: JSON.parse(raw) } : {}), status: result.statusCode, response: parsed });
        response.writeHead(result.statusCode, { 'content-type': 'application/json' }); response.end(result.body);
      } catch { response.writeHead(500, { 'content-type': 'application/json' }); response.end('{"error":"fixture_error"}'); }
    });
    http.listen(0, '127.0.0.1'); await once(http, 'listening');
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('测试监听失败');
    const portalUrl = `http://127.0.0.1:${address.port}`;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const serviceAddress = app.server.address();
    if (!serviceAddress || typeof serviceAddress === 'string') throw new Error('测试服务监听失败');
    const serviceUrl = `http://127.0.0.1:${serviceAddress.port}`;
    return { directory, db, app, store, project, documents, grant, adminToken, appToken, portalUrl, serviceUrl, trace,
      canonical: () => canonical,
      async connect() {
        const client = new Client({ name: 'sthstart-learning', version: '1.0.0' }); clients.push(client);
        await client.connect(new StdioClientTransport({ command: process.execPath,
          args: ['--import', import.meta.resolve('tsx/esm'), resolve('apps/service/src/story/native-mcp-server.ts')],
          stderr: 'pipe', env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '',
            STHSTART_STORY_PROJECT_ID: project.id, STHSTART_STORY_BRIDGE_TOKEN: grant.token, STHSTART_STORY_PORTAL_URL: portalUrl } }));
        return client;
      },
      async close() {
        await Promise.allSettled(clients.map(client => client.close()));
        http!.closeAllConnections(); await new Promise<void>(done => http!.close(() => done()));
        try { await activeApp.close(); } finally { db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
      } };
  } catch (error) {
    http?.closeAllConnections(); http?.close(); await app?.close(); db.close();
    await rm(directory, { recursive: true, force: true }); throw error;
  }
}
