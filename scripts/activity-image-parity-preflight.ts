/**
 * 活动生图对齐 V2 · 真实 ComfyUI 只读预检（计划 §10.3 / §12.4 / §17.2）。
 *
 * 只做两件事：
 *   1. 把两个内置对齐工作流的**定义对象**渲染成实际会派发的图；
 *   2. 对真实 ComfyUI 实例跑 `inspectWorkflowRuntime`，逐节点、逐模型核对依赖。
 *
 * 不写任何数据库、不提交任何任务、不修改真实配置；只读 `/object_info`。
 * 可选 `--submit-text` / `--submit-hires` 才会真的排队出图（默认关闭，需显式打开）。
 *
 *   node --import tsx scripts/activity-image-parity-preflight.ts
 */
import { buildParityHiresWorkflow, buildParityTextWorkflow, PARITY_BASE_PRESET, PARITY_TURBO_PRESET, PARITY_SIZE_PRESETS } from '../apps/service/src/activities/parity-workflows.js';
import { inspectWorkflowRuntime } from '../apps/service/src/generation/runtime-preflight.js';
import { renderWorkflowSnapshot } from '../apps/service/src/generation/workflows.js';
import { SecretStore } from '../apps/service/src/security.js';

const BASE_URL = process.env.STHSTART_PARITY_ENGINE_URL ?? 'http://127.0.0.1:8188';
const target = { id: 'comfyui-local', kind: 'comfyui', baseUrl: BASE_URL, credentialAccount: null };
const secrets = new SecretStore({});

const text = buildParityTextWorkflow();
const hires = buildParityHiresWorkflow();

console.log(`引擎：${BASE_URL}`);
console.log(`文本工作流：${text.id}  contentHash=${text.contentHash.slice(0, 12)}`);
console.log(`细化工作流：${hires.id}  contentHash=${hires.contentHash.slice(0, 12)}`);

// 用实际默认参数渲染两份图，而不是拿模板去校验。
const POSITIVE = '1girl, solo, standing in snow, masterpiece, best quality';
const NEGATIVE = 'worst quality, low quality, blurry, text, watermark';
const textSnapshot = renderWorkflowSnapshot(text.definition, text.nodeBindings, { prompt: POSITIVE, negativePrompt: NEGATIVE }, 2026100301);
const hiresSnapshot = renderWorkflowSnapshot(hires.definition, hires.nodeBindings, { prompt: POSITIVE, negativePrompt: NEGATIVE, initImage: 'parity-source.png' }, 2026100302);

const results: Array<{ label: string; result: Awaited<ReturnType<typeof inspectWorkflowRuntime>> }> = [];
const cases: Array<[string, Record<string, unknown>]> = [['文本工作流', textSnapshot], ['细化工作流', hiresSnapshot]];
for (const [label, snapshot] of cases) {
  const result = await inspectWorkflowRuntime(target, snapshot, secrets, fetch, true);
  results.push({ label, result });
  console.log(`\n=== ${label} ===`);
  console.log(`  ok=${result.ok}  reachable=${result.reachable}`);
  for (const [group, messages] of Object.entries(result.checks)) {
    if (!messages.length) continue;
    console.log(`  [${group}]`);
    for (const message of messages) console.log(`    - ${message}`);
  }
  if (!Object.values(result.checks).some((messages) => messages.length)) console.log('  没有问题');
}

console.log('\n=== 预设（计划 §10.1） ===');
for (const preset of [PARITY_BASE_PRESET, PARITY_TURBO_PRESET]) {
  const v = preset.values as Record<string, unknown>;
  console.log(`  ${preset.name}：${v.steps} 步 / CFG ${v.cfg} / ${v.sampler_name}/${v.scheduler} / 初始 ${v.width}×${v.height} / unet=${v.unet_name}`);
}
console.log(`  尺寸：${PARITY_SIZE_PRESETS.map((preset) => preset.label).join('、')}`);

const failed = results.filter((entry) => !entry.result.ok);
if (failed.length) {
  console.error(`\n失败：${failed.map((entry) => entry.label).join('、')} 未通过真实实例预检。`);
  process.exit(1);
}
console.log('\nOK：两个对齐工作流都通过真实 ComfyUI 预检（只读，未提交任何任务）。');
