import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppDescriptor } from '@sthstart/contracts';
import { readConfig } from './config.js';
import { createService } from './server.js';

const onlineApp: AppDescriptor = {
  id: 'linshe',
  name: '邻舍.EXE',
  description: 'test',
  launchUrl: 'http://127.0.0.1:5173',
  status: 'online',
  version: '3.0.3',
  sourceRevision: 'abc123',
  capabilities: ['chat'],
  checkedAt: '2026-08-24T00:00:00.000Z',
};

test('health and capabilities expose stable v1 contracts', async () => {
  const { app } = await createService({ inspectApp: async () => onlineApp });

  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().service, 'sthstart-service');

  const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
  assert.equal(capabilities.statusCode, 200);
  assert.deepEqual(capabilities.json().modules.map((item: { id: string }) => item.id), ['app-registry']);
  await app.close();
});

test('app registry returns the configured linshe descriptor', async () => {
  const { app } = await createService({ inspectApp: async () => onlineApp });
  const response = await app.inject({ method: 'GET', url: '/api/v1/apps/linshe' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), onlineApp);
  await app.close();
});

test('configuration rejects unsafe URL protocols', () => {
  assert.throws(() => readConfig({ LINSHE_APP_URL: 'file:///tmp/index.html' }), /http or https/);
});
