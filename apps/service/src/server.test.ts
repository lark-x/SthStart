import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppDescriptor } from '@sthstart/contracts';
import { readConfig } from './config.js';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';

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
  const database = new ServiceDatabase();
  const { app } = await createService({ inspectApp: async () => onlineApp, database });

  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().service, 'sthstart-service');

  const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
  assert.equal(capabilities.statusCode, 200);
  assert.deepEqual(capabilities.json().modules.map((item: { id: string }) => item.id), [
    'app-registry', 'llm-gateway', 'vector-service', 'image-service', 'persona-catalog', 'creative-notebook', 'narrative-archive', 'runtime-manager', 'artifact-service', 'generation-core',
  ]);
  await app.close(); database.close();
});

test('app registry returns the configured linshe descriptor', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ inspectApp: async () => onlineApp, database });
  const response = await app.inject({ method: 'GET', url: '/api/v1/apps/linshe' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), onlineApp);
  await app.close(); database.close();
});

test('configuration rejects unsafe URL protocols', () => {
  assert.throws(() => readConfig({ LINSHE_APP_URL: 'file:///tmp/index.html' }), /http or https/);
  assert.throws(() => readConfig({ SERVICE_HOST: '0.0.0.0' }), /loopback/);
});

test('relative storage paths resolve from the project root', () => {
  const config = readConfig({ STHSTART_DATABASE_PATH: './data/test.db' });
  assert.match(config.databasePath, /[\\/]SthStart[\\/]data[\\/]test\.db$/);
});

test('validation errors carry the same request id in header and JSON envelope', async () => {
  const database = new ServiceDatabase();
  const token = 'admin-request-id-token-12345678901234567890';
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: token }), database });
  const response = await app.inject({
    method: 'PUT', url: '/api/v1/admin/runtime/settings',
    headers: { 'x-sthstart-admin-token': token, 'x-request-id': 'request-test-1234' },
    payload: { autoStart: 'yes' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.headers['x-request-id'], 'request-test-1234');
  assert.equal(response.json().requestId, 'request-test-1234');
  await app.close(); database.close();
});
