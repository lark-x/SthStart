import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLaunchRequest } from './protocol-handler.mjs';

test('accepts a project launch request from a loopback Portal', () => {
  assert.deepEqual(parseLaunchRequest('sthstart-dsh://launch?projectId=72d80914-5759-4a0c-ba10-7c877beb44e9&portal=http%3A%2F%2F127.0.0.1%3A9320'), {
    projectId: '72d80914-5759-4a0c-ba10-7c877beb44e9',
    portalUrl: 'http://127.0.0.1:9320',
  });
});

test('rejects remote portals and malformed or ambiguous project input', () => {
  for (const uri of [
    'https://example.test/?projectId=project-123&portal=http%3A%2F%2F127.0.0.1%3A9320',
    'sthstart-dsh://launch?projectId=project-123&portal=https%3A%2F%2Fexample.test',
    'sthstart-dsh://launch?projectId=project-123&projectId=other-123&portal=http%3A%2F%2Flocalhost%3A9320',
    'sthstart-dsh://launch?projectId=project-123&portal=http%3A%2F%2Flocalhost%3A9320&token=secret',
    'sthstart-dsh://launch?projectId=bad%2Fid&portal=http%3A%2F%2Flocalhost%3A9320',
  ]) assert.throws(() => parseLaunchRequest(uri));
});
