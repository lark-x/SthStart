import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceDatabase } from '../../apps/service/src/database.js';
import { loadScenarios, loadCurrentProfile, parseEvalArgs, runScenario } from '../../scripts/testing/ai-eval.js';
import { grade } from './grading.js';
import { execute } from '../../scripts/testing/run.mjs';

test('评估场景覆盖两个 Skill，参数拒绝空 ID 和非法重复次数', async () => {
  const scenarios = await loadScenarios();
  assert.equal(scenarios.length, 6);
  assert.equal(new Set(scenarios.map(item => item.skill)).size, 2);
  assert.equal(parseEvalArgs(['compare']).repeats, 3);
  assert.throws(() => parseEvalArgs(['live', '--repeats', '0']));
  assert.throws(() => parseEvalArgs(['live', '--scenario']));
});

test('评分不能把有正文但无角色的编译结果、未加载的 Skill 或修改正式资料判为通过', async () => {
  const scenario = (await loadScenarios()).find(item => item.id === 'flow-normal')!;
  const input = { scenario, output: '<script>任意正文</script>', trace: [], proposals: [], variant: 'with_skill' as const,
    skillLoaded: false, canonicalBefore: ['原文'], canonicalAfter: ['已覆盖'] };
  const result = grade(input);
  for (const name of ['canon-unchanged', 'compiler-shape', 'skill-loaded']) assert.equal(result.assertions.find(item => item.name === name)!.passed, false);
  assert.ok(result.manualReview.every(item => item.score === null));
});

test('现有模型解析只读且不迁移，未配置模型明确不可用', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-profile-'));
  const path = join(directory, 'source.db');
  try {
    const db = new ServiceDatabase(path);
    db.connection.prepare(`INSERT INTO provider_profiles VALUES ('learning','Learning','llm','http://127.0.0.1:1/v1','fake-model',NULL,1,'now','now')`).run();
    db.connection.prepare(`INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('story','text','learning','now')`).run();
    db.close();
    const before = await readFile(path);
    // Windows can retain readonly WAL memory maps until process exit. Exercise a real isolated reader.
    const reader = await execute(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e',
      "import {loadCurrentProfile} from './scripts/testing/ai-eval.ts'; const p=await loadCurrentProfile(process.argv[1]); console.log(p.model);", path]);
    assert.equal(reader.exitCode, 0, reader.output); assert.match(reader.output, /fake-model/);
    assert.deepEqual(await readFile(path), before);
    await assert.rejects(() => loadCurrentProfile(join(directory, 'missing.db')), /不存在/);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('真实 DSH + Skill 加载 + 原生 MCP + 流式模拟供应商，验证有无 Skill 对照并保留审计', { timeout: 120000 }, async () => {
  const scenario = (await loadScenarios()).find(item => item.id === 'flow-normal')!;
  let step = 0;
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: Array<{ role: string; content: string }> };
    const messages = body.messages;
    let delta: Record<string, unknown>;
    if (step++ % 3 === 0) delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'list', type: 'function', function: { name: 'mcp__story__list_entries', arguments: '{"kind":"chapter","limit":1}' } }] };
    else if (step % 3 === 2) {
      const serialized = JSON.stringify(messages);
      const ids = [...serialized.matchAll(/(?:\\"|\")id(?:\\"|\")\s*:\s*(?:\\"|\")([a-f0-9-]{36})/g)];
      const id = ids.at(-1)?.[1];
      assert.ok(id, '列表工具结果应包含真实章节 ID');
      delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'read', type: 'function', function: { name: 'mcp__story__read_entry', arguments: JSON.stringify({ kind: 'chapter', id }) } }] };
    } else delta = { role: 'assistant', content: '<script>### 场景：港口 - 夜\n林遥望向海面。\n派蒙（轻笑）：我们走吧。\n林遥：等钟响后再走。</script>' };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [content, finish] of [[delta, null], [{}, delta.tool_calls ? 'tool_calls' : 'stop']] as const) {
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'eval-fixture', choices: [{ index: 0, delta: content, finish_reason: finish }] })}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  try {
    const address = provider.address(); assert.ok(address && typeof address !== 'string');
    const profile = { id: 'fixture', name: 'fixture', model: 'eval-fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`, secret: 'fake-eval-key',
      thinkingMode: 'omit' as const, headers: {}, extraBody: {}, timeoutMs: 10000 };
    for (const variant of ['with_skill', 'without_skill'] as const) {
      step = 0;
      const result = await runScenario(scenario, profile, variant);
      assert.equal(result.status, 'passed', JSON.stringify({ error: result.error, grading: result.grading }));
      assert.equal(result.requestCount, 3);
      assert.equal((result.skillLoadEvidence as unknown[]).length > 0, variant === 'with_skill');
      assert.equal((result.audit as unknown[]).length, 3);
      assert.ok(!JSON.stringify(result).includes('fake-eval-key'));
    }
  } finally { provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done())); }
});
