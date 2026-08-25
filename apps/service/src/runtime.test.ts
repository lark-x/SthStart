import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase } from './database.js';
import { RuntimeLogService, RuntimeSettingsStore } from './runtime.js';
import { readConfig } from './config.js';
import { createService } from './server.js';

test('runtime settings persist with bounded normalization', () => {
  const database = new ServiceDatabase(':memory:');
  const settings = new RuntimeSettingsStore(database);
  const updated = settings.update({ autoStart: true, extraLoraFolders: ['  /models/a  ', '', '/models/b'] });
  assert.equal(updated.autoStart, true);
  assert.deepEqual(settings.get().extraLoraFolders, ['/models/a', '/models/b']);
  database.close();
});

test('log policy filters levels, supports overrides, and redacts credentials', () => {
  const database = new ServiceDatabase(':memory:');
  const logs = new RuntimeLogService(database, '.', false);
  logs.setPolicy({ globalLevel: 'warn', serviceLevels: { noisy: 'off', debugged: 'debug' } });
  assert.equal(logs.append({ appId: 'test', serviceId: 'normal', stream: 'stdout', level: 'info', message: 'hidden' }), null);
  assert.equal(logs.append({ appId: 'test', serviceId: 'noisy', stream: 'stderr', level: 'error', message: 'hidden too' }), null);
  logs.append({ appId: 'test', serviceId: 'normal', stream: 'stderr', level: 'error', message: 'authorization: Bearer-secret-value' });
  logs.append({ appId: 'test', serviceId: 'debugged', stream: 'stdout', level: 'debug', message: 'details' });
  const items = logs.list();
  assert.equal(items.length, 2);
  assert.match(items[0].message, /REDACTED/);
  assert.equal(items[1].level, 'debug');
  database.close();
});

test('sensitive payloads are omitted unless the temporary switch is active', () => {
  const database = new ServiceDatabase(':memory:');
  const logs = new RuntimeLogService(database, '.', false);
  logs.append({ appId: 'test', serviceId: 'agent', stream: 'app', message: 'private story', sensitive: true });
  assert.equal(logs.list()[0].message, '[敏感正文已省略]');
  logs.setPolicy({ sensitiveUntil: new Date(Date.now() + 60_000).toISOString() });
  logs.append({ appId: 'test', serviceId: 'agent', stream: 'app', message: 'private story', sensitive: true });
  assert.equal(logs.list()[1].message, 'private story');
  database.close();
});

test('runtime admin API controls policy and app log ingestion is isolated by capability', async () => {
  const database = new ServiceDatabase(':memory:');
  const token = 'admin-runtime-test-token-12345678901234567890';
  const config = readConfig({ STHSTART_ADMIN_TOKEN: token, PROBE_TIMEOUT_MS: '100' });
  const { app } = await createService({ config, database });
  const adminHeaders = { 'x-sthstart-admin-token': token };
  const overview = await app.inject({ method: 'GET', url: '/api/v1/admin/runtime/overview', headers: adminHeaders });
  assert.equal(overview.statusCode, 200);
  assert.equal(Array.isArray(overview.json().services), true);
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/apps', headers: adminHeaders, payload: { id: 'logger-app', name: 'Logger', capabilities: ['logs'] } });
  const appToken = created.json().token as string;
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/logs', headers: { authorization: `Bearer ${appToken}` }, payload: { message: 'token=do-not-keep', serviceId: 'worker', level: 'warn' } });
  assert.equal(accepted.statusCode, 202);
  const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/logs', headers: adminHeaders });
  assert.match(listed.json().items[0].message, /REDACTED/);
  await app.close(); database.close();
});

test('high-volume logs keep a fixed in-memory tail', () => {
  const database = new ServiceDatabase(':memory:');
  const logs = new RuntimeLogService(database, '.', false);
  for (let index = 0; index < 20_000; index++) logs.append({ appId: 'load', serviceId: 'worker', stream: 'stdout', message: `line ${index}` });
  const items = logs.list({ limit: 2_000 });
  assert.equal(items.length, 2_000);
  assert.equal(items[0].message, 'line 18000');
  assert.equal(items[1_999].message, 'line 19999');
  database.close();
});
