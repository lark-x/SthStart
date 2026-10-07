import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { readConfig } from '../../apps/service/src/config.js';
import type { ServiceDatabase } from '../../apps/service/src/database.js';
import { SecretStore } from '../../apps/service/src/security.js';
import { resolveEffectiveModelProfile, type ResolvedProfile } from '../../apps/service/src/providers.js';
import { collectAiCallRedactionSecrets, redactAiValue } from '../../apps/service/src/ai-call-trace.js';
import { storyFixture, type Scenario } from '../../tests/ai/fixture.js';
import { grade } from '../../tests/ai/grading.js';

export interface EvalOptions { mode: 'live' | 'compare'; scenario?: string; repeats: number; output?: string; list?: boolean }
export function parseEvalArgs(args: string[]): EvalOptions {
  const mode = args.shift();
  if (mode !== 'live' && mode !== 'compare') throw new Error('使用 live 或 compare');
  const result: EvalOptions = { mode, repeats: mode === 'compare' ? 3 : 1 };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--list') result.list = true;
    else if (['--scenario', '--repeats', '--output'].includes(arg)) {
      const value = args[++index]; if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`);
      if (arg === '--repeats') result.repeats = Number(value);
      else if (arg === '--scenario') result.scenario = value;
      else result.output = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isSafeInteger(result.repeats) || result.repeats < 1) throw new Error('repeats 必须是正整数');
  return result;
}

export async function loadScenarios(): Promise<Scenario[]> {
  const parsed = JSON.parse(await readFile(resolve('tests/ai/scenarios.json'), 'utf8')) as { scenarios: Scenario[] };
  if (!parsed.scenarios.length || new Set(parsed.scenarios.map(item => item.id)).size !== parsed.scenarios.length) throw new Error('评估场景为空或 ID 重复');
  return parsed.scenarios;
}

// A readonly SQLite handle deliberately bypasses ServiceDatabase's migration constructor.
export async function loadCurrentProfile(databasePath = readConfig().databasePath): Promise<ResolvedProfile> {
  if (!existsSync(databasePath)) throw Object.assign(new Error('项目数据库不存在，请先在项目中配置剧情文本模型。'), { unavailable: true });
  const connection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const binding = connection.prepare(`SELECT purpose_key FROM purpose_bindings WHERE app_id='story'
      AND purpose_key IN ('story','writing') AND inherit_app_default=0 LIMIT 1`).get() as { purpose_key: string } | undefined;
    const profile = await resolveEffectiveModelProfile({ connection } as unknown as ServiceDatabase,
      new SecretStore(), 'story', binding?.purpose_key ?? 'story');
    if (!profile?.model) throw Object.assign(new Error('剧情文本模型未配置或已禁用；不回退到其他模型。'), { unavailable: true });
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(profile.baseUrl).hostname);
    if (!local && !profile.secret && !Object.keys(profile.headers).some(key => /authorization|api[-_]?key/i.test(key))) {
      throw Object.assign(new Error('当前模型凭据不可用，请检查项目凭据库或对应环境变量。'), { unavailable: true });
    }
    return profile;
  } catch (error) {
    // Do not echo SQL rows, URLs or credential-bearing provider errors to console.
    if (error instanceof Error && 'unavailable' in error) throw error;
    throw Object.assign(new Error('无法只读解析现有剧情模型配置；请检查数据库版本和模型绑定。'), { unavailable: true });
  } finally { connection.close(); }
}

export async function runScenario(scenario: Scenario, profile: ResolvedProfile, variant: 'with_skill' | 'without_skill', fetchFn: typeof fetch = fetch) {
  const startedAt = new Date().toISOString(), started = Date.now();
  const skillSource = await readFile(resolve(`apps/service/src/story/skills/${scenario.skill}/SKILL.md`), 'utf8');
  const skillBody = skillSource.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').trim();
  const skillHash = createHash('sha256').update(skillSource).digest('hex');
  const knownSecrets = collectAiCallRedactionSecrets(profile);
  const requests: unknown[] = [];
  const safe = (value: unknown) => redactAiValue(value, '', knownSecrets);
  const fixture = await storyFixture(scenario, profile, async (input, init) => {
    if (init?.body && typeof init.body === 'string') requests.push(safe(JSON.parse(init.body)));
    const timeout = AbortSignal.timeout(profile.timeoutMs ?? 180000);
    return fetchFn(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  });
  knownSecrets.push(fixture.grant.token, fixture.appToken, fixture.adminToken);
  let harness: DeepSeekHarness | undefined;
  let output = '', error: string | undefined;
  const notifications: unknown[] = [];
  try {
    const skillsDirectory = resolve(fixture.directory, 'skills');
    await mkdir(resolve(skillsDirectory, scenario.skill), { recursive: true });
    if (variant === 'with_skill') await writeFile(resolve(skillsDirectory, scenario.skill, 'SKILL.md'), skillSource);
    let patch = (await readFile(resolve('apps/service/src/story/profile.cordis.patch.yml'), 'utf8'))
      .replace('__STHSTART_STORY_RESUME_SERVER_PATH__', resolve('apps/service/src/story/dsh-resume-server.mjs').replaceAll('\\', '/'))
      .replaceAll('STHSTART_STORY_MCP_TOKEN', 'STHSTART_STORY_BRIDGE_TOKEN')
      .replaceAll('STHSTART_STORY_INTERNAL_URL', 'STHSTART_STORY_PORTAL_URL');
    if (variant === 'without_skill') {
      for (const name of ['story-skill-registry', 'story-skill-filesystem', 'story-skill-tool']) {
        patch = patch.replace(`- id: ${name}\n`, `- id: ${name}\n      disabled: true\n`);
      }
    }
    // Avoid invisible DSH retries: a provider failure remains an experiment failure.
    patch = patch.replace('displayName: SthStart public text model', 'displayName: SthStart public text model\n            retryPolicy:\n              mode: normal\n              maxRetries: 0');
    const patchPath = resolve(fixture.directory, 'eval.patch.yml'); await writeFile(patchPath, patch);
    const env = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, NODE_ENV: process.env.NODE_ENV,
      DSH_TELEMETRY_MODE: 'OFF', STHSTART_STORY_APP_TOKEN: fixture.appToken,
      STHSTART_STORY_LLM_BASE_URL: `${fixture.serviceUrl}/v1`, STHSTART_STORY_MODEL_ID: profile.model!,
      STHSTART_STORY_PROJECT_ID: fixture.project.id, STHSTART_STORY_BRIDGE_TOKEN: fixture.grant.token,
      STHSTART_STORY_PORTAL_URL: fixture.portalUrl,
      STHSTART_STORY_MCP_SOURCE_PATH: resolve('apps/service/src/story/native-mcp-server.ts'),
      STHSTART_STORY_TSX_IMPORT_PATH: import.meta.resolve('tsx/esm'), STHSTART_STORY_SKILLS_DIR: skillsDirectory,
      STHSTART_STORY_RUNTIME_SESSION_ID: `eval-${scenario.id}`, STHSTART_STORY_CONTEXT_WINDOW: '32768',
      STHSTART_STORY_OUTPUT_TOKENS: '4096', STHSTART_STORY_COMPACT_THRESHOLD: '0.75', STHSTART_STORY_RETAIN_TOKENS: '2048',
    };
    harness = new DeepSeekHarness({ profile: 'sdk-minimal', patches: [patchPath], dshHome: resolve(fixture.directory, 'home'),
      processCwd: fixture.directory, cwd: fixture.directory, provider: 'sthstart', model: profile.model!,
      maxTokens: 4096, initializeTimeoutMs: 45000, env });
    const input = `${variant === 'with_skill' ? `/${scenario.skill}\n` : ''}${scenario.prompt}`;
    const interrupt = () => { void harness?.close(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      output = (await harness.run(input, { onNotification: notification => notifications.push(safe(notification)) })).finalResponse;
      if (!output.trim()) error = '模型未返回最终正文';
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  } catch (caught) { error = String(safe(caught instanceof Error ? caught.message : String(caught))); }
  finally { await harness?.close(); }
  try {
    const texts = requests.map(request => JSON.stringify(request).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
    // Look at actual model messages, not the existence of SKILL.md on disk.
    const evidence = requests.flatMap((request, requestIndex) => {
      const messages = (request as { messages?: unknown[] }).messages ?? [];
      return messages.filter(message => {
        const content = (message as { content?: unknown }).content;
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        return text?.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').includes(skillBody);
      }).map(() => ({ requestIndex, bodyHash: createHash('sha256').update(skillBody).digest('hex') }));
    });
    const baselineContaminated = variant === 'without_skill' && texts.some(text => text.includes(skillBody));
    const proposals = fixture.store.listProposals(fixture.project.id);
    const grading = grade({ scenario, output, trace: fixture.trace, skillLoaded: evidence.length > 0, variant,
      canonicalBefore: fixture.canonical(), canonicalAfter: fixture.store.listDocuments(fixture.project.id).map(item => ({ id: item.id, revision: item.revision, body: item.body })), proposals });
    const audit = fixture.db.connection.prepare('SELECT id,status,usage_json,parameters_json,error_code FROM ai_call_records ORDER BY requested_at,id').all();
    return safe({ schemaVersion: 1, scenarioId: scenario.id, variant, startedAt, durationMs: Date.now() - started,
      status: error || baselineContaminated ? 'failed' : grading.automaticStatus,
      error: error ?? (baselineContaminated ? '无 Skill 组受 Skill 指引污染' : undefined),
      model: { profileId: profile.id, modelId: profile.model, thinkingMode: profile.thinkingMode },
      skillHash, skillLoadEvidence: evidence, prompt: scenario.prompt, fixtures: scenario.documents,
      fixtureHash: createHash('sha256').update(JSON.stringify(scenario.documents)).digest('hex'),
      output, trace: fixture.trace, proposals, modelRequests: requests, notifications, audit, grading,
      requestCount: requests.length, manualStatus: 'pending',
    }) as Record<string, unknown>;
  } finally { await fixture.close(); }
}

export function aggregate(runs: Record<string, unknown>[]) {
  return ['with_skill', 'without_skill'].map(variant => {
    const selected = runs.filter(run => run.variant === variant);
    return { variant, runs: selected.length, passed: selected.filter(run => run.status === 'passed').length,
      failed: selected.filter(run => run.status === 'failed').length, requestCount: selected.reduce((sum, run) => sum + Number(run.requestCount ?? 0), 0),
      meanDurationMs: selected.length ? selected.reduce((sum, run) => sum + Number(run.durationMs), 0) / selected.length : null,
      manualReview: 'pending' };
  });
}

export async function main(args = process.argv.slice(2)) {
  let outputDirectory = resolve(`artifacts/ai-evals/${Date.now()}-${process.pid}`);
  const report: { schemaVersion: number; status: string; runs: Record<string, unknown>[]; error?: string; summary?: unknown } = { schemaVersion: 1, status: 'running', runs: [] };
  try {
    const options = parseEvalArgs([...args]);
    if (options.output) outputDirectory = resolve(options.output);
    const scenarios = await loadScenarios();
    if (options.list) { console.log(scenarios.map(item => `${item.id}: ${item.expected}`).join('\n')); return 0; }
    const selected = options.scenario ? scenarios.filter(item => item.id === options.scenario) : options.mode === 'live' ? scenarios.slice(0, 1) : scenarios;
    if (!selected.length) throw new Error('评估场景不存在，拒绝运行空集合。');
    const envFile = resolve('.env'); if (existsSync(envFile)) loadEnvFile(envFile);
    const profile = await loadCurrentProfile();
    await mkdir(outputDirectory, { recursive: true });
    const variants = options.mode === 'compare' ? ['with_skill', 'without_skill'] as const : ['with_skill'] as const;
    for (const scenario of selected) for (let repeat = 1; repeat <= options.repeats; repeat++) {
      // Alternate group order to reduce order/time effects. Every run has a fresh database and session.
      for (const variant of repeat % 2 === 0 ? [...variants].reverse() : variants) {
        console.log(`正在评估 ${scenario.id} · ${variant} · 第 ${repeat} 轮`);
        const result = { ...await runScenario(scenario, profile, variant), repeat };
        const file = `${scenario.id}-${variant}-${repeat}.json`;
        await writeFile(resolve(outputDirectory, file), JSON.stringify(result, null, 2));
        report.runs.push({ ...result, file });
        await writeFile(resolve(outputDirectory, 'report.json'), JSON.stringify({ ...report, summary: aggregate(report.runs) }, null, 2));
      }
    }
    report.status = report.runs.some(run => run.status === 'failed') ? 'failed' : 'passed';
  } catch (error) {
    report.status = error instanceof Error && 'unavailable' in error ? 'environment-unavailable' : 'failed';
    report.error = error instanceof Error && 'unavailable' in error ? error.message : '评估运行失败；检查参数、依赖和运行目录。';
    console.error(report.error);
  }
  report.summary = aggregate(report.runs);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(outputDirectory, 'report.md'), `# 真实 AI 评估\n\n结果：${report.status}。人工复核：待完成。\n\n${report.error ?? ''}\n\n| 场景 | 组别 | 轮次 | 自动检查 | 请求数 | 耗时 ms | 证据与评分 |\n|---|---|---:|---|---:|---:|---|\n` + report.runs.map(run => `| ${run.scenarioId} | ${run.variant} | ${run.repeat} | ${run.status} | ${run.requestCount} | ${run.durationMs} | [查看](${run.file}) |`).join('\n') + '\n\n请在各运行 JSON 的 grading.manualReview 中填写 score 和 evidence；自动通过不代表语义质量通过。\n');
  console.log(`评估报告：${outputDirectory}/report.md`);
  return report.status === 'passed' ? 0 : report.status === 'environment-unavailable' ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
