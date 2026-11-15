/**
 * Isolated browser service for the story-world authoring page.
 *
 * Every upstream call is served by a deterministic fixture: the OpenAI-compatible
 * chat endpoint answers with the exact candidate envelope the authoring prompt
 * expects, and Tavily answers with the real `/search` and `/extract` response
 * shapes. Any other host is recorded and rejected so no test traffic can escape
 * to a real provider.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppDescriptor, WorldAuthoringDraft, WorldSuggestionCandidate } from '@sthstart/contracts';
import { createService } from '../../apps/service/src/server.js';
import { readConfig } from '../../apps/service/src/config.js';
import { ServiceDatabase } from '../../apps/service/src/database.js';
import { SecretStore } from '../../apps/service/src/security.js';

const PORTAL_ORIGIN = 'http://127.0.0.1:4983';
const SERVICE_PORT = '4984';
const ADMIN_TOKEN = 'story-worlds-isolated-e2e-admin-token-4974';
const SESSION_SECRET = 'story-worlds-isolated-e2e-session-token-4973';
const TAVILY_KEY = 'tvly-world-authoring-fixture';

const directory = mkdtempSync(join(tmpdir(), 'sthstart-world-authoring-'));
const config = readConfig({
  SERVICE_PORT,
  PORTAL_ORIGINS: PORTAL_ORIGIN,
  STHSTART_ADMIN_TOKEN: ADMIN_TOKEN,
  STHSTART_SESSION_SECRET: SESSION_SECRET,
  STHSTART_DATABASE_PATH: join(directory, 'service.db'),
  STHSTART_NARRATIVE_DATABASE_PATH: join(directory, 'narrative.db'),
  STHSTART_ARTIFACT_DIR: join(directory, 'artifacts'),
  STHSTART_LOG_DIR: join(directory, 'logs'),
  STHSTART_LAN_ACCESS: 'false',
});
const database = new ServiceDatabase(config.databasePath);
const stamp = new Date().toISOString();

database.connection.prepare(
  'INSERT INTO provider_profiles(id,name,kind,base_url,model,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
).run('world-test-model', '隔离文本模型', 'llm', 'https://world-test.invalid/v1', 'fixture-story-model', stamp, stamp);
database.connection.prepare(
  "INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,'omit','{}','{}',?)",
).run('world-test-model', JSON.stringify(['text']));
database.connection.prepare(
  "INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('story-worlds','故事世界','fixture-hash','[]',1,?,?)",
).run(stamp, stamp);
database.connection.prepare(
  "INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('story-worlds','text',?,?)",
).run('world-test-model', stamp);
// authoring 用途只声明“继承应用默认”，实际模型来自 story-worlds 的文本模型分配。
database.connection.prepare(
  "INSERT INTO purpose_bindings(id,app_id,purpose_key,target_type,target_id,inherit_app_default,updated_at) VALUES (?,?,?,?,?,1,?)",
).run('purpose-authoring-inherit', 'story-worlds', 'authoring', 'model', 'world-test-model', stamp);
database.connection.prepare(
  "INSERT INTO sw_authoring_settings(id,data_json,updated_at) VALUES ('tavily',?,?)",
).run(JSON.stringify({ enabled: true }), stamp);

// 真实角色库版本：用于验证“导入角色版本快照”“AI 不得改写绑定与媒体”的边界。
const characterDraft = (name: string, persona: string) => JSON.stringify({
  schemaVersion: 2,
  displayName: name,
  englishName: '',
  aliases: [],
  originType: 'original',
  work: '雾港纪事',
  summary: `${name}的公开摘要。`,
  personaText: persona,
  speechText: `${name}说话简短，常引用潮位。`,
  dialogueExamples: [],
  behaviorRules: '',
  appearance: { baseText: `${name}穿深蓝防水外套。`, defaultOutfitText: '值夜装' },
  birthday: { status: 'unset', calendar: 'unknown', source: 'manual' },
});
database.connection.prepare(
  `INSERT INTO character_profiles (id, slug, display_name, draft_json, latest_version, created_at, updated_at)
   VALUES ('char-tidekeeper','tidekeeper','潮汐记录员',?,2,?,?)`,
).run(characterDraft('潮汐记录员', '在灯塔值夜二十年。'), stamp, stamp);
database.connection.prepare(
  `INSERT INTO character_versions (character_id, version, data_json, compiled_linshe_prompt, created_at)
   VALUES ('char-tidekeeper',1,?,'v1',?),('char-tidekeeper',2,?,'v2',?)`,
).run(
  characterDraft('潮汐记录员', '第一版：刚接手灯塔。'), stamp,
  characterDraft('潮汐记录员', '第二版：已值夜二十年。'), stamp,
);

// 一篇真实的笔记修订：用于验证“资料库/笔记的新版本只更新同一来源，不新增副本”。
const noteId = 'note-world-tide-upgrade';
const noteContentV1 = '第一版资料：港口每天只校准一次水位。';
const noteContentV2 = '第二版资料：港口每天清晨与午后各校准一次水位，退潮后由守夜人复核。';
database.connection.prepare(
  `INSERT INTO creative_notes
   (id,title,kind,summary,content_json,tags_json,stage,favorite,created_at,updated_at,revision)
   VALUES (?,?,?,?,?,?,?,0,?,?,2)`,
).run(
  noteId,
  '港口潮汐条例',
  'note',
  '第二版：每天两次水位校准，退潮后复核。',
  JSON.stringify([{ id: 'note-block-1', type: 'text', text: noteContentV2 }]),
  JSON.stringify(['雾港纪事']),
  'reference',
  stamp,
  stamp,
);

// 一张真实落盘的媒体库图片：用于“参考素材只能来自媒体库”与撤销/采纳后媒体不被改写。
const artifactDirectory = config.artifactDirectory;
const mediaId = 'artifact-world-authoring-cover';
const mediaRelative = `world-authoring/${mediaId}.png`;
const mediaAbsolute = join(artifactDirectory, mediaRelative);
mkdirSync(dirname(mediaAbsolute), { recursive: true });
// 1x1 PNG，足够让媒体库把文件判为 ready。
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
writeFileSync(mediaAbsolute, pngBytes);
database.connection.prepare(
  `INSERT INTO artifacts (id, app_id, local_path, storage_key, content_type, media_type, byte_size, file_status, original_name, created_at, updated_at)
   VALUES (?,'story-worlds',?,?,'image/png','image',?,'ready','港口封面.png',?,?)`,
).run(mediaId, mediaAbsolute, mediaRelative, pngBytes.byteLength, stamp, stamp);

type SuggestionMode = 'normal' | 'dependency' | 'tamper-media' | 'tamper-version';
let suggestionMode: SuggestionMode = 'normal';

interface Fixture {
  suggestionCalls: number;
  searchCalls: number;
  extractCalls: number;
  models: string[];
  searchQueries: string[];
  extractUrls: string[][];
  hosts: string[];
  rejected: string[];
}

const fixture: Fixture = {
  suggestionCalls: 0,
  searchCalls: 0,
  extractCalls: 0,
  models: [],
  searchQueries: [],
  extractUrls: [],
  hosts: [],
  rejected: [],
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SuggestionPrompt {
  instruction: string;
  scope: 'all' | 'world' | 'actors' | 'locations' | 'direction';
  allowedSourceIds: string[];
  draft: WorldAuthoringDraft;
}

function newLocationCandidate(id: string, name: string, description: string): WorldSuggestionCandidate {
  return {
    id,
    target: 'location',
    value: { id: `location-${id}`, name, description },
    sourceIds: [],
    dependsOn: [],
    note: '补一个仍能在当前世界简介里站得住脚的开场地点。',
  };
}

function newActorCandidate(
  id: string,
  name: string,
  locationId: string,
  dependsOn: string[],
): WorldSuggestionCandidate {
  return {
    id,
    target: 'actor',
    value: {
      id: `actor-${id}`,
      name,
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: '在潮汐观测站值夜多年，熟悉港口每一次涨落。',
      personality: '克制、耐心，习惯先记录再开口。',
      speechStyle: '句子短，喜欢用潮位和时间作比喻。',
      appearance: '深蓝防水外套，袖口有盐渍。',
      goals: ['把本月潮汐记录整理成册'],
      locationId,
      referenceArtifactIds: [],
    },
    sourceIds: [],
    dependsOn,
    note: '人物落在本次新增的地点；采纳前可继续修改设定。',
  };
}

/** Mirrors the candidate envelope required by apps/service/src/story-worlds/suggestions.ts. */
function candidatesFor(request: SuggestionPrompt): { candidates: WorldSuggestionCandidate[]; gaps: string[] } {
  const sourceId = request.allowedSourceIds[0];
  const summary: WorldSuggestionCandidate = {
    id: 'cand-summary',
    target: 'summary',
    value: '退潮后的港口以潮汐记录维持秩序：每天两次水位校准决定谁能出海，旧灯塔的守夜人负责把结果写进公共册页。',
    sourceIds: sourceId ? [sourceId] : [],
    dependsOn: [],
    note: sourceId ? '依据已加入草稿的网页资料整理，仍需作者核对年代与地名。' : '暂无来源，属于草稿层面的补写。',
  };
  const worldCandidates: WorldSuggestionCandidate[] = [
    { id: 'cand-title', target: 'title', value: '潮汐册页', sourceIds: [], dependsOn: [], note: '更贴近简介里“记录决定出海”的日常秩序。' },
    summary,
    { id: 'cand-time', target: 'timeLabel', value: '第三次退潮 · 雨季', sourceIds: [], dependsOn: [], note: '只改时间标签，不推测具体年份。' },
    { id: 'cand-minute', target: 'startMinuteOfDay', value: 540, sourceIds: [], dependsOn: [], note: '故事从清晨第一次校准开始。' },
    {
      id: 'cand-style',
      target: 'visualStyle',
      value: '日式动画赛璐璐画风，潮湿石材与冷灰海雾，暖色灯火只出现在灯塔窗口。',
      sourceIds: [],
      dependsOn: [],
      note: '在原有画风上补光线与材质，避免只写画派名。',
    },
    {
      id: 'cand-facts',
      target: 'lockedFacts',
      value: ['潮汐记录公开可查，任何人都不能私自改动。', '旧灯塔由守夜人轮班维护。'],
      sourceIds: [],
      dependsOn: [],
      note: '两条都属于简介已写明的事实。',
    },
  ];
  const direction: WorldSuggestionCandidate = {
    id: 'cand-direction',
    target: 'direction',
    value: '从一次异常的低潮开始：记录册出现互相矛盾的潮位，守夜人必须在下一班船出海前找出是谁改了册页。',
    sourceIds: [],
    dependsOn: [],
    note: '把冲突落在记录本身，不新增超自然设定。',
  };
  const location = newLocationCandidate('cand-loc', '旧灯塔', '石砌灯塔与潮位刻度墙，夜里只亮一盏灯。');
  const actor = newActorCandidate(
    'cand-actor',
    '潮汐记录员',
    (location.value as { id: string }).id,
    [location.id],
  );

  if (suggestionMode === 'dependency') {
    // 新地点 + 依赖它的新人物：验证“勾人物自动补选地点、取消地点阻断采纳”。
    return { candidates: [location, actor], gaps: [] };
  }

  if (suggestionMode === 'tamper-media' || suggestionMode === 'tamper-version') {
    const existing = request.draft.definition.actors.find((item) => item.characterId);
    if (!existing) return { candidates: [worldCandidates[0]], gaps: [] };
    const tampered: WorldSuggestionCandidate = {
      id: 'cand-actor-tampered',
      target: 'actor',
      entityId: existing.id,
      value: {
        ...existing,
        goals: [...existing.goals, '整理本班次的潮位副本'],
        ...(suggestionMode === 'tamper-media'
          ? { referenceArtifactIds: ['artifact-not-in-draft'] }
          : { characterVersion: (existing.characterVersion ?? 1) + 1 }),
      },
      sourceIds: [],
      dependsOn: [],
      note: '故意改写受保护字段，服务端必须拒绝。',
    };
    return { candidates: [tampered], gaps: [] };
  }

  if (request.scope === 'world') return { candidates: worldCandidates, gaps: ['港口的具体年代与海域名称缺少资料来源。'] };
  if (request.scope === 'actors') {
    const existing = request.draft.definition.actors[0];
    const updated = existing
      ? [{
          id: 'cand-actor-existing',
          target: 'actor' as const,
          entityId: existing.id,
          value: {
            ...existing,
            goals: [...existing.goals, '核对上一班留下的潮位记录'],
            personality: existing.personality || '谨慎，先记录再开口。',
          },
          sourceIds: [],
          dependsOn: [],
          note: '只补充目标与性格，角色库绑定和参考媒体保持原样。',
        }]
      : [];
    return {
      candidates: [...updated, newActorCandidate('cand-actor', '潮汐记录员', request.draft.definition.locations[0].id, [])],
      gaps: [],
    };
  }
  if (request.scope === 'locations') return { candidates: [location], gaps: [] };
  if (request.scope === 'direction') return { candidates: [direction], gaps: [] };
  return {
    candidates: [worldCandidates[0], summary, location, actor, direction],
    gaps: ['异常低潮的成因尚未确定，建议由作者决定是否写成自然现象。'],
  };
}

function readUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function tavilySearchResponse(query: string) {
  return {
    query,
    response_time: 0.42,
    request_id: 'fixture-search-request',
    auto_parameters: { topic: 'general', search_depth: 'basic' },
    results: [
      {
        title: '潮汐记录与港口日常 · 地方志摘录',
        url: 'https://harbor-archive.example.org/tide-records',
        content: '港口以两次水位校准决定出海窗口，记录册对所有人公开。旧灯塔由守夜人轮班维护，灯油按班次登记。',
        score: 0.93,
        raw_content: null,
      },
      {
        title: '旧灯塔维护手册',
        url: 'https://lighthouse-notes.example.net/maintenance',
        content: '灯塔灯器每周擦拭一次，刻度墙上的潮位线由当班守夜人复核，任何涂改都要在册页留痕。',
        score: 0.81,
        raw_content: null,
      },
    ],
  };
}

function tavilyExtractResponse(urls: string[]) {
  const ok = urls.find((url) => url.includes('harbor-archive'));
  const failed = urls.find((url) => !url.includes('harbor-archive'));
  return {
    request_id: 'fixture-extract-request',
    response_time: 0.68,
    results: ok
      ? [{
          url: ok,
          raw_content: '潮汐记录与港口日常：港口以两次水位校准决定出海窗口。记录册放在灯塔下的公共木柜里，任何居民都可以翻阅；改动必须由当班守夜人签字。旧灯塔的灯油按班次登记，缺页要当班说明。',
        }]
      : [],
    failed_results: failed ? [{ url: failed, error: '目标站点拒绝了正文抓取（HTTP 403）。' }] : [],
  };
}

