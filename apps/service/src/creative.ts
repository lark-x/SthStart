import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import {
  createArtifactReadStream,
  readArtifact,
  removeArtifact,
  streamUploadArtifact,
} from './artifacts.js';
import {
  cancelGenerationTask,
  createGenerationTask,
  getGenerationTask,
  normalizeInputArtifacts,
  parseGenerationRequestParams,
  retryGenerationTask,
  sanitizeErrorMessage,
} from './generation.js';
import { hashToken, issueToken, type SecretStore } from './security.js';
import { getH3Status, type H3ExperimentStatus, type H3StatusOptions } from './h3.js';

export const CREATIVE_APP_ID = 'creative-center';
export const CREATIVE_TEXT_PURPOSE = 'text-to-image';
export const CREATIVE_IMAGE_PURPOSE = 'image-to-image';
const CREATIVE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const CREATIVE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

type CreativeMode = 'text-to-image' | 'image-to-image' | 'h3-t2v' | 'h3-i2v' | 'h3-fl2va';
type H3Purpose = 'h3-t2v' | 'h3-i2v' | 'h3-fl2va';

interface CreativeTaskBody {
  mode?: unknown;
  prompt?: unknown;
  negativePrompt?: unknown;
  width?: unknown;
  height?: unknown;
  steps?: unknown;
  seed?: unknown;
  sourceArtifactId?: unknown;
  idempotencyKey?: unknown;
  duration?: unknown;
  aspectRatio?: unknown;
  firstFrameId?: unknown;
  lastFrameId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorWithCode(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function normalizeMode(value: unknown): CreativeMode | null {
  if (value === 'text-to-image' || value === 'text2image' || value === 'txt2img') return 'text-to-image';
  if (value === 'h3-t2v' || value === 'h3-i2v' || value === 'h3-fl2va') return value;
  if (value === 'image-to-image' || value === 'image2image' || value === 'img2img') return 'image-to-image';
  return null;
}

function modePurpose(mode: CreativeMode) {
  return mode === 'image-to-image' ? CREATIVE_IMAGE_PURPOSE : mode === 'h3-t2v' ? 'h3-t2v' : mode === 'h3-i2v' ? 'h3-i2v' : mode === 'h3-fl2va' ? 'h3-fl2va' : CREATIVE_TEXT_PURPOSE;
}

function parseInteger(value: unknown, fallback: number, min: number, max: number, code: string, label: string) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw errorWithCode(code, `${label}必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return value;
}

function parsePrompt(value: unknown, label: string, required = false) {
  if (value === undefined || value === null) {
    if (required) throw errorWithCode('prompt_required', `${label}不能为空。`);
    return '';
  }
  if (typeof value !== 'string') throw errorWithCode('invalid_prompt', `${label}格式无效。`);
  const prompt = value.trim();
  if (required && !prompt) throw errorWithCode('prompt_required', `${label}不能为空。`);
  if (prompt.length > 10_000) throw errorWithCode('prompt_too_long', `${label}不能超过 10000 个字符。`);
  return prompt;
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function safeParamsSummary(value: unknown) {
  const summary = safeJsonObject(value);
  return Object.fromEntries(Object.entries(summary).filter(([, item]) => (
    item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  )));
}

function parseParamsSummary(value: unknown) {
  if (!value) return {};
  try {
    return safeParamsSummary(JSON.parse(String(value)));
  } catch {
    return {};
  }
}

function safeInputCapabilities(value: unknown) {
  let parsed: unknown = value;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    parsed = {};
  }
  if (!isRecord(parsed)) return {};
  const result: Record<string, {
    mediaTypes?: string[];
    maxBytes?: number;
    required?: boolean;
    maxCount?: number;
  }> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (!isRecord(raw)) continue;
    const capability: typeof result[string] = {};
    if (Array.isArray(raw.mediaTypes)) {
      const mediaTypes = raw.mediaTypes
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().toLowerCase())
        .slice(0, 32);
      if (mediaTypes.length) capability.mediaTypes = mediaTypes;
    }
    const maxBytes = Number(raw.maxBytes);
    if (Number.isSafeInteger(maxBytes) && maxBytes > 0) capability.maxBytes = maxBytes;
    if (typeof raw.required === 'boolean') capability.required = raw.required;
    const maxCount = Number(raw.maxCount);
    if (Number.isSafeInteger(maxCount) && maxCount > 0) capability.maxCount = maxCount;
    if (Object.keys(capability).length) result[key.slice(0, 80)] = capability;
  }
  return result;
}

function creativeArtifactUrl(id: string) {
  return `/api/v1/admin/creative/artifacts/${encodeURIComponent(id)}`;
}

function toSafeArtifact(row: Record<string, unknown>): ArtifactDescriptor {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    taskId: row.task_id ? String(row.task_id) : null,
    providerUrl: null,
    contentType: row.content_type ? String(row.content_type) : null,
    byteSize: Number(row.byte_size || 0),
    sha256: row.sha256 ? String(row.sha256) : null,
    fileStatus: (row.file_status || 'ready') as ArtifactDescriptor['fileStatus'],
    originalName: row.original_name ? String(row.original_name) : null,
    mediaType: row.media_type ? String(row.media_type) : null,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    fps: row.fps == null ? null : Number(row.fps),
    codec: row.codec ? String(row.codec) : null,
    hasAudio: row.has_audio == null ? null : Boolean(row.has_audio),
    thumbnailArtifactId: row.thumbnail_artifact_id ? String(row.thumbnail_artifact_id) : null,
    metadata: (() => {
      try {
        const parsed: unknown = JSON.parse(String(row.metadata_json ?? '{}'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    })(),
    paramsSummary: parseParamsSummary(row.params_summary_json),
    pinned: Boolean(row.pinned),
    url: creativeArtifactUrl(String(row.id)),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function safeTask(database: ServiceDatabase, taskId: string) {
  const descriptor = getGenerationTask(database, taskId, CREATIVE_APP_ID);
  if (!descriptor) return null;
  const row = database.connection.prepare('SELECT request_params_json FROM generation_tasks WHERE id=? AND app_id=?').get(taskId, CREATIVE_APP_ID) as { request_params_json: string } | undefined;
  const request = parseGenerationRequestParams(row?.request_params_json ?? '{}');
  const mode: CreativeMode = descriptor.purpose === CREATIVE_IMAGE_PURPOSE ? 'image-to-image' : descriptor.purpose === 'h3-t2v' ? 'h3-t2v' : descriptor.purpose === 'h3-i2v' ? 'h3-i2v' : descriptor.purpose === 'h3-fl2va' ? 'h3-fl2va' : 'text-to-image';
  return {
    ...descriptor,
    artifacts: descriptor.artifacts.map((artifact) => ({ ...artifact, url: creativeArtifactUrl(artifact.artifactId) })),
    replay: {
      mode,
      inputs: Object.fromEntries(Object.entries(request.inputs).filter(([key, value]) => (
        ['prompt', 'negativePrompt', 'width', 'height', 'steps', 'duration', 'aspectRatio'].includes(key) &&
        (typeof value === 'string' || typeof value === 'number')
      ))),
      inputArtifactIds: request.inputArtifacts.map((item) => item.artifactId),
    },
  };
}

function safeStatusBinding(database: ServiceDatabase, purpose: string) {
  const assignment = database.connection.prepare(`
    SELECT a.workflow_id, a.workflow_version, a.engine_id,
      w.name AS workflow_name, w.engine_kind,
      v.is_published, v.input_capabilities_json, m.input_capabilities_json AS legacy_input_capabilities_json,
      e.name AS engine_name, e.kind AS engine_kind_actual, e.enabled AS engine_enabled
    FROM app_generation_assignments a
    LEFT JOIN generation_workflows w ON w.id=a.workflow_id
    LEFT JOIN generation_workflow_versions v ON v.workflow_id=a.workflow_id AND v.version=a.workflow_version
    LEFT JOIN generation_workflow_media_versions m ON m.workflow_id=a.workflow_id AND m.version=a.workflow_version
    LEFT JOIN generation_engines e ON e.id=a.engine_id
    WHERE a.app_id=? AND a.purpose=?
  `).get(CREATIVE_APP_ID, purpose) as Record<string, unknown> | undefined;

  if (!assignment) {
    return { purpose, ready: false, status: 'not_configured', workflow: null, engine: null };
  }

  const workflowReady = Boolean(assignment.workflow_name && assignment.is_published);
  const expectedEngineKind = purpose.startsWith('h3-') ? 'worker' : 'comfyui';
  const engineReady = Boolean(assignment.engine_name && assignment.engine_enabled && assignment.engine_kind_actual === expectedEngineKind);
  const status = !workflowReady ? 'workflow_unavailable' : !assignment.engine_name || !assignment.engine_enabled ? 'engine_unavailable' : !engineReady ? 'unsupported_engine' : 'ready';
  const directInputCapabilities = safeInputCapabilities(assignment.input_capabilities_json);
  const legacyInputCapabilities = safeInputCapabilities(assignment.legacy_input_capabilities_json);
  const inputCapabilities = Object.keys(directInputCapabilities).length ? directInputCapabilities : legacyInputCapabilities;
  return {
    purpose,
    ready: workflowReady && engineReady,
    status,
    workflow: workflowReady ? {
      id: String(assignment.workflow_id),
      name: String(assignment.workflow_name),
      version: Number(assignment.workflow_version),
    } : null,
    engine: assignment.engine_name ? {
      id: String(assignment.engine_id),
      name: String(assignment.engine_name),
      kind: String(assignment.engine_kind_actual ?? ''),
      enabled: Boolean(assignment.engine_enabled),
    } : null,
    ...(Object.keys(inputCapabilities).length ? { inputCapabilities } : {}),
  };
}

function inputStream(request: FastifyRequest): NodeJS.ReadableStream {
  if (Buffer.isBuffer(request.body)) return Readable.from(request.body as unknown as Uint8Array);
  if (request.body && typeof (request.body as NodeJS.ReadableStream).pipe === 'function') return request.body as NodeJS.ReadableStream;
  return request.raw;
}

function uploadOriginalName(request: FastifyRequest) {
  const raw = request.headers['x-artifact-original-name'] ?? request.headers['x-original-filename'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    if (!decoded || decoded.length > 255 || decoded.includes('\0')) throw new Error('invalid_filename');
    return decoded;
  } catch {
    throw errorWithCode('invalid_filename', '文件名编码格式不正确。');
  }
}

function requestIdempotencyKey(request: FastifyRequest, body: CreativeTaskBody) {
  const header = request.headers['idempotency-key'];
  const supplied = typeof header === 'string' ? header.trim() : typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (supplied && supplied.length >= 8 && supplied.length <= 200) return supplied;
  return `creative-${randomUUID()}`;
}

function errorStatus(code: string) {
  if (['input_artifact_not_found', 'workflow_not_found', 'workflow_version_not_found'].includes(code)) return 404;
  if (['generation_engine_unavailable', 'input_artifact_unavailable', 'input_artifact_missing_file'].includes(code)) return 503;
  if (['input_artifact_too_large'].includes(code)) return 413;
  if (['generation_assignment_not_found', 'unsupported_engine', 'not_retryable', 'not_cancellable', 'artifact_is_pinned', 'artifact_is_referenced'].includes(code)) return 409;
  if (['input_upload_failed'].includes(code)) return 502;
  return 400;
}

function sendCreativeError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: string })?.code || (error instanceof Error ? error.message : 'creative_request_failed');
  const safeCode = /^[a-z][a-z0-9_]{2,80}$/.test(code) ? code : 'creative_request_failed';
  const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300);
  return reply.code(errorStatus(safeCode)).send({ error: safeCode, message });
}

export function ensureCreativeApp(database: ServiceDatabase) {
  const token = issueToken('sth_internal');
  const now = nowIso();
  database.connection.prepare(`
    INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,1,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, token_hash=excluded.token_hash,
      capabilities_json=excluded.capabilities_json, enabled=1, updated_at=excluded.updated_at
  `).run(CREATIVE_APP_ID, '创作中心', hashToken(token), JSON.stringify(['artifact', 'generation']), now, now);
  database.connection.prepare("INSERT OR IGNORE INTO storage_policies(app_id,mode) VALUES (?,'keep')").run(CREATIVE_APP_ID);
}


async function resolveH3Status(database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch, purpose: H3Purpose): Promise<H3ExperimentStatus | null> {
  const assignment = database.connection.prepare(`
    SELECT e.base_url, e.credential_account, e.enabled AS engine_enabled,
      w.category AS workflow_category, v.is_published, v.input_schema_json, v.node_bindings_json,
      v.output_declarations_json, v.definition_json, v.input_capabilities_json,
      v.output_media_types_json, v.output_schema_json,
      m.category AS legacy_category, m.input_capabilities_json AS legacy_input_capabilities_json,
      m.output_media_types_json AS legacy_output_media_types_json, m.output_schema_json AS legacy_output_schema_json
    FROM app_generation_assignments a
    JOIN generation_engines e ON e.id = a.engine_id
    JOIN generation_workflows w ON w.id = a.workflow_id
    LEFT JOIN generation_workflow_versions v ON v.workflow_id = a.workflow_id AND v.version = a.workflow_version
    LEFT JOIN generation_workflow_media_versions m ON m.workflow_id = a.workflow_id AND m.version = a.workflow_version
    WHERE a.app_id = ? AND a.purpose = ? AND e.kind = 'worker'
  `).get(CREATIVE_APP_ID, purpose) as { base_url: string; credential_account: string | null } | undefined;

  let workerToken: string | null = null;
  let workerUrl: string | undefined = undefined;

  if (assignment) {
    workerUrl = assignment.base_url;
    if (assignment.credential_account) {
      try {
        workerToken = (await secrets.get(assignment.credential_account)).value;
      } catch {
        // ignore
      }
    }
  }

  if (!assignment) return null;

  const record = assignment as Record<string, unknown>;
  const parseObject = (value: unknown): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(String(value ?? '{}')) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const parseArray = (value: unknown): unknown[] => {
    try {
      const parsed = JSON.parse(String(value ?? '[]')) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const inputSchema = parseObject(record.input_schema_json);
  const nodeBindings = parseObject(record.node_bindings_json);
  const outputDeclarations = parseArray(record.output_declarations_json);
  const definition = parseObject(record.definition_json);
  const requiredInputs = purpose === 'h3-t2v'
    ? ['prompt', 'duration', 'aspectRatio']
    : purpose === 'h3-i2v'
      ? ['prompt', 'duration', 'aspectRatio', 'firstFrame']
      : ['prompt', 'duration', 'aspectRatio', 'firstFrame', 'lastFrame'];
  const bindingValid = Boolean(record.engine_enabled) && record.is_published === 1
    && requiredInputs.every((key) => Array.isArray(nodeBindings[key]) && nodeBindings[key].length === 3)
    && Object.values(nodeBindings).every((path) => {
      if (!Array.isArray(path) || path.length !== 3 || path[1] !== 'inputs') return false;
      const node = definition[String(path[0])];
      return isRecord(node) && isRecord(node.inputs) && typeof path[2] === 'string';
    });
  const directOutputMediaTypes = parseArray(record.output_media_types_json).filter((value): value is string => typeof value === 'string');
  const legacyOutputMediaTypes = parseArray(record.legacy_output_media_types_json).filter((value): value is string => typeof value === 'string');
  const outputMediaTypes = directOutputMediaTypes.length && !(directOutputMediaTypes.length === 1 && directOutputMediaTypes[0] === 'image/png' && legacyOutputMediaTypes.length)
    ? directOutputMediaTypes
    : legacyOutputMediaTypes;
  const outputSchema = Object.keys(parseObject(record.output_schema_json)).length
    ? parseObject(record.output_schema_json)
    : parseObject(record.legacy_output_schema_json);
  const declaredVideoOutput = outputMediaTypes.length === 0 || outputMediaTypes.some((value) => value.startsWith('video/'));
  const outputValid = outputDeclarations.length > 0 && outputDeclarations.every((value) => typeof value === 'string' && isRecord(definition[value])) && declaredVideoOutput;

  const numberFrom = (...values: unknown[]) => {
    for (const value of values) {
      const number = Number(value);
      if (Number.isSafeInteger(number) && number > 0) return number;
    }
    return undefined;
  };
  const constraintObject = isRecord(outputSchema.constraints) ? outputSchema.constraints : outputSchema;
  const durationSpec = isRecord(inputSchema.duration) ? inputSchema.duration : {};
  const constraints: H3StatusOptions['constraints'] = {
    maxWidth: numberFrom(constraintObject.maxWidth, constraintObject.width, inputSchema.maxWidth),
    maxHeight: numberFrom(constraintObject.maxHeight, constraintObject.height, inputSchema.maxHeight),
    maxDurationSeconds: numberFrom(constraintObject.maxDurationSeconds, constraintObject.maxDuration, durationSpec.maximum, durationSpec.max, inputSchema.maxDurationSeconds),
    concurrencyLimit: numberFrom(constraintObject.concurrencyLimit, inputSchema.concurrencyLimit),
  };
  const workflowOptions: H3StatusOptions = {
    constraints,
    workflow: {
      published: record.is_published === 1,
      category: typeof record.workflow_category === 'string' && record.workflow_category !== 'image'
        ? record.workflow_category
        : typeof record.legacy_category === 'string' ? record.legacy_category : 'video',
      bindingValid,
      outputValid,
    },
  };
  const envOverrides = { ...process.env, STHSTART_H3_WORKER_URL: workerUrl };
  return getH3Status(fetcher, envOverrides, workerToken, purpose, workflowOptions);
}

export function registerCreativeRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
) {
  app.get('/api/v1/admin/creative/status', async () => {
    const t2vBinding = safeStatusBinding(database, 'h3-t2v');
    const i2vBinding = safeStatusBinding(database, 'h3-i2v');
    const fl2vaBinding = safeStatusBinding(database, 'h3-fl2va');

    const h3T2vStatus = await resolveH3Status(database, secrets, fetcher, 'h3-t2v');
    const h3I2vStatus = await resolveH3Status(database, secrets, fetcher, 'h3-i2v');
    const h3Fl2vaStatus = await resolveH3Status(database, secrets, fetcher, 'h3-fl2va');

    if (h3T2vStatus && !h3T2vStatus.ready) {
      t2vBinding.ready = false;
      t2vBinding.status = h3T2vStatus.reason;
    }
    if (h3I2vStatus && !h3I2vStatus.ready) {
      i2vBinding.ready = false;
      i2vBinding.status = h3I2vStatus.reason;
    }
    if (h3Fl2vaStatus && !h3Fl2vaStatus.ready) {
      fl2vaBinding.ready = false;
      fl2vaBinding.status = h3Fl2vaStatus.reason;
    }

    const withH3Constraints = (binding: ReturnType<typeof safeStatusBinding>, status: H3ExperimentStatus | null) => (
      status ? { ...binding, constraints: status.constraints } : binding
    );

    return {
      app: { id: CREATIVE_APP_ID, name: '创作中心' },
      modes: {
        textToImage: safeStatusBinding(database, CREATIVE_TEXT_PURPOSE),
        imageToImage: safeStatusBinding(database, CREATIVE_IMAGE_PURPOSE),
        h3T2v: withH3Constraints(t2vBinding, h3T2vStatus),
        h3I2v: withH3Constraints(i2vBinding, h3I2vStatus),
        h3Fl2va: withH3Constraints(fl2vaBinding, h3Fl2vaStatus),
      },
    };
  });

  app.post('/api/v1/admin/creative/uploads', { bodyLimit: CREATIVE_UPLOAD_MAX_BYTES }, async (request, reply) => {
    try {
      const contentType = String(request.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
      if (!CREATIVE_IMAGE_TYPES.has(contentType)) throw errorWithCode('input_artifact_invalid_type', '只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。');
      const rawLength = request.headers['content-length'];
      const parsedLength = rawLength ? Number.parseInt(rawLength, 10) : null;
      const contentLength = parsedLength !== null && Number.isFinite(parsedLength) ? parsedLength : null;
      if (contentLength !== null && (contentLength < 1 || contentLength > CREATIVE_UPLOAD_MAX_BYTES)) throw errorWithCode('input_artifact_too_large', '输入图片不能超过 12 MiB。');
      const artifact = await streamUploadArtifact(config, database, {
        appId: CREATIVE_APP_ID,
        stream: inputStream(request),
        contentType,
        contentLength,
        originalName: uploadOriginalName(request),
        metadata: { source: 'creative-center-upload' },
      });
      return reply.code(201).send({ ...artifact, providerUrl: null, url: creativeArtifactUrl(artifact.id) });
    } catch (error) {
      return sendCreativeError(reply, error);
    }
  });

  app.post<{ Body: CreativeTaskBody }>('/api/v1/admin/creative/tasks', async (request, reply) => {
    try {
      const body = request.body ?? {};
      const mode = normalizeMode(body.mode);
      if (!mode) throw errorWithCode('invalid_mode', '请选择有效的生成模式。');
      const isVideo = mode.startsWith('h3-');
      const prompt = parsePrompt(body.prompt, '提示词', true);
      const negativePrompt = parsePrompt(body.negativePrompt, '反向提示词');
      const seed = body.seed === undefined || body.seed === null || body.seed === ''
        ? null
        : parseInteger(body.seed, 0, 0, 2_147_483_647, 'invalid_seed', '种子');
      const sourceArtifactId = typeof body.sourceArtifactId === 'string' ? body.sourceArtifactId.trim() : '';
      const firstFrameId = typeof body.firstFrameId === 'string' ? body.firstFrameId.trim() : '';
      const lastFrameId = typeof body.lastFrameId === 'string' ? body.lastFrameId.trim() : '';
      const aspectRatio = typeof body.aspectRatio === 'string' ? body.aspectRatio.trim() : '16:9';
      // 宽高/步数只属于图片模式，时长只属于视频模式：解析彼此无关的字段
      // 会让另一模式因携带冗余参数而被误拒。
      const width = isVideo ? 0 : parseInteger(body.width, 1024, 64, 4096, 'invalid_dimensions', '宽度');
      const height = isVideo ? 0 : parseInteger(body.height, 1024, 64, 4096, 'invalid_dimensions', '高度');
      const steps = isVideo ? 0 : parseInteger(body.steps, 20, 1, 150, 'invalid_steps', '步数');
      if (!isVideo && width * height > 16_777_216) throw errorWithCode('invalid_dimensions', '图片像素总数不能超过 16 megapixels。');
      const duration = isVideo ? parseInteger(body.duration, 4, 1, 10, 'invalid_duration', '时长') : 0;

      if (mode === 'image-to-image' && !sourceArtifactId) throw errorWithCode('source_artifact_required', '图生图需要先上传一张参考图片。');
      if (mode === 'text-to-image' && sourceArtifactId) throw errorWithCode('source_artifact_not_allowed', '文本生图不应附带参考图片。');
      if (mode === 'h3-i2v' && !sourceArtifactId && !firstFrameId) throw errorWithCode('source_artifact_required', '图生视频需要先上传首帧参考图片。');
      if (mode === 'h3-fl2va' && (!firstFrameId || !lastFrameId)) throw errorWithCode('source_artifact_required', '首尾帧视频需要同时提供首帧和尾帧图片。');

      const inputArtifacts = [];
      if (sourceArtifactId && mode === 'image-to-image') inputArtifacts.push({ artifactId: sourceArtifactId, inputKey: 'sourceImage' });
      else if (mode === 'h3-i2v') {
        const id = firstFrameId || sourceArtifactId;
        if (id) inputArtifacts.push({ artifactId: id, inputKey: 'firstFrame' });
      }
      else if (mode === 'h3-fl2va') {
        const id = firstFrameId || sourceArtifactId;
        if (id) inputArtifacts.push({ artifactId: id, inputKey: 'firstFrame' });
        if (lastFrameId) inputArtifacts.push({ artifactId: lastFrameId, inputKey: 'lastFrame' });
      }

      if (isVideo) {
        const h3Status = await resolveH3Status(database, secrets, fetcher, mode as H3Purpose);
        if (!h3Status || !h3Status.ready) throw errorWithCode('h3_not_ready', 'H3 视频生成当前不可用：' + (h3Status?.reason ?? 'workflow_missing'));
        if (aspectRatio && !['16:9', '9:16', '1:1', '4:3'].includes(String(aspectRatio))) {
          throw errorWithCode('invalid_aspect_ratio', '画幅比例必须是 16:9、9:16、1:1 或 4:3。');
        }
        if (typeof duration !== 'number' || duration < 1 || duration > h3Status.constraints.maxDurationSeconds) {
          throw errorWithCode('invalid_duration', `时长必须在 1 到 ${h3Status.constraints.maxDurationSeconds} 秒之间。`);
        }
      }

      const task = await createGenerationTask(config, database, secrets, {
        appId: CREATIVE_APP_ID,
        idempotencyKey: requestIdempotencyKey(request, body),
        purpose: modePurpose(mode),
        inputs: isVideo ? { prompt, duration, aspectRatio } : { prompt, negativePrompt, width, height, steps },
        inputArtifacts: normalizeInputArtifacts(inputArtifacts),
        seed,
        priority: 'interactive',
      }, fetcher);
      return reply.code(202).send(safeTask(database, task.id) ?? task);
    } catch (error) {
      return sendCreativeError(reply, error);
    }
  });

  app.get('/api/v1/admin/creative/tasks', async (request, reply) => {
    try {
      const rawLimit = Number((request.query as { limit?: string }).limit ?? 30);
      const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;
      const rows = database.connection.prepare('SELECT id FROM generation_tasks WHERE app_id=? ORDER BY created_at DESC LIMIT ?').all(CREATIVE_APP_ID, limit) as Array<{ id: string }>;
      return { items: rows.map((row) => safeTask(database, row.id)).filter(Boolean) };
    } catch (error) {
      return sendCreativeError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/creative/tasks/:id', async (request, reply) => {
    const task = safeTask(database, request.params.id);
    if (!task) return reply.code(404).send({ error: 'not_found' });
    return task;
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/creative/tasks/:id/cancel', async (request, reply) => {
    try {
      const task = await cancelGenerationTask(config, database, secrets, request.params.id, CREATIVE_APP_ID, fetcher);
      return safeTask(database, task.id) ?? task;
    } catch (error) {
      return sendCreativeError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/creative/tasks/:id/retry', async (request, reply) => {
    try {
      const header = request.headers['idempotency-key'];
      const key = typeof header === 'string' && header.trim().length >= 8 ? header.trim() : `creative-retry-${randomUUID()}`;
      const task = await retryGenerationTask(config, database, secrets, request.params.id, CREATIVE_APP_ID, key, fetcher);
      return reply.code(202).send(safeTask(database, task.id) ?? task);
    } catch (error) {
      return sendCreativeError(reply, error);
    }
  });

  app.get('/api/v1/admin/creative/artifacts', async (request, reply) => {
    try {
      const query = request.query as { limit?: string; offset?: string };
      const rawLimit = Number(query.limit ?? 60);
      const rawOffset = Number(query.offset ?? 0);
      const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 60;
      const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
      const rows = database.connection.prepare(`
        SELECT * FROM artifacts
        WHERE app_id=? AND file_status='ready' AND media_type IN ('image','video','audio')
          AND NOT EXISTS (SELECT 1 FROM artifacts parent WHERE parent.thumbnail_artifact_id=artifacts.id)
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(CREATIVE_APP_ID, limit, offset) as Array<Record<string, unknown>>;
      const total = (database.connection.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE app_id=? AND file_status='ready' AND media_type IN ('image','video','audio') AND NOT EXISTS (SELECT 1 FROM artifacts parent WHERE parent.thumbnail_artifact_id=artifacts.id)").get(CREATIVE_APP_ID) as { count: number }).count;
      return { items: rows.map(toSafeArtifact), total: Number(total) };
    } catch (error) {
      return sendCreativeError(reply, error);
    }
  });

