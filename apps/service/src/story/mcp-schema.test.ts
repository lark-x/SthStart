import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP Schema and Contract Verification Test', async (t) => {
  let latestPayload: unknown = null;
  const http = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    latestPayload = raw ? JSON.parse(raw) : null;
    res.setHeader('content-type', 'application/json');
    if (req.url?.includes('/proposals') && req.method === 'POST') {
      res.statusCode = 201;
      res.end(JSON.stringify({ proposal: { id: 'prop-test-1', status: 'pending' }, created: true }));
    } else if (req.url?.includes('/proposals/prop-test-1')) {
      res.end(JSON.stringify({ id: 'prop-test-1', status: 'pending' }));
    } else if (req.url?.includes('/entries')) {
      res.end(JSON.stringify({ items: [{ id: 'ch-1', kind: 'chapter', title: '第一章', revision: 2 }], nextCursor: null }));
    } else if (req.url?.includes('/search')) {
      res.end(JSON.stringify({ items: [{ id: 'ch-1', kind: 'chapter', title: '第一章', revision: 2, excerpt: '开端' }], nextCursor: null }));
    } else {
      res.end(JSON.stringify({ project: { id: 'proj-contract-test', title: '契约测试项目', revision: 3 } }));
    }
  });

  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert.ok(address && typeof address !== 'string');

  const token = 'contract-bridge-test-token-0123456789abcdefghijklmnopqrstuvwxyz';
  const serverPath = existsSync(fileURLToPath(new URL('./native-mcp-server.ts', import.meta.url)))
    ? fileURLToPath(new URL('./native-mcp-server.ts', import.meta.url))
    : fileURLToPath(new URL('./native-mcp-server.js', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', import.meta.resolve('tsx/esm'), serverPath],
    cwd: process.cwd(),
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH ?? '',
      STHSTART_STORY_PROJECT_ID: 'proj-contract-test',
      STHSTART_STORY_BRIDGE_TOKEN: token,
      STHSTART_STORY_PORTAL_URL: `http://127.0.0.1:${address.port}`,
    },
  });

  const client = new Client({ name: 'story-mcp-contract-verifier', version: '1.0.0' });

  try {
    await client.connect(transport);

    await t.test('1. 列出工具应严格包含 6 个核心工具且具备完整 inputSchema', async () => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 6);
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, [
        'get_project',
        'get_proposal_status',
        'list_entries',
        'read_entry',
        'search_entries',
        'submit_proposal',
      ]);

      const submitProposal = tools.find((t) => t.name === 'submit_proposal');
      assert.ok(submitProposal);
      assert.ok(submitProposal.inputSchema.required?.includes('operation'));
      assert.ok(submitProposal.inputSchema.required?.includes('kind'));
      assert.ok(submitProposal.inputSchema.required?.includes('proposedTitle'));
      assert.ok(submitProposal.inputSchema.required?.includes('proposedBody'));
      assert.ok(submitProposal.inputSchema.required?.includes('reason'));
    });

    await t.test('2. 正常读取项目资料与条目列表', async () => {
      const projectRes = await client.callTool({ name: 'get_project', arguments: {} });
      assert.equal(projectRes.isError, undefined);
      assert.match(JSON.stringify(projectRes), /契约测试项目/);

      const listRes = await client.callTool({ name: 'list_entries', arguments: { kind: 'chapter', limit: 10 } });
      assert.equal(listRes.isError, undefined);
      assert.match(JSON.stringify(listRes), /第一章/);
    });

    await t.test('3. submit_proposal 创建章节正常流转并验证数据体', async () => {
      const res = await client.callTool({
        name: 'submit_proposal',
        arguments: {
          operation: 'create',
          kind: 'chapter',
          targetId: null,
          baseRevision: null,
          proposedTitle: '第二章 风暴将至',
          proposedBody: '狂风在悬崖边呼啸…',
          reason: '推进剧情冲突',
        },
      });
      assert.equal(res.isError, undefined);
      assert.match(JSON.stringify(res), /pending/);
      assert.deepEqual(latestPayload, {
        operation: 'create',
        kind: 'chapter',
        targetId: null,
        baseRevision: null,
        proposedTitle: '第二章 风暴将至',
        proposedBody: '狂风在悬崖边呼啸…',
        reason: '推进剧情冲突',
      });
    });

    await t.test('4. 安全约束：创建大纲提案应被拒绝（大纲只能有一个，只能更新）', async () => {
      const res = await client.callTool({
        name: 'submit_proposal',
        arguments: {
          operation: 'create',
          kind: 'outline',
          targetId: null,
          baseRevision: null,
          proposedTitle: '新大纲',
          proposedBody: '全新大纲内容',
          reason: '尝试非法创建新大纲',
        },
      });
      assert.equal(res.isError, true);
      assert.match(JSON.stringify(res), /新建提案不能新建大纲/);
    });

    await t.test('5. 安全约束：更新条目时缺失基准版本号应被拒绝', async () => {
      const res = await client.callTool({
        name: 'submit_proposal',
        arguments: {
          operation: 'update',
          kind: 'chapter',
          targetId: 'ch-1',
          baseRevision: null, // 非法，update 必须有正整数版本
          proposedTitle: '第一章 修订',
          proposedBody: '修订正文',
          reason: '尝试无版本乐观锁更新',
        },
      });
      assert.equal(res.isError, true);
      assert.match(JSON.stringify(res), /更新提案必须提供目标 ID 和读取时的正整数版本号/);
    });

    await t.test('6. 搜索工具参数校验：空搜索词应被拒绝', async () => {
      const res = await client.callTool({
        name: 'search_entries',
        arguments: { query: '   ' },
      });
      assert.equal(res.isError, true);
      assert.match(JSON.stringify(res), /搜索词须为 1 到 120 个字符/);
    });
  } finally {
    await client.close().catch(() => {});
    http.close();
    await once(http, 'close');
  }
});
