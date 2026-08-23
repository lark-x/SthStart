import assert from 'node:assert/strict';
import test from 'node:test';
import {
  embedStateForStatus,
  embedStatusLabel,
  homeStatusHint,
  homeStatusLabel,
  shouldRenderLinshe,
} from './linshe-state';

test('home status copy distinguishes online, offline, and unknown states', () => {
  assert.equal(homeStatusLabel('online'), '邻舍已就绪');
  assert.equal(homeStatusLabel('offline'), '邻舍尚未启动');
  assert.equal(homeStatusLabel('unknown'), '正在连接本地服务');
  assert.equal(homeStatusHint('online'), '可在门户内完整使用');
  assert.equal(homeStatusHint('offline'), '启动后会自动连接');
});

test('embed state only renders automatically when Linshe is online', () => {
  assert.equal(embedStateForStatus('online'), 'ready');
  assert.equal(embedStateForStatus('offline'), 'offline');
  assert.equal(embedStateForStatus('unknown'), 'unknown');
  assert.equal(shouldRenderLinshe('ready', false), true);
  assert.equal(shouldRenderLinshe('offline', false), false);
  assert.equal(shouldRenderLinshe('offline', true), true);
  assert.equal(embedStatusLabel('loading'), '连接中');
});
