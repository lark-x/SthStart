import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 邻舍对齐真实样例与预算（计划 §18.1）。
 *
 *   node scripts/activity-image-parity-sample.mjs
 *   node scripts/activity-image-parity-sample.mjs --confirm [--portal <url>]
 *
 * 默认（不带 --confirm）只读预演：列出预算分配、固定 seed 与（在有管理令牌时）实际配置，
 * 不创建活动、不提交图片、不写数据库。
 * 真实写入必须显式 --confirm，并且必须能连上实际 ComfyUI 实例；离线时明确拒绝，不排队重试。
 *
 * 硬性约束：最多 12 次实际图片提交（失败也计数）、请求串行、不复用用户已有活动、
 * 不调用 interrupt／unload 影响其他应用、无法得知峰值显存时报告“未测”。
 */

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};

const MAX_SUBMISSIONS = 12;
const FIXED_SEEDS = [20260101, 20260102];
const PARITY_TEXT_WORKFLOW_ID = 'anima-activity-linshe-parity';
const PARITY_HIRES_WORKFLOW_ID = 'anima-activity-hires-basic';
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const outputDirectory = resolve('artifacts/activity-image-parity-v2', stamp);
const portal = flag('--portal', 'http://127.0.0.1:9320').replace(/\/$/, '');
const token = (process.env.STHSTART_ADMIN_TOKEN ?? '').trim();

/** 与计划 §18.1 表格逐行对应；顺序即串行提交顺序。 */
const BUDGET_PLAN = [
  { key: 'A-seed1', label: 'A 旧工作流 + 画风后缀', purpose: 'activity_image_text', submissions: 1, seed: FIXED_SEEDS[0], variant: 'legacy' },
  { key: 'A-seed2', label: 'A 旧工作流 + 画风后缀', purpose: 'activity_image_text', submissions: 1, seed: FIXED_SEEDS[1], variant: 'legacy' },
  { key: 'B-seed1', label: 'B 新工作流（服务端组装，无重复画风）', purpose: 'activity_image_text', submissions: 1, seed: FIXED_SEEDS[0], variant: 'parity' },
  { key: 'B-seed2', label: 'B 新工作流（服务端组装，无重复画风）', purpose: 'activity_image_text', submissions: 1, seed: FIXED_SEEDS[1], variant: 'parity' },
  { key: 'C-seed1', label: 'C 新工作流 + 结构化 tags + keyword', purpose: 'activity_image_text', submissions: 1, seed: FIXED_SEEDS[0], variant: 'parity_structured', requiresTextModel: true },
  { key: 'C-seed2', label: 'C 新工作流 + 结构化 tags + keyword', purpose: 'activity_image_text', submissions: 1, seed: FIXED_SEEDS[1], variant: 'parity_structured', requiresTextModel: true },
  { key: 'comic-duo', label: '漫画双角色', purpose: 'activity_image_text', submissions: 1, variant: 'comic' },
  { key: 'media-empty', label: '素材空场景／无人道具', purpose: 'activity_media_slot', submissions: 1, variant: 'media' },
  { key: 'turbo-real', label: 'Turbo 真实参数', purpose: 'activity_image_text', submissions: 1, seed: FIXED_SEEDS[0], variant: 'turbo' },
  { key: 'hires-basic', label: '基础细化', purpose: 'activity_image_upscale', submissions: 1, variant: 'hires' },
  { key: 'lora-real', label: '有文件时真实 LoRA', purpose: 'activity_image_text', submissions: 1, variant: 'lora', conditional: 'lora_file_present' },
  { key: 'reserve', label: '必要补验', purpose: null, submissions: 1, variant: 'reserve', conditional: 'explicit_need' },
];

const plan = {
  mode: has('--confirm') ? 'confirm' : 'dry-run',
  portal,
  outputDirectory,
  imageBudget: { max: MAX_SUBMISSIONS, planned: BUDGET_PLAN.reduce((sum, item) => sum + item.submissions, 0), failuresCount: true, serial: true, autoRetry: false },
  fixedSeeds: FIXED_SEEDS,
  workflows: { text: PARITY_TEXT_WORKFLOW_ID, hires: PARITY_HIRES_WORKFLOW_ID },
  budgetPlan: BUDGET_PLAN,
  constraints: [
    '最多 12 次实际图片提交，失败也计数；不做无目标批量重试。',
    '请求串行；启动前观察实际队列，其他应用正在使用时等待或报告。',
    '不调用 interrupt 或 unload 影响其他应用。',
    '无法得知峰值显存时报告“未测”，不从总显存推算。',
    '1920×1080 结果不与 768 基线混比较；需要额外额度时先请求用户。',
    '不复用用户已有活动；--confirm 会先创建专门的验收活动并记录其 ID。',
  ],
};