  app.route<{ Params: { id: string }; Querystring: { thumbnail?: string } }>({
    method: ['GET', 'HEAD'],
    url: '/api/v1/admin/creative/artifacts/:id',
    handler: async (request, reply) => {
      const artifact = await readArtifact(database, request.params.id);
      if (!artifact || artifact.appId !== CREATIVE_APP_ID || artifact.fileStatus !== 'ready' || !artifact.localPath) return reply.code(404).send({ error: 'not_found' });

      let servePath = artifact.localPath;
      let contentType = artifact.contentType || 'application/octet-stream';

      if (request.query.thumbnail === 'true' && artifact.mediaType === 'video') {
        if (artifact.thumbnailArtifactId) {
          const thumbnail = await readArtifact(database, artifact.thumbnailArtifactId);
          if (thumbnail?.appId === CREATIVE_APP_ID && thumbnail.fileStatus === 'ready' && thumbnail.localPath) {
            servePath = thumbnail.localPath;
            contentType = thumbnail.contentType || 'image/webp';
          } else {
            return reply.code(404).send({ error: 'thumbnail_not_found' });
          }
        } else {
          // Keep old artifacts usable until their central thumbnail is
          // generated by reconciliation. New artifacts never depend on this
          // sidecar path.
          const legacyThumbPath = artifact.localPath + '.jpg';
          const legacyExists = await stat(legacyThumbPath).then(() => true).catch(() => false);
          if (legacyExists) {
            servePath = legacyThumbPath;
            contentType = 'image/jpeg';
          } else {
            return reply.code(404).send({ error: 'thumbnail_not_found' });
          }
        }
      }

      const fileStat = await stat(servePath).catch(() => null);
      if (!fileStat) return reply.code(404).send({ error: 'not_found' });

      const totalSize = fileStat.size;
      const etag = `"${artifact.sha256 || artifact.id}"` + (servePath !== artifact.localPath ? '-thumb' : '');

      reply.header('accept-ranges', 'bytes');
      reply.header('etag', etag);
      reply.header('last-modified', fileStat.mtime.toUTCString());
      reply.header('cache-control', 'private, no-store');

      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }

      if (request.method === 'HEAD') {
        reply.header('content-type', contentType);
        reply.header('content-length', totalSize);
        return reply.code(200).send();
      }

      const rangeHeader = request.headers.range;
      if (rangeHeader) {
        const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
        if (match) {
          const [, startStr, endStr] = match;
          let start;
          let end;

          if (!startStr && endStr) {
            const suffix = Number.parseInt(endStr, 10);
            if (suffix > 0) {
              start = Math.max(0, totalSize - suffix);
              end = totalSize - 1;
            }
          } else if (startStr && !endStr) {
            start = Number.parseInt(startStr, 10);
            end = totalSize - 1;
          } else if (startStr && endStr) {
            start = Number.parseInt(startStr, 10);
            end = Number.parseInt(endStr, 10);
          }

          if (start !== undefined && end !== undefined && !Number.isNaN(start) && !Number.isNaN(end) && start >= 0 && start < totalSize && end >= start && end < totalSize) {
            const chunkSize = end - start + 1;
            reply.header('content-type', contentType);
            reply.header('content-range', `bytes ${start}-${end}/${totalSize}`);
            reply.header('content-length', chunkSize);
            reply.code(206);
            return reply.send(createArtifactReadStream(servePath, { start, end }));
          }
        }
        reply.header('content-range', `bytes */${totalSize}`);
        reply.header('content-type', 'application/json');
        return reply.code(416).send({ error: 'range_not_satisfiable' });
      }

      reply.header('content-type', contentType);
      reply.header('content-length', totalSize);
      reply.code(200);
      return reply.send(createArtifactReadStream(servePath));
    },
  });

  app.put<{ Params: { id: string }; Body: { pinned?: boolean } }>('/api/v1/admin/creative/artifacts/:id/pin', async (request, reply) => {
    const result = database.connection.prepare('UPDATE artifacts SET pinned=?, updated_at=? WHERE id=? AND app_id=?')
      .run(request.body?.pinned ? 1 : 0, nowIso(), request.params.id, CREATIVE_APP_ID);
    if (!result.changes) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, pinned: Boolean(request.body?.pinned) };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/creative/artifacts/:id', async (request, reply) => {
    try {
      const removed = await removeArtifact(database, request.params.id, CREATIVE_APP_ID, false);
      return removed ? { ok: true } : reply.code(404).send({ error: 'not_found' });
    } catch (error) {
      return sendCreativeError(reply, error);
    }
  });
}
