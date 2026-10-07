// @ts-nocheck
// 根 tsconfig 的 @cloudflare/workers-types 会覆盖全局 Buffer 类型（readUInt32BE/copy 等消失），
// 而本脚本必须用 Buffer 做 PNG 编解码。这是独立只读探针，不进入任何运行时路径，
// 因此在此关闭类型检查；运行时行为由脚本自身的判定输出验证。
/**
 * 计划 §12.2 要求的透明图节点输入／输出验证。
 *
 * “LoadImage的mask通常为反alpha，必须验证mask方向，不能把人物抹掉。
 *   用透明红方块与不透明边缘fixture做节点输入/输出验证。非透明图不得产生黑底或变色。”
 *
 * 本脚本不经过数据库与活动，直接把细化工作流的图形方案渲染出来打到真实 ComfyUI，
 * 再逐像素检查输出：透明处必须变白底、不透明处必须保留原色、结果必须是不透明新图。
 *
 * 只读探针：不写业务库、不建活动、不占验收预算。
 */
import { deflateSync, inflateSync } from 'node:zlib';
// 显式导入：根 tsconfig 的 @cloudflare/workers-types 会覆盖全局 Buffer 类型，导致 readUInt32BE/copy 不存在。
import { Buffer } from 'node:buffer';
import { buildParityHiresWorkflow } from '../apps/service/src/activities/parity-workflows.js';

const COMFY = process.env.PARITY_COMFY_URL ?? 'http://127.0.0.1:8188';
const SIZE = 256;
const SQUARE = { x: 64, y: 64, size: 128 };
const RED = [255, 0, 0];
const SEMI_GREEN = [0, 255, 0];

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- PNG 解码 ----------
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function decodePng(buffer: Buffer): { width: number; height: number; channels: number; at: (x: number, y: number) => number[] } {
  let offset = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`只支持 8 位深度，实际 ${bitDepth}`);
  if (interlace !== 0) throw new Error('不支持隔行扫描');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y === 0 ? Buffer.alloc(stride) : pixels.subarray((y - 1) * stride, y * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prior[i];
      const c = i >= channels ? prior[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = value & 0xff;
    }
  }
  const at = (x: number, y: number) => {
    const base = y * stride + x * channels;
    if (channels === 4) return [pixels[base], pixels[base + 1], pixels[base + 2], pixels[base + 3]];
    if (channels === 3) return [pixels[base], pixels[base + 1], pixels[base + 2], 255];
    if (channels === 2) return [pixels[base], pixels[base], pixels[base], pixels[base + 1]];
    return [pixels[base], pixels[base], pixels[base], 255];
  };
  return { width, height, channels, at };
}

// ---------- 夹具：透明底 + 不透明红方块 + 半透明绿方块 ----------
function buildFixture() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4, 0);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const base = (y * SIZE + x) * 4;
      const inRed = x >= SQUARE.x && x < SQUARE.x + SQUARE.size && y >= SQUARE.y && y < SQUARE.y + SQUARE.size;
      const inSemi = x >= 16 && x < 48 && y >= 16 && y < 48;
      if (inRed) { rgba[base] = RED[0]; rgba[base + 1] = RED[1]; rgba[base + 2] = RED[2]; rgba[base + 3] = 255; }
      else if (inSemi) { rgba[base] = SEMI_GREEN[0]; rgba[base + 1] = SEMI_GREEN[1]; rgba[base + 2] = SEMI_GREEN[2]; rgba[base + 3] = 128; }
    }
  }
  return rgba;
}

// ---------- 主流程 ----------
const fixture = buildFixture();
const fixturePng = encodePng(SIZE, SIZE, fixture);

const form = new FormData();
form.append('image', new Blob([new Uint8Array(fixturePng)], { type: 'image/png' }), 'parity-alpha-fixture.png');
form.append('overwrite', 'true');
const upload = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form });
if (!upload.ok) throw new Error(`上传夹具失败：HTTP ${upload.status} ${await upload.text()}`);
const uploaded = (await upload.json()) as { name: string; subfolder?: string; subpath?: string };
const serverName = uploaded.subpath ? `${uploaded.subpath}/${uploaded.name}` : uploaded.name;
console.log('夹具已上传：', serverName, `(${SIZE}x${SIZE} RGBA，透明底 + 不透明红方块 + 半透明绿方块)`);

const bundle = buildParityHiresWorkflow();
const definition = bundle.definition;
// 反向对照：把合成 mask 接回未反转的 LoadImage 输出（即修复前的错误接线）。
// 若这个模式下红方块**没有**消失，说明本脚本的判定根本测不出 mask 方向，正向结果也就不可信。
const negativeControl = process.argv.includes('--negative-control');
if (negativeControl) {
  (definition['3'] as { inputs: Record<string, unknown> }).inputs.mask = ['1', 1];
  console.log('模式：反向对照（mask 接回未反转的 LoadImage 输出）');
} else {
  console.log('模式：修复后（mask 经 InvertMask）');
}
const outputSize = 512;
const inputs = {
  positivePrompt: 'a plain red square on a white background',
  negativePrompt: 'text, watermark',
  width: outputSize, height: outputSize,
  sourceWidth: SIZE, sourceHeight: SIZE,
  seed: 20260101, steps: 4, cfg: 5, sampler_name: 'er_sde', scheduler: 'beta', denoise: 0.2,
  init_image: serverName,
};
// 复用项目自己的渲染函数，确保验证的就是真实派发用的图形方案。
const { renderWorkflowSnapshot } = await import('../apps/service/src/generation/workflows.js');
const graph = renderWorkflowSnapshot(definition, bundle.nodeBindings, inputs, inputs.seed);