// 门户把管理接口代理在 /api/admin 下；直接指向服务时是 /api/v1/admin。
// 首次 404 时自动换前缀，避免“指错端口”被误报成“配置读不到”。
let adminPrefix = null;
async function call(method, path, body) {
  const send = (prefix) => fetch(`${portal}${prefix}${path}`, {
    method,
    headers: { 'x-sthstart-admin-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let prefix = adminPrefix ?? '/api/admin';
  let response = await send(prefix);
  if (adminPrefix === null && response.status === 404) {
    const alternative = prefix === '/api/admin' ? '/api/v1/admin' : '/api/admin';
    const retry = await send(alternative);
    if (retry.status !== 404) { adminPrefix = alternative; response = retry; }
    else { adminPrefix = prefix; }
  } else if (adminPrefix === null) {
    adminPrefix = prefix;
  }
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { status: response.status, body: parsed ?? text };
}

async function probeEngine(baseUrl) {
  if (!baseUrl) return { reachable: false, reason: 'no_base_url' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal });
    return response.ok ? { reachable: true, reason: null } : { reachable: false, reason: `http_${response.status}` };
  } catch (error) {
    return { reachable: false, reason: error instanceof Error ? error.message : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** 只读读取实际配置：需要管理令牌；没有令牌时如实说明“未读取”，不猜。 */
async function liveConfiguration() {
  if (!token) return { read: false, reason: 'admin_token_required', engines: [], parityWorkflows: null, parityPresets: [] };
  const enginesResponse = await call('GET', '/generation/engines');
  if (enginesResponse.status >= 300) {
    return { read: false, reason: `http_${enginesResponse.status}`, engines: [], parityWorkflows: null, parityPresets: [] };
  }
  const items = Array.isArray(enginesResponse.body?.items) ? enginesResponse.body.items : [];
  const engines = [];
  for (const engine of items) {
    const kind = String(engine.kind ?? '');
    if (!/comfy/i.test(kind) || engine.enabled === false) continue;
    engines.push({ id: String(engine.id), name: String(engine.name ?? ''), baseUrl: String(engine.baseUrl ?? engine.base_url ?? '').replace(/\/$/, '') });
  }
  for (const engine of engines) Object.assign(engine, await probeEngine(engine.baseUrl));

  const workflowsResponse = await call('GET', '/generation/workflows');
  const workflows = Array.isArray(workflowsResponse.body?.items) ? workflowsResponse.body.items : [];
  const find = (id) => workflows.find((item) => item.id === id) ?? null;
  const presetsResponse = await call('GET', '/generation/presets?appId=activities');
  const presets = Array.isArray(presetsResponse.body?.items) ? presetsResponse.body.items : [];
  return {
    read: true,
    reason: null,
    engines,
    parityWorkflows: {
      text: find(PARITY_TEXT_WORKFLOW_ID) ? { present: true, latestVersion: find(PARITY_TEXT_WORKFLOW_ID).latest_version ?? null } : { present: false, latestVersion: null },
      hires: find(PARITY_HIRES_WORKFLOW_ID) ? { present: true, latestVersion: find(PARITY_HIRES_WORKFLOW_ID).latest_version ?? null } : { present: false, latestVersion: null },
    },
    parityPresets: presets.filter((item) => String(item.name ?? '').startsWith('邻舍对齐 · ')).map((item) => ({ id: item.id, name: item.name, workflowId: item.workflowId, workflowVersion: item.workflowVersion, isDefault: item.isDefault })),
  };
}

const live = await liveConfiguration();
const reachable = live.engines.filter((engine) => engine.reachable);

if (!has('--confirm')) {
  console.log(JSON.stringify({
    ...plan,
    live,
    note: '只读预演：未创建活动、未提交图片、未写入数据库。真实样例请加 --confirm。',
  }, null, 2));
  process.exit(0);
}

if (!token) {
  console.error(JSON.stringify({ error: 'admin_token_required', message: 'STHSTART_ADMIN_TOKEN 未设置，拒绝真实提交。' }, null, 2));
  process.exit(1);
}
if (!live.read) {
  console.error(JSON.stringify({ error: 'configuration_unreadable', message: `无法读取实际生成配置（${live.reason}），拒绝真实提交。`, plan }, null, 2));
  process.exit(1);
}
if (!reachable.length) {
  console.error(JSON.stringify({
    error: 'comfyui_unreachable',
    message: '没有任何已启用的 ComfyUI 引擎可连接；本轮真实样例无法执行，未创建活动也未提交图片。',
    engines: live.engines,
    plan,
  }, null, 2));
  process.exit(1);
}

mkdirSync(outputDirectory, { recursive: true });
const report = {
  startedAt: new Date().toISOString(), mode: 'confirm', portal, engine: reachable[0],
  imageBudget: plan.imageBudget, budgetPlan: BUDGET_PLAN, submissions: [], issues: [],
  peakVram: '未测', status: 'in_progress',
};
const save = () => writeFileSync(resolve(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
save();

// 专用验收活动：标题带时间戳，避免与用户活动混淆；ID 记录在报告中。
const title = flag('--activity-title', `邻舍对齐验收 ${stamp}`);
const created = await call('POST', '/activities', { title, type: '验收', theme: '', location: '', rules: '' });
if (created.status >= 300 || !created.body?.activity?.id) {
  report.status = 'failed';
  report.issues.push(`创建验收活动失败：HTTP ${created.status}`);
  save();
  console.error(JSON.stringify({ error: 'activity_create_failed', response: created, outputDirectory }, null, 2));
  process.exit(1);
}
const activityId = created.body.activity.id;
report.activityId = activityId;
report.status = 'ready';
save();

// ── 受控对照的固定条件（计划 §9）：同一镜头、同尺寸、同步数、同负向词 ──
const TEST_BEAT = {
  sceneTitle: '邻舍对齐受控对照',
  timeText: '傍晚 18:30',
  location: '雪山营地',
  environment: '风雪渐起，烧瓶内透出金色微光',
  action: '研究员轻轻摇晃试管，观察结晶变化，另一只手扶住实验台',
  dialogue: '低温并未抑制反应。',
};
const FIXED_NEGATIVE = 'worst quality, low quality, blurry, text, watermark, signature, jpeg artifacts, extra fingers, deformed hands';
const FIXED_CUSTOM_PROMPT = 'single female researcher, short silver hair, green eyes, blue lab coat, holding a glass flask with green liquid, snowy mountain camp at night, tents and pine trees, medium shot, calm expression, clean anime screenshot';
const FIXED_PARAMETERS = { steps: 31, cfg: 5, sampler_name: 'er_sde', scheduler: 'beta', width: 768, height: 512 };

/** 把验收活动的第一个镜头改写成固定测试镜头，并提交为内容版本。 */
async function prepareContent() {
  const draftResponse = await call('GET', `/activities/${activityId}/draft`);
  const draft = draftResponse.body?.draft ?? draftResponse.body;
  if (!draft?.document) throw new Error(`无法读取验收活动草稿：HTTP ${draftResponse.status}`);
  const document = structuredClone(draft.document);
  const stage = document.stages?.[0];
  const scene = stage?.scenes?.[0];
  const beat = scene?.beats?.[0];
  if (!beat) throw new Error('验收活动草稿里没有可用镜头，拒绝伪造镜头结构。');
  scene.title = TEST_BEAT.sceneTitle;
  scene.timeText = TEST_BEAT.timeText;
  scene.locationText = TEST_BEAT.location;
  scene.environment = TEST_BEAT.environment;
  beat.action = TEST_BEAT.action;
  beat.dialogue = TEST_BEAT.dialogue;
  const saved = await call('PUT', `/activities/${activityId}/draft`, { expectedDraftVersion: draft.draftVersion, document });
  if (saved.status >= 300) throw new Error(`保存草稿失败：HTTP ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`);
  const detail = await call('GET', `/activities/${activityId}`);
  const expectedHeadVersion = detail.body?.activity?.headVersion;
  const committed = await call('POST', `/activities/${activityId}/draft/commit`, { expectedHeadVersion, expectedDraftVersion: saved.body?.draftVersion ?? draft.draftVersion + 1 });
  if (committed.status >= 300) throw new Error(`提交内容版本失败：HTTP ${committed.status} ${JSON.stringify(committed.body).slice(0, 300)}`);

  // 计划 §9：A/B/C 必须在**同一份画风**下比较。验收活动默认没有画风，
  // 不绑定的话 B 组会完全没有风格锚点，对照就不成立。
  const styles = await call('GET', '/activity-art-styles');
  const artStyle = (styles.body?.items ?? []).find((item) => String(item.name).includes('邻舍对齐')) ?? null;
  if (!artStyle) throw new Error('没有找到「邻舍对齐 · Anima」画风，无法建立单份画风对照。');
  const stylePayload = artStyle.payload ?? artStyle.payloadJson ?? null;
  if (!stylePayload?.renderProfiles) throw new Error('画风 payload 缺少 renderProfiles，无法建立渲染档位引用。');
  const configDraft = await call('GET', `/activities/${activityId}/image-config/draft`);
  const config = configDraft.body?.draft ?? configDraft.body;
  const configDocument = structuredClone(config.document);
  // 与门户一致：选中画风卡会把 payload 的 positiveStylePrompt／negativePrompt 写进
  // 全局风格字段，并带上默认档位、默认画布与 renderProfiles。只写 selectedStyle 会让
  // 画风的风格串根本不参与组装。
  configDocument.globalStylePrompt = stylePayload.positiveStylePrompt;
  configDocument.globalNegativePrompt = stylePayload.negativePrompt;
  // 计划 §9 要求 31 步／CFG 5（Base）与 768×512；draft 档是 Turbo 12 步，所以用 final。
  // renderProfiles 必须一起给：画风负责“用哪个预设渲染”，缺了服务端会拒绝提交。
  configDocument.artDirection = {
    ...(configDocument.artDirection ?? {}),
    selectedStyle: { id: artStyle.id, version: artStyle.version, name: artStyle.name, payloadSnapshot: stylePayload },
    quality: 'final',
    canvas: { width: 768, height: 512 },
    renderProfiles: stylePayload.renderProfiles,
    parameterOverrides: {},
  };
  const head = await call('GET', `/activities/${activityId}`);
  const artCommitted = await call('POST', `/activities/${activityId}/art-direction/commit`, {
    expectedHeadVersion: head.body?.activity?.headVersion,
    expectedImageConfigDraftVersion: config.draftVersion,
    document: configDocument,
  });
  if (artCommitted.status >= 300) throw new Error(`提交画风失败：HTTP ${artCommitted.status} ${JSON.stringify(artCommitted.body).slice(0, 300)}`);
  return {
    stageId: stage.id, sceneId: scene.id, beatId: beat.id,
    artStyleId: artStyle.id, artStyleName: artStyle.name,
    artStylePositivePrompt: stylePayload.positiveStylePrompt,
    renderProfiles: stylePayload.renderProfiles,
  };
}

/** 按变体准备该轮要用的工作流、策略与画风，返回可直接提交的请求体。 */
async function resolveVariant(entry, target) {
  if (entry.variant === 'lora') {
    // 实例 LoRA 目录为空时如实跳过，不去下载文件凑验收。
    const policy = await call('GET', `/generation/activity-loras?workflowId=${PARITY_TEXT_WORKFLOW_ID}&workflowVersion=1`);
    const models = Array.isArray(policy.body?.models) ? policy.body.models : [];
    if (!models.length) return { skip: 'ComfyUI 实例没有任何 LoRA 文件（清单为空），真实 LoRA 验收无法进行。' };
  }
  if (entry.variant === 'media') {
    return { skip: '验收活动没有素材槽位（本轮只准备了一个镜头），素材入口的真实样例未执行。' };
  }
  if (entry.variant === 'comic') {
    return { comic: true, note: '漫画画格：四格 duo 模板，走 comic/panels 预览与提交' };
  }
  if (entry.variant === 'hires') {
    return { hires: true, note: '基础细化：沿用原图实际模型／采样参数／提示词，只放大并小幅重绘' };
  }
  if (entry.variant === 'reserve') {
    return { skip: '补验额度按计划只在确有需要时占用，本轮未触发。' };
  }
  if (entry.variant === 'legacy') {
    const binding = await call('GET', '/generation/assignments');
    const item = (binding.body?.items ?? []).find((row) => (row.app_id ?? row.appId) === 'activities' && (row.purpose) === 'activity_image_text');
    if (!item) return { skip: '没有 activity_image_text 绑定，无法复现旧工作流基线。' };
    const legacyWorkflowId = item.workflow_id ?? item.workflowId;
    const legacyVersion = item.workflow_version ?? item.workflowVersion;
    return {
      workflowId: legacyWorkflowId, workflowVersion: legacyVersion,
      note: `旧工作流 ${legacyWorkflowId} v${legacyVersion}（沿用其已发布策略）`,
    };
  }
  if (entry.variant === 'turbo') {
    return { workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion: 1, presetId: live.parityPresets.find((preset) => preset.name.includes('Turbo'))?.id ?? null, note: '对齐工作流 + Turbo 预设' };
  }
  if (entry.variant === 'parity_structured') {
    const policy = await call('GET', `/generation/activity-image-prompt-policy?workflowId=${PARITY_TEXT_WORKFLOW_ID}&workflowVersion=1`);
    const current = policy.body?.policy;
    if (!current) return { skip: '读不到对齐工作流的提示词策略，无法切换为结构化 tags。' };
    rememberPolicy(PARITY_TEXT_WORKFLOW_ID, 1, current);
    const updated = await call('PUT', '/generation/activity-image-prompt-policy', {
      workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion: 1, revision: current.revision, enabled: true,
      instructions: current.instructions, positiveSuffix: current.positiveSuffix, negativePrompt: current.negativePrompt,
      outputFormat: 'tags', knowledgeMode: 'keyword',
    });
    if (updated.status >= 300) return { skip: `切换结构化策略失败：HTTP ${updated.status} ${JSON.stringify(updated.body).slice(0, 200)}` };
    if (!updated.body?.optimizer?.ready) return { skip: `结构化优化需要可用的文本模型：${updated.body?.optimizer?.message ?? '未绑定'}`, policyRevision: updated.body?.policy?.revision ?? null };
    return { workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion: 1, note: `对齐工作流 + tags + keyword（策略 r${updated.body.policy.revision}）`, policyRevision: updated.body.policy.revision };
  }
  return { workflowId: PARITY_TEXT_WORKFLOW_ID, workflowVersion: 1, note: '对齐工作流 + prose' };
}

/** 提交一次真实图片，轮询到终态，并把证据写进报告。 */
/** 本轮改动过的策略快照，结束时按原值写回。 */
const policySnapshots = {};
function rememberPolicy(workflowId, workflowVersion, policy) {
  const key = `${workflowId}@${workflowVersion}`;
  if (!policySnapshots[key] && policy) policySnapshots[key] = { ...policy };
}

/** 读取某个工作流版本的提示词策略（不存在返回 null）。 */
async function readPolicy(workflowId, workflowVersion) {
  const response = await call('GET', `/generation/activity-image-prompt-policy?workflowId=${workflowId}&workflowVersion=${workflowVersion}`);
  return response.body?.policy ?? null;
}

/** 开关某个工作流版本的提示词优化，返回新策略修订号。 */
async function setPolicyEnabled(workflowId, workflowVersion, enabled) {
  const current = await readPolicy(workflowId, workflowVersion);
  if (!current) return null;
  rememberPolicy(workflowId, workflowVersion, current);
  const response = await call('PUT', '/generation/activity-image-prompt-policy', {
    workflowId, workflowVersion, revision: current.revision, enabled,
    instructions: current.instructions, positiveSuffix: current.positiveSuffix, negativePrompt: current.negativePrompt,
    outputFormat: current.outputFormat ?? 'prose', knowledgeMode: current.knowledgeMode ?? 'none',
  });
  return response.status < 300 ? response.body?.policy?.revision ?? null : null;
}

async function runVariant(entry, target, resolved) {
  const buildRequest = () => ({
    stageId: target.stageId, sceneId: target.sceneId, beatId: target.beatId,
    workflowId: resolved.workflowId, workflowVersion: resolved.workflowVersion,
    customPrompt: FIXED_CUSTOM_PROMPT, negativePrompt: FIXED_NEGATIVE,
    parameters: FIXED_PARAMETERS, seed: entry.seed,
    ...(resolved.presetId ? { presetId: resolved.presetId } : {}),
  });
  let request = buildRequest();
  let preview = await call('POST', `/activities/${activityId}/beat-renders/preview`, request);
  if (preview.status >= 300) return { status: 'failed', stage: 'preview', detail: `HTTP ${preview.status} ${JSON.stringify(preview.body).slice(0, 300)}` };
  let plan = preview.body;
  const record = {
    key: entry.key, label: entry.label, variant: entry.variant, seed: entry.seed,
    note: resolved.note, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
    promptAssembly: plan.promptAssembly, promptOptimization: plan.promptOptimization,
    effectiveParameters: plan.parameters, positivePrompt: plan.positivePrompt, negativePrompt: plan.negativePrompt,
    referenceSupported: plan.referenceSupported, canSubmit: plan.canSubmit, warnings: plan.warnings,
  };
  if (!plan.canSubmit) {
    // 服务端修复后（R14.1），凭据不可用时**预览**就会报 canSubmit=false，不再等到派发。
    // 除 C 组外，其余组的意义都不是“结构化优化”，所以关掉优化重试一次，
    // 把“服务端组装”这个变量单独隔离出来；凭据问题本身如实记进报告。
    const blockedByTextModel = (plan.warnings ?? []).some((warning) => String(warning).includes('文本模型'));
    if (!blockedByTextModel || entry.requiresTextModel) {
      return { ...record, status: 'skipped', stage: 'preview', detail: `预览不可提交：${(plan.warnings ?? []).join(' ')}` };
    }
    const revision = await setPolicyEnabled(resolved.workflowId, resolved.workflowVersion, false);
    if (revision === null) return { ...record, status: 'skipped', stage: 'preview', detail: `预览不可提交且无法关闭优化：${(plan.warnings ?? []).join(' ')}` };
    record.optimizerDisabled = true;
    record.optimizerDisabledReason = `实例文本模型凭据不可用（${resolved.workflowId} v${resolved.workflowVersion} 策略改为 r${revision} · 关闭优化）；本次只隔离“服务端组装”变量，未验证结构化优化。`;
    request = buildRequest();
    const repreview = await call('POST', `/activities/${activityId}/beat-renders/preview`, request);
    if (repreview.status >= 300) return { ...record, status: 'failed', stage: 'preview-retry', detail: `HTTP ${repreview.status} ${JSON.stringify(repreview.body).slice(0, 300)}` };
    plan = repreview.body;
    Object.assign(record, {
      promptAssembly: plan.promptAssembly, promptOptimization: plan.promptOptimization,
      effectiveParameters: plan.parameters, positivePrompt: plan.positivePrompt, negativePrompt: plan.negativePrompt,
      canSubmit: plan.canSubmit, warnings: plan.warnings,
    });
    if (!plan.canSubmit) return { ...record, status: 'skipped', stage: 'preview', detail: `关闭优化后仍不可提交：${(plan.warnings ?? []).join(' ')}` };
  }

  const attempt = async (suffix) => {
    const submitted = await call('POST', `/activities/${activityId}/beat-renders`, {
      ...request, planHash: plan.planHash,
      ...(plan.selectedPresetRevision ? { presetRevision: plan.selectedPresetRevision } : {}),
      idempotencyKey: `parity-${entry.key}-${entry.seed}${suffix}`,
    });
    if (submitted.status >= 300) return { submitted, candidate: null };
    const deadline = Date.now() + 8 * 60 * 1000;
    let candidate = null;
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 4000));
      const list = await call('GET', `/activities/${activityId}/beat-renders?beatId=${target.beatId}&limit=20`);
      candidate = (list.body?.items ?? []).find((item) => item.id === submitted.body.candidateId) ?? null;
      if (candidate && ['succeeded', 'failed'].includes(candidate.status)) break;
    }
    return { submitted, candidate };
  };

  let outcome = await attempt('');
  if (outcome.submitted.status >= 300) {
    return { ...record, status: 'failed', stage: 'submit', detail: `HTTP ${outcome.submitted.status} ${JSON.stringify(outcome.submitted.body).slice(0, 300)}` };
  }
  record.candidateId = outcome.submitted.body.candidateId;
  record.callId = outcome.submitted.body.callId;

  // 文本模型凭据不可用时整条链路会在派发前被拒绝：AI 调用记录是 not_dispatched，
  // 没有排队任何 GPU 任务，所以关掉优化后重试一次不消耗图片预算，可以把
  // “服务端组装”这一项变量单独隔离出来。凭据问题本身如实记进报告。
  if (outcome.candidate?.status === 'failed' && /凭据不可用|prompt_optimizer_profile_unavailable/.test(outcome.candidate.error ?? '')) {
    // C 组的全部意义就是结构化优化；关掉优化再跑等于把它变成 B 组，属于自欺，所以直接如实跳过。
    if (entry.requiresTextModel) {
      return {
        ...record, status: 'skipped', stage: 'submit',
        detail: `结构化优化需要可用的活动文本模型，实例凭据不可用（${outcome.candidate.error}）。关掉优化会让本组退化成 B 组，因此不冒充已验证。`,
      };
    }
    const revision = await setPolicyEnabled(resolved.workflowId, resolved.workflowVersion, false);
    if (revision !== null) {
      record.optimizerDisabled = true;
      record.optimizerDisabledReason = `实例文本模型凭据不可用（${resolved.workflowId} v${resolved.workflowVersion} 策略改为 r${revision} · 关闭优化）；本次只隔离“服务端组装”变量，未验证结构化优化。`;
      request = buildRequest();
      const repreview = await call('POST', `/activities/${activityId}/beat-renders/preview`, request);
      if (repreview.status < 300) {
        plan = repreview.body;
        Object.assign(record, {
          promptAssembly: plan.promptAssembly, promptOptimization: plan.promptOptimization,
          effectiveParameters: plan.parameters, positivePrompt: plan.positivePrompt, negativePrompt: plan.negativePrompt,
          canSubmit: plan.canSubmit, warnings: plan.warnings,
        });
        outcome = await attempt('-noopt');
        if (outcome.submitted.status < 300) {
          record.candidateId = outcome.submitted.body.candidateId;
          record.callId = outcome.submitted.body.callId;
        }
      }
    }
  }
  if (outcome.submitted.status >= 300) {
    return { ...record, status: 'failed', stage: 'submit', detail: `HTTP ${outcome.submitted.status} ${JSON.stringify(outcome.submitted.body).slice(0, 300)}` };
  }
  const candidate = outcome.candidate;
  if (!candidate) return { ...record, status: 'failed', stage: 'poll', detail: '轮询超时，未拿到候选终态。' };
  // 提交响应里的 callId 可能还是空的（调用记录是异步建的），候选上的才是最终值。
  if (candidate.callId) record.callId = candidate.callId;
  record.status = candidate.status;
  record.artifactSha256 = candidate.artifactSha256;
  record.imageCount = candidate.images?.length ?? 0;
  record.artifactId = candidate.images?.[0]?.artifactId ?? null;
  record.error = candidate.error;
  record.imageOperation = candidate.imageOperation ?? null;

  // 实际进入编码器的文本：读调用日志里的派生字段，读不到就如实留空。
  if (record.callId) {
    const detail = await call('GET', `/ai-calls/${record.callId}`);
    const encoded = detail.body?.encodedTexts;
    record.encodedTexts = Array.isArray(encoded) ? encoded.map((item) => ({ nodeId: item.nodeId, role: item.role, text: item.text })) : null;
    record.encodedTextsReason = record.encodedTexts?.length ? null : '无法从这次调用的工作流快照确定实际编码文本';
  }

  if (candidate.images?.length) {
    const first = candidate.images[0];
    const fileName = `${entry.key}-seed${entry.seed}.png`;
    // mediaUrl 是门户相对路径（/api/admin/...）；直连服务时前缀不同，沿用 call() 探测到的前缀。
    const prefix = adminPrefix ?? '/api/admin';
    const url = `${portal}${first.mediaUrl.replace(/^\/api\/(v1\/)?admin/, prefix)}`;
    const response = await fetch(url, { headers: { 'x-sthstart-admin-token': token } });
    if (response.ok) {
      writeFileSync(resolve(outputDirectory, fileName), Buffer.from(await response.arrayBuffer()));
      record.file = fileName;
    } else {
      record.file = null;
      record.downloadError = `HTTP ${response.status} ${url}`;
    }
  }
  return record;
}

/**
 * 基础细化（计划 §11／§18.1）。来源必须是本活动的一张已成功图片；
 * 预览返回服务端从原图冻结的加载器／采样参数／提示词，提交必须回传同一个 seed 与 planHash。
 * 同时记录来源图 sha256 的前后值，作为“细化不改原图”的证据。
 */
async function runHires(entry, target, source, note) {
  if (!source?.artifactId) return { key: entry.key, label: entry.label, variant: 'hires', status: 'skipped', detail: '本轮没有可用的来源图（需要先有一张成功的镜头绘制）。' };
  const record = {
    key: entry.key, label: entry.label, variant: 'hires', note,
    sourceArtifactId: source.artifactId, sourceKey: source.key, sourceSha256Before: source.artifactSha256,
  };
  const activityDetail = await call('GET', `/activities/${activityId}`);
  const draftDetail = await call('GET', `/activities/${activityId}/draft`);
  const configDetail = await call('GET', `/activities/${activityId}/image-config/draft`);
  const versions = {
    headVersion: activityDetail.body?.activity?.headVersion,
    contentDraftVersion: draftDetail.body?.draft?.draftVersion ?? draftDetail.body?.draftVersion,
    contentRevisionId: activityDetail.body?.activity?.currentContentRevisionId,
    imageConfigDraftVersion: configDetail.body?.draft?.draftVersion ?? configDetail.body?.draftVersion,
    imageConfigRevisionId: configDetail.body?.draft?.baseRevisionId ?? configDetail.body?.baseRevisionId ?? null,
  };
  record.versions = versions;
  const studioTarget = { kind: 'beat', stageId: target.stageId, sceneId: target.sceneId, beatId: target.beatId };
  const request = { versions, target: studioTarget, sourceArtifactId: source.artifactId, maxSize: 2000, denoise: 0.2 };

  // 只读探针：旧工作流（图内自行拼接）的成果必须被拒绝，且错误码要具体。
  // 预览不创建任务、不调用模型，所以这一步不消耗图片预算。
  if (legacySource?.artifactId) {
    const probe = await call('POST', `/activities/${activityId}/studio/hires/preview`, { ...request, sourceArtifactId: legacySource.artifactId });
    record.legacySourceProbe = {
      sourceKey: legacySource.key, status: probe.status,
      error: probe.body?.error ?? null, message: probe.body?.message ?? null,
    };
  }

  const preview = await call('POST', `/activities/${activityId}/studio/hires/preview`, request);
  if (preview.status >= 300) return { ...record, status: 'failed', stage: 'preview', detail: `HTTP ${preview.status} ${JSON.stringify(preview.body).slice(0, 300)}` };
  const plan = preview.body;
  Object.assign(record, {
    canSubmit: plan.canSubmit, issues: plan.issues, sourceWidth: plan.sourceWidth, sourceHeight: plan.sourceHeight,
    outputWidth: plan.outputWidth, outputHeight: plan.outputHeight, maxSize: plan.maxSize, denoise: plan.denoise,
    seed: plan.seed, loaders: plan.loaders, sampler: plan.sampler,
    workflowId: plan.workflowId, workflowVersion: plan.workflowVersion, engineId: plan.engineId,
    hiresPositivePrompt: plan.positivePrompt, hiresNegativePrompt: plan.negativePrompt,
    transparencyHint: plan.transparencyHint, sourceChanged: plan.sourceChanged,
  });
  if (!plan.canSubmit) return { ...record, status: 'skipped', stage: 'preview', detail: `预览不可提交：${(plan.issues ?? []).join(' ')}` };
  const submitted = await call('POST', `/activities/${activityId}/studio/hires`, {
    ...request, seed: plan.seed, planHash: plan.planHash, idempotencyKey: `parity-hires-${entry.seed ?? 20260101}`,
  });
  if (submitted.status >= 300) return { ...record, status: 'failed', stage: 'submit', detail: `HTTP ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 300)}` };
  const jobId = submitted.body?.id ?? submitted.body?.job?.id;
  record.jobId = jobId;

  const deadline = Date.now() + 8 * 60 * 1000;
  let job = null;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 4000));
    const response = await call('GET', `/activities/${activityId}/studio-jobs/${jobId}`);
    job = response.body?.job ?? response.body;
    if (job && ['succeeded', 'failed', 'cancelled', 'stopped'].includes(job.status)) break;
  }
  if (!job) return { ...record, status: 'failed', stage: 'poll', detail: '轮询超时，未拿到细化任务终态。' };
  record.status = job.status === 'succeeded' ? 'succeeded' : 'failed';
  record.jobStatus = job.status;
  record.error = job.error?.message ?? job.error ?? null;

  const items = await call('GET', `/activities/${activityId}/studio-jobs/${jobId}/items?limit=20`);
  const resultItems = (items.body?.items ?? []).filter((item) => item.artifactId);
  record.resultArtifactIds = resultItems.map((item) => item.artifactId);
  if (resultItems[0]) {
    const fileName = `${entry.key}-from-${source.key}.png`;
    const prefix = adminPrefix ?? '/api/admin';
    const url = `${portal}/api/v1/admin/creative/artifacts/${resultItems[0].artifactId}`.replace('/api/v1/admin', prefix);
    const response = await fetch(url, { headers: { 'x-sthstart-admin-token': token } });
    if (response.ok) { writeFileSync(resolve(outputDirectory, fileName), Buffer.from(await response.arrayBuffer())); record.file = fileName; }
    else record.downloadError = `HTTP ${response.status} ${url}`;
  }

  // 原图必须原样保留：细化产物写新 artifact，来源 sha256 不得变化。
  const after = await call('GET', `/activities/${activityId}/beat-renders?beatId=${target.beatId}&limit=20`);
  const sourceCandidate = (after.body?.items ?? []).find((item) => (item.images ?? []).some((image) => image.artifactId === source.artifactId));
  record.sourceSha256After = sourceCandidate?.artifactSha256 ?? null;
  record.sourceUnchanged = record.sourceSha256After === record.sourceSha256Before;
  return record;
}

