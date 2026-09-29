import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CreateNativeStoryProposal } from '@sthstart/contracts';

const portalUrl = process.env.STHSTART_STORY_PORTAL_URL;
const projectId = process.env.STHSTART_STORY_PROJECT_ID;
const token = process.env.STHSTART_STORY_BRIDGE_TOKEN;
if (!portalUrl || !projectId || !token) throw new Error('Story bridge configuration is incomplete.');
const root = `${portalUrl.replace(/\/$/, '')}/api/story-bridge/projects/${encodeURIComponent(projectId)}`;

const tools = [
  { name: 'get_project', description: 'Read the current canonical SthStart project title, summary and revision. Use list_entries and read_entry to inspect specific story material.', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'list_entries', description: 'List canonical entries and their current revisions. Use cursor for another page. This tool does not change story data.', inputSchema: { type: 'object' as const, properties: { kind: { type: 'string', enum: ['outline', 'world', 'scene', 'chapter', 'character'] }, cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } },
  { name: 'read_entry', description: 'Read a canonical entry. Long bodies can be retrieved in chunks using offset; response includes totalLength and truncated.', inputSchema: { type: 'object' as const, properties: { kind: { type: 'string', enum: ['outline', 'world', 'scene', 'chapter', 'character'] }, id: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['kind', 'id'] } },
  { name: 'search_entries', description: 'Search canonical project material; returns up to 20 short excerpts and an optional next cursor.', inputSchema: { type: 'object' as const, properties: { query: { type: 'string', minLength: 1, maxLength: 120 }, kind: { type: 'string', enum: ['outline', 'world', 'scene', 'chapter', 'character'] }, cursor: { type: 'integer', minimum: 0 } }, required: ['query'] } },
  { name: 'submit_proposal', description: 'Submit a proposed create or update for human review in SthStart. This never changes canonical content. Read the target first and use its current revision for updates.', inputSchema: { type: 'object' as const, properties: {
    operation: { type: 'string', enum: ['create', 'update'] }, kind: { type: 'string', enum: ['outline', 'world', 'scene', 'chapter', 'character'] },
    targetId: { type: ['string', 'null'] }, baseRevision: { type: ['integer', 'null'] },
    proposedTitle: { type: 'string', minLength: 1, maxLength: 120 }, proposedBody: { type: 'string', maxLength: 100000 }, reason: { type: 'string', minLength: 1, maxLength: 4000 },
  }, required: ['operation', 'kind', 'targetId', 'baseRevision', 'proposedTitle', 'proposedBody', 'reason'] } },
  { name: 'get_proposal_status', description: 'Read the status of a proposal in this project.', inputSchema: { type: 'object' as const, properties: { proposalId: { type: 'string' } }, required: ['proposalId'] } },
];

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${root}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...init.headers },
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = payload && typeof payload === 'object' ? payload as { message?: string; error?: string } : {};
    throw new Error(`${error.error ?? 'story_bridge_error'}: ${error.message ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是 JSON 对象。');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`缺少字符串参数 ${name}。`);
  return value;
}
function kind(value: unknown): string {
  const result = text(value, 'kind');
  if (!['outline', 'world', 'scene', 'chapter', 'character'].includes(result)) throw new Error('条目类型不受支持。');
  return result;
}
function render(value: unknown) { return JSON.stringify(value, null, 2); }

const server = new Server({ name: 'sthstart-story-bridge', version: '1.0.0' }, {
  capabilities: { tools: {} },
  instructions: 'Read current SthStart story data as canonical reference. You may submit create/update proposals for human review, but must never claim the proposal changed official content. Do not attempt direct edits through this bridge.',
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const args = asObject(params.arguments ?? {});
    let result: unknown;
    switch (params.name) {
      case 'get_project': result = await request(''); break;
      case 'list_entries': {
        const params = new URLSearchParams();
        if (typeof args.kind === 'string') params.set('kind', kind(args.kind));
        if (typeof args.cursor === 'number' && Number.isSafeInteger(args.cursor) && args.cursor >= 0) params.set('cursor', String(args.cursor));
        if (typeof args.limit === 'number' && Number.isSafeInteger(args.limit) && args.limit >= 1 && args.limit <= 200) params.set('limit', String(args.limit));
        const query = params.size ? `?${params.toString()}` : '';
        result = await request(`/entries${query}`); break;
      }
      case 'read_entry': {
        const entryKind = kind(args.kind);
        const id = text(args.id, 'id');
        const offset = typeof args.offset === 'number' && Number.isSafeInteger(args.offset) && args.offset >= 0 ? args.offset : 0;
        result = await request(`/entries/${encodeURIComponent(entryKind)}/${encodeURIComponent(id)}?offset=${offset}&limit=20000`); break;
      }
      case 'search_entries': {
        const query = text(args.query, 'query').trim();
        if (!query || query.length > 120) throw new Error('搜索词须为 1 到 120 个字符。');
        const params = new URLSearchParams({ q: query, limit: '20' });
        if (typeof args.kind === 'string') params.set('kind', kind(args.kind));
        if (typeof args.cursor === 'number' && Number.isSafeInteger(args.cursor) && args.cursor >= 0) params.set('cursor', String(args.cursor));
        result = await request(`/search?${params.toString()}`); break;
      }
      case 'submit_proposal': {
        const operation = text(args.operation, 'operation');
        if (operation !== 'create' && operation !== 'update') throw new Error('操作类型只能是 create 或 update。');
        const entryKind = kind(args.kind);
        const targetId = args.targetId;
        const baseRevision = args.baseRevision;
        if (operation === 'update' && (typeof targetId !== 'string' || !targetId || typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 1)) {
          throw new Error('更新提案必须提供目标 ID 和读取时的正整数版本号。');
        }
        if (operation === 'create' && (entryKind === 'outline' || targetId !== null || baseRevision !== null)) {
          throw new Error('新建提案不能新建大纲，目标 ID 和基准版本必须为 null。');
        }
        const proposal: CreateNativeStoryProposal = {
          operation,
          kind: entryKind as CreateNativeStoryProposal['kind'],
          targetId: targetId as string | null,
          baseRevision: baseRevision as number | null,
          proposedTitle: text(args.proposedTitle, 'proposedTitle'),
          proposedBody: text(args.proposedBody, 'proposedBody'),
          reason: text(args.reason, 'reason'),
        } as CreateNativeStoryProposal;
        result = await request('/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proposal) }); break;
      }
      case 'get_proposal_status': {
        const id = text(args.proposalId, 'proposalId');
        result = await request(`/proposals/${encodeURIComponent(id)}`); break;
      }
      default: throw new Error('未知的 Story 工具。');
    }
    return { content: [{ type: 'text' as const, text: render(result) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : '剧情桥接调用失败。' }] };
  }
});

await server.connect(new StdioServerTransport());
