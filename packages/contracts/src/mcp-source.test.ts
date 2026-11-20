import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from '@sinclair/typebox/value';
import {
  McpConnectionTestSchema,
  McpSourceSaveSchema,
  McpSourceSchema,
} from './index.js';

const source = {
  id: 'wiki',
  name: 'Wiki',
  url: 'https://example.com/mcp',
  authMode: 'none',
  applicableWorks: ['原神'],
  universal: false,
  purpose: '资料',
  allowedTools: [],
  status: 'enabled',
  hasCredential: false,
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
};

test('MCP source contracts accept legacy omission and all supported transports', () => {
  assert.equal(Value.Check(McpSourceSchema, source), true);
  assert.equal(Value.Check(McpSourceSaveSchema, {
    name: 'Wiki',
    url: 'https://example.com/mcp',
    authMode: 'none',
    applicableWorks: [],
  }), true);
  for (const transport of ['auto', 'streamable-http', 'sse'] as const) {
    assert.equal(Value.Check(McpSourceSchema, { ...source, transport }), true);
    assert.equal(Value.Check(McpSourceSaveSchema, {
      name: 'Wiki',
      url: 'https://example.com/mcp',
      authMode: 'none',
      applicableWorks: [],
      transport,
    }), true);
    assert.equal(Value.Check(McpConnectionTestSchema, {
      ok: true,
      message: 'connected',
      testedAt: '2026-11-19T00:00:00.000Z',
      transport,
    }), true);
  }
  assert.equal(Value.Check(McpSourceSchema, { ...source, transport: 'websocket' }), false);
  assert.equal(Value.Check(McpSourceSaveSchema, {
    name: 'Wiki',
    url: 'https://example.com/mcp',
    authMode: 'none',
    applicableWorks: [],
    transport: 'websocket',
  }), false);
});
