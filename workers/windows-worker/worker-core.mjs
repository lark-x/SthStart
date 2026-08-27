import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { extname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
export const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
export const OUTPUT_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;
const DEFAULT_DISK_WARNING_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_DISK_STOP_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_TEMP_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

export class WorkerError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.status = status;
  }
}

function safeJson(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanFileExtension(name, contentType) {
  const candidate = extname(String(name || '')).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|avif)$/.test(candidate)) return candidate;
  const map = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
  return map[String(contentType || '').split(';')[0].trim().toLowerCase()] || '.bin';
}

function contentTypeForExtension(extension) {
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
  return map[extension] || 'application/octet-stream';
}

function now() {
  return new Date().toISOString();
}

function hashBytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeRemoteAddress(address) {
  return String(address || '').replace(/^::ffff:/i, '');
}

function ipv4Number(address) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv6Number(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (!value || value.includes('.')) return null;
  const sections = value.split('::');
  if (sections.length > 2) return null;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((sections.length === 1 && missing !== 0) || (sections.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

export function ipAllowed(remoteAddress, allowlist) {
  if (!allowlist.length) return true;
  const remote = normalizeRemoteAddress(remoteAddress);
  const remoteNumber = ipv4Number(remote);
  const remote6 = ipv6Number(remote);
  return allowlist.some((entry) => {
    const value = String(entry).trim();
    const [address, prefix, ...extra] = value.split('/');
    if (extra.length) return false;
    if (prefix === undefined) return normalizeRemoteAddress(address) === remote || (address === '127.0.0.1' && remote === '::1');
    const network = ipv4Number(address);
    const bits = Number(prefix);
    if (remoteNumber !== null && network !== null) {
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
      if (bits === 0) return true;
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return (remoteNumber & mask) === (network & mask);
    }
    const network6 = ipv6Number(address);
    if (remote6 === null || network6 === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
    if (bits === 0) return true;
    const mask = ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
    return (remote6 & mask) === (network6 & mask);
  });
}

export function validateWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new WorkerError('invalid_workflow', '工作流必须为 JSON 对象。');
  if (Array.isArray(workflow.nodes) || 'last_node_id' in workflow || Array.isArray(workflow.links)) throw new WorkerError('invalid_workflow', 'Worker 只接受 ComfyUI API 格式工作流。');
  const keys = Object.keys(workflow);
  if (!keys.length) throw new WorkerError('invalid_workflow', '工作流不能为空。');
  for (const key of keys) {
    const node = workflow[key];
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.class_type !== 'string' || !node.class_type || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) {
      throw new WorkerError('invalid_workflow', '工作流节点结构无效。');
    }
  }
  const size = Buffer.byteLength(JSON.stringify(workflow));
  if (size > MAX_WORKFLOW_BYTES) throw new WorkerError('workflow_too_large', '工作流定义过大。', 413);
  return workflow;
}

function readNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function readSettings(environment = process.env) {
  const token = String(environment.WORKER_TOKEN || '').trim();
  if (token.length < 32) throw new Error('WORKER_TOKEN 必须至少包含 32 个字符。');
  const concurrency = Number(environment.WORKER_CONCURRENCY || 1);
  if (concurrency !== 1) throw new Error('WORKER_CONCURRENCY 必须固定为 1。');
  const temperature = readNumber(environment.WORKER_TEMPERATURE, 0.7);
  if (temperature < 0 || temperature > 2) throw new Error('WORKER_TEMPERATURE 必须在 0 到 2 之间。');
  const warningBytes = Math.max(1, Math.floor(readNumber(environment.WORKER_DISK_WARNING_BYTES, DEFAULT_DISK_WARNING_BYTES)));
  const stopBytes = Math.max(1, Math.floor(readNumber(environment.WORKER_DISK_STOP_BYTES, DEFAULT_DISK_STOP_BYTES)));
  if (warningBytes < stopBytes) throw new Error('WORKER_DISK_WARNING_BYTES 必须不小于 WORKER_DISK_STOP_BYTES。');
  const maxTempBytes = Math.floor(readNumber(environment.WORKER_MAX_TEMP_BYTES, DEFAULT_MAX_TEMP_BYTES));
  if (!Number.isSafeInteger(maxTempBytes) || maxTempBytes < MAX_INPUT_BYTES) throw new Error('WORKER_MAX_TEMP_BYTES 必须是不小于 12 MiB 的安全整数。');
  const allowlist = String(environment.WORKER_ALLOWED_IPS || '').split(',').map((item) => item.trim()).filter(Boolean);
  for (const entry of allowlist) {
    const [address, prefix, ...extra] = entry.split('/');
    const addressType = isIP(address);
    const maxPrefix = addressType === 4 ? 32 : addressType === 6 ? 128 : -1;
    if (!addressType || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > maxPrefix))) throw new Error('WORKER_ALLOWED_IPS 必须是合法 IP/CIDR 列表。');
  }
  const port = Number(environment.WORKER_PORT || 9200);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('WORKER_PORT 必须是 1 到 65535 之间的整数。');
  return {
    workerId: String(environment.WORKER_ID || 'windows-worker').trim() || 'windows-worker',
    host: String(environment.WORKER_HOST || '127.0.0.1').trim() || '127.0.0.1',
    port,
    token,
    allowlist,
    comfyUrl: String(environment.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
    comfyToken: String(environment.COMFYUI_TOKEN || '').trim(),
    dataDir: resolve(String(environment.WORKER_DATA_DIR || './data/windows-worker')),
    modelDir: resolve(String(environment.WORKER_MODEL_DIR || './models')),
    model: String(environment.WORKER_MODEL || '').trim(),
    temperature,
    concurrency: 1,
    diskWarningBytes: warningBytes,
    diskStopBytes: stopBytes,
    maxTempBytes,
    pollIntervalMs: Math.max(100, Math.floor(readNumber(environment.WORKER_POLL_INTERVAL_MS, 500))),
    pollTimeoutMs: Math.max(5_000, Math.floor(readNumber(environment.WORKER_POLL_TIMEOUT_MS, 600_000))),
  };
}

async function atomicWrite(path, value) {
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tempPath, path);
}

