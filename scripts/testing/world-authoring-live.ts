import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { WorldAuthoringDraft, WorldSuggestionRequest, WorldSuggestionResponse } from '@sthstart/contracts';
import { collectAiCallRedactionSecrets, redactAiValue } from '../../apps/service/src/ai-call-trace.js';
import { readConfig } from '../../apps/service/src/config.js';
import { ServiceDatabase } from '../../apps/service/src/database.js';
import { SecretStore } from '../../apps/service/src/security.js';
import { resolveEffectiveModelProfile } from '../../apps/service/src/providers.js';
import { suggestWorldFields, WorldSuggestionError } from '../../apps/service/src/story-worlds/suggestions.js';

type StoredValue = string | number | bigint | null | Uint8Array;
type StoredRow = Record<string, StoredValue>;

interface LiveOptions {
  databasePath: string;
  outputPath: string;
  help: boolean;
}

interface ConfigSnapshot {
  apps: StoredRow[];
  purposeBindings: StoredRow[];
  assignments: StoredRow[];
  connections: StoredRow[];
  modelProfiles: StoredRow[];
  providerProfiles: StoredRow[];
  providerOptions: StoredRow[];
}

interface LiveReport {
  schemaVersion: number;
  status: 'running' | 'passed' | 'failed' | 'environment-unavailable';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  databaseMode: 'readonly-source-copy';
  retry: 'never';
  model?: string;
  request?: {
    scope: WorldSuggestionRequest['scope'];
    sourceId: string;
    requestedTargets: ['summary', 'direction'];
    requestCount: 1;
  };
  result?: {
    draftFingerprint: string;
    candidates: WorldSuggestionResponse['candidates'];
    gaps: string[];
  };
  checks?: {
    passed: boolean;
    errors: string[];
    candidateCount: number;
    sourceCited: boolean;
    chinese: boolean;
    portStory: boolean;
    originality: 'manual-review';
  };
  audit?: unknown;
  error?: { code: string; message: string; statusCode?: number };
  manualReview: 'pending';
}

const sourceId = 'live-harbor-source';
const projectRoot = resolve(import.meta.dirname, '../..');

function parseLiveArgs(args: string[]): LiveOptions {
  let databasePath = readConfig().databasePath;
  let outputPath = resolve(projectRoot, `artifacts/testing/world-authoring-live-${Date.now()}.json`);
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      help = true;
    } else if (argument === '--database' || argument === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} 缺少参数`);
      if (argument === '--database') databasePath = resolve(value);
      else outputPath = resolve(value);
      index += 1;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  return { databasePath, outputPath, help };
}

function unavailable(message: string) {
  return Object.assign(new Error(message), {
    unavailable: true,
    code: 'environment_unavailable',
  });
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableExists(database: DatabaseSync, table: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function readTable(database: DatabaseSync, table: string, sql: string, parameters: string[] = []) {
  if (!tableExists(database, table)) return [];
  return database.prepare(sql).all(...parameters) as StoredRow[];
}

function selectByIds(database: DatabaseSync, table: string, ids: string[]) {
  if (!ids.length || !tableExists(database, table)) return [];
  const placeholders = ids.map(() => '?').join(',');
  return database.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE id IN (${placeholders})`).all(...ids) as StoredRow[];
}

function selectProviderOptions(database: DatabaseSync, ids: string[]) {
  if (!ids.length || !tableExists(database, 'provider_profile_options')) return [];
  const placeholders = ids.map(() => '?').join(',');
  return database.prepare(`SELECT * FROM provider_profile_options WHERE profile_id IN (${placeholders})`).all(...ids) as StoredRow[];
}

