import assert from 'node:assert/strict';
import test from 'node:test';
import { getMediaDiagnostics, inspectMediaTool } from './media-diagnostics.js';

test('media diagnostics reports tool absence without exposing local paths', async () => {
  const missing = await inspectMediaTool('ffmpeg', async () => {
    const error = new Error('command not found') as Error & { code: string };
    error.code = 'ENOENT';
    throw error;
  });
  assert.deepEqual(missing, { available: false, version: null, error: 'not_found' });

  const diagnostics = await getMediaDiagnostics(
    async () => { throw new Error('H3 probe must stay disabled'); },
    {},
    async (command) => ({ stdout: `${command} version 7.0.0 test-build\n` }),
  );
  assert.equal(diagnostics.video.ffmpeg.available, true);
  assert.equal(diagnostics.video.ffprobe.version, '7.0.0');
  assert.equal(diagnostics.video.preprocessingReady, true);
  assert.equal(diagnostics.video.installHint, null);
  assert.equal(diagnostics.h3.reason, 'disabled');
});
