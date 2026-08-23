import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from './config.js';
import { inspectLinshe } from './registry.js';

const config = readConfig({
  LINSHE_APP_URL: 'http://127.0.0.1:5173',
  LINSHE_HEALTH_URL: 'http://127.0.0.1:3099/api/health',
  LINSHE_VERSION: '3.0.3',
  LINSHE_SOURCE_REVISION: 'db47daf',
  PROBE_TIMEOUT_MS: '100',
});

test('registry reports an online app and reads a compatible version field', async () => {
  const fetcher: typeof fetch = async () => Response.json({ app_version: '3.0.3' });
  const app = await inspectLinshe(config, fetcher);

  assert.equal(app.status, 'online');
  assert.equal(app.version, '3.0.3');
  assert.equal(app.sourceRevision, 'db47daf');
});

test('registry normalizes connection failures to offline', async () => {
  const fetcher: typeof fetch = async () => { throw new Error('connection refused'); };
  const app = await inspectLinshe(config, fetcher);

  assert.equal(app.status, 'offline');
  assert.equal(app.version, '3.0.3');
});
