import type { SecretStore } from '../security.js';
import { getNodeDefinitions, listModels, loadObjectInfo, LOADER_NODE_CATEGORIES } from './comfy-discovery.js';
import type { EngineTarget } from './comfy-discovery.js';

type WorkflowNode = { class_type?: unknown; inputs?: unknown };

export interface WorkflowRuntimePreflight {
  ok: boolean;
  issues: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function inputModelOptions(node: Record<string, unknown>, inputName: string): string[] | null {
  const input = asRecord(node.input);
  if (!input) return null;
  for (const group of ['required', 'optional']) {
    const inputs = asRecord(input[group]);
    const field = inputs?.[inputName];
    if (Array.isArray(field) && Array.isArray(field[0])) {
      return field[0].filter((value): value is string => typeof value === 'string');
    }
  }
  return null;
}

function normalizedCategory(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_');
}

function validateDefinition(snapshot: Record<string, unknown>): { issues: string[]; nodes: Array<{ id: string; classType: string; inputs: Record<string, unknown> }> } {
  const issues: string[] = [];
  const nodes: Array<{ id: string; classType: string; inputs: Record<string, unknown> }> = [];
  for (const [id, rawNode] of Object.entries(snapshot)) {
    const node = asRecord(rawNode) as WorkflowNode | null;
    const inputs = asRecord(node?.inputs);
    if (!node || typeof node.class_type !== 'string' || !node.class_type.trim() || !inputs) {
      issues.push(`工作流节点 ${id} 格式无效：必须包含 class_type 和 inputs 对象。`);
      continue;
    }
    nodes.push({ id, classType: node.class_type, inputs });
  }
  if (!Object.keys(snapshot).length) issues.push('工作流定义为空，无法提交。');
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'number') continue;
      if (!nodeIds.has(value[0])) issues.push(`节点 ${node.id} 的输入 ${inputName} 引用了不存在的节点 ${value[0]}。`);
    }
  }
  return { issues, nodes };
}

/**
 * Check the actual, already-bound API graph against the selected engine's live
 * node and model inventory. This runs before prompt optimization and task creation.
 */
export async function inspectWorkflowRuntime(
  target: EngineTarget,
  snapshot: Record<string, unknown>,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
  refresh = true,
): Promise<WorkflowRuntimePreflight> {
  const { issues, nodes } = validateDefinition(snapshot);
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };

  let secret: string | null = null;
  if (target.credentialAccount) {
    try { secret = (await secrets.get(target.credentialAccount)).value; }
    catch { return { ok: false, issues: [`生成引擎「${target.id}」的凭据不可用，无法校验工作流依赖。`] }; }
  }

  const classTypes = [...new Set(nodes.map((node) => node.classType))];
  let nodeDefinitions: Map<string, Record<string, unknown>>;
  let modelInventory: Awaited<ReturnType<typeof listModels>> | null = null;

  if (target.kind === 'comfyui') {
    const result = await loadObjectInfo(target, secret, fetcher, refresh);
    if (!result.objectInfo) {
      return { ok: false, issues: [`无法读取 ComfyUI「${target.id}」的 /object_info 节点与模型清单：${result.error ?? '上游未返回有效数据'}；已阻止提交。`] };
    }
    nodeDefinitions = new Map(Object.entries(result.objectInfo).map(([key, value]) => [key, asRecord(value) ?? {}]));
  } else if (target.kind === 'worker') {
    if (classTypes.length > 64) return { ok: false, issues: ['工作流节点类型超过 Worker 可校验上限（64），已阻止提交。'] };
    const [nodeResult, inventory] = await Promise.all([
      getNodeDefinitions(target, secret, classTypes, fetcher),
      listModels(target, secret, { refresh }, fetcher),
    ]);
    if (nodeResult.error) return { ok: false, issues: [`无法读取 Windows Worker「${target.id}」的节点清单：${nodeResult.error}；已阻止提交。`] };
    if (inventory.error) return { ok: false, issues: [`无法读取 Windows Worker「${target.id}」的模型清单：${inventory.error}；已阻止提交。`] };
    nodeDefinitions = new Map(nodeResult.items.map((item) => [item.classType, { input: item.input }]));
    modelInventory = inventory;
  } else {
    return { ok: false, issues: [`不支持校验生成引擎类型「${target.kind}」。`] };
  }

  const missingClasses = classTypes.filter((classType) => !nodeDefinitions.has(classType));
  for (const classType of missingClasses) issues.push(`所选生成实例缺少工作流节点「${classType}」；请安装提供该节点的扩展后重试。`);

  for (const node of nodes) {
    const loader = LOADER_NODE_CATEGORIES[node.classType];
    if (!loader || missingClasses.includes(node.classType)) continue;
    const selected = node.inputs[loader.inputName];
    // A link means the model input is provided by another graph node, not a filename.
    if (Array.isArray(selected) && selected.length === 2 && typeof selected[0] === 'string') continue;
    if (typeof selected !== 'string' || !selected.trim()) {
      issues.push(`节点 ${node.id}（${node.classType}）没有配置模型输入 ${loader.inputName}。`);
      continue;
    }
    const definition = nodeDefinitions.get(node.classType)!;
    const options = inputModelOptions(definition, loader.inputName);
    if (options) {
      if (!options.includes(selected)) issues.push(`模型缺失：${loader.category} / ${selected}（节点 ${node.classType}）。请将文件安装到此 ComfyUI 实例对应的 models 子目录，并刷新模型清单。`);
      continue;
    }
    if (modelInventory) {
      const matches = modelInventory.items.some((item) => normalizedCategory(item.category) === normalizedCategory(loader.category) && item.name === selected);
      if (!matches) issues.push(`模型缺失或无法验证：${loader.category} / ${selected}（节点 ${node.classType}）。请确认此 Windows Worker 已发现该模型。`);
    } else {
      issues.push(`无法验证模型：${loader.category} / ${selected}（节点 ${node.classType}）未出现在 ComfyUI 节点清单中；已阻止提交。`);
    }
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}
