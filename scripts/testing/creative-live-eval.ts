import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';
import type {
  CreativeApproval,
  CreativeArtifact,
  CreativeBudget,
  CreativeRun,
  CreativeRunDetail,
  CreativeScope,
  CreativeWorkflowDocument,
  ModelThinkingLevel,
  WorldDefinition,
} from '@sthstart/contracts';
import { readConfig } from '../../apps/service/src/config.js';
import { nowIso, ServiceDatabase } from '../../apps/service/src/database.js';
import { resolveProfile, type ResolvedProfile } from '../../apps/service/src/providers.js';
import { SecretStore } from '../../apps/service/src/security.js';
import { createCreativeService, type CreativeService } from '../../apps/service/src/creative-orchestration/service.js';
import {
  createDefaultIllustrationWorkflow,
  createDefaultStorySceneWorkflow,
} from '../../apps/service/src/creative-orchestration/templates.js';

const EVAL_WORLD_TITLE = '灯潮档案';
const EVAL_SOURCE_ID = 'eval-world-source';
const CHECKPOINT_AFTER = 'main_08';

type LineSelection = 'a' | 'b' | 'both';
type BranchKey = 'main' | 'fork';

interface StoryScenarioSpec {
  id: string;
  branch: BranchKey;
  line: LineSelection;
  title: string;
  focus: string;
  instruction: string;
}

interface ImageScenarioSpec {
  id: string;
  sourceScenarioId: string;
  title: string;
  instruction: string;
}

interface ApprovalFlag {
  id: string;
  hash: string;
}

interface CliOptions {
  help: boolean;
  list: boolean;
  selfCheck: boolean;
  dryRun: boolean;
  storyOnly: boolean;
  maxScenes?: number;
  thinkingLevel?: ModelThinkingLevel;
  probeHealth: boolean;
  execute: boolean;
  resume?: string;
  reviewer?: string;
  sourceDb?: string;
  output?: string;
  models: Record<string, string>;
  imageWorkflow?: { id: string; version: number };
  budget?: CreativeBudget;
  approvals: ApprovalFlag[];
}

interface InventoryModel {
  id: string;
  name: string;
  model: string | null;
  modelType: string;
  capabilities: string[];
  enabled: boolean;
  connectionEnabled: boolean;
  credentialConfigured: boolean;
  available: boolean;
  testStatus: string;
}

interface InventoryWorkflow {
  workflowId: string;
  workflowName: string;
  version: number;
  category: string;
  engineId: string | null;
  engineKind: string | null;
  engineEnabled: boolean;
  credentialConfigured: boolean;
  available: boolean;
  published: boolean;
}

interface SourceInventory {
  schemaVersion: 1;
  generatedAt: string;
  dryRun: true;
  databaseExists: boolean;
  secretBackend: { available: boolean; backend: string | null };
  models: InventoryModel[];
  imageWorkflows: InventoryWorkflow[];
  coverage: {
    storyScenarios: number;
    mainScenarios: number;
    forkScenarios: number;
    extraImages: number;
    availableTextModels: number;
    availableVisionModels: number;
    availableImageWorkflows: number;
  };
  gaps: string[];
  health?: Array<{
    id: string;
    kind: string;
    ok: boolean;
    statusCode: number | null;
    latencyMs: number;
    error?: string;
  }>;
}

interface EvalState {
  worldId: string;
  mainBranchId: string;
  forkBranchId: string | null;
  lineAId: string;
  lineBId: string;
}

interface EvalManifest {
  schemaVersion: 3;
  createdAt: string;
  sourceDatabase: string;
  sourceDatabaseHash: string;
  evalDatabase: string;
  artifactDirectory: string;
  checkpointAfter: string;
  storyOnly: boolean;
  maxScenes: number;
  thinkingLevel: ModelThinkingLevel | null;
  budget: CreativeBudget;
  models: Record<string, string>;
  imageWorkflow: { id: string; version: number } | null;
  storyScenarios: StoryScenarioSpec[];
  extraImageScenarios: ImageScenarioSpec[];
}

interface EvalPlan {
  storyOnly: boolean;
  maxScenes: number;
  thinkingLevel: ModelThinkingLevel | null;
}

const storyScene = (
  id: string,
  branch: BranchKey,
  line: LineSelection,
  title: string,
  focus: string,
  instruction: string,
): StoryScenarioSpec => ({ id, branch, line, title, focus, instruction });

// Exactly 20 story scenes. Main history has 16 scenes; the parallel history
// forks after main_08 and contributes four more.
const STORY_SCENARIOS: readonly StoryScenarioSpec[] = [
  storyScene('main_01', 'main', 'a', '封港前的检索', '建立人物目标与港口异常',
    '林澄在封港前寻找失踪的航标日志；沈砚同时检查潮位。两人必须先行动再交谈，不能等待旁白安排。'),
  storyScene('main_02', 'main', 'b', '旧仓库的交换', '另一故事线自主推进并交换同一事实',
    '沈砚在旧仓库发现被改动的值班表。让沈砚自行决定如何使用这条事实，并让他与林澄发生一次有目的的对话。'),
  storyScene('main_03', 'main', 'a', '潮痕里的名字', '两线共享时间和已确认事实',
    '林澄依据上一场的值班表追查潮痕里的名字；事件应明确关联两条故事线，但不要替角色宣布他们的关系。'),
  storyScene('main_04', 'main', 'both', '灯桥并线', '两线在同一地点汇合',
    '两人从不同线索抵达灯桥。各自保留独立判断，并通过行动而不是台词解释全部设定。'),
  storyScene('main_05', 'main', 'a', '未发送的警报', '新增可延续的悬念',
    '林澄发现一份没有发送的警报记录。让她的选择带来具体下一步，埋下可追踪伏笔但不要马上解释。'),
  storyScene('main_06', 'main', 'b', '泊位上的第二张票', '角色私密知识边界',
    '沈砚只让自己看到第二张船票。通过行动表达隐瞒，不要写成全知旁白。'),
  storyScene('main_07', 'main', 'a', '封门倒计时', '时间压力与资源状态',
    '封门倒计时缩短。林澄必须决定先救人还是先保住证据，并呈现选择造成的可验证状态变化。'),
  storyScene('main_08', 'main', 'b', '潮位记录被调包', '分叉前的共同事实',
    '沈砚确认潮位记录被调包。让两条故事线都拥有这一已发生事实，并保留人物各自知道的范围。完成本场后故事世界将在此刻分叉。'),
  storyScene('main_09', 'main', 'a', '主线：灯桥失火', '分叉后的主线升级',
    '主线历史中灯桥起火。林澄依据分叉前已确认的调包记录行动，不得引用平行分支中尚未发生的事。'),
  storyScene('main_10', 'main', 'b', '主线：第二码头', '主线另一条线继续推进',
    '沈砚在第二码头追踪船票来源，同时保留封港前获得的共同事实和时间顺序。'),
  storyScene('main_11', 'main', 'both', '主线：证词碰撞', '两线共享事件的不同视角',
    '两人的证词发生冲突。让他们各自坚持基于自身经历的解释，并留下可以被后续验证的矛盾。'),
  storyScene('main_12', 'main', 'a', '主线：封港令', '正式设定变化',
    '林澄得到一份需要后续执行的封港令。只把它作为已发生事件记录，不要替未来场景预写结果。'),
  storyScene('main_13', 'main', 'b', '主线：失联一分钟', '悬念与信息缺口',
    '沈砚失联一分钟，只呈现他本人可感知的片段。其他角色不应获得不存在的信息。'),
  storyScene('main_14', 'main', 'a', '主线：灯下对质', '人物自主冲突',
    '林澄与沈砚当面对质，但冲突由两人各自目标推动，不能由旁白强行和解。'),
  storyScene('main_15', 'main', 'both', '主线：双线收束', '多条故事线汇合',
    '两条故事线在同一事件中收束，明确保留此前共享事实，同时停止引入无法延续的新核心设定。'),
  storyScene('main_16', 'main', 'a', '主线：黎明记录', '完整可审核的阶段性交付',
    '林澄在黎明写下本轮记录，交代已发生与仍未解决的线索。场景必须完整、可继续，但不预先采用未审批内容。'),
  storyScene('fork_01', 'fork', 'a', '平行：没有失火', '分叉后立即改变事件路径',
    '平行历史中灯桥没有失火。林澄依据分叉前的潮位与调包事实选择另一条路，不得继承主线第 9 场以后的事件。'),
  storyScene('fork_02', 'fork', 'b', '平行：船票流向', '平行分支另一条线自主行动',
    '沈砚在平行历史追查船票，让港口布局和人物状态服从该分支已有历史。'),
  storyScene('fork_03', 'fork', 'both', '平行：两种证词', '平行分支内部共享事实',
    '两人依据完全相同的前八场历史交换证词，但让事件后果与平行分支的方向一致。'),
  storyScene('fork_04', 'fork', 'b', '平行：未封的港', '平行历史阶段交付',
    '沈砚在港口未封闭的清晨结束本轮，呈现这一分支独有的结局状态，并保留可继续线索。'),
];