const queued = await fetch(`${COMFY}/prompt`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: graph, client_id: 'parity-alpha-check' }),
});
if (!queued.ok) throw new Error(`派发失败：HTTP ${queued.status} ${await queued.text()}`);
const queuedBody = (await queued.json()) as { prompt_id: string };
const promptId = queuedBody.prompt_id;
console.log('已派发：', promptId);

const deadline = Date.now() + 5 * 60 * 1000;
type HistoryEntry = {
  status?: { status_str?: string; status?: string; messages?: unknown[] };
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
};
let entry: HistoryEntry | null = null;
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 3000));
  const history = (await (await fetch(`${COMFY}/history/${promptId}`)).json()) as Record<string, HistoryEntry>;
  entry = history[promptId] ?? null;
  if (entry) break;
}
if (!entry) throw new Error('轮询超时，未拿到执行结果。');
const status = entry.status?.status_str ?? entry.status?.status ?? 'unknown';
console.log('执行状态：', status);
if (status !== 'success') {
  console.log('节点错误：', JSON.stringify(entry.status?.messages ?? [], null, 1).slice(0, 1500));
  process.exit(1);
}

const image = Object.values(entry.outputs ?? {}).flatMap((node) => node.images ?? [])[0];
if (!image) throw new Error('执行成功但没有输出图片。');
const viewUrl = `${COMFY}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? '')}&type=${image.type ?? 'output'}`;
const outputPng = Buffer.from(await (await fetch(viewUrl)).arrayBuffer());
const decoded = decodePng(outputPng);
console.log(`输出：${decoded.width}x${decoded.height}，通道数 ${decoded.channels}`);

// ---------- 逐像素判定 ----------
const scale = decoded.width / SIZE;
const sample = (x: number, y: number) => decoded.at(Math.min(decoded.width - 1, Math.round(x * scale)), Math.min(decoded.height - 1, Math.round(y * scale)));
const center = sample(SQUARE.x + SQUARE.size / 2, SQUARE.y + SQUARE.size / 2);
const corner = sample(4, 4);
const semi = sample(32, 32);
const checks: Array<[string, boolean, string]> = [];
const opaque = decoded.channels === 3 || center[3] === 255;
checks.push(['结果是单通道数或 alpha 全 255 的不透明新图', opaque, `通道 ${decoded.channels}，中心 alpha ${center[3]}`]);
checks.push(['不透明红方块保留红色（未被抹成白底）', center[0] > 180 && center[1] < 80 && center[2] < 80, `中心 RGB ${center.slice(0, 3)}`]);
checks.push(['透明区域合成成白底（不是黑底）', corner[0] > 200 && corner[1] > 200 && corner[2] > 200, `角落 RGB ${corner.slice(0, 3)}`]);
checks.push(['半透明区域没有被当成完全透明丢掉', semi[1] > 120, `半透明处 RGB ${semi.slice(0, 3)}`]);

console.log('\n判定：');
/**
 * 反向对照下应当失败的项：mask 方向反了以后，
 * 不透明处会被白底覆盖、透明处会取到透明像素的 RGB(0,0,0) 而变黑。
 * 另外两项（不透明新图、半透明混合）在两种模式下表现相同，不具区分力，只作记录。
 */
const DISCRIMINATING = new Set(['不透明红方块保留红色（未被抹成白底）', '透明区域合成成白底（不是黑底）']);
let failed = 0;
for (const [label, ok, detail] of checks) {
  const expected = negativeControl ? !DISCRIMINATING.has(label) : true;
  const verdict = ok === expected;
  if (!verdict) failed += 1;
  const suffix = negativeControl && DISCRIMINATING.has(label) ? '（对照下应失败）' : '';
  console.log(`  ${verdict ? '符合预期' : '不符合预期'}  ${label} —— ${detail}${suffix}`);
}
if (negativeControl) {
  console.log(`\n结论：${failed === 0 ? '判定有效——反向对照把不透明处抹成白底、透明处变成黑底，本脚本能测出 mask 方向' : '判定无效——反向对照没有复现缺陷，正向结果不可信'}`);
} else {
  console.log(`\n结论：${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
}
// 用 exitCode 而不是 process.exit：后者会与仍在收尾的 fetch 句柄竞争，在 Windows 上触发 libuv 断言。
process.exitCode = failed === 0 ? 0 : 1;
