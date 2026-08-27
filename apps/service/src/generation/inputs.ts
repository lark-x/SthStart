import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ServiceDatabase } from '../database.js';
import { mimeToExt } from '../artifacts.js';
import { uploadWorkerInput } from '../worker.js';
import { generationError, sanitizeErrorMessage } from './errors.js';

export interface GenerationInputArtifact {
  artifactId: string;
  inputKey: string;
}

export interface ParsedGenerationRequestParams {
  inputs: Record<string, unknown>;
  inputArtifacts: GenerationInputArtifact[];
}

type InputCapability = {
  mediaTypes?: string[];
  maxBytes?: number;
  required?: boolean;
  maxCount?: number;
};

const DEFAULT_MEDIA_LIMITS: Record<string, number> = {
  image: 12 * 1024 * 1024,
  video: 512 * 1024 * 1024,
  audio: 64 * 1024 * 1024,
};

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function capabilityFor(inputKey: string, capabilities: Record<string, unknown>): InputCapability {
  const raw = jsonObject(capabilities[inputKey]);
  const mediaTypes = Array.isArray(raw.mediaTypes)
    ? raw.mediaTypes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().toLowerCase())
    : undefined;
  const maxBytes = Number(raw.maxBytes);
  const maxCount = Number(raw.maxCount);
  return {
    mediaTypes,
    maxBytes: Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : undefined,
    required: raw.required === true,
    maxCount: Number.isSafeInteger(maxCount) && maxCount > 0 ? maxCount : undefined,
  };
}

function mediaKind(contentType: string) {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'file';
}

function allowedMediaType(contentType: string, mediaTypes: string[] | undefined) {
  if (!mediaTypes?.length) return true;
  return mediaTypes.some((allowed) => allowed === '*' || allowed === contentType || (allowed.endsWith('/*') && contentType.startsWith(allowed.slice(0, -1))));
}

function validateCapability(input: GenerationInputArtifact, row: { content_type: string | null; byte_size: number }, capabilities: Record<string, unknown>) {
  const contentType = row.content_type?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  const capability = capabilityFor(input.inputKey, capabilities);
  const kind = mediaKind(contentType);
  const limit = capability.maxBytes ?? DEFAULT_MEDIA_LIMITS[kind] ?? 512 * 1024 * 1024;
  if (!allowedMediaType(contentType, capability.mediaTypes)) throw generationError('input_artifact_invalid_type', `输入媒体 ${input.inputKey} 的 MIME 类型不在工作流允许范围内。`);
  if (!Number.isFinite(Number(row.byte_size)) || Number(row.byte_size) > limit) throw generationError('input_artifact_too_large', `输入媒体 ${input.inputKey} 超过工作流限制。`);
}

export function normalizeInputArtifacts(raw: unknown): GenerationInputArtifact[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw generationError('invalid_input_artifacts', '输入媒体引用必须为数组。');
  if (raw.length > 4) throw generationError('too_many_input_artifacts', '单个生成任务最多引用 4 个输入媒体。');
  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw generationError('invalid_input_artifact', '输入媒体引用格式无效。');
    const value = item as Record<string, unknown>;
    const artifactId = typeof value.artifactId === 'string' ? value.artifactId.trim() : '';
    const inputKey = typeof value.inputKey === 'string' ? value.inputKey.trim() : '';
    if (!artifactId || !inputKey || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(inputKey)) {
      throw generationError('invalid_input_artifact', '输入媒体引用必须包含合法的 artifactId 和 inputKey。');
    }
    if (seen.has(inputKey)) throw generationError('duplicate_input_artifact_key', `输入媒体绑定键 ${inputKey} 重复。`);
    seen.add(inputKey);
    return { artifactId, inputKey };
  });
}

export function parseGenerationRequestParams(raw: unknown): ParsedGenerationRequestParams {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { inputs: {}, inputArtifacts: [] };
  const value = parsed as Record<string, unknown>;
  if (value.inputs && typeof value.inputs === 'object' && !Array.isArray(value.inputs)) {
    return { inputs: value.inputs as Record<string, unknown>, inputArtifacts: normalizeInputArtifacts(value.inputArtifacts) };
  }
  return { inputs: value, inputArtifacts: [] };
}

