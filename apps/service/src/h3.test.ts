import assert from 'node:assert/strict';
import test from 'node:test';
import { getH3Status } from './h3.js';

test('H3 FL2VA stays disabled and reports hard experimental limits by default', async () => {
  const status = await getH3Status(async () => { throw new Error('must not probe when disabled'); }, {});
  assert.equal(status.id, 'h3-fl2va');
  assert.equal(status.enabled, false);
  assert.equal(status.ready, false);
  assert.equal(status.reason, 'disabled');
  assert.deepEqual(status.constraints, { maxWidth: 854, maxHeight: 480, maxDurationSeconds: 4, concurrencyLimit: 1 });
});

test('H3 FL2VA only reports ready after a real configured worker confirms readiness', async () => {
  const calls: string[] = [];
  const authorization: Array<string | null> = [];
  const ready = await getH3Status(async (input, init) => {
    calls.push(String(input));
    authorization.push(new Headers(init?.headers).get('authorization'));
    return Response.json({ ready: true, capabilities: ['h3-fl2va'] });
  }, { STHSTART_H3_ENABLED: 'true', STHSTART_H3_WORKER_URL: 'http://h3-worker.test:9300' }, 'worker-secret');
  assert.equal(ready.ready, true);
  assert.equal(ready.available, true);
  assert.deepEqual(calls, ['http://h3-worker.test:9300/health']);
  assert.deepEqual(authorization, ['Bearer worker-secret']);

  const notReady = await getH3Status(async () => Response.json({ ready: true, capabilities: ['other'] }), { STHSTART_H3_ENABLED: 'true', STHSTART_H3_WORKER_URL: 'http://h3-worker.test:9300' });
  assert.equal(notReady.ready, false);
  assert.equal(notReady.reason, 'capability_missing');

  const missingCapability = await getH3Status(async () => Response.json({ ready: true }), { STHSTART_H3_ENABLED: 'true', STHSTART_H3_WORKER_URL: 'http://h3-worker.test:9300' });
  assert.equal(missingCapability.ready, false);
  assert.equal(missingCapability.reason, 'capability_missing');
});

test('H3 capabilities report correctly based on mode requirement', async () => {
  const readyT2v = await getH3Status(async () => Response.json({ ready: true, capabilities: ['h3-t2v'] }), { STHSTART_H3_ENABLED: 'true', STHSTART_H3_WORKER_URL: 'http://h3-worker.test:9300' }, 'secret', 'h3-t2v');
  assert.equal(readyT2v.ready, true, 't2v should be ready');

  const readyFl2va = await getH3Status(async () => Response.json({ ready: true, capabilities: ['h3-t2v'] }), { STHSTART_H3_ENABLED: 'true', STHSTART_H3_WORKER_URL: 'http://h3-worker.test:9300' }, 'secret', 'h3-fl2va');
  assert.equal(readyFl2va.ready, false, 'fl2va should not be ready if only t2v is supported');
});
