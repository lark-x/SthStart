import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTextLlm, type CommonLlmResult } from './common-llm.js';

test('length finish reason and partial text reach onResult once without an automatic retry or fallback', async () => {
  let requests = 0;
  const results: CommonLlmResult[] = [];
  const partial = '{"body":"尚未闭合的场景';
  const output = await executeTextLlm({
    profile: {
      id: 'primary', baseUrl: 'https://primary.invalid/v1', model: 'test-reasoning',
      fallbacks: [{ id: 'fallback', baseUrl: 'https://fallback.invalid/v1', model: 'test-fallback' }],
    },
    prompt: '输出场景 JSON', maxTokens: 8192, jsonMode: true,
    fetchFn: async () => {
      requests++;
      return Response.json({ choices: [{ message: { content: partial }, finish_reason: 'length' }],
        usage: { prompt_tokens: 9781, completion_tokens: 8192, total_tokens: 17973,
          completion_tokens_details: { reasoning_tokens: 6139 } } });
    },
    onResult: result => results.push(result),
  });
  assert.equal(output, partial);
  assert.equal(requests, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].finishReason, 'length');
  assert.equal(results[0].text, partial);
  assert.equal(results[0].profileId, 'primary');
  assert.equal(results[0].tokenUsage?.total_tokens, 17973);
});

test('finish reason is optional and only a string from the selected first choice is exposed', async () => {
  for (const reason of ['stop', 'content_filter', undefined, null, 42, { reason: 'length' }]) {
    const results: CommonLlmResult[] = [];
    const output = await executeTextLlm({
      profile: { baseUrl: 'https://output.invalid/v1', model: 'test' }, prompt: '输出文本',
      fetchFn: async () => Response.json({ choices: [
        { message: { content: '首个结果' }, ...(reason === undefined ? {} : { finish_reason: reason }) },
        { message: { content: '后续结果' }, finish_reason: 'length' },
      ] }),
      onResult: result => results.push(result),
    });
    assert.equal(output, '首个结果');
    assert.equal(results.length, 1);
    assert.equal(results[0].finishReason, typeof reason === 'string' ? reason : undefined);
    if (typeof reason !== 'string') assert.equal(Object.hasOwn(results[0], 'finishReason'), false);
  }
});