const fetcher: typeof fetch = async (input, init) => {
  const url = readUrl(input);
  const parsed = new URL(url);
  fixture.hosts.push(parsed.host);

  if (parsed.host === 'world-test.invalid' && parsed.pathname === '/v1/chat/completions') {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    if (!Array.isArray(body.messages)) throw new Error('fixture denies non-chat upstream call');
    fixture.suggestionCalls += 1;
    fixture.models.push(String(body.model ?? ''));
    const prompt = JSON.parse(body.messages.at(-1)?.content ?? '{}') as SuggestionPrompt;
    if (!prompt.draft?.definition || !prompt.scope) throw new Error('fixture received an unexpected authoring prompt');
    const envelope = candidatesFor(prompt);
    await wait(120);
    return Response.json({
      id: 'chatcmpl-world-authoring-fixture',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(envelope) },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 180, completion_tokens: 320, total_tokens: 500 },
    });
  }

  if (parsed.host === 'api.tavily.com' && parsed.pathname === '/search') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
    fixture.searchCalls += 1;
    fixture.searchQueries.push(String(body.query ?? ''));
    await wait(80);
    return Response.json(tavilySearchResponse(String(body.query ?? '')));
  }

  if (parsed.host === 'api.tavily.com' && parsed.pathname === '/extract') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { urls?: string[] };
    fixture.extractCalls += 1;
    fixture.extractUrls.push([...(body.urls ?? [])]);
    await wait(80);
    return Response.json(tavilyExtractResponse(body.urls ?? []));
  }

  fixture.rejected.push(url);
  throw new Error(`fixture_network_escape: ${url}`);
};