export function validateInputArtifacts(
  database: ServiceDatabase,
  appId: string,
  inputArtifacts: GenerationInputArtifact[],
  inputCapabilities: Record<string, unknown> = {},
) {
  const byKey = new Map(inputArtifacts.map((input) => [input.inputKey, input]));
  for (const key of Object.keys(inputCapabilities)) {
    const capability = capabilityFor(key, inputCapabilities);
    if (capability.required && !byKey.has(key)) throw generationError('input_artifact_required', `工作流要求提供输入媒体 ${key}。`);
    if (capability.maxCount && inputArtifacts.filter((input) => input.inputKey === key).length > capability.maxCount) throw generationError('too_many_input_artifacts', `输入媒体 ${key} 超过数量限制。`);
  }
  for (const input of inputArtifacts) {
    const row = database.connection.prepare(
      'SELECT id, app_id, local_path, content_type, byte_size, file_status FROM artifacts WHERE id = ?',
    ).get(input.artifactId) as { id: string; app_id: string; local_path: string | null; content_type: string | null; byte_size: number; file_status: string } | undefined;
    if (!row) throw generationError('input_artifact_not_found', `输入媒体 ${input.artifactId} 不存在。`);
    if (row.app_id !== appId) throw generationError('input_artifact_access_denied', '输入媒体不属于当前应用。');
    if (row.file_status !== 'ready' || !row.local_path) throw generationError('input_artifact_unavailable', '输入媒体当前不可用。');
    validateCapability(input, row, inputCapabilities);
  }
}

function applyWorkflowInput(workflow: Record<string, unknown>, bindings: Record<string, string[]>, inputKey: string, value: string) {
  const path = bindings[inputKey];
  if (!path || path.length !== 3 || path[1] !== 'inputs') throw generationError('input_binding_not_found', `工作流没有为输入 ${inputKey} 配置节点绑定。`);
  const [nodeId, , parameter] = path;
  const node = workflow[nodeId];
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw generationError('input_binding_not_found', `输入 ${inputKey} 的目标节点不存在。`);
  const inputs = (node as Record<string, unknown>).inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw generationError('input_binding_not_found', `输入 ${inputKey} 的目标节点缺少 inputs。`);
  (inputs as Record<string, unknown>)[parameter] = value;
}

