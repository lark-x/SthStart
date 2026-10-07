/**
 * 历史执行快照解析：从工作流定义里读出“实际编码文本”。
 *
 * 规则（计划 §6.4 / §17.1 快照组）：
 * - 只允许安全解析字符串字面量与已有的 `StringConcatenate` 链，按真实 delimiter 组装。
 * - 循环、未知节点、缺值一律返回“无法解析”，不猜、不 eval、不访问网络。
 * - 显示值与可读性说明分开；不得用请求里的 prompt 字段冒充实际编码输入。
 */

const CONCAT_CLASS = 'StringConcatenate';
const ENCODER_CLASS = 'CLIPTextEncode';
const SAMPLER_CLASSES = new Set(['KSampler', 'KSamplerAdvanced']);

export type TextResolution =
  | { resolvable: true; text: string; nodeIds: string[] }
  | { resolvable: false; reason: string };

type NodeLike = { class_type?: unknown; inputs?: Record<string, unknown> };

function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';
}

function nodeAt(definition: Record<string, unknown>, nodeId: string): NodeLike | null {
  const raw = definition[nodeId];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as NodeLike;
}

/**
 * 解析一个“文本值”：字符串字面量直接返回；连线则只沿 `StringConcatenate` 链递归。
 * 其它节点类型不做猜测。
 */
export function resolveWorkflowTextValue(
  definition: Record<string, unknown>,
  value: unknown,
  visiting: ReadonlySet<string> = new Set(),
): TextResolution {
  if (typeof value === 'string') return { resolvable: true, text: value, nodeIds: [] };
  if (!isLink(value)) {
    return { resolvable: false, reason: '文本输入既不是字符串字面量，也不是可识别的节点连线。' };
  }
  const [nodeId] = value;
  if (visiting.has(nodeId)) return { resolvable: false, reason: `文本拼接链存在循环，经过节点 ${nodeId}。` };
  const node = nodeAt(definition, nodeId);
  if (!node) return { resolvable: false, reason: `文本拼接链引用了不存在的节点 ${nodeId}。` };
  const classType = String(node.class_type ?? '');
  if (classType !== CONCAT_CLASS) {
    return { resolvable: false, reason: `文本来源节点 ${nodeId} 的类型为 ${classType || '未知'}，只有 ${CONCAT_CLASS} 链可以安全解析。` };
  }
  const inputs = node.inputs ?? {};
  const delimiter = inputs.delimiter;
  if (typeof delimiter !== 'string') {
    return { resolvable: false, reason: `文本拼接节点 ${nodeId} 缺少字符串分隔符，无法确定真实拼接结果。` };
  }
  const nextVisiting = new Set(visiting);
  nextVisiting.add(nodeId);
  const parts: string[] = [];
  const nodeIds: string[] = [nodeId];
  // 只按 ComfyUI 的字符串拼接语义读取 string_a/string_b（以及扩展的 string_c/string_d）。
  for (const key of ['string_a', 'string_b', 'string_c', 'string_d']) {
    if (!(key in inputs)) continue;
    const resolved = resolveWorkflowTextValue(definition, inputs[key], nextVisiting);
    if (!resolved.resolvable) return resolved;
    parts.push(resolved.text);
    nodeIds.push(...resolved.nodeIds);
  }
  if (!parts.length) return { resolvable: false, reason: `文本拼接节点 ${nodeId} 没有可解析的字符串输入。` };
  return { resolvable: true, text: parts.join(delimiter), nodeIds };
}

export interface SamplerEncoderLinks {
  samplerNodeIds: string[];
  /** 采样器数量 > 1 时无法确定唯一来源，此时不猜。 */
  ambiguous: boolean;
  positiveNodeId: string | null;
  negativeNodeId: string | null;
}

/** 找到唯一的 KSampler 及其正／负文本编码器节点。多采样器一律视为无法确定。 */
export function findSamplerTextEncoders(definition: Record<string, unknown>): SamplerEncoderLinks {
  const samplerNodeIds = Object.entries(definition)
    .filter(([, raw]) => raw && typeof raw === 'object' && !Array.isArray(raw)
      && SAMPLER_CLASSES.has(String((raw as NodeLike).class_type ?? '')))
    .map(([id]) => id);
  if (samplerNodeIds.length !== 1) {
    return { samplerNodeIds, ambiguous: true, positiveNodeId: null, negativeNodeId: null };
  }
  const sampler = nodeAt(definition, samplerNodeIds[0])!;
  const linkToEncoder = (inputName: string): string | null => {
    const link = sampler.inputs?.[inputName];
    if (!isLink(link)) return null;
    const target = nodeAt(definition, link[0]);
    return target && String(target.class_type ?? '') === ENCODER_CLASS ? link[0] : null;
  };
  return {
    samplerNodeIds, ambiguous: false,
    positiveNodeId: linkToEncoder('positive'), negativeNodeId: linkToEncoder('negative'),
  };
}

export interface ActualEncodedTexts {
  samplerNodeId: string | null;
  positiveNodeId: string | null;
  negativeNodeId: string | null;
  positive: TextResolution;
  negative: TextResolution;
}

