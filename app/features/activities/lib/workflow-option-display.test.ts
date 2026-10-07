import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCanvasHint, resolutionClaim, workflowOptionLabel } from './workflow-option-display';

test('resolutionClaim only reads an explicit resolution token in the id', () => {
  assert.equal(resolutionClaim('anima-activity-1080p-eval'), '1080p');
  assert.equal(resolutionClaim('anima_activity_720p'), '720p');
  assert.equal(resolutionClaim('anima-activity-linshe-parity'), null);
  assert.equal(resolutionClaim('anima-activity-1080'), null);
  // 数字必须是独立分段，不能从别的数字里截出来。
  assert.equal(resolutionClaim('anima-activity-21080px'), null);
});

test('the option label always carries the real default canvas', () => {
  assert.equal(
    workflowOptionLabel({ workflowName: '旧工作流', workflowVersion: 4, engineName: '本机', defaultWidth: 768, defaultHeight: 512 }),
    '旧工作流 v4 · 本机 · 默认 768×512',
  );
  assert.equal(
    workflowOptionLabel({ workflowName: '未知尺寸', workflowVersion: 1, engineName: '本机' }),
    '未知尺寸 v1 · 本机',
  );
});

test('a resolution in the id that disagrees with the real default triggers the recommendation', () => {
  const hint = defaultCanvasHint({ workflowName: '旧工作流', workflowVersion: 4, engineName: '本机', defaultWidth: 768, defaultHeight: 512 }, 'anima-activity-1080p-eval');
  assert.match(hint ?? '', /真实默认画布为 768×512/);
  assert.match(hint ?? '', /1080p 只是历史命名/);
  assert.match(hint ?? '', /邻舍对齐/);
});

test('an id whose resolution matches the real default is stated without a recommendation', () => {
  const hint = defaultCanvasHint({ workflowName: '对齐', workflowVersion: 1, engineName: '本机', defaultWidth: 1920, defaultHeight: 1080 }, 'anima-activity-1080p-eval');
  assert.match(hint ?? '', /真实默认画布为 1920×1080/);
  assert.doesNotMatch(hint ?? '', /邻舍对齐/);
});

test('an id without a resolution claim is stated plainly', () => {
  const hint = defaultCanvasHint({ workflowName: '对齐', workflowVersion: 1, engineName: '本机', defaultWidth: 768, defaultHeight: 512 }, 'anima-activity-linshe-parity');
  assert.equal(hint, '该工作流版本真实默认画布为 768×512。');
});

test('a version with no declared canvas says so instead of guessing', () => {
  assert.equal(
    defaultCanvasHint({ workflowName: 'x', workflowVersion: 1, engineName: '本机' }, 'anima-activity-1080p-eval'),
    '该工作流版本没有声明默认画布尺寸，将沿用活动画风设置。',
  );
});
