import { createHash } from 'node:crypto';
import type { ActivityLora, GenerationEditorConfig } from '@sthstart/contracts';

export function assertNoWorkflowSecrets(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|token|secret|password|credential)/i;
  const BASIC_AUTH_URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
  const queue = [value];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item && typeof item === 'object') queue.push(item);
      }
    } else {
      for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
        if (SECRET_KEY_PATTERN.test(k)) {
          const err = new Error(`工作流配置不得包含明文密钥或凭据字段 "${k}"，请使用系统安全凭据管理。`) as Error & { code?: string };
          err.code = 'secrets_not_permitted';
          throw err;
        }
        if (typeof v === 'string' && BASIC_AUTH_URL_PATTERN.test(v.trim())) {
          const err = new Error('工作流配置不得包含带用户凭据的 URL，请使用系统安全凭据管理。') as Error & { code?: string };
          err.code = 'secrets_not_permitted';
          throw err;
        }
        if (v && typeof v === 'object') queue.push(v);
      }
    }
  }
}

export function validateComfyApiJson(definition: unknown): Record<string, unknown> {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('invalid_workflow_format');
  const raw = definition as Record<string, unknown>;
  if (Array.isArray(raw.nodes) || 'last_node_id' in raw || Array.isArray(raw.links)) {
    const error = new Error('工作流必须为 ComfyUI API 格式 JSON（不得使用 UI 导出的含 nodes 数组的 GUI 格式）。') as Error & { code?: string };
    error.code = 'invalid_workflow_format_gui_rejected';
    throw error;
  }
  if (!Object.keys(raw).length) throw new Error('empty_workflow_definition');
  for (const node of Object.values(raw)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('invalid_node_structure');
    const value = node as Record<string, unknown>;
    if (typeof value.class_type !== 'string' || !value.class_type.trim()) throw new Error('missing_node_class_type');
    if (!value.inputs || typeof value.inputs !== 'object' || Array.isArray(value.inputs)) throw new Error('missing_node_inputs');
  }
  return raw;
}

export function validateWorkflowVersionStructure(
  definition: unknown,
  inputSchema: unknown,
  nodeBindings: unknown,
  outputDeclarations: unknown,
) {
  const validatedDefinition = validateComfyApiJson(definition);
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    const error = new Error('输入结构 inputSchema 必须为合法的 JSON 对象。') as Error & { code?: string };
    error.code = 'invalid_input_schema'; throw error;
  }
  if (!nodeBindings || typeof nodeBindings !== 'object' || Array.isArray(nodeBindings)) {
    const error = new Error('节点绑定 nodeBindings 必须为合法的 JSON 对象。') as Error & { code?: string };
    error.code = 'invalid_node_bindings'; throw error;
  }
  const validatedNodeBindings: Record<string, string[]> = {};
  for (const [key, pathSegments] of Object.entries(nodeBindings)) {
    if (!Array.isArray(pathSegments) || pathSegments.length !== 3 || pathSegments[1] !== 'inputs' || typeof pathSegments[0] !== 'string' || typeof pathSegments[2] !== 'string') {
      const error = new Error(`节点绑定 "${key}" 的目标路径必须为 [nodeId, "inputs", paramName] 格式。`) as Error & { code?: string };
      error.code = 'invalid_node_binding_path'; throw error;
    }
    const [nodeId, , paramName] = pathSegments;
    const targetNode = validatedDefinition[nodeId];
    if (!targetNode || typeof targetNode !== 'object' || Array.isArray(targetNode)) {
      const error = new Error(`节点绑定 "${key}" 引用的节点 ID "${nodeId}" 在工作流定义中不存在。`) as Error & { code?: string };
      error.code = 'binding_node_not_found'; throw error;
    }
    const inputs = (targetNode as Record<string, unknown>).inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
      const error = new Error(`节点绑定 "${key}" 引用的节点 "${nodeId}" 缺少有效的 inputs 属性。`) as Error & { code?: string };
      error.code = 'binding_node_inputs_invalid'; throw error;
    }
    validatedNodeBindings[key] = [nodeId, 'inputs', paramName];
  }
  if (!Array.isArray(outputDeclarations) || !outputDeclarations.length) {
    const error = new Error('输出声明 outputDeclarations 必须为非空数组。') as Error & { code?: string };
    error.code = 'output_declarations_required'; throw error;
  }
  const validatedOutputDeclarations: string[] = [];
  for (const outputId of outputDeclarations) {
    if (typeof outputId !== 'string' || !outputId.trim()) {
      const error = new Error('输出声明中的节点 ID 必须为有效字符串。') as Error & { code?: string };
      error.code = 'invalid_output_declaration'; throw error;
    }
    const id = outputId.trim();
    if (!validatedDefinition[id]) {
      const error = new Error(`输出声明引用的节点 ID "${id}" 在工作流定义中不存在。`) as Error & { code?: string };
      error.code = 'output_node_not_found'; throw error;
    }
    validatedOutputDeclarations.push(id);
  }
  return {
    validatedDefinition,
    validatedInputSchema: inputSchema as Record<string, unknown>,
    validatedNodeBindings,
    validatedOutputDeclarations,
  };
}