function readConfigSnapshot(source: DatabaseSync): ConfigSnapshot {
  const apps = readTable(source, 'managed_apps', "SELECT * FROM managed_apps WHERE id='story-worlds'");
  if (!apps.length) throw unavailable('现有数据库没有 story-worlds 应用配置。');
  if (!Number(apps[0].enabled)) throw unavailable('故事世界应用已停用。');
  const purposeBindings = readTable(source, 'purpose_bindings', "SELECT * FROM purpose_bindings WHERE app_id='story-worlds'");
  const assignments = readTable(source, 'app_llm_assignments', "SELECT * FROM app_llm_assignments WHERE app_id='story-worlds'");
  const requestedIds = new Set<string>();
  for (const row of purposeBindings) {
    if (row.target_type === 'model' && typeof row.target_id === 'string') requestedIds.add(row.target_id);
  }
  for (const row of assignments) {
    if (typeof row.profile_id === 'string') requestedIds.add(row.profile_id);
  }
  const requested = [...requestedIds];
  const modelProfiles = selectByIds(source, 'model_profiles', requested);
  const providerProfiles = selectByIds(source, 'provider_profiles', requested);
  const connectionIds = [...new Set(modelProfiles
    .map((row) => row.connection_id)
    .filter((value): value is string => typeof value === 'string'))];
  const connections = selectByIds(source, 'service_connections', connectionIds);
  const providerOptions = selectProviderOptions(source, providerProfiles
    .map((row) => row.id)
    .filter((value): value is string => typeof value === 'string'));
  return { apps, purposeBindings, assignments, connections, modelProfiles, providerProfiles, providerOptions };
}

function copyRows(target: ServiceDatabase, table: string, rows: StoredRow[]) {
  if (!rows.length) return;
  const targetColumns = new Set((target.connection.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as StoredRow[])
    .map((row) => String(row.name)));
  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => targetColumns.has(column));
    if (!columns.length) continue;
    const values = columns.map((column) => row[column]);
    target.connection.prepare(
      `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(',')}) `
      + `VALUES (${columns.map(() => '?').join(',')})`,
    ).run(...values);
  }
}

function copyConfig(target: ServiceDatabase, snapshot: ConfigSnapshot) {
  copyRows(target, 'managed_apps', snapshot.apps);
  copyRows(target, 'provider_profiles', snapshot.providerProfiles);
  copyRows(target, 'provider_profile_options', snapshot.providerOptions);
  copyRows(target, 'service_connections', snapshot.connections);
  copyRows(target, 'model_profiles', snapshot.modelProfiles);
  copyRows(target, 'purpose_bindings', snapshot.purposeBindings);
  copyRows(target, 'app_llm_assignments', snapshot.assignments);
}

function acceptanceDraft(capturedAt: string): WorldAuthoringDraft {
  return {
    definition: {
      title: '真实模型验收港口',
      summary: '',
      timeLabel: '',
      locations: [],
      actors: [],
      sources: [{
        id: sourceId,
        title: '验收专用港口资料',
        nature: 'author',
        content: '旧港在冬季封航，三号码头的钟楼每天黄昏敲响。守港人以潮汐表和旧航海日志判断冰情，灯塔守望者只信任海鸥带来的预兆。',
        sourceUrl: '',
        sourceVersion: 'live-acceptance-1',
        capturedAt,
      }],
      lockedFacts: [],
      models: { action: null, adjudication: null, narration: null },
      visualStyle: '',
    },
    initialBranch: { title: '验收主线', mode: 'canon-gap', direction: '' },
  };
}

function acceptanceRequest(draft: WorldAuthoringDraft) {
  const instruction = [
    '本次为真实模型验收，只生成两个候选：一个 summary、一个 direction，禁止其他 target。',
    'summary 写约 120 到 220 字的中文原创港口小故事摘要，必须是创作，不得声称是原作事实；',
    `sourceIds 必须包含 ${sourceId}。`,
    'direction 写约 60 到 140 字的中文故事方向，可以是无来源依据的创作建议。',
    '除这两个候选外不要输出其他候选，gaps 可以为空。',
  ].join('');
  const request: WorldSuggestionRequest = {
    draft,
    instruction,
    scope: 'all',
    draftFingerprint: createHash('sha256').update(JSON.stringify(draft)).digest('hex'),
  };
  return request;
}

