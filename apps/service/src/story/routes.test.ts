import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../server.js';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';

const token = 'story-test-admin-token-1234567890';
const headers = { 'x-sthstart-admin-token': token };
test('story routes enforce auth, CAS, session separation and proposal review', async () => {
  const database = new ServiceDatabase(':memory:');
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: token }), database, secrets: new SecretStore({}) });
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/story/projects' })).statusCode, 401);
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/story/projects', headers, payload: { title: '雾港' } });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id as string;
    const root = `/api/v1/admin/story/projects/${id}`;
    const outline = (await app.inject({ method: 'GET', url: `${root}/documents`, headers })).json().items[0];
    const updated = await app.inject({ method: 'PUT', url: `${root}/documents/${outline.id}`, headers,
      payload: { expectedRevision: 1, title: '主线', body: '港口失踪案' } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal((await app.inject({ method: 'PUT', url: `${root}/documents/${outline.id}`, headers,
      payload: { expectedRevision: 1, title: '冲突', body: '' } })).statusCode, 409);
    const s1 = (await app.inject({ method: 'POST', url: `${root}/sessions`, headers, payload: { title: '世界观讨论' } })).json();
    const s2 = (await app.inject({ method: 'POST', url: `${root}/sessions`, headers, payload: { title: '第一幕讨论' } })).json();
    assert.notEqual(s1.runtimeSessionId, s2.runtimeSessionId);
    const proposal = await app.inject({ method: 'POST', url: `${root}/proposals`, headers, payload: {
      sessionId: s1.id, kind: 'outline', targetId: outline.id, baseRevision: 2,
      proposedTitle: '主线', proposedBody: '更明确的失踪案', reason: '主角动机更清楚',
    } });
    assert.equal(proposal.statusCode, 201, proposal.body);
    assert.equal((await app.inject({ method: 'GET', url: `${root}/documents`, headers })).json().items[0].body, '港口失踪案');
    const accepted = await app.inject({ method: 'POST', url: `${root}/proposals/${proposal.json().id}/decision`, headers, payload: { decision: 'accepted' } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal((await app.inject({ method: 'GET', url: `${root}/documents`, headers })).json().items[0].body, '更明确的失踪案');
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/internal/story/projects/${id}/snapshot` })).statusCode, 401);
  } finally { await app.close(); database.close(); }
});

test('native DSH bridge is project-scoped, proposal-only, revocable, and never accepts the admin token', async () => {
  const database = new ServiceDatabase(':memory:');
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: token }), database, secrets: new SecretStore({}) });
  try {
    const create = async (title: string) => (await app.inject({ method: 'POST', url: '/api/v1/admin/story/projects', headers, payload: { title } })).json() as { id: string };
    const first = await create('橋接甲'); const second = await create('橋接乙');
    const root = (id: string) => `/api/v1/admin/story/projects/${id}`;
    const grantA = await app.inject({ method: 'POST', url: `${root(first.id)}/bridge-grant`, headers, payload: {} });
    const grantB = await app.inject({ method: 'POST', url: `${root(second.id)}/bridge-grant`, headers, payload: {} });
    assert.equal(grantA.statusCode, 201, grantA.body);
    const tokenA = grantA.json().token as string; const tokenB = grantB.json().token as string;
    const bridge = (id: string) => `/api/v1/story-bridge/projects/${id}`;
    assert.equal((await app.inject({ method: 'POST', url: `${bridge(second.id)}/heartbeat`, headers: { authorization: `Bearer ${tokenB}` }, payload: { instanceId: 'story-test-instance-b', port: 3081 } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `${bridge(first.id)}/entries`, headers })).statusCode, 401, 'admin token is not a bridge credential');
    assert.equal((await app.inject({ method: 'GET', url: `${bridge(first.id)}/entries`, headers: { authorization: `Bearer ${tokenA}` } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `${bridge(second.id)}/entries`, headers: { authorization: `Bearer ${tokenA}` } })).statusCode, 401, 'project A token cannot cross into project B');
    assert.equal((await app.inject({ method: 'GET', url: `${root(second.id)}/bridge-status`, headers })).json().running, true, 'unauthorized requests do not falsify another project’s heartbeat');
    const outline = (await app.inject({ method: 'GET', url: `${root(first.id)}/documents`, headers })).json().items[0] as { id: string; revision: number; body: string };
    const proposal = await app.inject({ method: 'POST', url: `${bridge(first.id)}/proposals`, headers: { authorization: `Bearer ${tokenA}` }, payload: {
      operation: 'update', kind: 'outline', targetId: outline.id, baseRevision: outline.revision,
      proposedTitle: '提案标题', proposedBody: '桥接只能提交提案', reason: '人工确认后才写入。',
    } });
    assert.equal(proposal.statusCode, 201, proposal.body);
    assert.equal((await app.inject({ method: 'GET', url: `${root(first.id)}/documents`, headers })).json().items[0].body, outline.body, 'submitting a bridge proposal does not change canon');
    const proposalId = proposal.json().proposal.id as string;
    assert.equal((await app.inject({ method: 'GET', url: `${bridge(first.id)}/proposals/${proposalId}`, headers: { authorization: `Bearer ${tokenB}` } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: `${bridge(first.id)}/documents`, headers: { authorization: `Bearer ${tokenA}` }, payload: {} })).statusCode, 404, 'bridge does not expose direct formal write routes');
    const status = await app.inject({ method: 'GET', url: `${root(first.id)}/bridge-status`, headers });
    assert.equal(status.json().paired, true);
    assert.equal('token' in status.json(), false, 'status never returns a credential');
    await app.inject({ method: 'POST', url: `${bridge(first.id)}/heartbeat`, headers: { authorization: `Bearer ${tokenA}` }, payload: { instanceId: 'story-test-instance-a', port: 3081 } });
    const rotated = await app.inject({ method: 'POST', url: `${root(first.id)}/bridge-grant`, headers, payload: {} });
    assert.notEqual(rotated.json().token, tokenA);
    assert.equal((await app.inject({ method: 'GET', url: `${root(first.id)}/bridge-status`, headers })).json().running, false, 'rotating credentials immediately marks the old DSH instance offline');
    assert.equal((await app.inject({ method: 'GET', url: `${bridge(first.id)}/entries`, headers: { authorization: `Bearer ${tokenA}` } })).statusCode, 401);
    const tokenNew = rotated.json().token as string;
    assert.equal((await app.inject({ method: 'GET', url: `${bridge(first.id)}/entries`, headers: { authorization: `Bearer ${tokenNew}` } })).statusCode, 200);
    await app.inject({ method: 'DELETE', url: `${root(first.id)}/bridge-grant`, headers });
    assert.equal((await app.inject({ method: 'GET', url: `${root(first.id)}/bridge-status`, headers })).json().paired, false);
    assert.equal((await app.inject({ method: 'POST', url: `${bridge(first.id)}/heartbeat`, headers: { authorization: `Bearer ${tokenNew}` }, payload: { instanceId: 'story-test-instance', port: 3081 } })).statusCode, 401);
  } finally { await app.close(); database.close(); }
});