const inspectApp = async (): Promise<AppDescriptor> => ({
  id: 'linshe',
  name: '邻舍.EXE',
  description: '隔离验收中的邻舍占位。',
  launchUrl: 'http://127.0.0.1:5173',
  status: 'offline',
  version: null,
  sourceRevision: null,
  capabilities: ['chat'],
  checkedAt: new Date().toISOString(),
});

const secrets = new SecretStore({ STHSTART_TAVILY_API_KEY: TAVILY_KEY });
const service = await createService({ config, database, secrets, fetcher, inspectApp });

service.app.get('/__fixture', async () => ({ ...fixture, hosts: [...fixture.hosts], rejected: [...fixture.rejected] }));
service.app.get('/__fixture/world-authoring', async () => ({
  mediaId,
  mediaUrl: `/api/admin/media-library/${mediaId}/file`,
  characterId: 'char-tidekeeper',
  characterVersions: [1, 2],
  noteId,
  noteTitle: '港口潮汐条例',
  noteContentV1,
  noteContentV2,
  suggestionMode,
}));
service.app.post('/__fixture/suggestion-mode', async (request) => {
  const body = request.body as { mode?: SuggestionMode } | undefined;
  suggestionMode = body?.mode === 'dependency' || body?.mode === 'tamper-media' || body?.mode === 'tamper-version'
    ? body.mode
    : 'normal';
  return { suggestionMode };
});
service.app.post('/__fixture/reset', async () => {
  fixture.suggestionCalls = 0;
  fixture.searchCalls = 0;
  fixture.extractCalls = 0;
  fixture.models.length = 0;
  fixture.searchQueries.length = 0;
  fixture.extractUrls.length = 0;
  fixture.hosts.length = 0;
  fixture.rejected.length = 0;
  suggestionMode = 'normal';
  return { ok: true };
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await service.app.close();
  database.close();
  rmSync(directory, { recursive: true, force: true });
};
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });

await service.app.listen({ host: '127.0.0.1', port: config.port });