function checkAcceptance(response: WorldSuggestionResponse) {
  const errors: string[] = [];
  const summaryCandidates = response.candidates.filter((candidate) => candidate.target === 'summary');
  const directionCandidates = response.candidates.filter((candidate) => candidate.target === 'direction');
  if (response.candidates.length !== 2) errors.push(`候选数量为 ${response.candidates.length}，要求恰好 2 个。`);
  if (summaryCandidates.length !== 1) errors.push('summary 候选必须恰好 1 个。');
  if (directionCandidates.length !== 1) errors.push('direction 候选必须恰好 1 个。');
  const unexpected = response.candidates.filter((candidate) => candidate.target !== 'summary' && candidate.target !== 'direction');
  if (unexpected.length) errors.push(`出现未要求的 target：${unexpected.map((candidate) => candidate.target).join('、')}。`);
  const summary = summaryCandidates[0]?.value;
  const direction = directionCandidates[0]?.value;
  if (typeof summary !== 'string' || !summary.trim()) errors.push('summary 必须是非空字符串。');
  if (typeof direction !== 'string' || !direction.trim()) errors.push('direction 必须是非空字符串。');
  const chinese = [summary, direction].every((value) => typeof value === 'string' && /[\u4e00-\u9fff]/.test(value));
  if (!chinese) errors.push('summary 与 direction 必须包含中文。');
  if (typeof summary === 'string' && summary.trim().length < 60) errors.push('summary 少于 60 字符，内容过短。');
  if (typeof direction === 'string' && direction.trim().length < 20) errors.push('direction 少于 20 字符，内容过短。');
  const sourceCited = Boolean(summaryCandidates[0]?.sourceIds.includes(sourceId));
  if (!sourceCited) errors.push(`summary 未引用指定资料 ${sourceId}。`);
  const portStory = /港口|码头|海港|灯塔|船|潮|港湾/.test(`${summary ?? ''}${direction ?? ''}`);
  if (!portStory) errors.push('结果没有体现港口小故事主题。');
  return {
    passed: errors.length === 0,
    errors,
    candidateCount: response.candidates.length,
    sourceCited,
    chinese,
    portStory,
    originality: 'manual-review' as const,
  };
}

function sha256(value: unknown) {
  if (value == null) return null;
  return createHash('sha256').update(String(value)).digest('hex');
}

function parseJson(value: unknown) {
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    return null;
  }
}

function auditSummary(database: ServiceDatabase, knownSecrets: readonly string[], includeResponseText: boolean) {
  const rows = database.connection.prepare(`SELECT status,error_code,feature,business_event,object_type,
    models_json,usage_json,duration_ms,requested_at,ended_at,request_snapshot_json,positive_prompt,response_text,error_message
    FROM ai_call_records WHERE application_id='story-worlds' ORDER BY requested_at DESC,id DESC LIMIT 5`).all() as StoredRow[];
  const summary = {
    callCount: rows.length,
    records: rows.map((row) => ({
      status: String(row.status),
      errorCode: row.error_code == null ? null : String(row.error_code),
      feature: String(row.feature),
      businessEvent: String(row.business_event),
      objectType: row.object_type == null ? null : String(row.object_type),
      models: parseJson(row.models_json),
      usage: parseJson(row.usage_json),
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      requestedAt: String(row.requested_at),
      endedAt: row.ended_at == null ? null : String(row.ended_at),
      requestHash: sha256(row.request_snapshot_json),
      promptHash: sha256(row.positive_prompt),
      responseHash: sha256(row.response_text),
      errorHash: sha256(row.error_message),
      ...(includeResponseText && row.response_text != null
        ? { responseText: String(redactAiValue(String(row.response_text), '', knownSecrets)) }
        : {}),
    })),
  };
  return redactAiValue(summary, '', knownSecrets);
}

function failureReport(error: unknown) {
  if (error instanceof WorldSuggestionError) {
    return { status: 'failed' as const, code: error.code, statusCode: error.statusCode, message: error.message };
  }
  if (error && typeof error === 'object' && 'unavailable' in error) {
    const unavailableError = error as unknown as Error & { code?: string };
    return { status: 'environment-unavailable' as const, code: unavailableError.code ?? 'environment_unavailable',
      message: unavailableError.message };
  }
  return { status: 'failed' as const, code: 'world_authoring_live_failed',
    message: '验收运行失败；请检查参数、模型配置和运行目录。' };
}

