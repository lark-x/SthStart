import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { ServiceConfig } from '../config.js';
import { registerStoryWorldRunRecoveryRoutes } from './run-recovery-routes.js';

test('recovery routes require admin auth, preserve fields and reject malformed evidence', async () => {
  const app = Fastify(); let resolved = 0;
  const path = '/api/v1/admin/story-worlds/w/branches/b/runs/r/recovery';
  const headers = { 'x-sthstart-admin-token': 'isolated-recovery-test' };
  registerStoryWorldRunRecoveryRoutes(app, { adminToken: headers['x-sthstart-admin-token'] } as ServiceConfig, {
    recovery: () => ({ items: [{ id: 'c', stepId: 's', stage: 'action:a', purpose: 'action', attempt: 0, status: 'uncertain', requestedAt: 'now', updatedAt: 'now', error: '结果不明', aiCallId: null }] }),
    resolveCall: (worldId, branchId, runId, callId, body) => {
      assert.deepEqual([worldId, branchId, runId, callId], ['w', 'b', 'r', 'c']); assert.equal(body.evidence, '供应商确认未执行'); resolved++;
      return { callId, status: 'confirmed-not-executed', validation: 'not-applicable', branchRevision: 2 };
    },
  });
  try {
    assert.equal((await app.inject({ url: path })).statusCode, 401);
    const listing = await app.inject({ url: path, headers }); assert.equal(listing.statusCode, 200); assert.equal(listing.json().items[0].stage, 'action:a');
    assert.equal((await app.inject({ method: 'POST', url: path + '/c', payload: { expectedRevision: 1, resolution: 'not-executed', evidence: '供应商确认未执行' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: path + '/c', headers, payload: { expectedRevision: 1, resolution: 'not-executed', evidence: '' } })).statusCode, 400);
    const result = await app.inject({ method: 'POST', url: path + '/c', headers, payload: { expectedRevision: 1, resolution: 'not-executed', evidence: '供应商确认未执行' } });
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().branchRevision, 2); assert.equal(resolved, 1);
  } finally { await app.close(); }
});
