import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ipAllowed, readSettings, validateWorkflow, WindowsWorker } from './worker-core.mjs';

test('Windows Worker validates token, IP policy, and API workflow format', () => {
  assert.throws(() => readSettings({ WORKER_TOKEN: 'short' }), /WORKER_TOKEN/);
  assert.equal(ipAllowed('192.168.1.42', ['192.168.1.0/24']), true);
  assert.equal(ipAllowed('192.168.2.42', ['192.168.1.0/24']), false);
  assert.equal(ipAllowed('127.0.0.1', []), true);
  assert.doesNotThrow(() => validateWorkflow({ '1': { class_type: 'SaveImage', inputs: {} } }));
  assert.throws(() => validateWorkflow({ nodes: [] }), /API 格式/);
});

test('Windows Worker keeps model files separate and enforces the aggregate temporary space cap', async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'sthstart-worker-cap-'));
  const modelDir = resolve(dataDir, 'mounted-models');
  const maxTempBytes = 12 * 1024 * 1024;
  await writeFile(resolve(dataDir, 'existing.tmp'), Buffer.alloc(maxTempBytes));
  const settings = readSettings({
    WORKER_TOKEN: 'worker-token-that-is-longer-than-32-characters',
    WORKER_DATA_DIR: dataDir,
    WORKER_MODEL_DIR: modelDir,
    WORKER_MAX_TEMP_BYTES: String(maxTempBytes),
    WORKER_DISK_WARNING_BYTES: '2',
    WORKER_DISK_STOP_BYTES: '1',
  });
  assert.equal(settings.modelDir, modelDir);
  assert.equal(settings.maxTempBytes, maxTempBytes);
  const worker = new WindowsWorker(settings);
  await worker.init();
  await assert.rejects(
    () => worker.uploadInput('worker-cap-task', 'upload-1', Buffer.from('input'), { filename: 'input.png', contentType: 'image/png', sha256: '' }),
    (error) => error?.code === 'worker_temp_space_exceeded' && error?.status === 507,
  );
});

test('Windows Worker persists inputs, bridges one ComfyUI task, and deletes files only after confirmation', async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'sthstart-worker-'));
  const settings = readSettings({
    WORKER_TOKEN: 'worker-token-that-is-longer-than-32-characters',
    WORKER_DATA_DIR: dataDir,
    COMFYUI_URL: 'http://comfy.test:8188',
    WORKER_DISK_WARNING_BYTES: '1000',
    WORKER_DISK_STOP_BYTES: '100',
  });
  const worker = new WindowsWorker(settings);
  await worker.init();

  const originalFetch = globalThis.fetch;
  let promptCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/upload/image')) return Response.json({ name: 'upload-1.png' });
    if (url.endsWith('/prompt')) {
      promptCalls++;
      assert.equal(init?.method, 'POST');
      return Response.json({ prompt_id: 'comfy-worker-task' });
    }
    if (url.endsWith('/history/comfy-worker-task')) {
      return Response.json({ 'comfy-worker-task': { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'result.png', type: 'output' }] } } } });
    }
    if (url.includes('/view?')) return new Response(Buffer.from('worker-result'), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '13' } });
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    throw new Error(`unexpected URL: ${url}`);
  };

  try {
    const input = Buffer.from('input-image');
    const uploaded = await worker.uploadInput('worker-task-1', 'upload-1', input, {
      filename: 'original.png',
      contentType: 'image/png',
      sha256: '',
    });
    assert.equal(uploaded.fileName, 'upload-1.png');
    const queued = await worker.submitTask({
      taskId: 'worker-task-1',
      workflow: { '1': { class_type: 'SaveImage', inputs: { filename: 'upload-1.png' } }, '9': { class_type: 'SaveImage', inputs: {} } },
      outputDeclarations: ['9'],
    });
    assert.equal(queued.status, 'queued');

    let status;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      status = await worker.status('worker-task-1');
      if (status.status === 'succeeded') break;
    }
    assert.equal(promptCalls, 1);
    assert.equal(status.status, 'succeeded');
    assert.equal(status.outputs.length, 1);
    const output = await worker.getOutput('worker-task-1', status.outputs[0].outputId);
    assert.equal((await readFile(output.path)).toString(), 'worker-result');
    const confirmed = await worker.confirmTask('worker-task-1', [status.outputs[0].outputId]);
    assert.equal(confirmed.status, 'confirmed');
    await assert.rejects(() => readFile(output.path));
    assert.equal((await worker.status('worker-task-1')).status, 'confirmed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
