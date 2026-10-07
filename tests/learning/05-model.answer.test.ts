import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTextLlm, parseCommonAiJson } from '../../apps/service/src/llm/common-llm.js';

test('参考答案：模拟供应商失败、空内容与 JSON 外壳，不调用真实模型', async () => {
  const profile = { baseUrl: 'https://model.example.invalid/v1', model: 'learning-model', secret: 'fake-learning-secret' };
  await assert.rejects(() => executeTextLlm({ profile, prompt: '练习', fetchFn: async () => new Response('rate limited', { status: 429 }) }), /429/);
  await assert.rejects(() => executeTextLlm({ profile, prompt: '练习', fetchFn: async () => Response.json({ choices: [] }) }), /为空/);
  assert.deepEqual(parseCommonAiJson('结果：\n```json\n{"ok":true}\n```'), { ok: true });
});
