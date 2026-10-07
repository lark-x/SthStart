/**
 * 活动提示词 V2 编译：有作用域的纯函数集合。
 *
 * 与 legacy `prompt-tag-composer.ts` 的关系：legacy 的行为保持不变，供旧工作流与旧策略继续使用。
 * 本模块只在工作流声明 `promptAssembly='service-finalized-v1'` 时参与最终组装，
 * 负责“服务端组装出完整提示词，工作流只编码与生成”。
 *
 * 固定顺序（计划 §6.2）：
 *   LoRA 触发词 → 活动画风／质量 → 明确人数 → 角色块 → 相机 → 环境 → 细节 → 必要自然语言
 */

export const ACTIVITY_IMAGE_COMPILER_VERSION = 'activity-image-v2.1';

export interface RemovedTag {
  scope: string;
  tag: string;
  reason: string;
}

export interface CompileDiagnostics {
  compilerVersion: string;
  removedTags: RemovedTag[];
  warnings: string[];
}

// ── 分段扫描 ──

export interface PromptSegment {
  /** 原始片段，保留显式权重写法。 */
  raw: string;
  /** 去掉权重包裹后的标签文本。 */
  base: string;
  /** 显式权重表达（如 `1.2`）；没有则为 null。 */
  weight: string | null;
  /** 归一化标签键，用于同作用域去重比较。 */
  normalized: string;
  /** 无法安全分析的表达：原样保留，只给诊断。 */
  opaque: boolean;
  reason?: string;
}

const OPENERS = '([{<';
const CLOSERS = ')]}>';

/** 归一化标签键：小写、下划线化分隔符，保留中文与数字。 */
export function normalizeTagKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 匹配一层括号包裹：返回内层文本与（可选的）显式权重。
 * 括号不配对时返回 null，表示这一层不能安全剥离。
 */
function matchWrapper(text: string): { inner: string; weight: string | null } | null {
  if (text.length < 2) return null;
  const first = text[0];
  const last = text[text.length - 1];
  if (!OPENERS.includes(first) || !CLOSERS.includes(last)) return null;
  const inner = text.slice(1, -1);
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (OPENERS.includes(char)) depth += 1;
    else if (CLOSERS.includes(char)) {
      depth -= 1;
      if (depth < 0) return null;
    }
  }
  if (escaped || depth !== 0) return null;
  const weightMatch = /^(.*?):\s*([-+]?\d*\.?\d+)\s*$/.exec(inner);
  if (weightMatch) return { inner: weightMatch[1].trim(), weight: weightMatch[2] };
  return { inner: inner.trim(), weight: null };
}

/**
 * 去掉最外层权重包裹：`(tag:1.2)` / `[tag]` / `{tag}` / `<tag>`。
 * 嵌套权重（`((a:0.8):0.5)`）无法表达为单一权重，按不透明段原样保留，不自行改权重。
 */
function unwrapSegment(raw: string): { base: string; weight: string | null; opaque: boolean; reason?: string } {
  const text = raw.trim();
  if (!text) return { base: '', weight: null, opaque: false };
  let current = text;
  let weight: string | null = null;
  for (;;) {
    const wrapper = matchWrapper(current);
    if (!wrapper) break;
    if (wrapper.weight !== null) {
      if (weight !== null) {
        return { base: text, weight: null, opaque: true, reason: '嵌套权重表达式无法安全合并，已原样保留，未参与去重与权重合并。' };
      }
      weight = wrapper.weight;
    }
    current = wrapper.inner;
  }
  return { base: current, weight, opaque: false };
}

/**
 * 最小分段扫描：只在括号深度为 0 的逗号／分号／换行处切分，
 * 因此 `(a:1.2, b)` 不会被拆坏。括号不配对或转义在末尾时标记为不透明段。
 */
export function scanPromptSegments(text: string): { segments: PromptSegment[]; warnings: string[] } {
  const warnings: string[] = [];
  const segments: PromptSegment[] = [];
  const source = String(text ?? '');
  let buffer = '';
  let depth = 0;
  let escaped = false;
  let unclosed = false;

  const flush = () => {
    const raw = buffer.trim();
    buffer = '';
    if (!raw) return;
    if (unclosed) {
      segments.push({
        raw, base: raw, weight: null, normalized: normalizeTagKey(raw), opaque: true,
        reason: '括号或转义未配对，已原样保留，未参与去重与权重合并。',
      });
      warnings.push(`无法安全分析的片段已原样保留：${raw.slice(0, 80)}`);
      unclosed = false;
      return;
    }
    const unwrapped = unwrapSegment(raw);
    if (unwrapped.opaque) {
      segments.push({
        raw, base: raw, weight: null, normalized: normalizeTagKey(raw), opaque: true, reason: unwrapped.reason,
      });
      warnings.push(`无法安全分析的片段已原样保留：${raw.slice(0, 80)}`);
      return;
    }
    segments.push({
      raw, base: unwrapped.base, weight: unwrapped.weight,
      normalized: normalizeTagKey(unwrapped.base), opaque: false,
    });
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { buffer += char; escaped = false; continue; }
    if (char === '\\') { buffer += char; escaped = true; continue; }
    if (OPENERS.includes(char)) { depth += 1; buffer += char; continue; }
    if (CLOSERS.includes(char)) { depth -= 1; if (depth < 0) unclosed = true; buffer += char; continue; }
    if (depth === 0 && (char === ',' || char === ';' || char === '\n' || char === '\r' || char === '，' || char === '；')) {
      flush();
      continue;
    }
    buffer += char;
  }
  if (escaped) unclosed = true;
  if (depth !== 0) unclosed = true;
  flush();
  return { segments, warnings };
}

