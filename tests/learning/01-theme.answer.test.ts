import assert from 'node:assert/strict';
import test from 'node:test';
import { readThemeMode } from '../../app/lib/theme-preference';

test('参考答案：未知新值回退到旧偏好；合法新值优先', () => {
  // Arrange：提供可控制的存储依赖，而不是使用真实浏览器存储。
  const storage = new Map([['sthstart_theme', 'invalid'], ['sthstart_eye_care_mode', 'false']]);
  // Act：执行一个行为。
  const result = readThemeMode(key => storage.get(key) ?? null);
  // Assert：检查用户最终看到的模式。
  assert.equal(result, 'neutral');
  storage.set('sthstart_theme', 'warm');
  assert.equal(readThemeMode(key => storage.get(key) ?? null), 'warm');
  assert.equal(readThemeMode(() => null), 'warm');
});
