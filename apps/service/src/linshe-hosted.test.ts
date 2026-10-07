import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { ServiceDatabase } from './database.js';
import { issueToken } from './security.js';
import { RuntimeSettingsStore } from './runtime.js';

test('hosted readiness requires the Linshe identity and reports missing bindings without secrets', async () => {
  const token = issueToken('linshe-hosted-test');
  const previousToken = process.env.STHSTART_APP_TOKEN;
  process.env.STHSTART_APP_TOKEN = token;
  const database = new ServiceDatabase(':memory:');
  const { app } = await createService({
    config: readConfig({ STHSTART_VECTOR_URL: 'https://vector.example.invalid' }),
    database,
  });
  if (previousToken === undefined) delete process.env.STHSTART_APP_TOKEN;
  else process.env.STHSTART_APP_TOKEN = previousToken;

  try {
    // Enabling the image gateway makes the missing linshe-chat-image binding an
    // actionable item again; with the default (off) the check is dormant.
    new RuntimeSettingsStore(database).update({ linsheImageViaGateway: true });
    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/app/hosted-readiness' });
    assert.equal(unauthorized.statusCode, 401);
    const readiness = await app.inject({
      method: 'GET', url: '/api/v1/app/hosted-readiness',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(readiness.statusCode, 200);
    assert.equal(readiness.json().appTokenValid, true);
    assert.equal(readiness.json().ready, false);
    assert.equal(readiness.json().vectorMode, 'default');
    assert.ok(readiness.json().missing.some((item: string) => item.includes('文本模型')));
    assert.ok(readiness.json().missing.some((item: string) => item.includes('linshe-chat-image')));
    assert.equal(JSON.stringify(readiness.json()).includes(token), false);
  } finally {
    await app.close(); database.close();
  }
});

test('hosted readiness ignores the image binding while Linshe uses its own ComfyUI', async () => {
  const token = issueToken('linshe-hosted-image-off');
  const previousToken = process.env.STHSTART_APP_TOKEN;
  process.env.STHSTART_APP_TOKEN = token;
  const database = new ServiceDatabase(':memory:');
  const { app } = await createService({
    config: readConfig({ STHSTART_VECTOR_URL: 'https://vector.example.invalid' }),
    database,
  });
  if (previousToken === undefined) delete process.env.STHSTART_APP_TOKEN;
  else process.env.STHSTART_APP_TOKEN = previousToken;

  try {
    // The image gateway defaults to off, so the binding is not required.
    assert.equal(new RuntimeSettingsStore(database).get().linsheImageViaGateway, false);
    const readiness = await app.inject({
      method: 'GET', url: '/api/v1/app/hosted-readiness',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(readiness.statusCode, 200);
    const body = readiness.json();
    assert.equal(body.imageReady, true);
    assert.equal(body.imageWorkflowId, null);
    assert.equal(body.imageWorkflowVersion, null);
    assert.equal(body.missing.some((item: string) => item.includes('linshe-chat-image')), false);
  } finally {
    await app.close(); database.close();
  }
});