/** 按作用域去重：同一作用域内完整归一化标签 + 相同权重表达才算重复。 */
export function dedupeSegments(
  segments: PromptSegment[],
  scope: string,
  options: { seen?: Set<string> } = {},
): { kept: PromptSegment[]; removed: RemovedTag[]; warnings: string[] } {
  const removed: RemovedTag[] = [];
  const warnings: string[] = [];
  const kept: PromptSegment[] = [];
  const seen = options.seen ?? new Set<string>();
  const baseWeights = new Map<string, Set<string>>();

  for (const segment of segments) {
    if (segment.opaque || !segment.normalized) { kept.push(segment); continue; }
    const weightKey = segment.weight ?? '';
    const key = `${segment.normalized}|${weightKey}`;
    if (seen.has(key)) {
      removed.push({ scope, tag: segment.raw, reason: '相同归一化标签与权重已在本作用域出现' });
      continue;
    }
    let weights = baseWeights.get(segment.normalized);
    if (!weights) { weights = new Set<string>(); baseWeights.set(segment.normalized, weights); }
    if (weights.size > 0 && !weights.has(weightKey)) {
      warnings.push(`作用域 ${scope} 中「${segment.base}」存在多个显式权重（${[...weights, weightKey].join(' / ')}）；已保留，未擅自合并。`);
    }
    weights.add(weightKey);
    seen.add(key);
    kept.push(segment);
  }
  return { kept, removed, warnings };
}

// ── 结构化块与最终组装 ──

export interface StructuredActorBlock {
  actorId: string;
  /** 明确身份，例如 `Hu Tao (genshin impact)`；缺失时不得伪造。 */
  identity?: string[];
  appearance?: string[];
  clothing?: string[];
  action?: string[];
  expression?: string[];
}

export interface VisualPromptBlocks {
  loraTriggers?: string[];
  stylePrompt?: string;
  /** 明确可见人数标签，例如 `2girls`；人数无法确定时留空，不补 solo。 */
  personCount?: string | null;
  characters?: StructuredActorBlock[];
  camera?: string[];
  environment?: string[];
  details?: string[];
  /** 必要自然语言：模型散文输出或人工补充描述。 */
  naturalLanguage?: string;
  /** 内部导演约束原文，优先于知识补全。 */
  directorConstraints?: string[];
}

export interface CompiledVisualPrompt {
  positive: string;
  diagnostics: CompileDiagnostics;
}

const MAX_TAGS_TOTAL = 128;

function joinSegments(segments: PromptSegment[]): string {
  return segments.map((segment) => segment.raw.trim()).filter(Boolean).join(', ');
}

function segmentsFrom(values: readonly string[] | undefined): PromptSegment[] {
  if (!values?.length) return [];
  return scanPromptSegments(values.join(', ')).segments;
}

/**
 * 角色块衔接：多角色时必须让每块归属明确。未知匿名人物不伪造角色库 ID，
 * 用位置关系句说明；这属于“必要自然语言”，不是新增人物。
 */
function actorLabel(actor: StructuredActorBlock, index: number, total: number): string {
  const identity = (actor.identity ?? []).map((item) => item.trim()).filter(Boolean).join(', ');
  if (identity) return identity;
  if (total <= 1) return '';
  if (index === 0) return 'the character on the left';
  if (index === total - 1) return 'the character on the right';
  return `the character in position ${index + 1}`;
}

/**
 * V2 最终组装。输入是已经过模型优化（或跳过优化）的语义内容，
 * 输出即工作流编码器应当收到的完整正向文本。
 */
