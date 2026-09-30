import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTextLlm, parseCommonAiJson } from './common-llm.js';
import { ServiceDatabase } from '../database.js';

test('executeTextLlm sends OpenAI-compatible payload with custom systemPrompt and logs correct applicationId', async () => {
  const db = new ServiceDatabase(':memory:');

  let interceptedUrl = '';
  let interceptedInit: RequestInit | undefined;

  const mockFetcher: typeof fetch = async (input, init) => {
    interceptedUrl = String(input);
    interceptedInit = init;
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"answer":"ok"}' },
            finish_reason: 'stop',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await executeTextLlm({
    profile: {
      id: 'profile-topics-1',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      secret: 'sk-test-secret-123456',
      model: 'deepseek-chat',
      headers: { 'X-Custom-Header': 'CustomVal' },
    },
    prompt: '请分析当前热门题材。',
    systemPrompt: '你是一名题材分析师。',
    fetchFn: mockFetcher,
    audit: {
      database: db,
      applicationId: 'topics',
      feature: 'topic-collection',
      businessEvent: 'topics.collection.test',
      traceId: 'trace-test-1',
    },
  });

  assert.equal(result, '{"answer":"ok"}');
  assert.equal(interceptedUrl, 'https://api.deepseek.com/v1/chat/completions');

  assert.ok(interceptedInit);
  assert.equal(interceptedInit.method, 'POST');
  const headers = interceptedInit.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer sk-test-secret-123456');
  assert.equal(headers['X-Custom-Header'], 'CustomVal');

  const payload = JSON.parse(String(interceptedInit.body)) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(payload.model, 'deepseek-chat');
  assert.equal(payload.messages.length, 2);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.messages[0].content, '你是一名题材分析师。');
  assert.equal(payload.messages[1].role, 'user');
  assert.equal(payload.messages[1].content, '请分析当前热门题材。');

  // 验证审计记录
  const auditedRow = db.connection.prepare('SELECT * FROM ai_call_records WHERE trace_id = ?').get('trace-test-1') as {
    application_id: string;
    feature: string;
    business_event: string;
    provider: string;
  };
  assert.ok(auditedRow);
  assert.equal(auditedRow.application_id, 'topics');
  assert.equal(auditedRow.feature, 'topic-collection');
  assert.equal(auditedRow.business_event, 'topics.collection.test');
});

test('parseCommonAiJson parses bare, fenced, and prose-wrapped JSON', () => {
  assert.deepEqual(parseCommonAiJson('{"key":"value"}'), { key: 'value' });
  assert.deepEqual(parseCommonAiJson('```json\n{"key":"value"}\n```'), { key: 'value' });
  assert.deepEqual(parseCommonAiJson('这里是结果：\n```json\n{"items":[1,2,3]}\n```\n请查收。'), { items: [1, 2, 3] });
  assert.deepEqual(parseCommonAiJson('前言：[{"id":1},{"id":2}] 后记。'), [{ id: 1 }, { id: 2 }]);
});
