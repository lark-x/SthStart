import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('Story MCP exposes only scoped read tools and queries the Story service', async () => {
  let reads = 0;
  let proposals = 0;
  const upstream = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer scoped-token');
    if (request.url === '/api/v1/internal/story/projects/p-one/proposals' && request.method === 'POST') {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const submitted = JSON.parse(Buffer.concat(chunks).toString()) as { kind: string; runtimeSessionId: string };
      assert.equal(submitted.kind, 'outline'); assert.equal(submitted.runtimeSessionId, 'session-one');
      proposals++; response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'proposal-1', status: 'pending' })); return;
    }
    assert.equal(request.url, '/api/v1/internal/story/projects/p-one/snapshot');
    reads++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ project: { id: 'p-one', title: '雾港', summary: '悬疑' },
      documents: [{ id: 'outline-1', kind: 'outline', title: '主线', body: '调查失踪案' }],
      characters: [{ id: 'char-1', name: '林遥', notes: '寻找失踪的哥哥' }],
    }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const client = new Client({ name: 'story-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('./mcp-server.ts', import.meta.url))],
    env: { ...Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string')),
      STHSTART_STORY_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
      STHSTART_STORY_PROJECT_ID: 'p-one', STHSTART_STORY_RUNTIME_SESSION_ID: 'session-one',
      STHSTART_STORY_MCP_TOKEN: 'scoped-token' },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((item) => item.name), [
      'story_get_project', 'story_get_outline', 'story_get_character', 'story_get_world', 'story_get_scene', 'story_search',
      'story_propose_outline_change', 'story_propose_world_change', 'story_propose_scene_change', 'story_propose_character_change',
    ]);
    const character = await client.callTool({ name: 'story_get_character', arguments: { nameOrId: '林遥' } });
    assert.match(JSON.stringify(character.content), /寻找失踪的哥哥/);
    const found = await client.callTool({ name: 'story_search', arguments: { query: '失踪' } });
    assert.match(JSON.stringify(found.content), /主线/);
    assert.equal(reads, 2);
    const proposal = await client.callTool({ name: 'story_propose_outline_change', arguments: {
      targetId: 'outline-1', baseRevision: 1, proposedTitle: '主线', proposedBody: '新大纲', reason: '增强冲突',
    } });
    assert.match(JSON.stringify(proposal.content), /pending/);
    assert.equal(proposals, 1);
  } finally { await client.close(); upstream.close(); }
});