const UNKNOWN_SAMPLER: TextResolution = { resolvable: false, reason: '工作流里存在多个或缺失的采样器，无法确定实际文本来源。' };
const UNKNOWN_ENCODER: TextResolution = { resolvable: false, reason: '采样器的该输入没有连接到标准文本编码器，无法确定实际编码文本。' };

/**
 * 读取一份**已经渲染完成**的工作流快照里真正进入文本编码器的字符串。
 * 调用方必须传入实际派发的图（含参数覆盖与 LoRA 注入），而不是工作流模板。
 */
export function readActualEncodedTexts(definition: Record<string, unknown>): ActualEncodedTexts {
  const links = findSamplerTextEncoders(definition);
  const read = (nodeId: string | null): TextResolution => {
    if (links.ambiguous || !nodeId) return links.ambiguous ? UNKNOWN_SAMPLER : UNKNOWN_ENCODER;
    const node = nodeAt(definition, nodeId);
    if (!node) return { resolvable: false, reason: `文本编码器节点 ${nodeId} 不存在。` };
    if (!('text' in (node.inputs ?? {}))) return { resolvable: false, reason: `文本编码器节点 ${nodeId} 没有 text 输入。` };
    return resolveWorkflowTextValue(definition, node.inputs!.text);
  };
  return {
    samplerNodeId: links.ambiguous ? null : links.samplerNodeIds[0] ?? null,
    positiveNodeId: links.positiveNodeId,
    negativeNodeId: links.negativeNodeId,
    positive: read(links.positiveNodeId),
    negative: read(links.negativeNodeId),
  };
}

export interface EncodedTextEntry {
  nodeId: string;
  input: string;
  role: 'positive' | 'negative';
  text: string;
}

/**
 * 把**实际派发**的工作流快照里真正进入文本编码器的字符串整理成日志可展示的列表（计划 §1.1）。
 * 读不出来时返回空列表——不猜、不编造文本；原因由 `readActualEncodedTexts` 的 reason 表达。
 */
export function encodedTextEntries(definition: unknown): EncodedTextEntry[] {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return [];
  const resolved = readActualEncodedTexts(definition as Record<string, unknown>);
  const entries: EncodedTextEntry[] = [];
  if (resolved.positive.resolvable) {
    entries.push({ nodeId: resolved.positiveNodeId ?? '', input: 'text', role: 'positive', text: resolved.positive.text });
  }
  if (resolved.negative.resolvable) {
    entries.push({ nodeId: resolved.negativeNodeId ?? '', input: 'text', role: 'negative', text: resolved.negative.text });
  }
  return entries;
}

export interface DirectTextBindingCheck {
  ok: boolean;
  issues: string[];
}

/**
 * 发布校验：声明 `service-finalized-v1` 的版本必须把正／负提示词语义字段直接绑定到
 * 标准文本编码器节点的 `text` 输入，且该输入是字符串字面量（没有第二次拼接）。
 * 不满足时阻止发布，错误指向具体节点与字段。
 */
export function checkDirectTextEncoderBindings(
  definition: Record<string, unknown>,
  nodeBindings: Record<string, string[]>,
  promptKeys: { positiveKey: string | null; negativeKey: string | null },
): DirectTextBindingCheck {
  const issues: string[] = [];
  const check = (key: string | null, label: string) => {
    if (!key) {
      issues.push(`工作流没有声明${label}输入，无法使用服务端组装方式。`);
      return;
    }
    const binding = nodeBindings[key];
    if (!Array.isArray(binding) || binding.length !== 3 || binding[1] !== 'inputs') {
      issues.push(`字段「${key}」的节点绑定不是 [nodeId, "inputs", paramName] 形式。`);
      return;
    }
    const [nodeId, , paramName] = binding;
    const node = nodeAt(definition, nodeId);
    if (!node) {
      issues.push(`字段「${key}」绑定的节点 ${nodeId} 在工作流定义中不存在。`);
      return;
    }
    const classType = String(node.class_type ?? '');
    if (classType !== ENCODER_CLASS) {
      issues.push(`字段「${key}」（${label}）绑定到节点 ${nodeId}，其类型为 ${classType || '未知'}；服务端组装只支持直接绑定 ${ENCODER_CLASS}。`);
      return;
    }
    if (paramName !== 'text') {
      issues.push(`字段「${key}」（${label}）绑定到 ${ENCODER_CLASS} 节点 ${nodeId} 的 "${paramName}" 输入；必须绑定 text。`);
      return;
    }
    const raw = (node.inputs ?? {}).text;
    if (typeof raw !== 'string') {
      issues.push(`字段「${key}」（${label}）绑定的 ${ENCODER_CLASS} 节点 ${nodeId}.text 不是字符串字面量，工作流会自行拼接提示词。`);
    }
  };
  check(promptKeys.positiveKey, '正向提示词');
  check(promptKeys.negativeKey, '反向提示词');
  return { ok: issues.length === 0, issues };
}
