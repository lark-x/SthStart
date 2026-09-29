import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { DeepSeekHarness, HarnessClient } from '@deepseek-ai/dsh-sdk-client';

test('restricted DSH profile can use an OpenAI-compatible SthStart gateway and resume after restart', { timeout: 90_000 }, async () => {
  const requests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/api/v1/internal/story/projects/test-project/snapshot' && request.method === 'GET') {
      assert.equal(request.headers.authorization, 'Bearer test-mcp-token');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ project: { id: 'test-project', title: '测试剧情', summary: '' }, documents: [], characters: [] }));
      return;
    }
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'mock-1', object: 'chat.completion.chunk', created: 1, model: 'poc-model', choices: [{ index: 0, delta: { role: 'assistant', content: requests.length === 1 ? '第一轮完成' : '第二轮完成' }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'mock-1', object: 'chat.completion.chunk', created: 1, model: 'poc-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const root = await mkdtemp(resolve(tmpdir(), 'sthstart-story-dsh-test-'));
  const sourcePatch = await readFile(resolve('apps/service/src/story/profile.cordis.patch.yml'), 'utf8');
  const patchPath = resolve(root, 'story.cordis.patch.yml');
  await writeFile(patchPath, sourcePatch.replace('__STHSTART_STORY_RESUME_SERVER_PATH__', resolve('apps/service/src/story/dsh-resume-server.mjs').replaceAll('\\', '/')));
  const options: ConstructorParameters<typeof DeepSeekHarness>[0] = {
    profile: 'sdk-minimal',
    patches: [patchPath],
    dshHome: resolve(root, 'home'),
    processCwd: root,
    cwd: root,
    provider: 'sthstart',
    model: 'poc-model',
    initializeTimeoutMs: 45_000,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOME: process.env.HOME,
      STHSTART_STORY_APP_TOKEN: 'test-token',
      STHSTART_STORY_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      STHSTART_STORY_MODEL_ID: 'poc-model',
      STHSTART_STORY_MCP_TOKEN: 'test-mcp-token',
      STHSTART_STORY_PROJECT_ID: 'test-project',
      STHSTART_STORY_RUNTIME_SESSION_ID: 'session-test',
      STHSTART_STORY_MCP_SOURCE_PATH: resolve('apps/service/src/story/mcp-server.ts'),
      STHSTART_STORY_TSX_IMPORT_PATH: import.meta.resolve('tsx/esm'),
      STHSTART_STORY_SKILLS_DIR: resolve('apps/service/src/story/skills'),
      STHSTART_STORY_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
      DSH_TELEMETRY_MODE: 'OFF',
    },
  };
  try {
    let sessionId: string;
    {
      const harness = new DeepSeekHarness(options);
      try {
        const first = await harness.run(`第一轮：${'角色在风雪中寻找失踪的手稿。'.repeat(100)}`).catch((error: unknown) => { throw new Error('first DSH run failed', { cause: error }); });
        sessionId = first.sessionId;
        assert.match(first.finalResponse, /第一轮完成/);
      } finally {
        await harness.close();
      }
    }
    {
      const harness = new DeepSeekHarness(options);
      try {
        const second = await harness.run(`第二轮：${'请讨论人物的矛盾和行动动机。'.repeat(100)}`, { sessionId });
        assert.equal(second.sessionId, sessionId);
        assert.match(second.finalResponse, /第二轮完成/);
      } finally {
        await harness.close();
      }
    }
    {
      const client = new HarnessClient(options);
      try {
        await client.start();
        await client.initialize({ cwd: root, provider: 'sthstart', model: 'poc-model', maxTokens: 4096 });
        const compact = await client.request('session/compact', { sessionId }) as { compacted: boolean; replacedItems: number };
        assert.equal(compact.compacted, true);
        assert.ok(compact.replacedItems > 0);
      } finally {
        await client.close();
      }
    }
    assert.ok(requests.length >= 3, 'manual compaction makes a separate summary request');
    assert.ok(requests.every((item) => item.authorization === 'Bearer test-token'));
    assert.ok(requests.every((item) => item.body.model === 'poc-model'));
    assert.ok(requests.some((item) => Array.isArray(item.body.tools) &&
      (item.body.tools as Array<{ function?: { name?: string } }>).some((tool) => tool.function?.name === 'mcp__story__story_get_project')),
    'Story MCP tools must be exposed to the model');
    const toolNames = requests.flatMap((item) => Array.isArray(item.body.tools)
      ? (item.body.tools as Array<{ function?: { name?: string } }>).map((tool) => tool.function?.name ?? '') : []);
    assert.ok(!toolNames.some((name) => /(?:bash|pwsh|shell|exec_command|write_file|edit_file|fs_write)/i.test(name)),
      `restricted profile exposed a filesystem/shell tool: ${toolNames.join(', ')}`);
    assert.ok(requests.some((item) => JSON.stringify(item.body.messages ?? []).includes('character-design')),
      'Story skills must be visible to the model');
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
