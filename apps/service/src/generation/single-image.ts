import { generationError } from './errors.js';

const REQUEST_BATCH_KEYS = new Set([
  'n',
  'batch',
  'batchsize',
  'batchcount',
  'numimages',
  'numoutputs',
  'imagecount',
  'batchamount',
]);

const WORKFLOW_BATCH_KEYS = new Set([
  'batchsize',
  'batchcount',
  'numimages',
  'numoutputs',
  'imagecount',
  'batchamount',
]);

const MULTI_OUTPUT_NODE_CLASSES = new Set([
  'ImageBatch',
  'ImageBatchMulti',
  'BatchImagesNode',
  'LatentBatch',
]);

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function numericBatchExceedsOne(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 1;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value) > 1;
  return false;
}

function requestBatchExceedsOne(value: unknown): boolean {
  // Request-level arrays are lists of prompts/images; workflow arrays are
  // ComfyUI links ([nodeId, outputIndex]) and must not be mistaken for batches.
  if (Array.isArray(value)) return value.length > 1;
  return numericBatchExceedsOne(value);
}

function workflowBatchUnverifiable(value: unknown): boolean {
  // A linked value ([nodeId, outputIndex]) cannot prove the batch size is 1.
  return Array.isArray(value) || numericBatchExceedsOne(value);
}

/** Reject request-level batch switches before a task is created. */
export function assertSingleImageRequestInputs(inputs: Record<string, unknown>, options: { openAiImage?: boolean } = {}): void {
  for (const [key, value] of Object.entries(inputs)) {
    const normalized = normalizedKey(key);
    if (!REQUEST_BATCH_KEYS.has(normalized)) continue;
    // `n` is the OpenAI image count. Other engines use batch_size/batch_count;
    // an unrelated ComfyUI input named n must not be rejected by mistake.
    if (normalized === 'n' && !options.openAiImage) continue;
    // A single prompt string or a single reference image is not a batch.
    if (normalized === 'batch' && typeof value === 'string') continue;
    if (requestBatchExceedsOne(value)) {
      throw generationError(
        'generation_batch_not_allowed',
        `公共图片生成每个任务只允许一幅图，参数 ${key} 不能大于 1；连续分镜请拆成独立任务。`,
      );
    }
  }
}

/** Reject frozen workflow graphs that would emit more than one image. */
export function assertSingleImageWorkflowSnapshot(snapshot: Record<string, unknown>): void {
  for (const [nodeId, rawNode] of Object.entries(snapshot)) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) continue;
    const node = rawNode as { class_type?: unknown; inputs?: unknown };
    const classType = typeof node.class_type === 'string' ? node.class_type : '';
    if (MULTI_OUTPUT_NODE_CLASSES.has(classType)) {
      throw generationError(
        'generation_batch_not_allowed',
        `工作流节点 ${nodeId}（${classType}）会生成多幅图，公共图片任务只允许单图输出。`,
      );
    }
    if (classType === 'RepeatLatentBatch' && node.inputs && typeof node.inputs === 'object') {
      const amount = (node.inputs as Record<string, unknown>).amount;
      if (workflowBatchUnverifiable(amount)) {
        throw generationError(
          'generation_batch_not_allowed',
          `工作流节点 ${nodeId}（RepeatLatentBatch）的批量数量不是明确的 1，公共图片任务只允许单图输出。`,
        );
      }
    }
    if (!node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) continue;
    for (const [inputName, value] of Object.entries(node.inputs as Record<string, unknown>)) {
      if (!WORKFLOW_BATCH_KEYS.has(normalizedKey(inputName))) continue;
      if (workflowBatchUnverifiable(value)) {
        throw generationError(
          'generation_batch_not_allowed',
          `工作流节点 ${nodeId} 的参数 ${inputName} 不是明确的 1，公共图片任务只允许单图输出。`,
        );
      }
    }
  }
}
