import assert from 'node:assert/strict';
import test from 'node:test';
import { watchComfyProgress, type ProgressSocket } from './comfy-progress.js';
import type { GenerationProgress } from '@sthstart/contracts';

test('progress filters task identity, malformed and duplicate events; completion waits for history', () => {
  const listeners = new Map<string, (event: { data?: unknown }) => void>();
  let closed = false, active = true;
  const socket: ProgressSocket = { addEventListener(name, listener) { listeners.set(name, listener); }, close() { closed = true; } };
  const received: GenerationProgress[] = [];
  const stop = watchComfyProgress({ baseUrl: 'https://comfy.test', clientId: 'task', promptId: 'prompt', headers: { authorization: 'Bearer test' },
    active: () => active, onProgress: progress => received.push(progress), connect(url, headers) {
      assert.equal(url, 'wss://comfy.test/ws?clientId=task'); assert.equal(headers?.authorization, 'Bearer test'); return socket;
    } });
  const send = (type: string, data: Record<string, unknown>) => listeners.get('message')!({ data: JSON.stringify({ type, data }) });
  listeners.get('message')!({ data: 'invalid' });
  send('progress', { value: 1, max: 20 });
  send('execution_start', { prompt_id: 'other' });
  assert.equal(received.length, 0);
  send('execution_start', { prompt_id: 'prompt' });
  send('progress', { prompt_id: 'prompt', value: 5, max: 20 });
  send('progress', { prompt_id: 'prompt', value: 5, max: 20 });
  assert.equal(received.length, 2); assert.equal(received[1].value, 0.25);
  send('execution_success', { prompt_id: 'prompt' });
  assert.equal(received.at(-1)?.stage, 'collecting'); assert.equal(received.at(-1)?.value, null);
  send('execution_start', { prompt_id: 'other' });
  send('progress', { value: 3, max: 10 });
  assert.equal(received.length, 3);
  active = false; send('progress', { prompt_id: 'prompt', value: 20, max: 20 });
  assert.equal(received.length, 3); stop(); assert.equal(closed, true);
});
