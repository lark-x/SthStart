import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  WorldChapterCopilotResponseSchema,
  WorldManuscriptDeleteResponseSchema,
  WorldManuscriptDocResponseSchema,
  WorldMcpReadResponseSchema,
  createUniversalStoryBlueprintTemplate,
  type WorldDefinition,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import { ServiceDatabase, nowIso } from '../database.js';
import { McpSourceStore } from '../mcp/store.js';
import { SecretStore } from '../security.js';
import { registerStoryWorldRoutes } from '../story-worlds/routes.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { registerWorkspaceRoutes } from '../workspace.js';
import { importStoryBodyPack } from './blueprint.js';
import {
  createWorldManuscriptDocument,
  deleteWorldManuscriptDocument,
  runWorldChapterCopilot,
  saveWorldManuscriptDocument,
} from './copilot.js';
import { getWorldHub, readWorldMcpDocument } from './hub.js';

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() {
    return { available: true, backend: 'memory', envFallback: false };
  }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined
      ? { value: null, source: 'none' as const }
      : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) {
    this.values.set(account, value);
  }
  override async delete(account: string) {
    this.values.delete(account);
  }
}

function installTestChatModel(database: ServiceDatabase, secrets: MemorySecrets) {
  const now = nowIso();
  secrets.values.set('hub-test-llm-account', 'sk-hub-test-secret');
  database.connection.prepare(`
    INSERT INTO service_connections
      (id, name, kind, base_url, credential_account, timeout_ms, headers_json, options_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    'hub-test-conn',
    'Hub Test LLM',
    'openai-compatible-text',
    'http://llm.invalid/v1',
    'hub-test-llm-account',
    5000,
    '{}',
    '{}',
    now,
    now,
  );
  database.connection.prepare(`
    INSERT INTO model_profiles
      (id, connection_id, name, model_id, model_type, capabilities_json, default_params_json, advanced_json, test_status, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'chat', '["text"]', '{}', '{}', 'passed', 1, ?, ?)
  `).run(
    'hub-test-model',
    'hub-test-conn',
    'Hub Test Chat Model',
    'gpt-test-copilot',
    now,
    now,
  );
}

test('getWorldHub aggregates regions, factions, arcs, linked projects, character cards, and scopePolicy', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const pack = createUniversalStoryBlueprintTemplate('星轨测试作品');
    pack.worldDefinition.narrativeMode = 'quest-chapter';
    pack.worldDefinition.regions = [{ id: 'reg_station', name: '核心区域', description: '枢纽空间站' }];
    pack.worldDefinition.factions = [{ id: 'fac_express', name: '无名客', description: '开拓阵营' }];
    pack.worldDefinition.locations[0] = {
      ...pack.worldDefinition.locations[0]!,
      region: '核心区域',
      regionId: 'reg_station',
      tier: 'sublocation',
    };
    pack.worldDefinition.actors[0] = {
      ...pack.worldDefinition.actors[0]!,
      faction: '无名客',
      factionId: 'fac_express',
      regionId: 'reg_station',
    };
    pack.storyLines[0] = {
      ...pack.storyLines[0]!,
      arcKind: 'main',
      timeWindowLabel: '第一卷 · 停靠站间隙',
      regionIds: ['reg_station'],
      locationIds: ['loc_hub'],
      status: 'active',
      orderIndex: 1,
    };

    const imported = importStoryBodyPack(database, pack);
    const hub = getWorldHub(database, imported.worldId, imported.branchId);

    assert.equal(hub.world.title, pack.worldDefinition.title);
    assert.equal(hub.definition?.narrativeMode, 'quest-chapter');
    assert.equal(hub.definition?.regions?.[0]?.name, '核心区域');
    assert.equal(hub.definition?.factions?.[0]?.name, '无名客');
    assert.equal(hub.definition?.actors[0]?.faction, '无名客');
    assert.equal(hub.storyLines[0]?.arcKind, 'main');
    assert.equal(hub.storyLines[0]?.timeWindowLabel, '第一卷 · 停靠站间隙');
    assert.equal(hub.linkedProjects.length, 1);
    assert.equal(hub.linkedProjects[0]?.project.id, imported.projectId);
    assert.ok(hub.linkedProjects[0]?.outline);
    assert.equal(hub.linkedProjects[0]?.worldDocs.length, 2);
    assert.equal(hub.characterCards.length, 1);
    assert.equal(hub.characterCards[0]?.displayName, '主角（待命名）');
    assert.equal(hub.scopePolicy?.styleGuide?.tone, pack.styleGuide.tone);
  } finally {
    database.close();
  }
});

test('readWorldMcpDocument parses [akasha_read] header, respects schema limits, and wraps tool errors as 502', async () => {
  const database = new ServiceDatabase(':memory:');
  const secrets = new MemorySecrets();
  try {
    const pack = createUniversalStoryBlueprintTemplate('崩坏：星穹铁道');
    pack.worldDefinition.title = '崩坏：星穹铁道';
    pack.worldDefinition.workNature = 'canon';
    pack.worldDefinition.parentWork = null;
    const imported = importStoryBodyPack(database, pack);

    const mcpStore = new McpSourceStore(database, secrets);
    await mcpStore.save({
      id: 'akasha-local',
      name: '虚空档案测试源',
      url: 'http://mcp.invalid/mcp',
      authMode: 'none',
      applicableWorks: ['hsr'],
      universal: false,
      purpose: '剧情查证',
      allowedTools: ['akasha_search'],
      timeoutMs: 5000,
      status: 'enabled',
    });

    const recordedCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let forceToolError = false;

    const fetcher = (async (_input: unknown, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') return new Response(null, { status: 405 });
      const body = init?.body
        ? JSON.parse(String(init.body)) as {
            method?: string;
            id?: number;
            params?: { name?: string; arguments?: Record<string, unknown> };
          }
        : {};

      if (body.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'AkashaMock', version: '1.0' },
          },
        });
      }
      if (body.method === 'tools/list') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'akasha_search',
                inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
              },
              {
                name: 'akasha_read',
                inputSchema: {
                  type: 'object',
                  properties: {
                    world: { type: 'string' },
                    pathHash: { type: 'string' },
                    offset: { type: 'integer' },
                    limit: { type: 'integer', maximum: 150 },
                  },
                },
              },
            ],
          },
        });
      }
      if (body.method === 'tools/call') {
        const name = String(body.params?.name ?? '');
        const args = body.params?.arguments ?? {};
        recordedCalls.push({ name, args });
        if (forceToolError) {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              isError: true,
              content: [{ type: 'text', text: 'document not found' }],
            },
          });
        }
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: [
                '[akasha_read]',
                '文件: 第五幕 · 太阳升起之前.txt | hash_pinacony_05',
                '范围: 1-80 / 共160行',
                '正文:',
                '钟表滴答作响，列车组推开了梦境尽头的长廊大门。',
                '微风拂过白日梦酒店的高台。',
              ].join('\n'),
            }],
          },
        });
      }
      return Response.json({ jsonrpc: '2.0', id: body.id, result: {} });
    }) as unknown as typeof fetch;

    const read = await readWorldMcpDocument(
      database,
      secrets,
      imported.worldId,
      { locator: 'hash_pinacony_05', limit: 250 },
      fetcher,
    );

    assert.equal(recordedCalls.length, 1);
    assert.equal(recordedCalls[0]?.name, 'akasha_read');
    assert.deepEqual(recordedCalls[0]?.args, {
      world: 'hsr',
      pathHash: 'hash_pinacony_05',
      offset: 1,
      limit: 150,
    });
    assert.equal(read.sourceId, 'akasha-local');
    assert.equal(read.toolUsed, 'akasha_read');
    assert.equal(read.title, '第五幕 · 太阳升起之前.txt');
    assert.equal(read.startOffset, 1);
    assert.equal(read.endOffset, 80);
    assert.equal(read.totalLines, 160);
    assert.equal(read.hasMore, true);
    assert.ok(read.content.includes('钟表滴答作响'));
    assert.ok(Value.Check(WorldMcpReadResponseSchema, read));

    forceToolError = true;
    await assert.rejects(
      () => readWorldMcpDocument(database, secrets, imported.worldId, { locator: 'hash_pinacony_05' }, fetcher),
      (err: { statusCode?: number; code?: string }) => err.statusCode === 502 && err.code === 'mcp_read_failed',
    );
  } finally {
    database.close();
  }
});

test('createWorldManuscriptDocument & saveWorldManuscriptDocument handle auto project binding, saves, and 409 conflicts', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const worldStore = new StoryWorldStore(database);
    const definition: WorldDefinition = {
      title: '无绑定测试世界',
      summary: '用于测试手稿自动建项与乐观锁',
      timeLabel: '第一日',
      locations: [{ id: 'loc_1', name: '码头', description: '海港码头' }],
      actors: [{
        id: 'act_1',
        name: '守望者',
        role: 'main',
        characterId: null,
        characterVersion: null,
        background: '',
        personality: '冷静',
        speechStyle: '克制',
        appearance: '',
        goals: [],
        locationId: 'loc_1',
        referenceArtifactIds: [],
      }],
      sources: [],
      lockedFacts: [],
      models: { action: null, adjudication: null, narration: null },
      visualStyle: '',
    };
    const world = worldStore.create(definition);

    const created = createWorldManuscriptDocument(database, world.id, {
      title: '第一章 · 潮汐',
      body: '海风吹过旧码头。',
    });
    assert.equal(created.document.title, '第一章 · 潮汐');
    assert.equal(created.document.revision, 1);
    assert.equal(created.document.wordCount, 8);
    assert.ok(Value.Check(WorldManuscriptDocResponseSchema, created));

    const overviewAfterCreate = worldStore.overview(world.id);
    assert.equal(overviewAfterCreate.branches.length, 1);
    assert.equal(overviewAfterCreate.branches[0]?.title, '主线分支');

    const second = createWorldManuscriptDocument(database, world.id, {
      title: '第二章 · 钟声',
    });
    assert.equal(second.projectId, created.projectId);

    const saved = saveWorldManuscriptDocument(database, world.id, created.document.id, {
      projectId: created.projectId,
      expectedRevision: 1,
      title: '第一章 · 潮汐（修订）',
      body: '海风吹过旧码头，远处灯塔亮起。',
    });
    assert.equal(saved.document.revision, 2);
    assert.equal(saved.document.title, '第一章 · 潮汐（修订）');
    assert.equal(saved.document.wordCount, 15);

    assert.throws(
      () => saveWorldManuscriptDocument(database, world.id, created.document.id, {
        projectId: created.projectId,
        expectedRevision: 1,
        title: '过期覆盖',
        body: '不应写入',
      }),
      (err: { statusCode?: number; code?: string }) => err.statusCode === 409 && err.code === 'story_revision_conflict',
    );

    assert.throws(
      () => saveWorldManuscriptDocument(database, world.id, created.document.id, {
        projectId: 'non-existent-project',
        expectedRevision: 2,
        title: '跨世界',
        body: '拒绝',
      }),
      (err: { statusCode?: number; code?: string }) => err.statusCode === 404 && err.code === 'manuscript_project_mismatch',
    );
  } finally {
    database.close();
  }
});

test('runWorldChapterCopilot supports beats, pure-prose draft/polish, structured check, and resilient plain-text check fallback', async () => {
  const database = new ServiceDatabase(':memory:');
  const secrets = new MemorySecrets();
  try {
    const pack = createUniversalStoryBlueprintTemplate('星穹copilots测试');
    pack.worldDefinition.lockedFacts = ['星穹列车航行期间禁止无故毁坏主控室核心'];
    const imported = importStoryBodyPack(database, pack);

    await assert.rejects(
      () => runWorldChapterCopilot(database, secrets, imported.worldId, { mode: 'beats' }),
      (err: { statusCode?: number; code?: string }) => err.statusCode === 503 && err.code === 'copilot_model_unavailable',
    );

    installTestChatModel(database, secrets);

    let mockMode: 'beats' | 'turn' | 'draft' | 'check-json' | 'check-plain' = 'beats';
    let capturedPrompt = '';

    const fetcher = (async (_input: unknown, init?: { body?: string }) => {
      const payload = init?.body
        ? JSON.parse(String(init.body)) as { messages?: Array<{ content?: string }> }
        : {};
      capturedPrompt = payload.messages?.map((m) => m.content ?? '').join('\n') ?? '';

      let content = '';
      if (mockMode === 'beats') {
        content = [
          '1. 开场：观景车厢的玻璃外掠过陌生星域的碎光。',
          '2. 冲突：通讯频道忽然传出断续求救信号。',
          '3. 转折：主角在旧星图中辨认出失踪站点的坐标。',
          '4. 收尾：众人决定靠泊查明真相，留下未解悬念。',
        ].join('\n');
      } else if (mockMode === 'turn') {
        content = JSON.stringify({
          prose: '门轴在夜风里轻响，她停下脚步，先看向灯下那道没有封口的信。',
          choices: ['拆开信件查看落款', '先询问守夜人是谁送来的'],
        });
      } else if (mockMode === 'draft') {
        content = '银白色的星尘贴着观景窗滑过，咖啡杯里的液面微微晃动。\n\n“信号来自三号航道。”她抬起眼，指尖停在星图边缘。';
      } else if (mockMode === 'check-json') {
        content = '```json\n{"issues":[{"severity":"warning","category":"canon","quote":"他一拳砸碎了主控室核心","detail":"违背锁定设定：列车航行期间主控室核心受保护且不可随意毁坏"}],"extractedFacts":["列车在三号航道捕获异常信号"]}\n```';
      } else {
        content = '建议将末尾的道理总结删除，改为角色转身关门的动作留白。';
      }

      return Response.json({
        model: 'gpt-test-copilot',
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      });
    }) as unknown as typeof fetch;

    const beatsRes = await runWorldChapterCopilot(
      database,
      secrets,
      imported.worldId,
      {
        mode: 'beats',
        branchId: imported.branchId,
        arcId: getWorldHub(database, imported.worldId, imported.branchId).storyLines[0]?.id,
        chapterTitle: '第一夜 · 星图余波',
        instruction: '重点突出紧迫感',
        references: [{ title: '原作摘录', locator: 'hash_1', excerpt: '三号航道曾是旧日航线' }],
      },
      fetcher,
    );
    assert.equal(beatsRes.mode, 'beats');
    assert.equal(beatsRes.beats.length, 4);
    assert.equal(beatsRes.beats[0], '开场：观景车厢的玻璃外掠过陌生星域的碎光。');
    assert.ok(capturedPrompt.includes('三号航道曾是旧日航线'));
    assert.ok(capturedPrompt.includes('星穹列车航行期间禁止无故毁坏主控室核心'));
    assert.ok(Value.Check(WorldChapterCopilotResponseSchema, beatsRes));

    mockMode = 'turn';
    const turnRes = await runWorldChapterCopilot(database, secrets, imported.worldId, {
      mode: 'turn',
      branchId: imported.branchId,
      arcId: getWorldHub(database, imported.worldId, imported.branchId).storyLines[0]?.id,
      action: '沿着灯光走到旧信箱前',
    }, fetcher);
    assert.equal(turnRes.mode, 'turn');
    assert.equal(turnRes.choices.length, 2);
    assert.ok(turnRes.prose.includes('没有封口的信'));
    assert.ok(capturedPrompt.includes('沿着灯光走到旧信箱前'));
    assert.ok(Value.Check(WorldChapterCopilotResponseSchema, turnRes));

    await assert.rejects(
      () => runWorldChapterCopilot(database, secrets, imported.worldId, { mode: 'turn' }, fetcher),
      (err: { statusCode?: number; code?: string }) => err.statusCode === 400 && err.code === 'copilot_turn_context_required',
    );

    mockMode = 'draft';
    const draftRes = await runWorldChapterCopilot(
      database,
      secrets,
      imported.worldId,
      {
        mode: 'draft',
        branchId: imported.branchId,
        beats: beatsRes.beats,
        targetWordCount: 1500,
      },
      fetcher,
    );
    assert.equal(draftRes.mode, 'draft');
    assert.ok(draftRes.prose.includes('银白色的星尘'));
    assert.deepEqual(draftRes.beats, []);
    assert.ok(Value.Check(WorldChapterCopilotResponseSchema, draftRes));

    await assert.rejects(
      () => runWorldChapterCopilot(database, secrets, imported.worldId, { mode: 'check', existingBody: '   ' }, fetcher),
      (err: { statusCode?: number; code?: string }) => err.statusCode === 400 && err.code === 'copilot_body_required',
    );

    mockMode = 'check-json';
    const checkJsonRes = await runWorldChapterCopilot(
      database,
      secrets,
      imported.worldId,
      {
        mode: 'check',
        branchId: imported.branchId,
        existingBody: '他一拳砸碎了主控室核心。',
      },
      fetcher,
    );
    assert.equal(checkJsonRes.issues.length, 1);
    assert.equal(checkJsonRes.issues[0]?.severity, 'warning');
    assert.equal(checkJsonRes.issues[0]?.category, 'canon');
    assert.deepEqual(checkJsonRes.extractedFacts, ['列车在三号航道捕获异常信号']);
    assert.ok(Value.Check(WorldChapterCopilotResponseSchema, checkJsonRes));

    mockMode = 'check-plain';
    const checkPlainRes = await runWorldChapterCopilot(
      database,
      secrets,
      imported.worldId,
      {
        mode: 'check',
        branchId: imported.branchId,
        existingBody: '于是大家都明白了团结的重要性。',
      },
      fetcher,
    );
    assert.equal(checkPlainRes.issues.length, 1);
    assert.equal(checkPlainRes.issues[0]?.severity, 'suggestion');
    assert.equal(checkPlainRes.issues[0]?.category, 'style');
    assert.ok(checkPlainRes.issues[0]?.detail.includes('动作留白'));
    assert.ok(Value.Check(WorldChapterCopilotResponseSchema, checkPlainRes));
  } finally {
    database.close();
  }
});

test('story-world manuscript, mcp-read, and copilot HTTP routes serialize and enforce status codes', async () => {
  const database = new ServiceDatabase(':memory:');
  const secrets = new MemorySecrets();
  const app = Fastify();
  const store = new StoryWorldStore(database);
  const unused = () => { throw new Error('unused'); };
  const adminHeaders = { 'x-sthstart-admin-token': 'hub-route-secret' };

  const fetcher = (async (_input: unknown, init?: { method?: string; body?: string }) => {
    if ((init?.method ?? 'GET') === 'GET') return new Response(null, { status: 405 });
    const url = String(_input);
    if (url.includes('/chat/completions')) {
      return Response.json({
        model: 'gpt-test-copilot',
        choices: [{ message: { content: '夜风掠过栈桥，远岸灯火逐一亮起。' } }],
      });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; id?: number };
    if (body.method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'GenericMock', version: '1.0' },
        },
      });
    }
    if (body.method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: [{ name: 'doc_read', inputSchema: { type: 'object', properties: { locator: { type: 'string' } } } }] },
      });
    }
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: '普通纯文本资料内容' }] },
    });
  }) as unknown as typeof fetch;

  registerStoryWorldRoutes(app, { adminToken: 'hub-route-secret' } as ServiceConfig, {
    store,
    runtime: { start: unused, pause: unused, resume: unused },
    images: { plan: unused, submit: unused },
    adopt: unused,
    mcpRead: (worldId, input) => readWorldMcpDocument(database, secrets, worldId, input, fetcher),
    createManuscriptDoc: (worldId, input) => createWorldManuscriptDocument(database, worldId, input),
    saveManuscriptDoc: (worldId, docId, input) => saveWorldManuscriptDocument(database, worldId, docId, input),
    deleteManuscriptDoc: (worldId, docId, projectId) => deleteWorldManuscriptDocument(database, worldId, docId, projectId),
    copilot: (worldId, input) => runWorldChapterCopilot(database, secrets, worldId, input, fetcher),
  });
  registerWorkspaceRoutes(app, database);

  try {
    const world = store.create({
      title: '路由测试世界',
      summary: '摘要',
      timeLabel: '日暮',
      locations: [{ id: 'loc1', name: '栈桥', description: '' }],
      actors: [{
        id: 'act1', name: '旅人', role: 'main', characterId: null, characterVersion: null,
        background: '', personality: '', speechStyle: '', appearance: '', goals: [],
        locationId: 'loc1', referenceArtifactIds: [],
      }],
      sources: [],
      lockedFacts: [],
      models: { action: null, adjudication: null, narration: null },
      visualStyle: '',
    });

    const mcpStore = new McpSourceStore(database, secrets);
    await mcpStore.save({
      id: 'generic-mcp',
      name: '通用文档源',
      url: 'http://mcp.invalid/mcp',
      authMode: 'none',
      applicableWorks: [],
      universal: true,
      purpose: '读取',
      allowedTools: [],
      timeoutMs: 5000,
      status: 'enabled',
    });

    const readResp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/story-worlds/${world.id}/mcp-read`,
      headers: adminHeaders,
      payload: { locator: 'doc-1' },
    });
    assert.equal(readResp.statusCode, 200, readResp.body);
    assert.ok(Value.Check(WorldMcpReadResponseSchema, readResp.json()));

    const createResp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/story-worlds/${world.id}/manuscript/documents`,
      headers: adminHeaders,
      payload: { title: '序幕' },
    });
    assert.equal(createResp.statusCode, 201, createResp.body);
    const created = createResp.json();
    assert.ok(Value.Check(WorldManuscriptDocResponseSchema, created));

    const saveResp = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/story-worlds/${world.id}/manuscript/documents/${created.document.id}`,
      headers: adminHeaders,
      payload: {
        projectId: created.projectId,
        expectedRevision: 1,
        title: '序幕 · 改',
        body: '正文章节落笔。',
      },
    });
    assert.equal(saveResp.statusCode, 200, saveResp.body);
    assert.equal(saveResp.json().document.revision, 2);

    const conflictResp = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/story-worlds/${world.id}/manuscript/documents/${created.document.id}`,
      headers: adminHeaders,
      payload: {
        projectId: created.projectId,
        expectedRevision: 1,
        title: '冲突',
        body: '冲突内容',
      },
    });
    assert.equal(conflictResp.statusCode, 409, conflictResp.body);

    const noModelResp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/story-worlds/${world.id}/copilot`,
      headers: adminHeaders,
      payload: { mode: 'draft' },
    });
    assert.equal(noModelResp.statusCode, 503, noModelResp.body);

    installTestChatModel(database, secrets);
    const copilotResp = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/story-worlds/${world.id}/copilot`,
      headers: adminHeaders,
      payload: { mode: 'draft', chapterTitle: '序幕' },
    });
    assert.equal(copilotResp.statusCode, 200, copilotResp.body);
    assert.ok(Value.Check(WorldChapterCopilotResponseSchema, copilotResp.json()));

    // Verify recent workspace surfaces worlds as 'world' and hides bound story projects
    const recentResp = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/workspace/recent?limit=10',
      headers: adminHeaders,
    });
    assert.equal(recentResp.statusCode, 200, recentResp.body);
    const recentItems = recentResp.json().items as Array<{ id: string; kind: string; title: string }>;
    assert.ok(recentItems.some((item) => item.id === world.id && item.kind === 'world'));
    assert.ok(!recentItems.some((item) => item.id === created.projectId && item.kind === 'story'));

    // Protected outline document cannot be deleted
    const hubData = getWorldHub(database, world.id);
    const outlineId = hubData.linkedProjects[0]?.outline?.id;
    assert.ok(outlineId);
    const badDelResp = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/story-worlds/${world.id}/manuscript/documents/${outlineId}`,
      headers: adminHeaders,
    });
    assert.equal(badDelResp.statusCode, 400, badDelResp.body);

    // Chapter document can be deleted cleanly
    const delResp = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/story-worlds/${world.id}/manuscript/documents/${created.document.id}`,
      headers: adminHeaders,
    });
    assert.equal(delResp.statusCode, 200, delResp.body);
    assert.ok(Value.Check(WorldManuscriptDeleteResponseSchema, delResp.json()));
    const hubAfter = getWorldHub(database, world.id);
    assert.ok(!hubAfter.linkedProjects[0]?.chapters.some((ch) => ch.id === created.document.id));
  } finally {
    await app.close();
    database.close();
  }
});
