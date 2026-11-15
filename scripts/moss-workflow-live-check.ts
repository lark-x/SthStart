import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMossImageWorkflow } from '../apps/service/src/activities/moss-workflow.js';
import { renderWorkflowSnapshot } from '../apps/service/src/generation/workflows.js';

/**
 * 用已注册的 MOSS 工作流定义直接向本地 ComfyUI 提交一张图，验证 API JSON 可用。
 *   node --import tsx scripts/moss-workflow-live-check.ts [--prompt-file <path>]
 * 只写 artifacts/story-worlds-implementation/moss-output/，不触碰数据库。
 */

const base = 'http://127.0.0.1:8188';
const bundle = buildMossImageWorkflow();
const prompt = 'Japanese anime screencap, cel shading, flat colors, clean lineart. Early morning at a small harbor town: two adults in their twenties stand beside a wooden repair table on stone steps, calm sea behind them. A young man with short black hair in a dark blue linen jacket holds an old brass lantern with a glass globe and wire guard; a young woman with chestnut shoulder-length hair in a dark green coat leans in with a dry cloth. The lantern is unlit. Medium shot, three-quarter front view, warm natural light, soft shadows.';
const parameters = {
  prompt,
  negativePrompt: bundle.inputSchema && (bundle.inputSchema as Record<string, { default?: string }>).negativePrompt.default,
  seed: 424242,
  width: 1024,
  height: 1024,
  steps: 25,
  cfg: 2.5,
};
const graph = renderWorkflowSnapshot(bundle.definition, bundle.nodeBindings, parameters);
const outputDir = join(process.cwd(), 'artifacts', 'story-worlds-implementation', 'moss-output');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'submitted-graph.json'), JSON.stringify(graph, null, 2));

const started = Date.now();
const submit = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: graph, client_id: 'sthstart-moss-check' }) });
const submitted = await submit.json() as { prompt_id?: string; error?: unknown; node_errors?: unknown };
if (!submit.ok || !submitted.prompt_id) {
  console.error(JSON.stringify({ stage: 'submit', status: submit.status, submitted }, null, 2));
  process.exit(1);
}
const promptId = submitted.prompt_id;
console.log(JSON.stringify({ stage: 'submitted', promptId }));

let entry: { status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> } | undefined;
for (let attempt = 0; attempt < 180; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const history = await fetch(`${base}/history/${promptId}`).then((response) => response.json()) as Record<string, typeof entry>;
  entry = history[promptId];
  if (entry?.status?.completed || entry?.status?.status_str === 'error') break;
  if (attempt % 15 === 0) console.log(JSON.stringify({ stage: 'waiting', seconds: Math.round((Date.now() - started) / 1000) }));
}
const images = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? []);
if (!images.length) {
  console.error(JSON.stringify({ stage: 'no-image', status: entry?.status ?? null }, null, 2));
  process.exit(1);
}
const saved: string[] = [];
for (const image of images) {
  const url = `${base}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${image.type}`;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const target = join(outputDir, image.filename);
  writeFileSync(target, bytes);
  saved.push(target);
}
console.log(JSON.stringify({ stage: 'done', seconds: Math.round((Date.now() - started) / 1000), images: saved }, null, 2));