export function renderWorkflowSnapshot(
  definition: Record<string, unknown>,
  nodeBindings: Record<string, string[]>,
  inputs: Record<string, unknown>,
  actualSeed?: number | null,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(definition)) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  for (const [inputKey, pathSegments] of Object.entries(nodeBindings)) {
    if (inputs[inputKey] === undefined) continue;
    const [nodeId, category, paramName] = pathSegments;
    if (pathSegments.length === 3 && cloned[nodeId] && category === 'inputs' && cloned[nodeId].inputs) cloned[nodeId].inputs[paramName] = inputs[inputKey];
  }
  if (actualSeed !== undefined && actualSeed !== null) {
    for (const node of Object.values(cloned)) {
      if (node?.inputs && 'seed' in node.inputs) node.inputs.seed = actualSeed;
      if (node?.inputs && 'noise_seed' in node.inputs) node.inputs.noise_seed = actualSeed;
    }
  }
  return cloned;
}

/** Insert activity-level ModelOnly LoRAs only at an explicitly declared model-link anchor. */
export function injectActivityLoras(
  snapshot: Record<string, unknown>,
  editorConfig: GenerationEditorConfig | null | undefined,
  loras: ActivityLora[] = [],
): Record<string, unknown> {
  const active = new Map<string, ActivityLora>();
  for (const lora of loras) if (lora.enabled) active.set(lora.model, lora);
  if (!active.size) return snapshot;
  const injection = editorConfig?.activityLoraInjection;
  if (!injection) throw new Error('当前工作流版本未声明活动 LoRA 插入点。');
  const target = validateActivityLoraInjection(snapshot, editorConfig);
  if (!target) throw new Error('当前工作流版本未声明活动 LoRA 插入点。');
  const targetLink = target.inputs![injection.targetInput] as [string, number];

  let previous = targetLink as [string, number];
  let nextId = Object.keys(snapshot).reduce((max, id) => /^\d+$/.test(id) ? Math.max(max, Number(id)) : max, 0) + 1;
  for (const lora of active.values()) {
    const id = String(nextId++);
    snapshot[id] = { class_type: 'LoraLoaderModelOnly', inputs: {
      model: previous, lora_name: lora.model, strength_model: lora.strength,
    } };
    previous = [id, 0];
  }
  target.inputs![injection.targetInput] = previous;
  return snapshot;
}

export function validateActivityLoraInjection(
  definition: Record<string, unknown>, editorConfig: GenerationEditorConfig | null | undefined,
): { class_type?: unknown; inputs?: Record<string, unknown> } | null {
  const injection = editorConfig?.activityLoraInjection;
  if (!injection) return null;
  if (injection.targetInput !== 'model') throw new Error('动态 LoRA 插入点只支持名为 model 的模型输入。');
  if (Object.values(definition).some((raw) => {
    const node = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return node.class_type === 'LoraLoader' || node.class_type === 'LoraLoaderModelOnly';
  })) throw new Error('此工作流已包含固定 LoRA 节点；动态 LoRA 已阻止，以免重复加载。');
  const targetRaw = definition[injection.targetNodeId];
  if (!targetRaw || typeof targetRaw !== 'object') throw new Error(`LoRA 插入点节点 ${injection.targetNodeId} 不存在。`);
  const target = targetRaw as { class_type?: unknown; inputs?: Record<string, unknown> };
  const link = target.inputs?.[injection.targetInput];
  if (!Array.isArray(link) || link.length !== 2 || typeof link[0] !== 'string' || typeof link[1] !== 'number' || !definition[link[0]]) {
    throw new Error(`LoRA 插入点 ${injection.targetNodeId}.${injection.targetInput} 必须连接到工作流中的模型节点。`);
  }
  return target;
}

export function computeRequestHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
