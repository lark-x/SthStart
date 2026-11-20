import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  CreativeScopeSchema,
  CreativeStartRunSchema,
} from '@sthstart/contracts';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { mcpError, mcpJson, toolSchema } from '../mcp-http.js';
import {
  CreativeAgentCandidateSubmissionSchema,
  CreativeAgentContextRequestSchema,
  CreativeAgentMemoryEntriesRequestSchema,
  CreativeAgentMemoryFactsRequestSchema,
} from './bridge.js';

const serviceUrl = process.env.STHSTART_SERVICE_URL
  ?? process.env.STHSTART_CREATIVE_AGENT_SERVICE_URL;
const token = process.env.STHSTART_CREATIVE_AGENT_TOKEN;
if (!serviceUrl || !token) throw new Error('Creative Agent MCP configuration is incomplete.');

let base: URL;
try {
  base = new URL(serviceUrl);
} catch {
  throw new Error('Creative Agent MCP service URL is invalid.');
}
if (!['http:', 'https:'].includes(base.protocol)
  || base.username
  || base.password
  || base.search
  || base.hash) {
  throw new Error('Creative Agent MCP service URL must be a plain HTTP(S) URL.');
}
const root = `${base.href.replace(/\/$/, '')}/api/v1/creative-agent`;

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});
const runId = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' };
const proposalRequestSchema = Type.Object({
  conversationId: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: '^[A-Za-z0-9_-]+$',
  })),
  scope: CreativeScopeSchema,
  message: Type.String({ minLength: 1, maxLength: 20000 }),
}, { additionalProperties: false });
const tools = [
  {
    name: 'list_runs',
    description: '列出当前范围凭据可见的创作运行。该工具只读。',
    inputSchema: objectSchema({}, []),
  },
  {
    name: 'get_run',
    description: '读取当前范围凭据拥有的运行、节点、候选产物和人工确认状态。',
    inputSchema: objectSchema({ runId }),
  },
  {
    name: 'read_context',
    description: '读取 grant scope 的当前真实创作上下文及其 canonical SHA-256。必须先读取再提交直接候选。',
    inputSchema: CreativeAgentContextRequestSchema,
  },
  {
    name: 'creative.memory.facts',
    description: '分页读取 grant scope 内当前时间线截至最新 tick 的事实索引。传 actorId 时只返回该角色已知或经 heard 来源验证的事实；不传时为导演全知视角。',
    inputSchema: CreativeAgentMemoryFactsRequestSchema,
  },
  {
    name: 'creative.memory.entries',
    description: '分页读取 grant scope 内已正式采用的设定与伏笔条目。该工具只读，返回真实来源产物与 hash。',
    inputSchema: CreativeAgentMemoryEntriesRequestSchema,
  },
  {
    name: 'propose_creative_run',
    description: '提交对话式工作流建议。建议不会执行工作流、改动正式内容或获得人工批准。',
    inputSchema: proposalRequestSchema,
  },
  {
    name: 'submit_candidate',
    description: '提交外部 scene、visual-brief 或 video-plan 候选。候选只进入统一审核，不会获得批准、正式采用或发布；重复请求沿用原 idempotencyKey。',
    inputSchema: CreativeAgentCandidateSubmissionSchema,
  },
  {
    name: 'start_run',
    description: '按已发布的固定工作流版本创建运行。重复请求必须沿用原 idempotencyKey；grant 会先预留完整额度。',
    inputSchema: CreativeStartRunSchema,
  },
  {
    name: 'stop_run',
    description: '请求停止当前凭据拥有的运行。不会批准、发布或提高预算。',
    inputSchema: objectSchema({ runId }),
  },
] as const;

function parameterId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error('runId 不是有效 ID。');
  }
  return encodeURIComponent(value);
}

async function request(path: string, method: 'GET' | 'POST', body?: unknown) {
  return mcpJson(`${root}${path}`, {
    method,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'cache-control': 'no-store',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

const server = new Server(
  { name: 'sthstart-creative-agent', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions: 'Use only the scoped Creative Agent tools. Read current context and relevant long-term memory before starting work, reuse idempotencyKey on retries, and report proposals as proposals. You cannot approve, publish, alter grants, increase budgets, start a review run, or inspect provider secrets.',
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const definition = tools.find((entry) => entry.name === params.name);
    if (!definition) throw new Error('不允许的 Creative Agent 工具。');
    const args = params.arguments ?? {};
    if (!Value.Check(toolSchema(definition.inputSchema as Record<string, unknown>), args)) {
      throw new Error('工具参数不符合 Schema。');
    }

    let result: unknown;
    switch (params.name) {
      case 'list_runs':
        result = await request('/runs', 'GET');
        break;
      case 'get_run':
        result = await request(`/runs/${parameterId(args.runId)}`, 'GET');
        break;
      case 'read_context':
        result = await request('/context', 'POST', args);
        break;
      case 'creative.memory.facts':
        result = await request('/memory/facts', 'POST', args);
        break;
      case 'creative.memory.entries':
        result = await request('/memory/entries', 'POST', args);
        break;
      case 'propose_creative_run':
        result = await request('/propose', 'POST', args);
        break;
      case 'submit_candidate':
        result = await request('/candidates', 'POST', args);
        break;
      case 'start_run':
        result = await request('/runs', 'POST', args);
        break;
      case 'stop_run':
        result = await request(`/runs/${parameterId(args.runId)}/stop`, 'POST', {});
        break;
      default:
        throw new Error('不允许的 Creative Agent 工具。');
    }
    const structured = result && typeof result === 'object'
      ? result as Record<string, unknown>
      : { result };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: structured,
    };
  } catch (error) {
    return mcpError(error);
  }
});

await server.connect(new StdioServerTransport());
