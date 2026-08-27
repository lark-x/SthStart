import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmWorkerTask,
  downloadWorkerOutput,
  getWorkerTaskStatus,
  submitWorkerTask,
  uploadWorkerInput,
  workerHealth,
} from './worker.js';

test('Worker protocol client authenticates every request and keeps IDs in controlled paths', async () => {
  const seen: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const body = init?.body ? await new Response(init.body as BodyInit).text() : '';
    const record = { url: String(input), method: init?.method || 'GET', headers: new Headers(init?.headers), body };
    seen.push(record);
    if (record.url.endsWith('/health')) return Response.json({ ok: true, ready: true, workerId: 'win-1', model: 'sdxl', temperature: 0.7, concurrency: 1, queueDepth: 0, runningTaskId: null, disk: { freeBytes: 1000 } });
    if (record.url.endsWith('/v1/worker/tasks')) return Response.json({ taskId: 'worker-task-1', status: 'queued' }, { status: 202 });
    if (record.url.endsWith('/input/upload-1')) return Response.json({ taskId: 'worker-task-1', uploadId: 'upload-1', fileName: 'upload-1.png', relativePath: 'inputs/worker-task-1/upload-1.png', sha256: 'abc' });
    if (record.url.endsWith('/status')) return Response.json({ taskId: 'worker-task-1', status: 'running' });
    if (record.url.endsWith('/output/output-1')) return new Response(Buffer.from('output'), { status: 200, headers: { 'content-type': 'image/png' } });
    if (record.url.endsWith('/confirm')) return Response.json({ taskId: 'worker-task-1', status: 'confirmed' });
    return new Response(null, { status: 404 });
  };

  const token = 'worker-secret-that-is-long-enough-123456';
  assert.deepEqual(await workerHealth('http://worker.test:9200', token, fetcher), { ok: true, ready: true, workerId: 'win-1', model: 'sdxl', temperature: 0.7, concurrency: 1, queueDepth: 0, runningTaskId: null, disk: { freeBytes: 1000 } });
  await submitWorkerTask({ baseUrl: 'http://worker.test:9200', token, taskId: 'worker-task-1', workflow: { '1': { class_type: 'SaveImage', inputs: {} } }, outputDeclarations: ['1'], fetcher });
  await uploadWorkerInput({ baseUrl: 'http://worker.test:9200', token, taskId: 'worker-task-1', uploadId: 'upload-1', body: new Blob(['input']), filename: 'upload-1.png', contentType: 'image/png', contentLength: 5, sha256: 'abc', fetcher });
  assert.equal((await getWorkerTaskStatus('http://worker.test:9200', token, 'worker-task-1', fetcher)).status, 'running');
  assert.equal((await downloadWorkerOutput('http://worker.test:9200', token, 'worker-task-1', 'output-1', fetcher)).status, 200);
  assert.equal((await confirmWorkerTask('http://worker.test:9200', token, 'worker-task-1', ['output-1'], fetcher)).status, 'confirmed');
  assert.ok(seen.length >= 5);
  for (const request of seen) assert.equal(request.headers.get('authorization'), `Bearer ${token}`);
  assert.ok(seen.some((request) => request.url.endsWith('/v1/worker/tasks/worker-task-1/input/upload-1')));
  assert.ok(seen.some((request) => request.url.endsWith('/v1/worker/tasks/worker-task-1/output/output-1')));
  assert.ok(seen.some((request) => request.url.endsWith('/v1/worker/tasks/worker-task-1/confirm')));
  await assert.rejects(() => getWorkerTaskStatus('http://worker.test:9200', token, '../bad', fetcher), /Worker task ID 格式无效/);
});

test('Worker protocol client distinguishes HTTP rejection from network unavailability', async () => {
  const rejected: typeof fetch = async () => new Response(JSON.stringify({ message: 'worker rejected' }), { status: 503, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    () => submitWorkerTask({ baseUrl: 'http://worker.test:9200', token: 'worker-secret-that-is-long-enough-123456', taskId: 'worker-task-1', workflow: { '1': { class_type: 'SaveImage', inputs: {} } }, outputDeclarations: ['1'], fetcher: rejected }),
    (error: Error & { code?: string; status?: number }) => error.code === 'worker_request_failed' && error.status === 503,
  );

  const unavailable: typeof fetch = async () => { throw new Error('connection refused'); };
  await assert.rejects(
    () => submitWorkerTask({ baseUrl: 'http://worker.test:9200', token: 'worker-secret-that-is-long-enough-123456', taskId: 'worker-task-1', workflow: { '1': { class_type: 'SaveImage', inputs: {} } }, outputDeclarations: ['1'], fetcher: unavailable }),
    (error: Error & { code?: string }) => error.code === 'worker_unavailable',
  );
});