export function compileVisualPrompt(blocks: VisualPromptBlocks): CompiledVisualPrompt {
  const removedTags: RemovedTag[] = [];
  const warnings: string[] = [];
  const globalSeen = new Set<string>();

  // 1. 角色块（先编译，才能知道触发词是否已在正文中出现）
  const characters = blocks.characters ?? [];
  const characterChunks: string[] = [];
  for (const [index, actor] of characters.entries()) {
    // 每个角色块独立去重：第二个角色同样的发色不会被删掉。
    const localSeen = new Set<string>();
    const scoped: PromptSegment[] = [];
    for (const [field, values] of [
      ['identity', actor.identity], ['appearance', actor.appearance], ['clothing', actor.clothing],
      ['action', actor.action], ['expression', actor.expression],
    ] as const) {
      const result = dedupeSegments(segmentsFrom(values), `character:${actor.actorId}:${field}`, { seen: localSeen });
      removedTags.push(...result.removed);
      warnings.push(...result.warnings);
      // 身份由本人物块的 label 承载，不再重复放进同一个 body（计划 §5.3）。
      // 只跳过**本人物**的 identity；其他人物块以及公共块不受影响，
      // 因此两个人共有的衣服/动作标签仍各自保留归属。
      // 注意 dedupe 仍照常执行，这样 identity 会进入 localSeen，
      // appearance 里重复出现的同一身份标签会被正常去重。
      if (field === 'identity' && (actor.identity ?? []).some((item) => item.trim())) continue;
      scoped.push(...result.kept);
    }
    const label = actorLabel(actor, index, characters.length);
    const body = joinSegments(scoped);
    const chunk = [label, body].filter(Boolean).join(', ');
    if (chunk) characterChunks.push(chunk);
  }

  // 2. 全局作用域：画风、数量、相机、环境、细节各自去重，并互相去重。
  const styleResult = dedupeSegments(segmentsFrom(blocks.stylePrompt ? [blocks.stylePrompt] : []), 'style', { seen: globalSeen });
  removedTags.push(...styleResult.removed); warnings.push(...styleResult.warnings);
  const countResult = dedupeSegments(segmentsFrom(blocks.personCount ? [blocks.personCount] : []), 'person_count', { seen: globalSeen });
  removedTags.push(...countResult.removed); warnings.push(...countResult.warnings);
  const cameraResult = dedupeSegments(segmentsFrom(blocks.camera), 'camera', { seen: globalSeen });
  removedTags.push(...cameraResult.removed); warnings.push(...cameraResult.warnings);
  const environmentResult = dedupeSegments(segmentsFrom(blocks.environment), 'environment', { seen: globalSeen });
  removedTags.push(...environmentResult.removed); warnings.push(...environmentResult.warnings);
  const directorResult = dedupeSegments(segmentsFrom(blocks.directorConstraints), 'director', { seen: globalSeen });
  removedTags.push(...directorResult.removed); warnings.push(...directorResult.warnings);
  const detailResult = dedupeSegments(segmentsFrom(blocks.details), 'details', { seen: globalSeen });
  removedTags.push(...detailResult.removed); warnings.push(...detailResult.warnings);
  const naturalResult = dedupeSegments(scanPromptSegments(blocks.naturalLanguage ?? '').segments, 'natural_language');
  warnings.push(...naturalResult.warnings);

  // 3. LoRA 触发词：完整标签匹配，不能因为短词被 includes 命中就丢掉整条触发词。
  const bodySegments = [
    ...styleResult.kept, ...countResult.kept, ...characterChunks.map((chunk) => ({ raw: chunk } as PromptSegment)),
    ...cameraResult.kept, ...environmentResult.kept, ...directorResult.kept, ...detailResult.kept, ...naturalResult.kept,
  ];
  const bodyKeys = new Set<string>();
  for (const segment of bodySegments) {
    for (const part of scanPromptSegments(segment.raw).segments) {
      if (part.normalized) bodyKeys.add(part.normalized);
    }
  }
  const triggerSegments: PromptSegment[] = [];
  const triggerSeen = new Set<string>();
  for (const raw of blocks.loraTriggers ?? []) {
    for (const segment of scanPromptSegments(raw).segments) {
      if (!segment.normalized) continue;
      if (triggerSeen.has(segment.normalized)) {
        removedTags.push({ scope: 'lora_trigger', tag: segment.raw, reason: '同一触发词列表内重复' });
        continue;
      }
      triggerSeen.add(segment.normalized);
      if (bodyKeys.has(segment.normalized)) {
        removedTags.push({ scope: 'lora_trigger', tag: segment.raw, reason: '触发词已存在于正文，保留正文中的那一份' });
        continue;
      }
      triggerSegments.push(segment);
    }
  }

  const ordered = [
    joinSegments(triggerSegments),
    joinSegments(styleResult.kept),
    joinSegments(countResult.kept),
    ...characterChunks,
    joinSegments(cameraResult.kept),
    joinSegments(environmentResult.kept),
    joinSegments(directorResult.kept),
    joinSegments(detailResult.kept),
    joinSegments(naturalResult.kept),
  ].filter(Boolean);

  const positive = ordered.join(', ').replace(/\s+/g, ' ').trim();
  const totalTags = scanPromptSegments(positive).segments.length;
  if (totalTags > MAX_TAGS_TOTAL) {
    warnings.push(`编译结果共 ${totalTags} 个片段，超过建议上限 ${MAX_TAGS_TOTAL}；已保留但请检查来源描述长度。`);
  }
  return {
    positive,
    diagnostics: { compilerVersion: ACTIVITY_IMAGE_COMPILER_VERSION, removedTags, warnings },
  };
}

/** 是否声明了服务端组装方式。 */
export function isServiceFinalizedAssembly(editorConfig: { promptAssembly?: string } | null | undefined): boolean {
  return editorConfig?.promptAssembly === 'service-finalized-v1';
}