export async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let options: LiveOptions | undefined;
  let source: DatabaseSync | undefined;
  let temporary: ServiceDatabase | undefined;
  let temporaryDirectory: string | undefined;
  let knownSecrets: string[] = [];
  const report: LiveReport = {
    schemaVersion: 1,
    status: 'running',
    startedAt,
    databaseMode: 'readonly-source-copy',
    retry: 'never',
    manualReview: 'pending',
  };
  try {
    const envFile = resolve(projectRoot, '.env');
    if (existsSync(envFile)) loadEnvFile(envFile);
    options = parseLiveArgs(args);
    if (options.help) {
      console.log('用法：node --import tsx/esm scripts/testing/world-authoring-live.ts [--database 数据库路径] [--output 报告文件]');
      return 0;
    }
    if (!existsSync(options.databasePath)) throw unavailable('指定的现有数据库不存在。');
    source = new DatabaseSync(options.databasePath, { readOnly: true });
    const snapshot = readConfigSnapshot(source);
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sthstart-world-authoring-live-'));
    temporary = new ServiceDatabase(join(temporaryDirectory, 'service.db'));
    copyConfig(temporary, snapshot);
    const secrets = new SecretStore();
    const profile = await resolveEffectiveModelProfile(temporary, secrets, 'story-worlds', 'authoring');
    if (!profile?.model?.trim()) throw unavailable('故事世界 authoring 模型未配置或已禁用。');
    let hostname = '';
    try {
      hostname = new URL(profile.baseUrl).hostname;
    } catch {
      throw unavailable('模型连接地址无效，请检查模型配置。');
    }
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
    if (!local && !profile.secret && !Object.keys(profile.headers).some((key) => /authorization|api[-_]?key/i.test(key))) {
      throw unavailable('模型凭据不可用，请检查凭据库或对应环境变量。');
    }
    knownSecrets = collectAiCallRedactionSecrets(profile);
    report.model = profile.model;
    const draft = acceptanceDraft(new Date().toISOString());
    const request = acceptanceRequest(draft);
    report.request = {
      scope: request.scope,
      sourceId,
      requestedTargets: ['summary', 'direction'],
      requestCount: 1,
    };
    const response = await suggestWorldFields(request, { database: temporary, secrets });
    const checks = checkAcceptance(response);
    report.result = {
      draftFingerprint: response.draftFingerprint,
      candidates: redactAiValue(response.candidates, '', knownSecrets) as WorldSuggestionResponse['candidates'],
      gaps: redactAiValue(response.gaps, '', knownSecrets) as string[],
    };
    report.checks = checks;
    report.status = checks.passed ? 'passed' : 'failed';
  } catch (error) {
    const failure = failureReport(error);
    report.status = failure.status;
    report.error = { code: failure.code, message: failure.message };
    if ('statusCode' in failure && failure.statusCode) report.error.statusCode = failure.statusCode;
  } finally {
    if (temporary) {
      try {
        report.audit = auditSummary(temporary, knownSecrets, report.status !== 'passed');
      } catch {
        report.audit = { callCount: 0, records: [], summaryUnavailable: true };
      }
      try {
        temporary.close();
      } catch {
        void 0;
      }
    }
    try {
      source?.close();
    } catch {
      void 0;
    }
    if (temporaryDirectory) {
      try {
        await rm(temporaryDirectory, { recursive: true, force: true });
      } catch {
        console.error('临时数据库清理失败。');
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - started;
  const safeReport = redactAiValue(report, '', knownSecrets);
  if (!options) {
    console.error('验收参数解析失败。');
    return 1;
  }
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, JSON.stringify(safeReport, null, 2) + '\n', 'utf8');
  console.log(`真实故事世界建议验收：${report.status}；报告：${options.outputPath}`);
  return report.status === 'passed' ? 0 : report.status === 'environment-unavailable' ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
