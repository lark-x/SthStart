import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readSettings, ipAllowed, WorkerError, WindowsWorker, TASK_ID_PATTERN, UPLOAD_ID_PATTERN, OUTPUT_ID_PATTERN } from './worker-core.mjs';

const settings = readSettings();
const worker = new WindowsWorker(settings);
const MAX_JSON_BYTES = 2 * 1024 * 1024;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

function errorPayload(error) {
  return { error: error.code || 'worker_error', message: String(error.message || error).slice(0, 300) };
}

async function readBody(request, maxBytes) {
  const declared = Number.parseInt(request.headers['content-length'] || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) throw new WorkerError('body_too_large', '请求体过大。', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new WorkerError('body_too_large', '请求体过大。', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, MAX_JSON_BYTES);
  try { return JSON.parse(body.toString('utf8')); } catch { throw new WorkerError('invalid_json', '请求 JSON 无效。'); }
}

function authorized(request, response) {
  const remoteAddress = request.socket.remoteAddress || '';
  if (!ipAllowed(remoteAddress, settings.allowlist)) { sendJson(response, 403, { error: 'ip_not_allowed', message: '请求来源不在 Worker IP 白名单中。' }); return false; }
  const supplied = request.headers.authorization || '';
  if (supplied !== `Bearer ${settings.token}`) { sendJson(response, 401, { error: 'unauthorized' }); return false; }
  return true;
}

function routeParts(url) {
  return url.split('?')[0].split('/').filter(Boolean).map((item) => decodeURIComponent(item));
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request, response)) return;
    const parts = routeParts(request.url || '/');
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'health') {
      return sendJson(response, 200, await worker.health());
    }
    if (request.method === 'POST' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'worker' && parts[2] === 'tasks') {
      return sendJson(response, 202, await worker.submitTask(await readJson(request)));
    }
    if (request.method === 'PUT' && parts.length === 6 && parts[0] === 'v1' && parts[1] === 'worker' && parts[2] === 'tasks' && parts[4] === 'input') {
      const taskId = parts[3]; const uploadId = parts[5];
      if (!TASK_ID_PATTERN.test(taskId) || !UPLOAD_ID_PATTERN.test(uploadId)) throw new WorkerError('invalid_upload_id', '输入上传 ID 格式无效。');
      const body = await readBody(request, 12 * 1024 * 1024);
      const result = await worker.uploadInput(taskId, uploadId, body, { filename: request.headers['x-worker-file-name'] || '', sha256: request.headers['x-artifact-sha256'] || '', contentType: request.headers['content-type'] || 'application/octet-stream' });
      return sendJson(response, 201, result);
    }
    if (request.method === 'GET' && parts.length === 5 && parts[0] === 'v1' && parts[1] === 'worker' && parts[2] === 'tasks' && parts[4] === 'status') {
      return sendJson(response, 200, await worker.status(parts[3]));
    }
    if (request.method === 'GET' && parts.length === 6 && parts[0] === 'v1' && parts[1] === 'worker' && parts[2] === 'tasks' && parts[4] === 'output') {
      const taskId = parts[3]; const outputId = parts[5];
      if (!TASK_ID_PATTERN.test(taskId) || !OUTPUT_ID_PATTERN.test(outputId)) throw new WorkerError('invalid_output_id', '产物 ID 格式无效。');
      const output = await worker.getOutput(taskId, outputId);
      response.writeHead(200, { 'content-type': output.contentType, 'content-length': output.byteSize, 'content-disposition': `inline; filename="${String(output.filename).replace(/["\r\n]/g, '')}"`, 'cache-control': 'no-store' });
      return createReadStream(output.path).on('error', () => response.destroy()).pipe(response);
    }
    if (request.method === 'POST' && parts.length === 5 && parts[0] === 'v1' && parts[1] === 'worker' && parts[2] === 'tasks' && parts[4] === 'confirm') {
      const body = await readJson(request);
      return sendJson(response, 200, await worker.confirmTask(parts[3], body.outputIds));
    }
    return sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const normalized = error instanceof WorkerError ? error : new WorkerError('worker_internal_error', 'Worker 内部错误。', 500);
    if (!(error instanceof WorkerError)) console.error('[windows-worker]', error);
    sendJson(response, normalized.status || 500, errorPayload(normalized));
  }
});

await worker.init();
server.listen(settings.port, settings.host, () => {
  console.log(`[SthStart] Windows Worker ${settings.workerId} listening on http://${settings.host}:${settings.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
