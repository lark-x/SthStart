import assert from 'node:assert/strict';
import test from 'node:test';
import { canSubmitHires, hiresBlockedReason, hiresIdempotencyKey } from './hires-request';

test('a missing source explains what to do instead of only disabling the button', () => {
  const reason = hiresBlockedReason({ hasSource: false, preview: null });
  assert.match(reason, /还没有可用的图片产物/);
  assert.equal(hiresBlockedReason({ hasSource: true, preview: null }), '');
});

test('server issues are shown verbatim, including the specific error text', () => {
  const reason = hiresBlockedReason({
    hasSource: true,
    preview: { canSubmit: false, issues: ['所选尺寸不大于原图，请换更大尺寸。', '原图文件不可用，记录仍保留。'] },
  });
  assert.match(reason, /不大于原图/);
  assert.match(reason, /原图文件不可用/);
});

test('an unexplained refusal never renders an empty reason', () => {
  const reason = hiresBlockedReason({ hasSource: true, preview: { canSubmit: false, issues: ['  '] } });
  assert.match(reason, /未说明具体原因/);
});

test('a preview failure reason wins over the generic text', () => {
  const reason = hiresBlockedReason({ hasSource: true, preview: null, failure: '无法安全复用原图参数，建议重新绘制。' });
  assert.equal(reason, '无法安全复用原图参数，建议重新绘制。');
});

test('submit is only allowed when the server says so', () => {
  assert.equal(canSubmitHires(null), false);
  assert.equal(canSubmitHires({ canSubmit: false, issues: [] }), false);
  assert.equal(canSubmitHires({ canSubmit: true, issues: [] }), true);
  assert.equal(hiresBlockedReason({ hasSource: true, preview: { canSubmit: true, issues: [] } }), '');
});

test('the idempotency key stays stable for one dialog session', () => {
  const key = hiresIdempotencyKey('artifact-1', () => 'fixed');
  assert.equal(key, 'hires-artifact-1-fixed');
  // 同一个随机值产生同一个键：重试沿用原键，不会新建任务。
  assert.equal(hiresIdempotencyKey('artifact-1', () => 'fixed'), key);
});

// ------------------- 第二轮修复（计划 §6.4／§8）：响应丢失重发保留幂等键
// 用例名统一带 `parity-round2:`，便于按计划 §8 的命令只跑本轮定向用例。
//
// 说明：计划 §8 还要求覆盖「预览后版本变化不提交」。
// 该行为**本轮故意未实现**（理由见第二轮交付记录 §4d.2：版本比较与响应丢失重发互相牵制，
// 误实现会强制新建第二个任务）。**因此这里不写它的用例**——
// 为未实现的行为写一条会通过的用例，等于把「没做」记成「已做」。

test('parity-round2: 同来源、同随机值的幂等键完全一致（响应丢失重发的前提）', () => {
  // 弹窗把键存在 ref 里，重发时不会重新生成；这里固定随机值验证函数本身是确定性的。
  const first = hiresIdempotencyKey('artifact-1', () => 'r-1');
  const resent = hiresIdempotencyKey('artifact-1', () => 'r-1');
  assert.equal(resent, first, '同一来源在同一会话内的重发必须沿用同一个键');
});

test('parity-round2: 更换来源图片必须得到不同的幂等键，不复用旧键', () => {
  // 幂等键包含来源标识：换了原图就是另一次请求，不能命中上一次的任务。
  const a = hiresIdempotencyKey('artifact-1', () => 'r-1');
  const b = hiresIdempotencyKey('artifact-2', () => 'r-1');
  assert.notEqual(a, b, '不同来源不得共享幂等键，否则会返回另一张图的任务');
  assert.match(b, /^hires-artifact-2-/, '键中应包含来源标识，便于排查');
});