const EXTRA_IMAGE_SCENARIOS: readonly ImageScenarioSpec[] = [
  {
    id: 'extra_image_main',
    sourceScenarioId: 'main_08',
    title: '主历史灯桥图',
    instruction: '为分叉前的灯桥场景制作一张写实插图；必须读取真实场景，人物、服装、环境影响与文字事实不得改变。',
  },
  {
    id: 'extra_image_fork',
    sourceScenarioId: 'fork_03',
    title: '平行历史证词图',
    instruction: '为平行历史的两证人场景制作一张写实插图；必须读取对应分支的真实场景，不得借用主线后续事件。',
  },
];

function usage() {
  return [
    'Creative live evaluation',
    '',
    '  --list                         列出 20 个真实故事场景与额外图片验收',
    '  --self-check                   不连数据库、不收费，验证场景分布和预算约束',
    '  --dry-run [--probe-health]     默认模式：只读清点模型、连接、引擎和工作流',
    '  --execute                     创建临时 eval DB 并推进到首个 waiting_approval',
    '  --story-only                  只执行故事验收；不要求 vision/图片工作流，图片项保持 pending',
    '  --max-scenes <1-20>          本 eval 累计最多启动前 N 个故事场景；续跑可显式扩大',
    '  --thinking-level <level>     新 eval 临时复制模型设为 low/medium/high/off/auto；不改生产',
    '  --resume <directory>          恢复已有 eval，缺少人工 approve flags 时继续停住',
    '  --reviewer <label>            人工审批署名，仅与 --resume 和 --approve 同用',
    '  --approve <approvalId> <hash>  重复使用；hash 必须由人工阅读证据后提供',
    '  --source-db <path>            只读源数据库，默认读取 ServiceConfig',
    '  --output <path>               新建 eval 输出目录',
    '  --model <text|vision|role>=<profileId>  可重复；完整 execute 需要 text 与 vision',
    '  --image-workflow <id@version> 已发布的真实图片工作流',
    '  --budget <json>               整个 eval 的统一 CreativeBudget 上限',
  ].join('\n');
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数`);
  return value;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    list: false, selfCheck: false, dryRun: true, storyOnly: false, probeHealth: false,
    execute: false, models: {}, approvals: [],
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--list') options.list = true;
    else if (arg === '--self-check') options.selfCheck = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--story-only') options.storyOnly = true;
    else if (arg === '--max-scenes') {
      const value = requireValue(args, index, arg);
      if (!/^(?:[1-9]|1[0-9]|20)$/.test(value)) {
        throw new Error('--max-scenes 必须是 1 到 20 的整数');
      }
      options.maxScenes = Number(value);
      index++;
    }
    else if (arg === '--thinking-level') {
      const value = requireValue(args, index, arg);
      if (!['low', 'medium', 'high', 'off', 'auto'].includes(value)) {
        throw new Error('--thinking-level 必须是 low、medium、high、off 或 auto');
      }
      options.thinkingLevel = value as ModelThinkingLevel;
      index++;
    }
    else if (arg === '--probe-health') options.probeHealth = true;
    else if (arg === '--execute') {
      options.execute = true;
      options.dryRun = false;
    } else if (arg === '--resume') {
      options.resume = resolve(requireValue(args, index, arg));
      options.dryRun = false;
      index++;
    } else if (arg === '--reviewer') {
      options.reviewer = requireValue(args, index, arg).trim();
      index++;
    } else if (arg === '--source-db') {
      options.sourceDb = resolve(requireValue(args, index, arg));
      index++;
    } else if (arg === '--output') {
      options.output = resolve(requireValue(args, index, arg));
      index++;
    } else if (arg === '--model') {
      const value = requireValue(args, index, arg);
      const separator = value.indexOf('=');
      if (separator < 1 || separator === value.length - 1) throw new Error('--model 必须使用 role=profileId');
      options.models[value.slice(0, separator)] = value.slice(separator + 1);
      index++;
    } else if (arg === '--image-workflow') {
      const value = requireValue(args, index, arg);
      const match = /^([A-Za-z0-9_-]+)@([1-9][0-9]*)$/.exec(value);
      if (!match) throw new Error('--image-workflow 必须使用 workflowId@version');
      options.imageWorkflow = { id: match[1], version: Number(match[2]) };
      index++;
    } else if (arg === '--budget') {
      const value = requireValue(args, index, arg);
      const parsed = JSON.parse(value) as Partial<CreativeBudget>;
      if (!Number.isInteger(parsed.maxTextCalls) || parsed.maxTextCalls! < 1
        || !Number.isInteger(parsed.maxImages) || parsed.maxImages! < 0
        || !Number.isInteger(parsed.maxTokens) || parsed.maxTokens! < 100
        || !Number.isInteger(parsed.maxRevisions) || parsed.maxRevisions! < 0
        || parsed.maxRevisions! > 2) {
        throw new Error('--budget 字段超出 CreativeBudget 允许范围');
      }
      options.budget = parsed as CreativeBudget;
      index++;
    } else if (arg === '--approve') {
      const id = requireValue(args, index, arg);
      const hash = args[index + 2];
      if (!hash || hash.startsWith('--')) throw new Error('--approve 需要 approvalId 和 bundleHash');
      options.approvals.push({ id, hash });
      index += 2;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (options.execute && options.resume) throw new Error('--execute 与 --resume 不能同时使用');
  if (options.approvals.length && !options.resume) throw new Error('--approve 只能与 --resume 使用');
  if (options.approvals.length && !options.reviewer) throw new Error('人工审批续跑必须提供 --reviewer');
  if (options.reviewer && !options.approvals.length) throw new Error('--reviewer 必须伴随 --approve');
  if (options.execute && options.storyOnly && (!options.models.text || !options.budget)) {
    throw new Error('--execute --story-only 必须显式提供 text 模型和统一 budget');
  }
  if (options.execute && !options.storyOnly
    && (!options.models.text || !options.models.vision || !options.imageWorkflow || !options.budget)) {
    throw new Error('完整 --execute 必须显式提供 text/vision 模型、图片工作流和统一 budget');
  }
  if (options.storyOnly && options.imageWorkflow) {
    throw new Error('--story-only 与 --image-workflow 不能同时使用');
  }
  if (options.budget) {
    if (options.storyOnly && options.budget.maxImages !== 0) {
      throw new Error('--story-only 的统一 budget 必须设置 maxImages=0');
    }
    if (!options.storyOnly && options.budget.maxImages < EXTRA_IMAGE_SCENARIOS.length) {
      throw new Error('完整评估的统一 budget 至少需要容纳 2 张额外图片');
    }
  }
  return options;
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?",
  ).get(name));
}

function capabilities(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function profileHasCredential(profile: ResolvedProfile | null): boolean {
  return Boolean(profile?.secret || Object.keys(profile?.headers ?? {})
    .some((key) => /^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(key)));
}

async function modelAvailable(
  sourceDatabase: DatabaseSync,
  secrets: SecretStore,
  row: Record<string, unknown>,
): Promise<{ available: boolean; profile: ResolvedProfile | null }> {
  const kind = String(row.model_type ?? 'chat') === 'image'
    ? 'image' : String(row.model_type ?? 'chat') === 'embedding' ? 'vector' : 'llm';
  const wrapper = {
    connection: sourceDatabase,
    transaction: () => { throw new Error('read-only inventory transaction is forbidden'); },
  } as unknown as ServiceDatabase;
  try {
    const profile = await resolveProfile(wrapper, secrets, kind, String(row.id));
    return {
      available: Boolean(profile) && (!row.credential_account || profileHasCredential(profile)),
      profile,
    };
  } catch {
    return { available: false, profile: null };
  }
}

async function engineCredentialConfigured(
  sourceDatabase: DatabaseSync,
  secrets: SecretStore,
  account: unknown,
  connectionId: string,
): Promise<boolean> {
  if (!account) return true;
  const envName = `STHSTART_SECRET_${connectionId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const credential = await secrets.get(String(account), envName);
  return Boolean(credential.value);
}

async function readInventory(
  sourcePath: string,
  secrets: SecretStore,
  requireImageEvaluation = true,
): Promise<SourceInventory> {
  const report: SourceInventory = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    dryRun: true,
    databaseExists: existsSync(sourcePath),
    secretBackend: { available: false, backend: null },
    models: [],
    imageWorkflows: [],
    coverage: {
      storyScenarios: STORY_SCENARIOS.length,
      mainScenarios: STORY_SCENARIOS.filter((item) => item.branch === 'main').length,
      forkScenarios: STORY_SCENARIOS.filter((item) => item.branch === 'fork').length,
      extraImages: EXTRA_IMAGE_SCENARIOS.length,
      availableTextModels: 0,
      availableVisionModels: 0,
      availableImageWorkflows: 0,
    },
    gaps: [],
  };
  const backend = await secrets.status();
  report.secretBackend = { available: backend.available, backend: backend.backend };
  if (!report.databaseExists) {
    report.gaps.push('配置的源数据库不存在；无法盘点模型和生成工作流。');
    return report;
  }
  const database = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    if (!tableExists(database, 'model_profiles') || !tableExists(database, 'service_connections')) {
      report.gaps.push('源数据库缺少模型配置表。');
      return report;
    }
    const modelRows = database.prepare(
      `SELECT mp.id,mp.name,mp.model_id,mp.model_type,mp.capabilities_json,mp.enabled,
              mp.test_status,sc.enabled AS connection_enabled,sc.credential_account
         FROM model_profiles mp
         JOIN service_connections sc ON sc.id=mp.connection_id
        ORDER BY mp.model_type,mp.name,mp.id`,
    ).all() as Array<Record<string, unknown>>;
    for (const row of modelRows) {
      const resolved = await modelAvailable(database, secrets, row);
      const item: InventoryModel = {
        id: String(row.id),
        name: String(row.name),
        model: row.model_id == null ? null : String(row.model_id),
        modelType: String(row.model_type ?? 'chat'),
        capabilities: resolved.profile?.capabilities
          ? [...resolved.profile.capabilities]
          : capabilities(row.capabilities_json),
        enabled: Number(row.enabled) === 1,
        connectionEnabled: Number(row.connection_enabled) === 1,
        credentialConfigured: profileHasCredential(resolved.profile),
        available: resolved.available,
        testStatus: String(row.test_status ?? 'untested'),
      };
      report.models.push(item);
      if (item.available && item.capabilities.includes('text')) {
        report.coverage.availableTextModels++;
      }
      if (item.available && item.capabilities.includes('multimodal')) {
        report.coverage.availableVisionModels++;
      }
    }
    if (tableExists(database, 'generation_workflows')
      && tableExists(database, 'generation_workflow_versions')
      && tableExists(database, 'generation_engines')) {
      const workflowRows = database.prepare(
        `SELECT w.id AS workflow_id,w.name AS workflow_name,v.version,v.is_published,
                v.engine_id,e.kind AS engine_kind,e.enabled AS engine_enabled,e.credential_account
           FROM generation_workflows w
           JOIN generation_workflow_versions v ON v.workflow_id=w.id
           LEFT JOIN generation_engines e ON e.id=v.engine_id
          WHERE v.is_published=1
          ORDER BY w.name,v.version DESC`,
      ).all() as Array<Record<string, unknown>>;
      for (const row of workflowRows) {
        const engineId = row.engine_id == null ? null : String(row.engine_id);
        const credentialConfigured = engineId
          ? await engineCredentialConfigured(database, secrets, row.credential_account, engineId)
          : false;
        const available = Boolean(engineId)
          && Number(row.engine_enabled) === 1
          && Number(row.is_published) === 1
          && credentialConfigured;
        report.imageWorkflows.push({
          workflowId: String(row.workflow_id),
          workflowName: String(row.workflow_name),
          version: Number(row.version),
          category: 'image',
          engineId,
          engineKind: row.engine_kind == null ? null : String(row.engine_kind),
          engineEnabled: Number(row.engine_enabled) === 1,
          credentialConfigured,
          available,
          published: Number(row.is_published) === 1,
        });
      }
    } else if (requireImageEvaluation) {
      report.gaps.push('源数据库缺少生成工作流表。');
    }
  } finally {
    database.close();
  }
  report.coverage.availableImageWorkflows = report.imageWorkflows
    .filter((item) => item.available).length;
  if (!report.coverage.availableTextModels) report.gaps.push('没有可用的文本模型。');
  if (requireImageEvaluation && !report.coverage.availableVisionModels) {
    report.gaps.push('没有可用且凭据就绪的多模态模型；真实图片审核无法运行。');
  }
  if (requireImageEvaluation && !report.coverage.availableImageWorkflows) {
    report.gaps.push('没有可用且已发布的图片工作流。');
  }
  if (!report.secretBackend.available) report.gaps.push('系统 SecretStore 不可用；需要按键环或显式环境变量解析凭据。');
  return report;
}

