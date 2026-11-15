import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMossImageWorkflow } from '../apps/service/src/activities/moss-workflow.js';
import { renderWorkflowSnapshot } from '../apps/service/src/generation/workflows.js';

/**
 * MOSS 三阶段对比：同一事件（海港修灯）的建立／行动／结果三张图，固定种子。
 *   node --import tsx scripts/moss-workflow-phase-compare.ts
 * 只写 artifacts/story-worlds-implementation/moss-output/phase-*，不触碰数据库。
 */

const base = 'http://127.0.0.1:8188';
const bundle = buildMossImageWorkflow();
const negative = (bundle.inputSchema as Record<string, { default?: string }>).negativePrompt.default;
const style = 'Japanese anime screencap, cel shading, flat colors, clean lineart, warm paper texture.';
const cast = 'Two adults in their twenties: a young man with short black hair in a dark blue linen jacket, and a young woman with chestnut shoulder-length hair in a dark green coat carrying a brown mailbag.';
const place = 'A small harbor town at early morning, wooden repair table on stone steps beside calm sea.';
const prop = 'An old brass lantern with a glass globe and a wire guard lies unlit on the table.';
const phases = [
  { name: 'establishing', text: `${style} Wide establishing shot of the empty dock before anyone acts. ${place} ${prop} No people in the foreground yet; the scene is quiet and still.` },
  { name: 'action', text: `${style} Medium shot. ${place} ${cast} ${prop} The woman leans forward and hands the man a dry cloth; he takes it and wipes the glass globe while steadying the loose handle with his other hand. The lantern stays unlit.` },
  { name: 'result', text: `${style} Medium shot. ${place} ${cast} The lantern now stands upright on the table with its handle tightened; the glass globe is clean and the wick is still unlit. The two step back and look at the repaired lantern.` },
];
const outputDir = join(process.cwd(), 'artifacts', 'story-worlds-implementation', 'moss-output');
mkdirSync(outputDir, { recursive: true });
const saved: string[] = [];
const started = Date.now();
for (const [index, phase] of phases.entries()) {
  const graph = renderWorkflowSnapshot(bundle.definition, bundle.nodeBindings, {
    prompt: phase.text, negativePrompt: negative, seed: 20261113, width: 1024, height: 1024, steps: 25, cfg: 2.5,
  });
  const submit = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: `sthstart-moss-phase-${index}` }) });
  const body = await submit.json() as { prompt_id?: string; error?: unknown; node_errors?: unknown };
  if (!submit.ok || !body.prompt_id) { console.error(JSON.stringify({ phase: phase.name, status: submit.status, body }, null, 2)); process.exit(1); }
  const promptId = body.prompt_id;
  let entry: { status?: { completed?: boolean; status_str?: string }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> } | undefined;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const history = await fetch(`${base}/history/${promptId}`).then((response) => response.json()) as Record<string, typeof entry>;
    entry = history[promptId];
    if (entry?.status?.completed || entry?.status?.status_str === 'error') break;
  }
  const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0];
  if (!image) { console.error(JSON.stringify({ phase: phase.name, status: entry?.status ?? null }, null, 2)); process.exit(1); }
  const url = `${base}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${image.type}`;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const target = join(outputDir, `phase-${phase.name}.png`);
  writeFileSync(target, bytes);
  saved.push(target);
  console.log(JSON.stringify({ phase: phase.name, seconds: Math.round((Date.now() - started) / 1000), file: target }));
}
console.log(JSON.stringify({ done: true, totalSeconds: Math.round((Date.now() - started) / 1000), images: saved }, null, 2));
