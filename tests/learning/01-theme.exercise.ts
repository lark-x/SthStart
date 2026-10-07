import assert from 'node:assert/strict';
import test from 'node:test';
import { readThemeMode } from '../../app/lib/theme-preference';

// 手动运行：node --import tsx/esm --test tests/learning/01-theme.exercise.ts
// 本文件故意失败，不会被正式入口收集。完成后与同名 answer 文件比较。
test('练习：无偏好、合法新偏好、无效新偏好与旧偏好', () => {
  const storage = new Map<string, string>();
  const read = () => readThemeMode(key => storage.get(key) ?? null);
  assert.equal(read(), 'warm');
  // TODO：添加至少三组输入；覆盖新偏好优先、旧值 false、未知值。
  assert.fail('请补全三个行为断言，再删除这一行。');
});