async function probeSourceHealth(sourcePath: string, secrets: SecretStore) {
  if (!existsSync(sourcePath)) return [{ id: 'source-database', kind: 'database', ok: false,
    statusCode: null, latencyMs: 0, error: '源数据库不存在' }];
  const database = new DatabaseSync(sourcePath, { readOnly: true });
  const results: NonNullable<SourceInventory['health']> = [];
  try {
    if (!tableExists(database, 'service_connections')) return results;
    const rows = database.prepare(
      `SELECT id,kind,base_url,credential_account,headers_json
         FROM service_connections WHERE enabled=1 ORDER BY id`,
    ).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const id = String(row.id), kind = String(row.kind);
      const started = Date.now();
      try {
        const credential = row.credential_account
          ? await secrets.get(String(row.credential_account),
            `STHSTART_SECRET_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)
          : { value: null };
        const headers: Record<string, string> = { accept: 'application/json' };
        for (const [key, value] of Object.entries(JSON.parse(String(row.headers_json ?? '{}')))) {
          if (typeof value === 'string' && !/^(authorization|proxy-authorization|x-api-key|api-key|cookie)$/i.test(key)) {
            headers[key] = value;
          }
        }
        if (credential.value) headers.authorization = `Bearer ${credential.value}`;
        const base = String(row.base_url).replace(/\/+$/, '');
        const url = kind === 'comfyui' ? `${base}/system_stats`
          : kind === 'worker' ? `${base}/health` : `${base}/models`;
        const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(10_000) });
        await response.arrayBuffer();
        results.push({
          id, kind, ok: response.ok, statusCode: response.status,
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        results.push({
          id, kind, ok: false, statusCode: null, latencyMs: Date.now() - started,
          error: safeError(error),
        });
      }
    }
  } finally {
    database.close();
  }
  return results;
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .slice(0, 400);
}

function assertNoEmbeddedHeaderSecret(table: string, row: Record<string, unknown>): void {
  for (const field of ['headers_json']) {
    if (!(field in row) || row[field] == null) continue;
    let value: unknown;
    try { value = JSON.parse(String(row[field])); } catch { continue; }
    const inspect = (item: unknown, path: string): void => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['authorization', 'proxyauthorization', 'xapikey', 'apikey', 'cookie', 'accesstoken', 'token']
          .includes(normalized) && typeof child === 'string' && child.trim()) {
          throw new Error(`${table}.${field}.${path}${key} 含内嵌凭据；请移到 SecretStore。`);
        }
        inspect(child, `${path}${key}.`);
      }
    };
    inspect(value, '');
  }
}

const QUOTE = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
type SqlValue = string | number | null;

function copyRows(
  source: DatabaseSync,
  destination: ServiceDatabase,
  table: string,
  where = '1=1',
  params: SqlValue[] = [],
): number {
  const sourceColumns = (source.prepare(`PRAGMA table_info(${QUOTE(table)})`).all() as Array<{ name: string }>)
    .map((item) => item.name);
  const destinationColumns = new Set(
    (destination.connection.prepare(`PRAGMA table_info(${QUOTE(table)})`).all() as Array<{ name: string }>)
      .map((item) => item.name),
  );
  const columns = sourceColumns.filter((column) => destinationColumns.has(column));
  if (!columns.length) throw new Error(`无法复制 ${table}：目标表不存在或没有兼容列。`);
  const rows = source.prepare(
    `SELECT ${columns.map(QUOTE).join(',')} FROM ${QUOTE(table)} WHERE ${where}`,
  ).all(...params) as Array<Record<string, unknown>>;
  const insert = destination.connection.prepare(
    `INSERT OR IGNORE INTO ${QUOTE(table)} (${columns.map(QUOTE).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  );
  destination.transaction(() => {
    for (const row of rows) {
      assertNoEmbeddedHeaderSecret(table, row);
      const values = columns.map((column) => {
        const value = row[column];
        if (value === undefined || value === null) return null;
        if (['string', 'number', 'bigint'].includes(typeof value)) return value as SqlValue;
        throw new Error(`${table}.${column} 含不支持的二进制或复合值。`);
      });
      insert.run(...values);
    }
  });
  return rows.length;
}

function copySelectedConfiguration(
  sourcePath: string,
  destination: ServiceDatabase,
  modelIds: string[],
  thinkingLevel: ModelThinkingLevel | null,
  workflow?: { id: string; version: number },
): Record<string, number> {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const copied: Record<string, number> = {};
  try {
    for (const table of ['service_connections', 'model_profiles']) {
      if (!tableExists(source, table)) throw new Error(`源数据库缺少 ${table}。`);
    }
    if (workflow) {
      for (const table of ['generation_engines', 'generation_workflows',
        'generation_workflow_versions']) {
        if (!tableExists(source, table)) throw new Error(`源数据库缺少 ${table}。`);
      }
    }
    copied.managed_apps = copyRows(source, destination, 'managed_apps', 'id=?', ['story-worlds']);
    if (!copied.managed_apps) {
      const at = nowIso();
      destination.connection.prepare(
        `INSERT OR IGNORE INTO managed_apps
          (id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
         VALUES ('story-worlds','AI 创作编排','eval-no-token','["story","image","generation"]',1,?,?)`,
      ).run(at, at);
      copied.managed_apps = 1;
    }
    const placeholders = modelIds.map(() => '?').join(',');
    const profiles = source.prepare(
      `SELECT id,connection_id FROM model_profiles WHERE id IN (${placeholders})`,
    ).all(...modelIds) as Array<{ id: string; connection_id: string }>;
    if (profiles.length !== new Set(modelIds).size) {
      const found = new Set(profiles.map((item) => item.id));
      throw new Error(`模型配置不存在：${modelIds.filter((id) => !found.has(id)).join(', ')}`);
    }
    const connectionIds = [...new Set(profiles.map((item) => item.connection_id))];
    copied.service_connections = copyRows(
      source, destination, 'service_connections',
      `id IN (${connectionIds.map(() => '?').join(',')})`, connectionIds,
    );
    copied.model_profiles = copyRows(
      source, destination, 'model_profiles',
      `id IN (${placeholders})`, modelIds,
    );
    if (thinkingLevel) {
      const changed = destination.connection.prepare(
        `UPDATE model_profiles SET thinking_level=?
          WHERE id IN (${placeholders})`,
      ).run(thinkingLevel, ...modelIds);
      if (changed.changes !== modelIds.length) {
        throw new Error('无法为全部临时 eval 模型设置 thinking_level。');
      }
      copied.thinking_level_overrides = modelIds.length;
    }
    if (workflow) {
      copied.generation_workflows = copyRows(
        source, destination, 'generation_workflows', 'id=?', [workflow.id],
      );
      if (!copied.generation_workflows) throw new Error(`图片工作流 ${workflow.id} 不存在。`);
      copied.generation_workflow_versions = copyRows(
        source, destination, 'generation_workflow_versions',
        'workflow_id=? AND version=? AND is_published=1', [workflow.id, workflow.version],
      );
      if (copied.generation_workflow_versions !== 1) {
        throw new Error(`图片工作流 ${workflow.id}@${workflow.version} 不是唯一已发布版本。`);
      }
      const versionRow = source.prepare(
        'SELECT engine_id FROM generation_workflow_versions WHERE workflow_id=? AND version=?',
      ).get(workflow.id, workflow.version) as { engine_id: string | null };
      if (!versionRow.engine_id) throw new Error('图片工作流版本没有绑定生成引擎。');
      copied.generation_engines = copyRows(
        source, destination, 'generation_engines', 'id=?', [versionRow.engine_id],
      );
      if (!copied.generation_engines) throw new Error(`生成引擎 ${versionRow.engine_id} 不存在。`);
      for (const [table, where, params] of [
        ['generation_engine_options', 'engine_id=?', [versionRow.engine_id]],
        ['generation_workers', 'engine_id=?', [versionRow.engine_id]],
        ['generation_workflow_media_versions', 'workflow_id=? AND version=?',
          [workflow.id, workflow.version]],
      ] as Array<[string, string, SqlValue[]]>) {
        if (!tableExists(source, table)) continue;
        copied[table] = copyRows(source, destination, table, where, params);
      }
    }
    return copied;
  } finally {
    source.close();
  }
}

function getMeta(database: ServiceDatabase, key: string): unknown {
  if (!tableExists(database.connection, 'eval_meta')) return undefined;
  const row = database.connection.prepare('SELECT value_json FROM eval_meta WHERE key=?')
    .get(key) as { value_json: string } | undefined;
  return row ? JSON.parse(row.value_json) : undefined;
}

function setMeta(database: ServiceDatabase, key: string, value: unknown): void {
  database.connection.prepare(
    `INSERT INTO eval_meta(key,value_json,updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function acquireLock(outputDirectory: string) {
  await mkdir(outputDirectory, { recursive: true });
  const path = join(outputDirectory, '.lock');
  if (existsSync(path)) {
    const held = JSON.parse(await readFile(path, 'utf8')) as { pid?: number };
    if (held.pid) {
      try { process.kill(held.pid, 0); throw new Error('该 eval 输出目录仍被另一个进程持有。'); }
      catch (error) {
        if (error instanceof Error && error.message.includes('仍被')) throw error;
      }
    }
    await rm(path, { force: true });
  }
  const handle = await open(path, 'wx');
  await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: nowIso() }));
  await handle.close();
  return async () => rm(path, { force: true });
}

function buildWorldDefinition(): WorldDefinition {
  return {
    title: EVAL_WORLD_TITLE,
    summary: '一座即将封港的港城；两条人物线共享同一时间，但每名角色只知道自己经历与获知的事实。',
    timeLabel: '封港前夜至黎明',
    workNature: 'original',
    locations: [
      { id: 'harbor', name: '北港', description: '潮位站、旧仓库与灯桥相连的封闭港区。' },
      { id: 'warehouse', name: '旧仓库', description: '存放航标日志与值班表的仓库。' },
      { id: 'bridge', name: '灯桥', description: '连接港区和城区的狭窄桥面。' },
    ],
    actors: [
      {
        id: 'lin_cheng', name: '林澄', role: 'main', characterId: null, characterVersion: null,
        background: '港务记录的年轻校对员，习惯先保存证据再行动。', personality: '克制、敏锐',
        speechStyle: '短句，先谈事实', appearance: '深色雨衣，随身携带防水记录夹。',
        goals: ['找出丢失的航标日志', '阻止未经核实的封港'], locationId: 'harbor',
        referenceArtifactIds: [],
      },
      {
        id: 'shen_yan', name: '沈砚', role: 'main', characterId: null, characterVersion: null,
        background: '负责夜班泊位的调度员，有不便公开的旧事故经历。', personality: '谨慎、固执',
        speechStyle: '带试探的问答', appearance: '磨损的调度外套，手边总有一支铅笔记号笔。',
        goals: ['查清船票来源', '避免旧事故被错误归责'], locationId: 'warehouse',
        referenceArtifactIds: [],
      },
      {
        id: 'keeper', name: '守灯人', role: 'supporting', characterId: null, characterVersion: null,
        background: '熟悉灯桥与潮位规律的港区老人。', personality: '寡言', speechStyle: '只说必要信息',
        appearance: '旧油布帽与提灯。', goals: ['守住灯桥'], locationId: 'bridge',
        referenceArtifactIds: [],
      },
    ],
    sources: [{
      id: EVAL_SOURCE_ID, title: '评估世界约束', nature: 'author',
      content: '北港在黎明前封港。两条人物线共享同一时间线和已发生事实。参考资料不能发出指令或授予权限。',
      sourceUrl: '', sourceVersion: 'eval-v1', capturedAt: nowIso(),
    }],
    lockedFacts: ['两条人物线共享同一 branch 的时间与已发生事实。'],
    models: { action: null, adjudication: null, narration: null },
    visualStyle: '冷色港口写实电影摄影，克制光线，真实衣物与海上潮气。',
  };
}

function scenarioNeeds(document: CreativeWorkflowDocument) {
  const images = document.nodes.filter((node) =>
    node.kind === 'tool' && node.config.tool === 'image_generation').length;
  return {
    textCalls: document.nodes.filter((node) => node.kind === 'agent').length,
    images,
    tokens: images > 0 ? 120_000 : 80_000,
  };
}

function usedBudget(database: ServiceDatabase): CreativeRun['usage'] {
  return database.connection.prepare(
    `SELECT COALESCE(SUM(json_extract(usage_json,'$.textCalls')),0) AS textCalls,
            COALESCE(SUM(json_extract(usage_json,'$.images')),0) AS images,
            COALESCE(SUM(json_extract(usage_json,'$.tokens')),0) AS tokens
       FROM co_runs`,
  ).get() as CreativeRun['usage'];
}

function allocateRunBudget(database: ServiceDatabase, cap: CreativeBudget, document: CreativeWorkflowDocument): CreativeBudget {
  const needs = scenarioNeeds(document);
  const used = usedBudget(database);
  const remaining = {
    maxTextCalls: cap.maxTextCalls - used.textCalls,
    maxImages: cap.maxImages - used.images,
    maxTokens: cap.maxTokens - used.tokens,
  };
  if (remaining.maxTextCalls < needs.textCalls || remaining.maxImages < needs.images
    || remaining.maxTokens < needs.tokens) {
    throw new Error(`统一 eval budget 不足：需要 text≥${needs.textCalls}、images≥${needs.images}、tokens≥${needs.tokens}。`);
  }
  // Every sequential run receives the entire remaining global envelope. The
  // aggregate usage ledger remains authoritative, so a later run cannot exceed
  // the original cap even when the current call is more expensive than planned.
  return {
    maxTextCalls: remaining.maxTextCalls,
    maxImages: remaining.maxImages,
    maxTokens: remaining.maxTokens,
    maxRevisions: cap.maxRevisions,
  };
}

function workflowByName(service: CreativeService, name: string) {
  const workflow = service.workflows().items.find((item) =>
    item.document.name === name && item.publishedVersion > 0);
  if (!workflow) throw new Error(`缺少已发布工作流：${name}`);
  return workflow;
}

function ensureWorld(service: CreativeService): EvalState {
  const saved = getMeta(service.store.database, 'eval_world') as EvalState | undefined;
  if (saved) return saved;
  const worlds = service.domain.worlds;
  const world = worlds.create(buildWorldDefinition());
  const branch = worlds.createBranch(world.id, {
    title: '主历史', mode: 'alternate', direction: '两条人物线共享同一时间和已发生事实。',
    expectedRevision: world.revision,
  });
  const lineA = worlds.addStoryLine(world.id, branch.id, {
    title: '林澄线', description: '以港务记录和封港决定为主。', actorIds: ['lin_cheng'],
    expectedRevision: branch.revision,
  });
  const afterA = worlds.getBranch(world.id, branch.id);
  const lineB = worlds.addStoryLine(world.id, branch.id, {
    title: '沈砚线', description: '以泊位、船票和旧事故为主。', actorIds: ['shen_yan'],
    expectedRevision: afterA.revision,
  });
  const state: EvalState = {
    worldId: world.id, mainBranchId: branch.id, forkBranchId: null,
    lineAId: lineA.id, lineBId: lineB.id,
  };
  setMeta(service.store.database, 'eval_world', state);
  return state;
}

function ensureFork(service: CreativeService, state: EvalState): EvalState {
  if (state.forkBranchId) return state;
  const world = service.domain.worlds.getWorld(state.worldId);
  const parent = service.domain.worlds.getBranch(state.worldId, state.mainBranchId);
  const fork = service.domain.worlds.createBranch(state.worldId, {
    title: '平行历史', mode: 'alternate',
    direction: '从主历史第 8 场之后分叉；不得继承主线第 9 场及以后的事件。',
    expectedRevision: world.revision, parentBranchId: parent.id, forkTick: parent.currentTick,
  });
  const next = { ...state, forkBranchId: fork.id };
  setMeta(service.store.database, 'eval_world', next);
  return next;
}

function configureRoles(
  service: CreativeService,
  modelIds: Record<string, string>,
  inventory: SourceInventory,
  storyOnly: boolean,
): void {
  const models = new Map(inventory.models.map((item) => [item.id, item]));
  const text = models.get(modelIds.text);
  if (!text?.available || !text.capabilities.includes('text')) {
    throw new Error(`文本模型 ${modelIds.text} 不可用或不支持 text。`);
  }
  const vision = modelIds.vision ? models.get(modelIds.vision) : undefined;
  if (!storyOnly && (!vision?.available || !vision.capabilities.includes('multimodal'))) {
    throw new Error(`vision 模型 ${modelIds.vision} 不可用或不支持 multimodal。`);
  }
  const requiredRoleIds = new Set([
    ...createDefaultStorySceneWorkflow().nodes.map((node) => node.roleId),
    ...(!storyOnly ? createDefaultIllustrationWorkflow().nodes.map((node) => node.roleId) : []),
  ].filter((roleId): roleId is string => Boolean(roleId)));
  for (const role of service.roles().items.filter((item) => requiredRoleIds.has(item.id))) {
    const explicit = modelIds[role.id];
    const selected = explicit ?? (role.capability === 'multimodal' ? modelIds.vision : modelIds.text);
    if (!selected) {
      throw new Error(`岗位 ${role.id} 需要 ${role.capability} 模型，但当前模式未选择。`);
    }
    const model = models.get(selected);
    if (!model?.available || !model.capabilities.includes(role.capability)) {
      throw new Error(`岗位 ${role.id} 选择的模型 ${selected ?? '(未选择)'} 不可用或不支持 ${role.capability}。`);
    }
    if (role.modelId !== selected) service.saveRole({ ...role, modelId: selected });
  }
}

function scenarioScope(state: EvalState, scenario: StoryScenarioSpec): CreativeScope {
  return {
    workName: EVAL_WORLD_TITLE, worldId: state.worldId,
    branchId: scenario.branch === 'fork' ? state.forkBranchId : state.mainBranchId,
    projectId: null,
  };
}

function scenarioLines(state: EvalState, line: LineSelection): string[] {
  return line === 'a' ? [state.lineAId]
    : line === 'b' ? [state.lineBId] : [state.lineAId, state.lineBId];
}

function scenarioKey(id: string): string {
  return `creative-eval-${id}`;
}

function runForScenario(service: CreativeService, id: string): CreativeRun | null {
  const row = service.store.database.connection.prepare(
    'SELECT run_id FROM co_run_keys WHERE idempotency_key=?',
  ).get(scenarioKey(id)) as { run_id: string } | undefined;
  return row ? service.store.getRun(row.run_id) : null;
}

async function saveEvidence(
  service: CreativeService,
  outputDirectory: string,
  scenarioId: string,
  runId: string,
): Promise<CreativeRunDetail> {
  const detail = service.store.detail(runId);
  const directory = join(outputDirectory, 'scenarios', scenarioId);
  await mkdir(directory, { recursive: true });
  const contents = (kind: CreativeArtifact['kind']) => detail.artifacts
    .filter((item) => item.kind === kind)
    .map((item) => ({ artifact: item, content: item.content }));
  await Promise.all([
    writeJson(join(directory, 'run.json'), detail.run),
    writeJson(join(directory, 'nodes.json'), detail.nodes),
    writeJson(join(directory, 'context.json'), contents('context')),
    writeJson(join(directory, 'scene.json'), contents('scene')),
    writeJson(join(directory, 'review.json'), contents('review')),
    writeJson(join(directory, 'image.json'), contents('image')),
    writeJson(join(directory, 'approvals.json'), detail.approvals),
    writeJson(join(directory, 'usage.json'), {
      runId, budget: detail.run.budget, usage: detail.run.usage,
    }),
  ]);
  const calls = service.store.database.connection.prepare(
    `SELECT id,business_event,call_type,status,models_json,usage_json,error_code,error_message
       FROM ai_call_records WHERE trace_id IN (
         SELECT trace_id FROM co_node_runs WHERE run_id=?
       ) ORDER BY requested_at,id`,
  ).all(runId) as Array<Record<string, unknown>>;
  await writeJson(join(directory, 'ai-calls.safe.json'), calls.map((row) => ({
    ...row, error_message: row.error_message == null ? null : safeError(row.error_message),
  })));
  const pending = detail.approvals.filter((item) => item.status === 'pending');
  await writeJson(join(directory, 'approval.json'), {
    pending: pending.map((item) => ({
      id: item.id, revision: item.revision, bundleHash: item.bundleHash,
      artifactIds: item.artifactIds,
    })),
    decisions: detail.approvals.filter((item) => item.status !== 'pending'),
  });
  await writeJson(join(directory, 'result.json'), {
    scenarioId, runId, status: detail.run.status, error: detail.run.error,
    usage: detail.run.usage, artifactIds: detail.artifacts.map((item) => item.id),
    approvalIds: detail.approvals.map((item) => item.id),
  });
  return detail;
}

async function refreshPending(service: CreativeService, outputDirectory: string): Promise<CreativeApproval[]> {
  const rows = service.store.database.connection.prepare(
    `SELECT a.*,k.idempotency_key
       FROM co_approvals a JOIN co_runs r ON r.id=a.run_id
       LEFT JOIN co_run_keys k ON k.run_id=r.id
      WHERE a.status='pending' ORDER BY a.created_at,a.id`,
  ).all() as Array<Record<string, unknown>>;
  const approvals = rows.map((row) => ({
    id: String(row.id), runId: String(row.run_id), nodeRunId: String(row.node_run_id),
    artifactIds: JSON.parse(String(row.artifact_ids_json)), bundleHash: String(row.bundle_hash),
    revision: Number(row.revision), status: 'pending' as const, comment: String(row.comment),
    createdAt: String(row.created_at), decidedAt: null,
  }));
  await writeJson(join(outputDirectory, 'pending-approvals.json'), approvals.map((item) => ({
    ...item,
    scenarioId: String(rows.find((row) => row.id === item.id)!.idempotency_key)
      .replace(/^creative-eval-/, ''),
    resumeCommand: `--resume "${outputDirectory}" --reviewer <name> --approve ${item.id} ${item.bundleHash}`,
  })));
  return approvals;
}

function technicalChecks(service: CreativeService, detail: CreativeRunDetail): Record<string, unknown> {
  const pending = detail.approvals.filter((item) => item.status === 'pending');
  const reviewed = detail.artifacts.filter((item) => item.kind === 'review');
  const reviewBindingsValid = reviewed.every((review) => {
    const target = detail.artifacts.find((item) => item.id === review.content.targetArtifactId);
    return Boolean(target && target.contentHash === review.content.targetHash);
  });
  const reviewsApproved = reviewed.length > 0
    && reviewed.every((item) => item.content.verdict === 'approved');
  const usageWithinBudget = detail.run.usage.textCalls <= detail.run.budget.maxTextCalls
    && detail.run.usage.images <= detail.run.budget.maxImages
    && detail.run.usage.tokens <= detail.run.budget.maxTokens;
  const scenes = detail.artifacts.filter((item) => item.kind === 'scene');
  const images = detail.artifacts.filter((item) => item.kind === 'image');
  const adoptedScenes = scenes.map((scene) => Boolean(service.store.database.connection
    .prepare('SELECT 1 FROM co_scene_adoptions WHERE artifact_id=?')
    .get(scene.id)));
  const adoptedImageIds = (service.store.database.connection.prepare(
    `SELECT DISTINCT artifact_id FROM artifact_references
      WHERE app_id='story-worlds' AND ref_type='creative-adopted'`,
  ).all() as Array<{ artifact_id: string }>).map((item) => item.artifact_id);
  return {
    manualGatePresent: pending.length > 0 || detail.approvals.some((item) => item.status === 'approved'),
    reviewBindingsValid,
    reviewsApproved,
    usageWithinBudget,
    scenes,
    adoptedScenes,
    images,
    adoptedImageIds,
    pendingApprovalIds: pending.map((item) => item.id),
  };
}

function deriveReportOutcome(
  records: Array<Record<string, unknown>>,
  plan: EvalPlan,
): {
  completedStoryScenarios: number;
  completedImageScenarios: number;
  fullEvaluationComplete: boolean;
  status: string;
} {
  const completedStoryScenarios = records.filter((item) =>
    item.status === 'completed' && !String(item.scenarioId).startsWith('extra_image_')).length;
  const completedImageScenarios = records.filter((item) =>
    item.status === 'completed' && String(item.scenarioId).startsWith('extra_image_')).length;
  const fullEvaluationComplete = completedStoryScenarios === STORY_SCENARIOS.length
    && completedImageScenarios === EXTRA_IMAGE_SCENARIOS.length
    && records.length === STORY_SCENARIOS.length + EXTRA_IMAGE_SCENARIOS.length
    && records.every((item) => item.status === 'completed');
  const status = records.some((item) => ['failed', 'cancelled'].includes(String(item.status)))
    ? 'blocked'
    : records.some((item) => item.status === 'waiting_approval') ? 'waiting_approval'
      : fullEvaluationComplete ? 'completed'
        : plan.storyOnly || plan.maxScenes < STORY_SCENARIOS.length || records.length > 0
          ? 'partial' : 'running';
  return {
    completedStoryScenarios,
    completedImageScenarios,
    fullEvaluationComplete,
    status,
  };
}

async function saveReports(
  service: CreativeService,
  outputDirectory: string,
): Promise<{ status: string; fullEvaluationComplete: boolean }> {
  const runs = service.store.listRuns().items;
  const records = [] as Array<Record<string, unknown>>;
  for (const run of runs) {
    const key = service.store.database.connection.prepare(
      'SELECT idempotency_key FROM co_run_keys WHERE run_id=?',
    ).get(run.id) as { idempotency_key: string } | undefined;
    const scenarioId = key?.idempotency_key.replace(/^creative-eval-/, '');
    if (!scenarioId) continue;
    const detail = service.store.detail(run.id);
    records.push({
      scenarioId, runId: run.id, status: run.status, error: run.error,
      usage: run.usage, budget: run.budget,
      technical: technicalChecks(service, detail),
      manualReview: 'pending',
    });
  }
  const used = usedBudget(service.store.database);
  const cap = getMeta(service.store.database, 'eval_budget') as CreativeBudget;
  const state = getMeta(service.store.database, 'eval_world') as EvalState;
  const plan = (getMeta(service.store.database, 'eval_plan') as EvalPlan | undefined)
    ?? { storyOnly: false, maxScenes: STORY_SCENARIOS.length, thinkingLevel: null };
  const imageTaskCount = Number(service.store.database.connection.prepare(
    "SELECT COUNT(*) AS count FROM generation_tasks WHERE app_id='story-worlds'",
  ).get()!.count);
  const sharedLineEventCount = state ? Number(service.store.database.connection.prepare(
    `SELECT COUNT(*) AS count FROM sw_events
      WHERE branch_id IN (?,?)
        AND EXISTS (SELECT 1 FROM json_each(data_json,'$.storyLineIds') WHERE value=?)
        AND EXISTS (SELECT 1 FROM json_each(data_json,'$.storyLineIds') WHERE value=?)`,
  ).get(state.mainBranchId, state.forkBranchId, state.lineAId, state.lineBId)!.count) : 0;
  const {
    completedStoryScenarios,
    completedImageScenarios,
    fullEvaluationComplete,
    status,
  } = deriveReportOutcome(records, plan);
  const imageRequirements = EXTRA_IMAGE_SCENARIOS.map((item) => {
    const run = runForScenario(service, item.id);
    return {
      scenarioId: item.id,
      sourceScenarioId: item.sourceScenarioId,
      status: run?.status ?? 'pending',
      reason: run?.status === 'completed' ? null
        : plan.storyOnly ? 'story-only 模式未执行图片验收'
          : plan.maxScenes < STORY_SCENARIOS.length ? `故事阶段边界为 ${plan.maxScenes}/20，图片尚未启动`
            : '等待图片验收路径完成',
    };
  });
  await writeJson(join(outputDirectory, 'report.json'), {
    schemaVersion: 3, generatedAt: nowIso(), status,
    plan: {
      mode: plan.storyOnly ? 'story-only' : 'full',
      plannedStoryScenarios: STORY_SCENARIOS.length,
      maxStoryScenes: plan.maxScenes,
      thinkingLevel: plan.thinkingLevel ?? 'source-default',
      pendingStoryScenes: STORY_SCENARIOS.length - plan.maxScenes,
      plannedImageScenarios: EXTRA_IMAGE_SCENARIOS.length,
      imageRequirements,
      fullEvaluationComplete,
    },
    budgetLedger: {
      cap, used,
      remaining: {
        textCalls: cap.maxTextCalls - used.textCalls,
        images: cap.maxImages - used.images,
        tokens: cap.maxTokens - used.tokens,
      },
    },
    coverage: {
      startedStoryScenarios: records.filter((item) =>
        !String(item.scenarioId).startsWith('extra_image_')).length,
      completedStoryScenarios,
      completedImageScenarios,
      imageTaskCount,
      sharedLineEventCount,
    },
    records,
  });
  await writeFile(join(outputDirectory, 'report.md'),
    `# AI 创作编排真实评估\n\n生成时间：${nowIso()}\n\n`
    + `模式：${plan.storyOnly ? 'story-only（图片项 pending）' : 'full'}\n\n`
    + `计划：20 个故事场景；当前累计边界 ${plan.maxScenes}/20；额外图片 2。\n\n`
    + `思考等级：${plan.thinkingLevel ?? '沿用临时副本的 source 默认值'}。\n\n`
    + `统一预算上限：${JSON.stringify(cap)}\n\n已用：${JSON.stringify(used)}\n\n`
    + `整体状态：${status}\n\n完整 20 场景 + 2 图片验收完成：${fullEvaluationComplete ? '是' : '否'}\n\n`
    + '| 场景 | 状态 | text/image/token | 人工复核 |\n|---|---|---:|---|\n'
    + records.map((item) => {
      const usage = item.usage as CreativeRun['usage'];
      return `| ${String(item.scenarioId)} | ${String(item.status)} | ${usage.textCalls}/${usage.images}/${usage.tokens} | pending |`;
    }).join('\n')
    + '\n\n'
    + imageRequirements.map((item) =>
      `- ${item.scenarioId}: ${item.status}${item.reason ? `（${item.reason}）` : ''}`).join('\n')
    + '\n\n自动检查通过不代表内容质量通过；部分场景或 story-only 运行不得报告为 20 场景全面通过。'
    + '正式采用必须由 root 阅读证据后显式 approve。\n');
  return { status, fullEvaluationComplete };
}

interface WorkItem {
  id: string;
  kind: 'story' | 'image';
  story?: StoryScenarioSpec;
  image?: ImageScenarioSpec;
}

function nextWork(
  service: CreativeService,
  state: EvalState,
  plan: EvalPlan,
): { item: WorkItem; run: CreativeRun | null; state: EvalState } | null {
  let currentState = state;
  for (const story of STORY_SCENARIOS.slice(0, plan.maxScenes)) {
    const checkpoint = runForScenario(service, CHECKPOINT_AFTER);
    if (story.id === 'main_09' && checkpoint?.status === 'completed') {
      currentState = ensureFork(service, currentState);
    }
    const run = runForScenario(service, story.id);
    if (run?.status === 'completed') continue;
    return { item: { id: story.id, kind: 'story', story }, run, state: currentState };
  }
  if (plan.storyOnly || plan.maxScenes < STORY_SCENARIOS.length) return null;
  for (const image of EXTRA_IMAGE_SCENARIOS) {
    const run = runForScenario(service, image.id);
    if (run?.status === 'completed') continue;
    return { item: { id: image.id, kind: 'image', image }, run, state: currentState };
  }
  return null;
}

function sourceScene(service: CreativeService, scenarioId: string) {
  if (scenarioId !== 'main_08' && scenarioId !== 'fork_03') {
    throw new Error(`图片验收来源场景未定义：${scenarioId}`);
  }
  const run = runForScenario(service, scenarioId);
  if (!run || run.status !== 'completed') {
    throw new Error(`图片验收来源场景 ${scenarioId} 尚未完成人工采用。`);
  }
  const artifact = service.store.database.connection.prepare(
    `SELECT a.* FROM co_artifacts a JOIN co_scene_adoptions d ON d.artifact_id=a.id
      WHERE a.run_id=? AND a.kind='scene' ORDER BY a.created_at DESC LIMIT 1`,
  ).get(run.id) as Record<string, unknown> | undefined;
  if (!artifact) throw new Error(`来源场景 ${scenarioId} 没有正式 adopted scene。`);
  return {
    artifactId: String(artifact.id), contentHash: String(artifact.content_hash),
    scope: run.scope,
  };
}

async function startScenario(
  service: CreativeService,
  state: EvalState,
  item: WorkItem,
  cap: CreativeBudget,
  imageWorkflow: { id: string; version: number } | null,
): Promise<CreativeRun> {
  const workflow = workflowByName(service, item.kind === 'story'
    ? createDefaultStorySceneWorkflow().name : createDefaultIllustrationWorkflow().name);
  const version = service.store.getVersion(workflow.id, workflow.publishedVersion);
  if (!version) throw new Error(`缺少工作流 ${workflow.document.name} 的已发布版本。`);
  // The first pass needs only the dispatched nodes in this fixed template.
  // Optional reruns still consume the same remaining global budget.
  const budget = allocateRunBudget(service.store.database, cap, version.document);
  if (item.kind === 'story' && item.story) {
    return service.startRun({
      workflowId: workflow.id, workflowVersion: workflow.publishedVersion,
      idempotencyKey: scenarioKey(item.id), scope: scenarioScope(state, item.story),
      instruction: `场景 ${item.id}：${item.story.title}\n评估焦点：${item.story.focus}\n${item.story.instruction}`,
      budget,
      input: {
        evalScenarioId: item.id,
        criticalChange: item.id === 'main_12',
        contextSelection: { storyLineIds: scenarioLines(state, item.story.line) },
      },
    });
  }
  if (!item.image) throw new Error(`未知图片场景 ${item.id}`);
  if (!imageWorkflow) throw new Error(`图片场景 ${item.id} 缺少真实图片工作流。`);
  const source = sourceScene(service, item.image.sourceScenarioId);
  return service.startRun({
    workflowId: workflow.id, workflowVersion: workflow.publishedVersion,
    idempotencyKey: scenarioKey(item.id), scope: source.scope,
    instruction: `额外图片验收 ${item.id}：${item.image.title}\n${item.image.instruction}`,
    budget,
    input: {
      evalScenarioId: item.id,
      sceneArtifactId: source.artifactId,
      sceneArtifactHash: source.contentHash,
      importance: 'ordinary',
      media: { workflowId: imageWorkflow.id, workflowVersion: imageWorkflow.version,
        inputs: {}, references: [] },
    },
  });
}

async function advanceUntilStopped(
  service: CreativeService,
  outputDirectory: string,
  scenarioId: string,
  runId: string,
): Promise<CreativeRunDetail> {
  for (let tick = 0; tick < 10_000; tick++) {
    await service.runtime.tick(runId);
    const detail = await saveEvidence(service, outputDirectory, scenarioId, runId);
    if (['waiting_approval', 'paused', 'uncertain', 'completed', 'failed', 'cancelled']
      .includes(detail.run.status)) return detail;
    await delay(25);
  }
  throw new Error(`场景 ${scenarioId} 在 10000 次调度后仍未进入可判定状态。`);
}

async function executeEvaluation(
  options: CliOptions,
  sourcePath: string,
  secrets: SecretStore,
): Promise<number> {
  const outputDirectory = options.resume ?? options.output
    ?? resolve(`artifacts/creative-evals/${nowIso().replaceAll(':', '-')}`);
  const releaseLock = await acquireLock(outputDirectory);
  let database: ServiceDatabase | null = null;
  let service: CreativeService | null = null;
  try {
    let manifest: EvalManifest;
    const manifestPath = join(outputDirectory, 'manifest.json');
    if (options.resume) {
      if (!existsSync(manifestPath)) throw new Error('resume 目录缺少 manifest.json。');
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as EvalManifest;
      if (options.sourceDb && resolve(options.sourceDb) !== resolve(manifest.sourceDatabase)) {
        throw new Error('resume 不能切换源数据库。');
      }
      const storedStoryOnly = Boolean(manifest.storyOnly);
      if (options.storyOnly && !storedStoryOnly) {
        throw new Error('resume 不能在完整评估中切换为 --story-only。');
      }
      const storedMaxScenes = Number.isInteger(manifest.maxScenes)
        ? Number(manifest.maxScenes) : STORY_SCENARIOS.length;
      if (options.maxScenes !== undefined && options.maxScenes < storedMaxScenes) {
        throw new Error(`--max-scenes 只能显式扩大：当前边界 ${storedMaxScenes}。`);
      }
      if (options.budget && JSON.stringify(options.budget) !== JSON.stringify(manifest.budget)) {
        throw new Error('resume 不能改变统一 budget cap。');
      }
      manifest.storyOnly = storedStoryOnly;
      manifest.maxScenes = options.maxScenes ?? storedMaxScenes;
      const storedThinkingLevel = fixedThinkingLevel(manifest.thinkingLevel ?? null, options.thinkingLevel);
      manifest.thinkingLevel = storedThinkingLevel;
      manifest.imageWorkflow = manifest.imageWorkflow ?? null;
      manifest.schemaVersion = 3;
      await writeJson(manifestPath, manifest);
      options.storyOnly = manifest.storyOnly;
      options.models = manifest.models;
      options.budget = manifest.budget;
      options.imageWorkflow = manifest.imageWorkflow ?? undefined;
      options.maxScenes = manifest.maxScenes;
      options.thinkingLevel = manifest.thinkingLevel ?? undefined;
    } else {
      if (!existsSync(sourcePath)) throw new Error('源数据库不存在，不能创建 eval。');
      if (options.storyOnly && options.budget && options.budget.maxImages !== 0) {
        throw new Error('--story-only 的统一 budget 必须设置 maxImages=0。');
      }
      const initialPlan: EvalPlan = {
        storyOnly: options.storyOnly,
        maxScenes: options.maxScenes ?? STORY_SCENARIOS.length,
        thinkingLevel: options.thinkingLevel ?? null,
      };
      const inventory = await readInventory(sourcePath, secrets, !initialPlan.storyOnly);
      const selectedModels = new Set(Object.values(options.models));
      for (const id of selectedModels) {
        if (!inventory.models.some((item) => item.id === id && item.available)) {
          throw new Error(`所选模型 ${id} 未通过 read-only availability inventory。`);
        }
      }
      if (options.imageWorkflow) {
        const selectedWorkflow = inventory.imageWorkflows.find((item) =>
          item.workflowId === options.imageWorkflow!.id
          && item.version === options.imageWorkflow!.version && item.available);
        if (!selectedWorkflow) throw new Error('所选图片工作流未通过 read-only availability inventory。');
      }
      database = new ServiceDatabase(join(outputDirectory, 'eval.db'));
      const copied = copySelectedConfiguration(
        sourcePath, database, [...selectedModels], initialPlan.thinkingLevel, options.imageWorkflow,
      );
      await writeJson(join(outputDirectory, 'inventory.json'), { inventory, copied });
      manifest = {
        schemaVersion: 3, createdAt: nowIso(), sourceDatabase: sourcePath,
        sourceDatabaseHash: createHash('sha256').update(resolve(sourcePath)).digest('hex'),
        evalDatabase: database.path, artifactDirectory: join(outputDirectory, 'artifacts'),
        checkpointAfter: CHECKPOINT_AFTER, storyOnly: initialPlan.storyOnly,
        maxScenes: initialPlan.maxScenes, thinkingLevel: initialPlan.thinkingLevel, budget: options.budget!,
        models: options.models, imageWorkflow: options.imageWorkflow ?? null,
        storyScenarios: [...STORY_SCENARIOS], extraImageScenarios: [...EXTRA_IMAGE_SCENARIOS],
      };
      await writeJson(manifestPath, manifest);
    }
    if (!database) database = new ServiceDatabase(manifest.evalDatabase);
    database.connection.exec(
      `CREATE TABLE IF NOT EXISTS eval_meta (
        key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL
      )`,
    );
    const savedBudget = getMeta(database, 'eval_budget') as CreativeBudget | undefined;
    if (savedBudget && JSON.stringify(savedBudget) !== JSON.stringify(manifest.budget)) {
      throw new Error('eval DB 中的统一 budget 与 manifest 不一致；拒绝自动扩容或缩小。');
    }
    if (!savedBudget) setMeta(database, 'eval_budget', manifest.budget);
    const plan: EvalPlan = {
      storyOnly: manifest.storyOnly,
      maxScenes: manifest.maxScenes,
      thinkingLevel: manifest.thinkingLevel,
    };
    setMeta(database, 'eval_plan', plan);
    const config = readConfig({
      STHSTART_DATABASE_PATH: manifest.evalDatabase,
      STHSTART_ARTIFACT_DIR: manifest.artifactDirectory,
    });
    await mkdir(manifest.artifactDirectory, { recursive: true });
    service = createCreativeService({ config, database, secrets });
    const inventory = await readInventory(sourcePath, secrets, !plan.storyOnly);
    configureRoles(service, manifest.models, inventory, plan.storyOnly);
    let state = ensureWorld(service);
    for (;;) {
      const next = nextWork(service, state, plan);
      if (!next) break;
      state = next.state;
      if (next.run?.status === 'waiting_approval') {
        const pending = await refreshPending(service, outputDirectory);
        const approval = pending.find((item) => item.runId === next.run!.id);
        const flag = approval && options.approvals.find((item) => item.id === approval.id);
        if (!approval || !flag) {
          await saveReports(service, outputDirectory);
          console.log(`等待人工审批：${approval?.id ?? '(approval missing)'} ${approval?.bundleHash ?? ''}`);
          if (approval) {
            console.log(`--resume "${outputDirectory}" --reviewer <name> --approve ${approval.id} ${approval.bundleHash}`);
          }
          return 3;
        }
        if (flag.hash !== approval.bundleHash) {
          throw new Error('人工提供的 bundleHash 与当前待审包不一致。');
        }
        service.decision(approval.id, {
          expectedRevision: approval.revision, bundleHash: approval.bundleHash,
          decision: 'approve',
          comment: `真实人工评测确认：${options.reviewer}；已阅读 ${next.item.id} 的证据包后显式批准。`,
        });
        await advanceUntilStopped(service, outputDirectory, next.item.id, next.run.id);
        continue;
      }
      if (next.run && ['paused', 'uncertain', 'failed', 'cancelled'].includes(next.run.status)) {
        await saveReports(service, outputDirectory);
        console.error(`场景 ${next.item.id} 停在 ${next.run.status}：${next.run.error ?? '无错误详情'}`);
        return 1;
      }
      const run = next.run ?? await startScenario(
        service, state, next.item, manifest.budget, manifest.imageWorkflow,
      );
      await writeJson(join(outputDirectory, 'scenarios', next.item.id, 'start.json'), {
        scenarioId: next.item.id, runId: run.id, budget: run.budget,
        branch: next.item.kind === 'story' ? next.item.story?.branch : 'source-branch',
      });
      await advanceUntilStopped(service, outputDirectory, next.item.id, run.id);
      await saveReports(service, outputDirectory);
    }
    await refreshPending(service, outputDirectory);
    const report = await saveReports(service, outputDirectory);
    if (report.fullEvaluationComplete) {
      console.log(`评估完成：20 个真实故事场景与 2 个额外图片验收均已处理。输出：${outputDirectory}`);
      return 0;
    }
    console.error(
      `阶段停止：当前边界 ${plan.maxScenes}/20，${plan.storyOnly ? '图片验收 pending' : '完整图片验收未完成'}。`
      + `报告状态 ${report.status}；不得报告为 20 场景全面通过。输出：${outputDirectory}`,
    );
    return 4;
  } catch (error) {
    if (service) await saveReports(service, outputDirectory);
    console.error(safeError(error));
    return 1;
  } finally {
    if (service) await service.close();
    if (database?.connection.isOpen) database.close();
    await releaseLock();
  }
}

function cliPlan(options: CliOptions): EvalPlan {
  return {
    storyOnly: options.storyOnly,
    maxScenes: options.maxScenes ?? STORY_SCENARIOS.length,
    thinkingLevel: options.thinkingLevel ?? null,
  };
}

function fixedThinkingLevel(
  stored: ModelThinkingLevel | null,
  requested: ModelThinkingLevel | undefined,
): ModelThinkingLevel | null {
  if (requested && requested !== stored) {
    throw new Error(`resume 的 thinking level 已固定为 ${stored ?? 'source-default'}，不能静默变化。`);
  }
  return stored;
}

function selfCheck(options: CliOptions): void {
  const storyNeeds = scenarioNeeds(createDefaultStorySceneWorkflow());
  const imageNeeds = scenarioNeeds(createDefaultIllustrationWorkflow());
  if (storyNeeds.textCalls !== 4 || storyNeeds.images !== 0
    || imageNeeds.textCalls !== 2 || imageNeeds.images !== 1) {
    throw new Error('评测模板首轮派发应为故事四次模型调用，以及插图两次模型调用和一次生图。');
  }
  const main = STORY_SCENARIOS.filter((item) => item.branch === 'main');
  const fork = STORY_SCENARIOS.filter((item) => item.branch === 'fork');
  if (STORY_SCENARIOS.length !== 20 || main.length !== 16 || fork.length !== 4) {
    throw new Error('场景分布必须为主 branch 16 + fork branch 4，总计 20。');
  }
  if (STORY_SCENARIOS[7].id !== CHECKPOINT_AFTER || STORY_SCENARIOS[8].id !== 'main_09') {
    throw new Error('平行历史必须在第 8 场后分叉。');
  }
  if (EXTRA_IMAGE_SCENARIOS.length !== 2) throw new Error('额外图片验收必须恰好 2 张。');
  if (new Set(STORY_SCENARIOS.map((item) => item.id)).size !== 20) throw new Error('场景 ID 重复。');
  if (!STORY_SCENARIOS.some((item) => item.line === 'a')
    || !STORY_SCENARIOS.some((item) => item.line === 'b')
    || STORY_SCENARIOS.filter((item) => item.line === 'both').length < 2) {
    throw new Error('两条 StoryLine 必须独立出现并至少有两次双线场景。');
  }
  const plan = cliPlan(options);
  if (!Number.isInteger(plan.maxScenes) || plan.maxScenes < 1 || plan.maxScenes > 20) {
    throw new Error('阶段边界必须落在 1-20。');
  }
  if (plan.storyOnly && options.imageWorkflow) {
    throw new Error('story-only 计划不能包含图片工作流。');
  }
  if (plan.thinkingLevel && !['low', 'medium', 'high', 'off', 'auto'].includes(plan.thinkingLevel)) {
    throw new Error('thinking level 无效。');
  }
  if (fixedThinkingLevel('low', undefined) !== 'low' || fixedThinkingLevel('low', 'low') !== 'low') {
    throw new Error('resume 必须固定沿用 manifest thinking level。');
  }
  try {
    fixedThinkingLevel('low', 'medium');
    throw new Error('resume thinking level 变化未被拒绝。');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('不能静默变化')) throw error;
  }
  const allStoryRecords = STORY_SCENARIOS.map((item) =>
    ({ scenarioId: item.id, status: 'completed' }));
  const storyOnlyOutcome = deriveReportOutcome(allStoryRecords, {
    storyOnly: true, maxScenes: STORY_SCENARIOS.length, thinkingLevel: null,
  });
  if (storyOnlyOutcome.status !== 'partial' || storyOnlyOutcome.fullEvaluationComplete) {
    throw new Error('story-only 即使完成 20 场故事也必须保持 partial，图片项不能算通过。');
  }
  const stageOneOutcome = deriveReportOutcome([allStoryRecords[0]], {
    storyOnly: true, maxScenes: 1, thinkingLevel: null,
  });
  if (stageOneOutcome.status !== 'partial' || stageOneOutcome.fullEvaluationComplete) {
    throw new Error('阶段边界 1/20 必须保持 partial，不能报告全面通过。');
  }
  const fullOutcome = deriveReportOutcome([
    ...allStoryRecords,
    ...EXTRA_IMAGE_SCENARIOS.map((item) => ({ scenarioId: item.id, status: 'completed' })),
  ], { storyOnly: false, maxScenes: STORY_SCENARIOS.length, thinkingLevel: null });
  if (fullOutcome.status !== 'completed' || !fullOutcome.fullEvaluationComplete) {
    throw new Error('只有 20 场故事和 2 张图片都完成才允许 completed。');
  }
}

function validateSelections(inventory: SourceInventory, options: CliOptions): string[] {
  const gaps: string[] = [];
  for (const role of Object.keys(options.models)) {
    const id = options.models[role];
    const model = inventory.models.find((item) => item.id === id);
    if (!model) gaps.push(`选择 ${role}=${id}：模型配置不存在。`);
    else if (!model.available) gaps.push(`选择 ${role}=${id}：模型或凭据当前不可用。`);
    else {
      const required = role === 'vision' ? 'multimodal'
        : role === 'text' ? 'text' : undefined;
      if (required && !model.capabilities.includes(required)) {
        gaps.push(`选择 ${role}=${id}：缺少 ${required} 能力。`);
      }
    }
  }
  if (options.imageWorkflow) {
    const selected = inventory.imageWorkflows.find((item) =>
      item.workflowId === options.imageWorkflow!.id
      && item.version === options.imageWorkflow!.version);
    if (!selected) gaps.push(`图片工作流 ${options.imageWorkflow.id}@${options.imageWorkflow.version} 不存在或未发布。`);
    else if (!selected.available) gaps.push(`图片工作流 ${options.imageWorkflow.id}@${options.imageWorkflow.version} 当前不可用。`);
  }
  return gaps;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.list) {
    console.log(STORY_SCENARIOS.map((item) =>
      `${item.id}\t${item.branch}\t${item.line}\t${item.title}\t${item.focus}`).join('\n'));
    console.log(`\n额外图片：${EXTRA_IMAGE_SCENARIOS.map((item) => item.id).join(', ')}`);
    return 0;
  }
  if (options.selfCheck) {
    selfCheck(options);
    const plan = cliPlan(options);
    console.log(
      `self-check 通过：完整目标 20=16+4，第 8 场后 fork，两条 StoryLine，额外图片 2；`
      + `当前模式=${plan.storyOnly ? 'story-only' : 'full'}，阶段边界=${plan.maxScenes}/20，`
      + `thinking=${plan.thinkingLevel ?? 'source-default'}。`,
    );
    return 0;
  }
  const envFile = resolve('.env');
  if (existsSync(envFile)) loadEnvFile(envFile);
  const config = readConfig();
  const sourcePath = options.sourceDb ?? config.databasePath;
  const secrets = new SecretStore();
  if (!options.execute && !options.resume) {
    const plan = cliPlan(options);
    const inventory = await readInventory(sourcePath, secrets, !plan.storyOnly);
    if (options.probeHealth) inventory.health = await probeSourceHealth(sourcePath, secrets);
    const selectionGaps = validateSelections(inventory, options);
    inventory.gaps.push(...selectionGaps);
    console.log(JSON.stringify({
      ...inventory,
      evaluationPlan: {
        mode: plan.storyOnly ? 'story-only' : 'full',
        plannedStoryScenarios: STORY_SCENARIOS.length,
        maxScenes: plan.maxScenes,
        thinkingLevel: plan.thinkingLevel ?? 'source-default',
        plannedImageScenarios: EXTRA_IMAGE_SCENARIOS.length,
        imageScenarios: plan.storyOnly ? 'pending-story-only' : 'required-for-full-evaluation',
        fullEvaluationComplete: false,
      },
    }, null, 2));
    return inventory.databaseExists && inventory.gaps.length === 0 ? 0 : 2;
  }
  return executeEvaluation(options, sourcePath, secrets);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
