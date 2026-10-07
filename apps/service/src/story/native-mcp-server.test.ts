import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('native DSH stdio MCP exposes scoped read/history tools and only submits proposals', async () => {
  const received: Array<{ method: string; path: string; authorization: string; body?: unknown }> = [];
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    received.push({ method: request.method ?? '', path: request.url ?? '', authorization: request.headers.authorization ?? '', ...(raw ? { body: JSON.parse(raw) as unknown } : {}) });
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/proposals') && request.method === 'POST') {
      response.statusCode = 201;
      response.end(JSON.stringify({ proposal: { id: 'proposal-1', status: 'pending' }, created: true }));
    } else if (request.url?.includes('/proposals/proposal-1')) response.end(JSON.stringify({ id: 'proposal-1', status: 'pending' }));
    else if (request.url?.includes('/entries')) response.end(JSON.stringify({ items: [], nextCursor: null }));
    else response.end(JSON.stringify({ project: { id: 'project-test', title: 'MCP 测试项目', revision: 1 } }));
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const token = 'bridge-test-token-abcdefghijklmnopqrstuvwxyz0123456789';
  const serverPath = existsSync(fileURLToPath(new URL('./native-mcp-server.ts', import.meta.url)))
    ? fileURLToPath(new URL('./native-mcp-server.ts', import.meta.url))
    : fileURLToPath(new URL('./native-mcp-server.js', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', import.meta.resolve('tsx/esm'), serverPath],
    cwd: process.cwd(), stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', STHSTART_STORY_PROJECT_ID: 'project-test', STHSTART_STORY_BRIDGE_TOKEN: token,
      STHSTART_STORY_PORTAL_URL: `http://127.0.0.1:${address.port}` },
  });
  const client = new Client({ name: 'story-bridge-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      'get_project', 'get_proposal_status', 'list_entries', 'list_entry_revisions', 'list_proposals', 'read_entry', 'read_entry_revision', 'search_entries', 'submit_proposal',
    ]);
    const project = await client.callTool({ name: 'get_project', arguments: {} });
    assert.match(JSON.stringify(project), /MCP 测试项目/);
    for(const [name,args,path] of [
      ['list_proposals',{status:'pending',limit:2},'/proposals?limit=2&status=pending'],
      ['list_entry_revisions',{kind:'chapter',id:'ch-1',limit:2},'/entries/chapter/ch-1/revisions?limit=2'],
      ['read_entry_revision',{kind:'chapter',id:'ch-1',revisionId:'rev-1',offset:10},'/entries/chapter/ch-1/revisions/rev-1?offset=10'],
    ] as const){assert.ok(!(await client.callTool({name,arguments:args})).isError);assert.equal(received.at(-1)?.path,`/api/story-bridge/projects/project-test${path}`);}
    const proposal = await client.callTool({ name: 'submit_proposal', arguments: {
      operation: 'create', kind: 'chapter', targetId: null, baseRevision: null,
      proposedTitle: '第一章', proposedBody: '仅待审内容', reason: '测试提案权限边界',
    } });
    assert.equal(proposal.isError, undefined);
    assert.match(JSON.stringify(proposal), /pending/);
    const status = await client.callTool({ name: 'get_proposal_status', arguments: { proposalId: 'proposal-1' } });
    assert.match(JSON.stringify(status), /proposal-1/);
    assert.equal(received.every((item) => item.authorization === `Bearer ${token}`), true);
    assert.equal(received.some((item) => item.path.endsWith('/proposals') && item.method === 'POST'), true);
    assert.deepEqual(received.find((item) => item.path.endsWith('/proposals') && item.method === 'POST')?.body,
      { operation: 'create', kind: 'chapter', targetId: null, baseRevision: null, proposedTitle: '第一章', proposedBody: '仅待审内容', reason: '测试提案权限边界' });
  } finally {
    await client.close().catch(() => {});
    http.close();
    await once(http, 'close');
  }
});
