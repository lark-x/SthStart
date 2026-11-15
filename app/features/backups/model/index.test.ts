import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClientError } from '@/app/lib/api-client';
import {
  describeError,
  formatBytes,
  formatTime,
  RUN_STATE_LABEL,
  TARGET_STATE_LABEL,
} from './index';

test('describeError maps known ApiClientError codes to friendly guidance', () => {
  const maintenanceError = new ApiClientError('Maintenance', {
    status: 503,
    code: 'backup_maintenance',
  });
  assert.equal(
    describeError(maintenanceError),
    '正在创建备份快照，请稍后重试；草稿会保留在本地。',
  );

  const busyError = new ApiClientError('Busy', {
    status: 409,
    code: 'backup_busy',
  });
  assert.equal(
    describeError(busyError),
    '已有备份正在执行，请稍后再试。',
  );

  const lockedError = new ApiClientError('Locked', {
    status: 423,
    code: 'backup_locked',
  });
  assert.equal(
    describeError(lockedError),
    '仓库已锁定，请先解锁。',
  );

  const unauthorizedError = new ApiClientError('Unauthorized', {
    status: 401,
    code: 'unauthorized',
  });
  assert.equal(
    describeError(unauthorizedError),
    '管理会话已失效，请刷新页面后重试。',
  );
});

test('describeError handles unknown ApiClientError, generic Error, and unknown non-Error types', () => {
  const genericApiError = new ApiClientError('后端存储服务超时', {
    status: 504,
    code: 'gateway_timeout',
  });
  assert.equal(describeError(genericApiError), '后端存储服务超时');

  const standardError = new Error('网络连接中断');
  assert.equal(describeError(standardError), '网络连接中断');

  assert.equal(describeError('未知字符串错误'), '未知字符串错误');
  assert.equal(describeError(null), 'null');
  assert.equal(describeError(undefined), 'undefined');
  assert.equal(describeError(500), '500');
});

test('formatBytes handles zero, empty, negative, and non-finite boundary values', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(null), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
  assert.equal(formatBytes(-100), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '0 B');
});

test('formatBytes formats units and decimal precision boundaries', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(10240), '10 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(10485760), '10 MB');
  assert.equal(formatBytes(1073741824), '1.0 GB');
  assert.equal(formatBytes(1099511627776), '1.0 TB');
  assert.equal(formatBytes(10995116277760), '10 TB');
  assert.equal(formatBytes(21990232555520), '20 TB');
});

test('formatTime handles empty, invalid, and valid date values', () => {
  assert.equal(formatTime(null), '—');
  assert.equal(formatTime(undefined), '—');
  assert.equal(formatTime(''), '—');
  assert.equal(formatTime('not-a-valid-date'), '—');

  const iso = '2026-11-10T12:30:00.000Z';
  const expected = new Date(iso).toLocaleString('zh-CN', { hour12: false });
  assert.equal(formatTime(iso), expected);
});

test('RUN_STATE_LABEL and TARGET_STATE_LABEL contain required status definitions', () => {
  assert.equal(RUN_STATE_LABEL.succeeded, '已完成');
  assert.equal(RUN_STATE_LABEL.failed, '失败');
  assert.equal(RUN_STATE_LABEL.running, '进行中');
  assert.equal(RUN_STATE_LABEL.queued, '等待中');

  assert.equal(TARGET_STATE_LABEL.succeeded, '已完成');
  assert.equal(TARGET_STATE_LABEL.failed, '需要处理');
  assert.equal(TARGET_STATE_LABEL.uploading, '上传中');
  assert.equal(TARGET_STATE_LABEL.verifying, '校验中');
});
