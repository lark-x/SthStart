import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';
import { ensureEnglishImagePrompt, parseEnglishPromptRewrite } from './image-prompt-language.js';

function cacheKey(prompt: string, negative: string) {
  return `story-image-en-v2:${createHash('sha256').update(`${prompt}\n${negative}\n`).digest('hex').slice(0, 40)}`;
}

test('parses the two-line rewrite and rejects an empty prompt', () => {
  const parsed = parseEnglishPromptRewrite('PROMPT: Two adults repair an unlit brass lantern on a wooden table.\nNEGATIVE: blurry, monochrome');
  assert.equal(parsed.prompt, 'Two adults repair an unlit brass lantern on a wooden table.');
  assert.equal(parsed.negativePrompt, 'blurry, monochrome');
  assert.throws(() => parseEnglishPromptRewrite('NEGATIVE: blurry'), /有效/);
});

test('reuses a cached English prompt without calling the model again', async () => {
  const database = new ServiceDatabase(':memory:');
  const prompt = '清晨，林舟在码头木桌旁修理未点燃的黄铜灯。';
  const negative = '模糊, 低画质';
  const now = new Date().toISOString();
  database.connection.prepare(`INSERT INTO ai_call_records (id,trace_id,application_id,feature,business_event,object_type,object_id,call_type,status,requested_at,parameters_json,positive_prompt,negative_prompt,request_snapshot_json,artifact_ids_json,response_text)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('call-1','trace-1','story-worlds','story-image-prompt-en','story.image.prompt.english','story-image-prompt',cacheKey(prompt,negative),'llm','succeeded',now,'{}',prompt,negative,'{}','[]','{"prompt":"Two adults repair an unlit brass lantern.","negativePrompt":"blurry"}');
  let called = 0;
  const result = await ensureEnglishImagePrompt({ database, secrets: new SecretStore(), appId: 'story-worlds', prompt, negativePrompt: negative,
    workflowId: 'wf', workflowVersion: 2, fetcher: (async () => { called++; throw new Error('must not call'); }) as typeof fetch });
  assert.equal(called, 0);
  assert.equal(result.cached, true);
  assert.equal(result.prompt, 'Two adults repair an unlit brass lantern.');
  database.close();
});

test('refuses to dispatch when no text model is assigned', async () => {
  const database = new ServiceDatabase(':memory:');
  await assert.rejects(() => ensureEnglishImagePrompt({ database, secrets: new SecretStore(), appId: 'story-worlds',
    prompt: '清晨，林舟修理黄铜灯。', negativePrompt: '模糊', workflowId: 'wf', workflowVersion: 2,
    fetcher: (async () => { throw new Error('must not call'); }) as typeof fetch }), /未配置文本模型/);
  database.close();
});