export async function prepareInputArtifacts(
  database: ServiceDatabase,
  taskRow: Record<string, unknown>,
  workflowSnapshot: Record<string, unknown>,
  secret: string | null,
  engineKind: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const parsedRequest = parseGenerationRequestParams(taskRow.request_params_json);
  if (!parsedRequest.inputArtifacts.length) return workflowSnapshot;
  const version = database.connection.prepare(
    `SELECT v.node_bindings_json, v.input_capabilities_json,
      m.input_capabilities_json AS legacy_input_capabilities_json
     FROM generation_workflow_versions v
     LEFT JOIN generation_workflow_media_versions m ON m.workflow_id=v.workflow_id AND m.version=v.version
     WHERE v.workflow_id = ? AND v.version = ?`,
  ).get(String(taskRow.workflow_id), Number(taskRow.workflow_version)) as { node_bindings_json: string; input_capabilities_json?: string; legacy_input_capabilities_json?: string } | undefined;
  if (!version) throw generationError('workflow_version_not_found', '生成工作流版本不存在。');
  let nodeBindings: Record<string, string[]>;
  try { nodeBindings = JSON.parse(version.node_bindings_json) as Record<string, string[]>; }
  catch { throw generationError('invalid_node_bindings', '生成工作流节点绑定不可用。'); }

  const prepared = JSON.parse(JSON.stringify(workflowSnapshot)) as Record<string, unknown>;
  const directCapabilities = jsonObject(version.input_capabilities_json);
  const inputCapabilities = Object.keys(directCapabilities).length ? directCapabilities : jsonObject(version.legacy_input_capabilities_json);
  const engineRow = database.connection.prepare('SELECT base_url FROM generation_engines WHERE id = ?').get(String(taskRow.engine_id)) as { base_url: string } | undefined;
  if (!engineRow) throw generationError('generation_engine_unavailable', '生成引擎不可用。');
  const engineBaseUrl = String(engineRow.base_url).replace(/\/+$/, '');

  for (const input of parsedRequest.inputArtifacts) {
    const artifact = database.connection.prepare(
      'SELECT id, local_path, content_type, byte_size, original_name, sha256, file_status FROM artifacts WHERE id = ? AND app_id = ?',
    ).get(input.artifactId, String(taskRow.app_id)) as { id: string; local_path: string | null; content_type: string | null; byte_size: number; original_name: string | null; sha256: string | null; file_status: string } | undefined;
    if (!artifact || artifact.file_status !== 'ready' || !artifact.local_path) throw generationError('input_artifact_unavailable', '输入媒体当前不可用。');
    const fileStats = await stat(artifact.local_path).catch(() => null);
    if (!fileStats?.isFile()) throw generationError('input_artifact_missing_file', '输入媒体文件已不存在。');
    const contentType = artifact.content_type?.split(';')[0].trim().toLowerCase() || 'image/png';
    validateCapability(input, { content_type: contentType, byte_size: fileStats.size }, inputCapabilities);
    const originalExtension = artifact.original_name ? extname(artifact.original_name).toLowerCase() : '';
    const extension = /^\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mp3|wav|ogg|flac|m4a)$/.test(originalExtension) ? originalExtension : mimeToExt(contentType);
    const controlledFilename = `${artifact.id}${extension}`;
    const blob = await openAsBlob(artifact.local_path, { type: contentType });

    if (engineKind === 'worker') {
      if (!secret) throw generationError('worker_token_missing', 'Windows Worker 凭据未配置。');
      let uploadResponse: { fileName?: string };
      try {
        uploadResponse = await uploadWorkerInput({
          baseUrl: engineBaseUrl, token: secret, taskId: String(taskRow.id), uploadId: artifact.id,
          body: blob, filename: controlledFilename, contentType, contentLength: fileStats.size,
          sha256: artifact.sha256 || '', fetcher,
        });
      } catch (error) {
        const detail = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 240);
        throw generationError('worker_input_upload_failed', `输入媒体上传到 Windows Worker 失败：${detail}`);
      }
      const uploadedName = typeof uploadResponse.fileName === 'string' ? uploadResponse.fileName : '';
      if (!uploadedName || uploadedName.includes('/') || uploadedName.includes('\\')) throw generationError('worker_input_upload_failed', 'Windows Worker 未返回可用的受控文件名。');
      applyWorkflowInput(prepared, nodeBindings, input.inputKey, uploadedName);
      continue;
    }

    if (!contentType.startsWith('image/')) throw generationError('input_artifact_engine_unsupported', '当前 ComfyUI 直连引擎只支持图片输入；视频或音频请使用 Windows Worker 工作流。');
    const form = new FormData();
    form.set('image', new File([blob], controlledFilename, { type: contentType }));
    form.set('overwrite', 'false'); form.set('type', 'input');
    let response: Response;
    try {
      response = await fetcher(`${engineBaseUrl}/upload/image`, {
        method: 'POST', headers: secret ? { authorization: `Bearer ${secret}` } : {}, body: form,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const detail = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 240);
      throw generationError('input_upload_failed', `输入图片上传到生成引擎失败：${detail}`);
    }
    const payload = await response.json().catch(() => null) as { name?: unknown; filename?: unknown } | null;
    if (!response.ok) {
      const detail = payload && typeof payload === 'object' ? String(payload.name ?? payload.filename ?? `HTTP ${response.status}`) : `HTTP ${response.status}`;
      throw generationError('input_upload_failed', `输入图片上传到生成引擎失败：${sanitizeErrorMessage(detail).slice(0, 240)}`);
    }
    const uploadedName = typeof payload?.name === 'string' ? payload.name : typeof payload?.filename === 'string' ? payload.filename : '';
    if (!uploadedName || uploadedName.includes('/') || uploadedName.includes('\\')) throw generationError('input_upload_failed', '生成引擎未返回可用的受控文件名。');
    applyWorkflowInput(prepared, nodeBindings, input.inputKey, uploadedName);
  }
  return prepared;
}
