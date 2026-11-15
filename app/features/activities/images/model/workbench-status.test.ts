import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@/app/lib/api-client';
import { describeImageConfigCommitError, describeImageConfigSaveError, isImageConfigConflict } from './workbench-status';

test('draft conflicts are distinguished from other save failures', () => {
  const conflict = new ApiClientError('stale draft', { status: 409, code: 'draft_version_conflict' });
  const failure = new ApiClientError('offline', { status: 503 });
  assert.equal(isImageConfigConflict(conflict), true);
  assert.equal(isImageConfigConflict(failure), false);
  assert.match(describeImageConfigSaveError(conflict), /当前输入仍保留/);
  assert.match(describeImageConfigCommitError(conflict), /当前输入仍保留/);
  assert.match(describeImageConfigSaveError(failure), /offline/);
});