/**
 * 准备漫画画格：漫画草稿默认是空的，需要按契约构造 ≥4 个引用真实场景／镜头的画格。
 * 画格必须绑定到内容版本里的真实 sceneId／beatIds，不能凭空造 id。
 */
async function prepareComic(target) {
  const detail = await call('GET', `/activities/${activityId}`);
  const contentRevisionId = detail.body?.activity?.currentContentRevisionId;
  if (!contentRevisionId) throw new Error('活动没有当前内容版本，无法建立漫画草稿。');
  let draftResponse = await call('GET', `/activities/${activityId}/comic/draft`);
  let draft = draftResponse.body?.draft ?? null;
  if (!draft) {
    const created = await call('POST', `/activities/${activityId}/comic/draft`, { contentRevisionId });
    if (created.status >= 300) throw new Error(`建立漫画草稿失败：HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    draft = created.body.draft;
  }
  const contentDraft = await call('GET', `/activities/${activityId}/draft`);
  const stages = contentDraft.body?.draft?.document?.stages ?? contentDraft.body?.document?.stages ?? [];
  const scene = stages[0]?.scenes?.[0];
  if (!scene?.beats?.length) throw new Error('内容草稿里没有可用场景／镜头，拒绝伪造漫画画格来源。');
  const beatIds = scene.beats.map((beat) => beat.id);
  const shotSizes = ['wide', 'medium', 'closeup', 'detail'];
  const panels = shotSizes.map((shotSize, index) => ({
    id: `parity-panel-${index + 1}`,
    source: { stageId: stages[0].id, sceneId: scene.id, beatIds: [beatIds[Math.min(index, beatIds.length - 1)]] },
    actorIds: [],
    shotSize,
    visualDescription: `${TEST_BEAT.action}（第 ${index + 1} 格：${shotSize}）`,
    // 单变量对照（R24.7 假说）：anima 主要按英文标签理解画面。
    // 这一格显式补上英文画面描述；若画面因此变成雪山营地，则假说成立。
    composition: index === 0
      ? `${TEST_BEAT.environment}｜single female researcher, short silver hair, green eyes, blue lab coat, holding a glass flask with green liquid, snowy mountain camp at night, tents and pine trees, medium shot, calm expression, clean anime screenshot`
      : '沿用同一场景的连续画面，保持人物与道具位置一致',
    textSafeArea: index % 2 === 0 ? 'top_left' : 'bottom',
    selectedImage: null,
    crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
    bubbles: [],
    presentation: { camera: 'none', impact: 'none', holdMs: null },
    renderSettings: {},
  }));
  // duo 模板每页**恰好 2 格**（服务端会校验），所以 4 格拆成两页，而不是一页塞 4 格。
  const document = {
    ...draft.document,
    contentRevisionId,
    pages: [
      { id: 'parity-page-1', title: '邻舍对齐受控对照 · 上', template: 'duo', panelIds: [panels[0].id, panels[1].id] },
      { id: 'parity-page-2', title: '邻舍对齐受控对照 · 下', template: 'duo', panelIds: [panels[2].id, panels[3].id] },
    ],
    panels,
  };
  const saved = await call('PUT', `/activities/${activityId}/comic/draft`, { expectedDraftVersion: draft.draftVersion, document });
  if (saved.status >= 300) throw new Error(`保存漫画草稿失败：HTTP ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`);
  return { panelId: panels[0].id, panelCount: panels.length, draftVersion: saved.body.draft.draftVersion, contentRevisionId };
}

/** 漫画画格的预览 → 提交 → 轮询 → 取产物。 */
async function runComic(entry, target, comic, note) {
  const record = { key: entry.key, label: entry.label, variant: 'comic', note, panelId: comic.panelId, panelCount: comic.panelCount };
  const seed = entry.seed ?? FIXED_SEEDS[0];
  const preview = await call('POST', `/activities/${activityId}/comic/panels/${comic.panelId}/render-preview`, { expectedDraftVersion: comic.draftVersion, seed });
  if (preview.status >= 300) return { ...record, status: 'failed', stage: 'preview', detail: `HTTP ${preview.status} ${JSON.stringify(preview.body).slice(0, 300)}` };
  let plan = preview.body;
  // 凭据不可用时预览会报 canSubmit=false（服务端修复后的行为）。这里与镜头路径一样降级：
  // 关掉结构化优化后重试一次，只隔离“漫画入口能否跑通”这个变量，不冒充结构化优化已验证。
  const blockedByTextModel = plan.canSubmit === false && (plan.warnings ?? []).some((warning) => String(warning).includes('文本模型'));
  if (blockedByTextModel) {
    const revision = await setPolicyEnabled(plan.workflowId, plan.workflowVersion, false);
    record.optimizerDisabled = true;
    record.optimizerDisabledReason = `实例文本模型凭据不可用（${plan.workflowId} v${plan.workflowVersion} 策略改为 r${revision} · 关闭优化）；本次只验证漫画入口链路，未验证结构化优化。`;
    const retry = await call('POST', `/activities/${activityId}/comic/panels/${comic.panelId}/render-preview`, { expectedDraftVersion: comic.draftVersion, seed });
    if (retry.status >= 300) return { ...record, status: 'failed', stage: 'preview-retry', detail: `HTTP ${retry.status} ${JSON.stringify(retry.body).slice(0, 300)}` };
    plan = retry.body;
  }
  Object.assign(record, {
    canSubmit: plan.canSubmit, warnings: plan.warnings, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
    planSeed: plan.seed, width: plan.width, height: plan.height, promptAssembly: plan.promptAssembly,
  });
  if (!plan.canSubmit) return { ...record, status: 'skipped', stage: 'preview', detail: `预览不可提交：${(plan.warnings ?? []).join(' ')}` };
  const submitted = await call('POST', `/activities/${activityId}/comic/panels/${comic.panelId}/renders`, {
    expectedDraftVersion: comic.draftVersion, planHash: plan.planHash, seed: plan.seed, idempotencyKey: `parity-comic-${seed}`,
  });
  if (submitted.status >= 300) return { ...record, status: 'failed', stage: 'submit', detail: `HTTP ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 300)}` };
  const jobId = submitted.body?.job?.id;
  record.jobId = jobId;
  const deadline = Date.now() + 8 * 60 * 1000;
  let job = null;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 4000));
    const response = await call('GET', `/activities/${activityId}/comic/jobs/${jobId}`);
    job = response.body?.job ?? response.body;
    if (job && ['succeeded', 'failed', 'cancelled'].includes(job.status)) break;
  }
  if (!job) return { ...record, status: 'failed', stage: 'poll', detail: '轮询超时，未拿到漫画任务终态。' };
  record.status = job.status === 'succeeded' ? 'succeeded' : 'failed';
  record.jobStatus = job.status;
  record.error = job.error?.message ?? job.error ?? null;
  const artifactId = job.result?.renderedImages?.[0] ?? null;
  record.artifactId = artifactId;
  if (artifactId) {
    const fileName = `${entry.key}-panel1-seed${seed}.png`;
    const prefix = adminPrefix ?? '/api/admin';
    const url = `${portal}${prefix}/artifacts/${artifactId}/file`;
    const response = await fetch(url, { headers: { 'x-sthstart-admin-token': token } });
    if (response.ok) { writeFileSync(resolve(outputDirectory, fileName), Buffer.from(await response.arrayBuffer())); record.file = fileName; }
    else record.downloadError = `HTTP ${response.status} ${url}`;
  }
  return record;
}

let submissions = 0;
let contentTarget = null;
/** 细化需要一个来源图：优先用对齐工作流（服务端组装，快照可解析）的成果。 */
let hiresSource = null;
/** 旧工作流的成果留着做“缺快照必须拒绝”的只读探针（预览不派发任务、不占预算）。 */
let legacySource = null;
/** 漫画画格上下文：草稿里默认没有画格，需要按契约构造。 */
let comicTarget = null;
try {
  contentTarget = await prepareContent();
  report.contentTarget = contentTarget;
  report.fixedConditions = { customPrompt: FIXED_CUSTOM_PROMPT, negativePrompt: FIXED_NEGATIVE, parameters: FIXED_PARAMETERS, testBeat: TEST_BEAT };
  // 漫画准备失败不应该拖垮整轮：如实记下原因，漫画那一条会走 skipped。
  try {
    comicTarget = await prepareComic(contentTarget);
    report.comicTarget = comicTarget;
  } catch (error) {
    comicTarget = null;
    report.comicPrepareError = error.message;
    console.log(`[warn] 漫画画格准备失败：${error.message}`);
  }
  save();
} catch (error) {
  report.status = 'failed';
  report.issues.push(`准备受控镜头失败：${error.message}`);
  save();
  console.error(JSON.stringify({ error: 'content_prepare_failed', message: error.message, activityId, outputDirectory }, null, 2));
  process.exit(1);
}

for (const entry of BUDGET_PLAN) {
  if (entry.conditional === 'lora_file_present' || entry.conditional === 'explicit_need') {
    // 条件项仍要走一次判定，判定结果如实记录；不计入提交数。
  }
  const resolved = await resolveVariant(entry, contentTarget);
  if (resolved.skip) {
    report.submissions.push({ key: entry.key, label: entry.label, variant: entry.variant, status: 'skipped', detail: resolved.skip });
    save();
    console.log(`[skip] ${entry.key}: ${resolved.skip}`);
    continue;
  }
  if (resolved.comic && !comicTarget) {
    report.submissions.push({ key: entry.key, label: entry.label, variant: 'comic', status: 'skipped', detail: `漫画画格未准备好：${report.comicPrepareError ?? '未知原因'}` });
    save();
    console.log(`[skip] ${entry.key}: 漫画画格未准备好`);
    continue;
  }
  submissions += 1;
  if (submissions > MAX_SUBMISSIONS) {
    report.submissions.push({ key: entry.key, status: 'skipped', detail: '超出 12 次预算上限。' });
    save();
    continue;
  }
  console.log(`[run ] ${entry.key} seed=${entry.seed} ${resolved.note ?? ''}`);
  const result = resolved.hires
    ? await runHires(entry, contentTarget, hiresSource, resolved.note)
    : resolved.comic
      ? await runComic(entry, contentTarget, comicTarget, resolved.note)
      : await runVariant(entry, contentTarget, resolved);
  report.submissions.push(result);
  save();
  if (result.status === 'succeeded' && result.artifactId) {
    const candidate = { key: result.key, artifactId: result.artifactId, artifactSha256: result.artifactSha256, promptAssembly: result.promptAssembly };
    if (result.promptAssembly === 'service-finalized-v1' && !hiresSource) hiresSource = candidate;
    if (result.promptAssembly !== 'service-finalized-v1' && !legacySource) legacySource = candidate;
  }
  console.log(`[done] ${entry.key} -> ${result.status}${result.error ? ` (${result.error})` : ''}`);
}

// 恢复本轮为了隔离变量而临时改动的策略，避免把实例配置留在被改动状态。
// 快照在循环开始前采集，恢复时用当前修订号写回，保证不覆盖别人的并发修改之外的内容。
for (const [key, snapshot] of Object.entries(policySnapshots)) {
  const [workflowId, version] = key.split('@');
  const current = await readPolicy(workflowId, Number(version));
  if (!current) continue;
  const response = await call('PUT', '/generation/activity-image-prompt-policy', {
    workflowId, workflowVersion: Number(version), revision: current.revision,
    enabled: snapshot.enabled, instructions: snapshot.instructions,
    positiveSuffix: snapshot.positiveSuffix, negativePrompt: snapshot.negativePrompt,
    outputFormat: snapshot.outputFormat ?? 'prose', knowledgeMode: snapshot.knowledgeMode ?? 'none',
  });
  report.policyRestored = report.policyRestored ?? [];
  report.policyRestored.push({
    workflowId, workflowVersion: Number(version), revision: response.body?.policy?.revision ?? null,
    enabled: snapshot.enabled, outputFormat: snapshot.outputFormat ?? 'prose', knowledgeMode: snapshot.knowledgeMode ?? 'none',
  });
}
save();

const succeeded = report.submissions.filter((item) => item.status === 'succeeded').length;
const failed = report.submissions.filter((item) => item.status === 'failed').length;
const skipped = report.submissions.filter((item) => item.status === 'skipped').length;
report.summary = { attempted: submissions, succeeded, failed, skipped, budgetMax: MAX_SUBMISSIONS };
report.status = failed ? 'completed_with_failures' : 'completed';
save();

console.log(JSON.stringify({
  engines: live.engines, parityWorkflows: live.parityWorkflows, activityId,
  summary: report.summary, outputDirectory,
  note: '真实提交已完成。成功与失败都记入报告；跳过项写明原因。',
}, null, 2));
console.log(`报告目录：${outputDirectory}`);

