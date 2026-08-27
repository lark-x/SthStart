import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createHash } from 'node:crypto';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitFor(url, init, predicate = (response) => response.ok) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(url, init);
      if (await predicate(response)) return response;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`timed out waiting for ${url}`);
}

test('Windows Worker HTTP protocol enforces auth and completes a real bridge lifecycle', async () => {
  const comfyPort = await freePort();
  const workerPort = await freePort();
  const dataDir = await mkdtemp(resolve(tmpdir(), 'sthstart-worker-http-'));
  const result = Buffer.from('http-worker-result');
  let promptCalls = 0;
  const comfy = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (url.pathname === '/queue') return response.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
    if (url.pathname === '/upload/image') return response.end(JSON.stringify({ name: 'upload-1.png' }));
    if (url.pathname === '/prompt') {
      promptCalls++;
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ prompt_id: 'comfy-http-task' }));
    }
    if (url.pathname === '/history/comfy-http-task') {
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ 'comfy-http-task': { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'result.png', type: 'output' }] } } } }));
    }
    if (url.pathname === '/view') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': result.length });
      return response.end(result);
    }
    response.writeHead(404); response.end();
  });
  comfy.listen(comfyPort, '127.0.0.1');
  await once(comfy, 'listening');

  const token = 'worker-http-token-that-is-longer-than-32-characters';
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'server.mjs')], {
    cwd: resolve(import.meta.dirname),
    env: {
      ...process.env,
      WORKER_HOST: '127.0.0.1', WORKER_PORT: String(workerPort), WORKER_TOKEN: token, WORKER_ALLOWED_IPS: '127.0.0.1',
      WORKER_DATA_DIR: dataDir, COMFYUI_URL: `http://127.0.0.1:${comfyPort}`, WORKER_POLL_INTERVAL_MS: '100',
      WORKER_POLL_TIMEOUT_MS: '5000', WORKER_DISK_STOP_BYTES: '1', WORKER_DISK_WARNING_BYTES: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    const health = await waitFor(`http://127.0.0.1:${workerPort}/health`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await health.json()).concurrency, 1);
    const unauthorized = await fetch(`http://127.0.0.1:${workerPort}/health`);
    assert.equal(unauthorized.status, 401);

    const input = Buffer.from('input');
    const sha = createHash('sha256').update(input).digest('hex');
    const taskId = 'worker-http-task';
    const inputResponse = await fetch(`http://127.0.0.1:${workerPort}/v1/worker/tasks/${taskId}/input/upload-1`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png', 'content-length': String(input.length), 'x-worker-file-name': 'original.png', 'x-artifact-sha256': sha }, body: input,
    });
    assert.equal(inputResponse.status, 201);
    const queued = await fetch(`http://127.0.0.1:${workerPort}/v1/worker/tasks`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, workflow: { '1': { class_type: 'SaveImage', inputs: { filename: 'upload-1.png' } }, '9': { class_type: 'SaveImage', inputs: {} } }, outputDeclarations: ['9'] }),
    });
    assert.equal(queued.status, 202);

    const statusResponse = await waitFor(`http://127.0.0.1:${workerPort}/v1/worker/tasks/${taskId}/status`, { headers: { authorization: `Bearer ${token}` } }, async (response) => {
      if (!response.ok) return false;
      const payload = await response.clone().json();
      return payload.status === 'succeeded';
    });
    const status = await statusResponse.json();
    assert.equal(promptCalls, 1);
    assert.equal(status.outputs.length, 1);
    const outputResponse = await fetch(`http://127.0.0.1:${workerPort}/v1/worker/tasks/${taskId}/output/${status.outputs[0].outputId}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(outputResponse.status, 200);
    assert.deepEqual(Buffer.from(await outputResponse.arrayBuffer()), result);
    const confirmed = await fetch(`http://127.0.0.1:${workerPort}/v1/worker/tasks/${taskId}/confirm`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ outputIds: [status.outputs[0].outputId] }) });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).status, 'confirmed');
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => undefined);
    await new Promise((resolvePromise) => comfy.close(resolvePromise));
    if (stderr) assert.doesNotMatch(stderr, /Unhandled/);
  }
});