async function directoryBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directoryBytes(child);
    } else if (entry.isFile()) {
      total += await stat(child).then((value) => value.size).catch(() => 0);
    }
  }
  return total;
}

async function streamResponseToFile(response, targetPath, maxBytes = 256 * 1024 * 1024) {
  if (!response.body) throw new WorkerError('comfy_output_empty', 'ComfyUI 未返回产物内容。', 502);
  await mkdir(resolve(targetPath, '..'), { recursive: true });
  const hash = createHash('sha256');
  let byteSize = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maxBytes) return callback(new WorkerError('output_too_large', '生成产物超过 Worker 限制。', 413));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(tempPath, { flags: 'wx' }));
    await rename(tempPath, targetPath);
    return { byteSize, sha256: hash.digest('hex') };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export class WindowsWorker {
  constructor(settings) {
    this.settings = settings;
    this.tasks = new Map();
    this.queue = [];
    this.runningTaskId = null;
    this.draining = false;
  }

  taskPath(taskId) { return resolve(this.settings.dataDir, 'tasks', `${taskId}.json`); }
  inputPath(taskId, uploadId, extension) { return resolve(this.settings.dataDir, 'inputs', taskId, `${uploadId}${extension}`); }
  outputPath(taskId, outputId, extension) { return resolve(this.settings.dataDir, 'outputs', taskId, `${outputId}${extension}`); }

  async init() {
    await mkdir(this.settings.modelDir, { recursive: true });
    await mkdir(resolve(this.settings.dataDir, 'tasks'), { recursive: true });
    await mkdir(resolve(this.settings.dataDir, 'inputs'), { recursive: true });
    await mkdir(resolve(this.settings.dataDir, 'outputs'), { recursive: true });
    const files = await readdir(resolve(this.settings.dataDir, 'tasks')).catch(() => []);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const task = JSON.parse(await readFile(resolve(this.settings.dataDir, 'tasks', file), 'utf8'));
        if (!task || !TASK_ID_PATTERN.test(String(task.taskId || ''))) continue;
        this.tasks.set(task.taskId, task);
        if (task.status === 'queued' || ((task.status === 'submitting' || task.status === 'accepted' || task.status === 'running') && task.providerTaskId)) this.enqueue(task.taskId);
        else if (task.status === 'submitting' && !task.providerTaskId) {
          task.status = 'abandoned';
          task.errorCode = 'submission_outcome_unknown';
          task.errorMessage = 'Worker 重启时提交状态未知，禁止自动重复提交。';
          task.updatedAt = now();
          await this.save(task);
        }
      } catch {
        // Ignore a corrupt manifest; it cannot be safely resubmitted.
      }
    }
    void this.drain();
  }

  async save(task) {
    task.updatedAt = now();
    await atomicWrite(this.taskPath(task.taskId), task);
  }

  enqueue(taskId) {
    if (!this.queue.includes(taskId)) this.queue.push(taskId);
    void this.drain();
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.runningTaskId && this.queue.length) {
        const taskId = this.queue.shift();
        const task = this.tasks.get(taskId);
        if (!task || ['succeeded', 'failed', 'abandoned', 'cancelled', 'confirmed'].includes(task.status)) continue;
        this.runningTaskId = taskId;
        try {
          if (task.providerTaskId) await this.pollComfy(task);
          else await this.submitToComfy(task);
        } catch (error) {
          task.status = 'abandoned';
          task.errorCode = 'worker_runtime_error';
          task.errorMessage = String(error?.message || error).slice(0, 300);
          await this.save(task).catch(() => undefined);
        } finally {
          this.runningTaskId = null;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async createStaging(taskId) {
    if (!TASK_ID_PATTERN.test(taskId)) throw new WorkerError('invalid_task_id', '任务 ID 格式无效。');
    const existing = this.tasks.get(taskId);
    if (existing) return existing;
    const task = {
      taskId,
      status: 'staging',
      workflow: null,
      outputDeclarations: [],
      inputs: [],
      outputs: [],
      providerTaskId: null,
      model: this.settings.model,
      temperature: this.settings.temperature,
      createdAt: now(),
      updatedAt: now(),
    };
    this.tasks.set(taskId, task);
    await this.save(task);
    return task;
  }

  async uploadInput(taskId, uploadId, body, metadata) {
    if (!TASK_ID_PATTERN.test(taskId) || !UPLOAD_ID_PATTERN.test(uploadId)) throw new WorkerError('invalid_upload_id', '输入上传 ID 格式无效。');
    if (body.length > MAX_INPUT_BYTES) throw new WorkerError('input_too_large', '输入图片不能超过 12 MiB。', 413);
    const existingTask = this.tasks.get(taskId);
    if (existingTask && ['succeeded', 'failed', 'abandoned', 'cancelled', 'confirmed'].includes(existingTask.status)) throw new WorkerError('task_not_uploadable', '任务已进入终态，不能继续上传输入。', 409);
    const computedSha = hashBytes(body);
    const expectedSha = String(metadata.sha256 || '').trim().toLowerCase();
    if (expectedSha && !/^[a-f0-9]{64}$/.test(expectedSha)) throw new WorkerError('invalid_sha256', '输入 SHA-256 格式无效。');
    if (expectedSha && expectedSha !== computedSha) throw new WorkerError('sha256_mismatch', '输入文件 SHA-256 校验失败。', 422);
    const contentType = String(metadata.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new WorkerError('invalid_input_type', 'Worker 输入必须是图片。', 415);
    const extension = cleanFileExtension(metadata.filename, contentType);
    const relativePath = `inputs/${taskId}/${uploadId}${extension}`;
    const existing = existingTask?.inputs.find((input) => input.uploadId === uploadId);
    if (existing) {
      if (existing.sha256 === computedSha && existing.byteSize === body.length) return { taskId, uploadId, fileName: existing.fileName, relativePath: existing.relativePath, sha256: existing.sha256 };
      throw new WorkerError('upload_id_conflict', '相同 uploadId 已绑定了不同文件。', 409);
    }
    const disk = await this.diskStatus();
    if (disk.freeBytes <= this.settings.diskStopBytes) throw new WorkerError('worker_disk_stop', 'Worker 可用磁盘空间低于停止阈值。', 507);
    if (disk.tempBytes + body.length > this.settings.maxTempBytes) throw new WorkerError('worker_temp_space_exceeded', 'Worker 临时目录已达到空间上限。', 507);
    const task = existingTask || await this.createStaging(taskId);
    const filePath = this.inputPath(taskId, uploadId, extension);
    await mkdir(resolve(filePath, '..'), { recursive: true });
    await writeFile(filePath, body, { flag: 'wx' }).catch((error) => {
      if (error?.code === 'EEXIST') throw new WorkerError('upload_id_conflict', '相同 uploadId 已存在。', 409);
      throw error;
    });
    const input = { uploadId, fileName: `${uploadId}${extension}`, relativePath, sha256: computedSha, byteSize: body.length, contentType };
    task.inputs.push(input);
    await this.save(task);
    return { taskId, uploadId, fileName: input.fileName, relativePath, sha256: computedSha };
  }

  async submitTask(body) {
    const taskId = String(body?.taskId || '').trim();
    if (!TASK_ID_PATTERN.test(taskId)) throw new WorkerError('invalid_task_id', '任务 ID 格式无效。');
    const existing = this.tasks.get(taskId);
    if (existing && existing.status !== 'staging') return this.publicStatus(existing);
    const workflow = validateWorkflow(body?.workflow);
    if (!Array.isArray(body?.outputDeclarations) || body.outputDeclarations.some((item) => typeof item !== 'string' || !item.trim())) throw new WorkerError('invalid_output_declarations', '输出声明格式无效。');
    const task = existing || await this.createStaging(taskId);
    task.workflow = workflow;
    task.outputDeclarations = [...new Set(body.outputDeclarations.map((item) => item.trim()))];
    task.model = this.settings.model;
    task.temperature = this.settings.temperature;
    task.status = 'queued';
    task.errorCode = null;
    task.errorMessage = null;
    await this.save(task);
    this.enqueue(taskId);
    return this.publicStatus(task);
  }

  publicStatus(task) {
    return {
      taskId: task.taskId,
      status: task.status,
      providerTaskId: task.providerTaskId || null,
      errorCode: task.errorCode || null,
      errorMessage: task.errorMessage || null,
      outputs: Array.isArray(task.outputs) ? task.outputs.map(({ outputId, outputName, filename, contentType, byteSize, sha256 }) => ({ outputId, outputName, filename, contentType, byteSize, sha256 })) : [],
    };
  }

  getTask(taskId) {
    if (!TASK_ID_PATTERN.test(taskId)) throw new WorkerError('invalid_task_id', '任务 ID 格式无效。');
    const task = this.tasks.get(taskId);
    if (!task) throw new WorkerError('task_not_found', '任务不存在。', 404);
    return task;
  }

  async status(taskId) {
    return this.publicStatus(this.getTask(taskId));
  }

  async getOutput(taskId, outputId) {
    if (!TASK_ID_PATTERN.test(taskId) || !OUTPUT_ID_PATTERN.test(outputId)) throw new WorkerError('invalid_output_id', '产物 ID 格式无效。');
    const task = this.getTask(taskId);
    const output = (task.outputs || []).find((item) => item.outputId === outputId);
    if (!output || !['succeeded', 'confirmed'].includes(task.status)) throw new WorkerError('output_not_ready', '产物当前不可用。', 404);
    const filePath = resolve(this.settings.dataDir, output.relativePath);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) throw new WorkerError('output_missing', '产物文件不存在。', 404);
    return { path: filePath, contentType: output.contentType, byteSize: fileStat.size, filename: output.filename, sha256: output.sha256 };
  }

  async confirmTask(taskId, outputIds) {
    const task = this.getTask(taskId);
    if (task.status === 'confirmed') return { taskId, status: 'confirmed' };
    if (task.status !== 'succeeded') throw new WorkerError('task_not_succeeded', '只有已成功任务才能确认清理。', 409);
    if (!Array.isArray(outputIds) || outputIds.length !== task.outputs.length || new Set(outputIds).size !== outputIds.length || outputIds.some((id) => !task.outputs.some((output) => output.outputId === id))) {
      throw new WorkerError('output_confirmation_incomplete', '必须确认该任务的全部产物。');
    }
    for (const input of task.inputs || []) await unlink(resolve(this.settings.dataDir, input.relativePath)).catch(() => undefined);
    for (const output of task.outputs || []) await unlink(resolve(this.settings.dataDir, output.relativePath)).catch(() => undefined);
    task.status = 'confirmed';
    task.confirmedAt = now();
    task.inputs = [];
    task.outputs = (task.outputs || []).map(({ outputId, outputName, filename, contentType, byteSize, sha256 }) => ({ outputId, outputName, filename, contentType, byteSize, sha256 }));
    await this.save(task);
    return { taskId, status: 'confirmed' };
  }

  authHeaders() {
    return this.settings.comfyToken ? { authorization: `Bearer ${this.settings.comfyToken}` } : {};
  }

  async comfyResponse(path, init = {}, timeoutMs = 30_000) {
    try {
      return await fetch(`${this.settings.comfyUrl}${path}`, { ...init, headers: { ...this.authHeaders(), ...(init.headers || {}) }, signal: init.signal || AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new WorkerError('comfy_unavailable', `ComfyUI 不可达：${String(error?.message || error).slice(0, 200)}`, 502);
    }
  }

  async submitToComfy(task) {
    if (!task.workflow) {
      task.status = 'failed'; task.errorCode = 'workflow_missing'; task.errorMessage = '任务缺少工作流定义。'; await this.save(task); return;
    }
    const disk = await this.diskStatus();
    if (disk.freeBytes <= this.settings.diskStopBytes) {
      task.status = 'failed'; task.errorCode = 'worker_disk_stop'; task.errorMessage = 'Worker 可用磁盘空间低于停止阈值。'; await this.save(task); return;
    }
    if (disk.tempBytes > this.settings.maxTempBytes) {
      task.status = 'failed'; task.errorCode = 'worker_temp_space_exceeded'; task.errorMessage = 'Worker 临时目录已达到空间上限。'; await this.save(task); return;
    }
    task.status = 'submitting';
    await this.save(task);
    for (const input of task.inputs || []) {
      try {
        const body = await readFile(resolve(this.settings.dataDir, input.relativePath));
        const form = new FormData();
        form.set('image', new File([body], input.fileName, { type: input.contentType }));
        form.set('overwrite', 'false'); form.set('type', 'input');
        const response = await this.comfyResponse('/upload/image', { method: 'POST', body: form }, 60_000);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new WorkerError('comfy_input_rejected', `ComfyUI 拒绝输入 (HTTP ${response.status})。`, 502);
        const uploadedName = typeof payload.name === 'string' ? payload.name : typeof payload.filename === 'string' ? payload.filename : '';
        if (!uploadedName || uploadedName.includes('/') || uploadedName.includes('\\')) throw new WorkerError('comfy_input_invalid_name', 'ComfyUI 未返回受控输入文件名。', 502);
        for (const node of Object.values(task.workflow)) {
          if (node?.inputs && typeof node.inputs === 'object') {
            for (const [key, value] of Object.entries(node.inputs)) if (value === input.fileName) node.inputs[key] = uploadedName;
          }
        }
      } catch (error) {
        task.status = 'failed'; task.errorCode = error.code || 'comfy_input_failed'; task.errorMessage = String(error.message || error).slice(0, 300); await this.save(task); return;
      }
    }

    let response;
    try {
      response = await this.comfyResponse('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: task.workflow, client_id: task.taskId }) }, 30_000);
    } catch (error) {
      task.status = 'abandoned'; task.errorCode = 'submission_outcome_unknown'; task.errorMessage = `ComfyUI 提交状态不确定：${String(error.message || error).slice(0, 240)}`; await this.save(task); return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      task.status = 'failed'; task.errorCode = 'comfy_request_failed'; task.errorMessage = `ComfyUI 拒绝任务 (HTTP ${response.status})。`; await this.save(task); return;
    }
    const providerTaskId = String(payload.prompt_id || payload.task_id || '');
    if (!providerTaskId) {
      task.status = 'failed'; task.errorCode = 'comfy_missing_task_id'; task.errorMessage = 'ComfyUI 未返回任务 ID。'; await this.save(task); return;
    }
    task.providerTaskId = providerTaskId;
    task.status = 'accepted';
    await this.save(task);
    await this.pollComfy(task);
  }

  async pollComfy(task) {
    const deadline = Date.now() + this.settings.pollTimeoutMs;
    while (Date.now() < deadline) {
      if (['succeeded', 'failed', 'abandoned', 'cancelled', 'confirmed'].includes(task.status)) return;
      try {
        const historyResponse = await this.comfyResponse(`/history/${encodeURIComponent(task.providerTaskId)}`, {}, 15_000);
        if (historyResponse.ok) {
          const history = safeJson(await historyResponse.json().catch(() => ({})));
          const entry = history[task.providerTaskId];
          if (entry) {
            const status = entry.status || {};
            const failed = status.status_str === 'error' || (Array.isArray(status.messages) && status.messages.some((message) => Array.isArray(message) && message[0] === 'execution_error'));
            if (failed) {
              task.status = 'failed'; task.errorCode = 'comfy_execution_error'; task.errorMessage = 'ComfyUI 执行失败。'; await this.save(task); return;
            }
            const outputs = await this.collectOutputs(task, entry.outputs || {});
            if (!outputs.length) {
              task.status = 'failed'; task.errorCode = 'worker_outputs_missing'; task.errorMessage = 'ComfyUI 未返回声明的产物。'; await this.save(task); return;
            }
            task.outputs = outputs;
            task.status = 'succeeded';
            await this.save(task);
            return;
          }
        }
        const queueResponse = await this.comfyResponse('/queue', {}, 5_000).catch(() => null);
        if (queueResponse?.ok) {
          const queue = safeJson(await queueResponse.json().catch(() => ({})));
          const running = [...(Array.isArray(queue.queue_running) ? queue.queue_running : []), ...(Array.isArray(queue.queue_pending) ? queue.queue_pending : [])].some((item) => Array.isArray(item) && String(item[1] || '') === task.providerTaskId);
          if (running && task.status !== 'running') { task.status = 'running'; await this.save(task); }
        }
      } catch {
        // Keep the accepted task single-submission while ComfyUI restarts.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.settings.pollIntervalMs));
    }
    task.status = 'abandoned'; task.errorCode = 'worker_poll_timeout'; task.errorMessage = 'ComfyUI 轮询超时，上游可能仍在运行。'; await this.save(task);
  }

  async collectOutputs(task, rawOutputs) {
    const selected = [];
    const declarations = new Set(task.outputDeclarations || []);
    for (const [outputName, output] of Object.entries(rawOutputs || {})) {
      if (declarations.size && !declarations.has(outputName)) continue;
      for (const image of Array.isArray(output?.images) ? output.images : []) {
        if (typeof image.filename !== 'string' || !image.filename || image.filename.includes('..')) continue;
        const query = new URLSearchParams({ filename: image.filename, subfolder: String(image.subfolder || ''), type: String(image.type || 'output') });
        const response = await this.comfyResponse(`/view?${query.toString()}`, {}, 120_000);
        if (!response.ok) throw new WorkerError('comfy_output_failed', `ComfyUI 产物请求失败 (HTTP ${response.status})。`, 502);
        const outputId = `out-${randomUUID().replaceAll('-', '')}`;
        const extension = cleanFileExtension(image.filename, response.headers.get('content-type'));
        const relativePath = `outputs/${task.taskId}/${outputId}${extension}`;
        const target = this.outputPath(task.taskId, outputId, extension);
        const disk = await this.diskStatus();
        const available = disk.maxTempBytes - disk.tempBytes;
        if (available <= 0) throw new WorkerError('worker_temp_space_exceeded', 'Worker 临时目录已达到空间上限。', 507);
        const declaredLength = Number.parseInt(response.headers.get('content-length') || '', 10);
        if (Number.isFinite(declaredLength) && declaredLength > available) throw new WorkerError('worker_temp_space_exceeded', 'Worker 临时目录剩余空间不足以保存产物。', 507);
        const saved = await streamResponseToFile(response, target, Math.min(MAX_OUTPUT_BYTES, available));
        selected.push({ outputId, outputName, filename: image.filename.split(/[\\/]/).pop(), contentType: response.headers.get('content-type')?.split(';')[0] || contentTypeForExtension(extension), byteSize: saved.byteSize, sha256: saved.sha256, relativePath });
      }
    }
    return selected;
  }

  async diskStatus() {
    const [freeBytes, tempBytes, modelDirectoryReady] = await Promise.all([
      statfs(this.settings.dataDir).then((stats) => Number(stats.bavail) * Number(stats.bsize)).catch(() => 0),
      directoryBytes(this.settings.dataDir),
      stat(this.settings.modelDir).then((value) => value.isDirectory()).catch(() => false),
    ]);
    return {
      freeBytes,
      tempBytes,
      maxTempBytes: this.settings.maxTempBytes,
      modelDirectoryReady,
      warningBytes: this.settings.diskWarningBytes,
      stopBytes: this.settings.diskStopBytes,
    };
  }

  async health() {
    const disk = await this.diskStatus();
    let comfyReady = false;
    try {
      const response = await this.comfyResponse('/queue', {}, 2_000);
      comfyReady = response.ok;
    } catch {}
    const ready = comfyReady && disk.freeBytes > this.settings.diskStopBytes && disk.tempBytes <= this.settings.maxTempBytes;
    return {
      ok: ready,
      workerId: this.settings.workerId,
      ready,
      model: this.settings.model,
      temperature: this.settings.temperature,
      concurrency: 1,
      queueDepth: this.queue.length,
      runningTaskId: this.runningTaskId,
      modelDirectoryReady: disk.modelDirectoryReady,
      disk,
    };
  }
}
