import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityLora } from '@sthstart/contracts';
import { appendLoraTriggerWords, mergeActivityLoras } from './activities/image-render-common.js';

/**
 * 计划 §16：复用全局 → 角色 → 目标覆盖，同名文件只注入一次；
 * 多个角色同名配置不同且目标未覆盖时阻止提交，
 * 禁止“最后一个角色配置赢”这种隐性策略。
 */

const lora = (model: string, strength = 1, triggerWord = '', enabled = true): ActivityLora =>
  ({ model, strength, triggerWord, enabled });

test('the same model file is injected exactly once across all three levels', () => {
  const merged = mergeActivityLoras(
    [lora('shared.safetensors', 0.8, 'shared-trigger')],
    [lora('shared.safetensors', 0.8, 'shared-trigger'), lora('actor.safetensors', 0.7, 'actor-trigger')],
    [{ model: 'shared.safetensors', strength: 0.9 }],
    { rejectActorConflicts: true },
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.model).sort(), ['actor.safetensors', 'shared.safetensors']);
});

test('the more specific level wins: shot over character over global', () => {
  const merged = mergeActivityLoras(
    [lora('a.safetensors', 0.5, 'global-trigger')],
    [lora('a.safetensors', 0.6, 'actor-trigger')],
    [{ model: 'a.safetensors', strength: 0.9, triggerWord: 'shot-trigger' }],
    { rejectActorConflicts: true },
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'shot');
  assert.equal(merged[0].strength, 0.9);
  assert.equal(merged[0].triggerWord, 'shot-trigger');
});

test('two characters configuring the same file differently stops the submission', () => {
  assert.throws(
    () => mergeActivityLoras([], [lora('a.safetensors', 0.6, 'one'), lora('a.safetensors', 0.9, 'two')], [], { rejectActorConflicts: true }),
    (error: Error & { code?: string; statusCode?: number }) =>
      error.code === 'comic_actor_lora_conflict' && error.statusCode === 409,
  );
  // 关闭该检查时不会抛错——确认冲突确实来自显式开关，而不是偶然的 Map 覆盖。
  const lenient = mergeActivityLoras([], [lora('a.safetensors', 0.6, 'one'), lora('a.safetensors', 0.9, 'two')], []);
  assert.equal(lenient.length, 1);
  assert.equal(lenient[0].strength, 0.9, '最后一个角色配置赢，正是必须被阻止的隐性策略');
});

test('an explicit shot override resolves the actor conflict instead of blocking', () => {
  const merged = mergeActivityLoras(
    [], [lora('a.safetensors', 0.6, 'one'), lora('a.safetensors', 0.9, 'two')],
    [{ model: 'a.safetensors', strength: 0.75 }],
    { rejectActorConflicts: true },
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'shot');
  assert.equal(merged[0].strength, 0.75);
});

test('identical character configuration is not a conflict', () => {
  const merged = mergeActivityLoras([], [lora('a.safetensors', 0.6, 'same'), lora('a.safetensors', 0.6, 'same')], [], { rejectActorConflicts: true });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'character');
});

test('trigger words are appended once and never duplicated into the prompt', () => {
  const loras = [lora('a.safetensors', 1, 'alpha'), lora('b.safetensors', 1, 'alpha'), lora('c.safetensors', 1, 'beta'), lora('d.safetensors', 1, 'beta', false)];
  const appended = appendLoraTriggerWords('a portrait', loras);
  assert.equal(appended, 'a portrait\nalpha, beta');
  // 提示词里已经有的触发词不再追加。
  assert.equal(appendLoraTriggerWords('alpha portrait', loras), 'alpha portrait\nbeta');
  // 关闭的 LoRA 不贡献触发词。
  assert.equal(appendLoraTriggerWords('a portrait', [lora('d.safetensors', 1, 'beta', false)]), 'a portrait');
});
