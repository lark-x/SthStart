import assert from 'node:assert/strict';
import test from 'node:test';
import { requestModelUnload, type EngineTarget } from './comfy-discovery.js';

const target: EngineTarget = {
  id: 'local-comfy',
  kind: 'comfyui',
  baseUrl: 'http://comfy.test:8188///',
  credentialAccount: 'comfy-secret',
};

test('model unload requests ComfyUI to unload models and clear its memory cache', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  await requestModelUnload(target, 'secret-value', async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(null, { status: 200 });
  });

  assert.equal(requestUrl, 'http://comfy.test:8188/free');
  assert.equal(requestInit?.method, 'POST');
  assert.equal(new Headers(requestInit?.headers).get('authorization'), 'Bearer secret-value');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { unload_models: true, free_memory: true });
});

test('model unload rejects unsupported engines and reports upstream failures', async () => {
  await assert.rejects(
    requestModelUnload({ ...target, kind: 'worker' }, null, async () => new Response(null, { status: 200 })),
    (error: Error & { code?: string }) => error.code === 'engine_operation_unsupported',
  );

  await assert.rejects(
    requestModelUnload(target, null, async () => new Response(null, { status: 503 })),
    (error: Error & { code?: string }) => error.code === 'upstream_rejected' && /HTTP 503/.test(error.message),
  );
});

test('model unload falls back to the newer API route only when the legacy route is missing', async () => {
  const requestedUrls: string[] = [];
  await requestModelUnload(target, null, async (input) => {
    requestedUrls.push(String(input));
    return new Response(null, { status: requestedUrls.length === 1 ? 404 : 200 });
  });

  assert.deepEqual(requestedUrls, ['http://comfy.test:8188/free', 'http://comfy.test:8188/api/free']);
});

test('model unload does not retry a real upstream failure on another route', async () => {
  const requestedUrls: string[] = [];
  await assert.rejects(
    requestModelUnload(target, null, async (input) => {
      requestedUrls.push(String(input));
      return new Response(null, { status: 500 });
    }),
    (error: Error & { code?: string }) => error.code === 'upstream_rejected',
  );
  assert.deepEqual(requestedUrls, ['http://comfy.test:8188/free']);
});
