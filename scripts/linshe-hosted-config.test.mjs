import assert from 'node:assert/strict';
import test from 'node:test';
import { createLinsheHostedEnvironment, hostedReadinessFailure, normalizeServiceUrl } from './linshe-hosted-config.mjs';

test('project-managed Linshe always receives all hosted gateway flags', () => {
  assert.deepEqual(createLinsheHostedEnvironment('http://localhost:4100/', 'token-value'), {
    STHSTART_APP_TOKEN: 'token-value',
    STHSTART_SERVICE_URL: 'http://localhost:4100',
    STHSTART_PUBLIC_LLM: 'true',
    STHSTART_PUBLIC_VECTOR: 'true',
    STHSTART_PUBLIC_IMAGE: 'false',
    STHSTART_GENERATION_PURPOSE: 'linshe-chat-image',
  });
});

test('the SthStart image gateway is opt-in and never implied by the other gateways', () => {
  const off = createLinsheHostedEnvironment('http://localhost:4100', 'token-value');
  assert.equal(off.STHSTART_PUBLIC_IMAGE, 'false');
  assert.equal(off.STHSTART_GENERATION_PURPOSE, 'linshe-chat-image');
  const on = createLinsheHostedEnvironment('http://localhost:4100', 'token-value', { imageViaGateway: true });
  assert.equal(on.STHSTART_PUBLIC_IMAGE, 'true');
  assert.equal(on.STHSTART_PUBLIC_LLM, 'true');
  assert.equal(on.STHSTART_PUBLIC_VECTOR, 'true');
});
test('hosted Linshe startup rejects missing app credentials and invalid service protocols', () => {
  assert.throws(() => createLinsheHostedEnvironment('http://localhost:4100', ''), /missing_STHSTART_APP_TOKEN/);
  assert.throws(() => normalizeServiceUrl('file:///tmp/service'), /http or https/);
});

test('standalone startup displays actionable hosted readiness items', () => {
  assert.deepEqual(hostedReadinessFailure({ ready: false, missing: ['缺文本模型', '缺图片工作流'] }), ['缺文本模型', '缺图片工作流']);
  assert.deepEqual(hostedReadinessFailure({ ready: true, missing: [] }), []);
});
