import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_CALL_DETAIL_SECTIONS, BUSINESS_EVENT_LABELS, businessEventLabel, businessEventTitle, traceGroupTitle } from './business-event-label';

test('the hires business event has a Chinese name (plan section 14)', () => {
  assert.equal(businessEventLabel('activity.image.hires'), '图片放大细化');
  assert.equal(BUSINESS_EVENT_LABELS['activity.image.hires'], '图片放大细化');
});

test('every known activity image event is covered', () => {
  for (const event of ['activity.beat.render', 'activity.comic.panel.render', 'activity.image.prompt.optimize', 'activity.image.hires']) {
    assert.notEqual(businessEventLabel(event), event, `${event} 缺少中文名称`);
  }
});

test('an unknown event falls back to its raw id instead of an empty label', () => {
  assert.equal(businessEventLabel('activity.something.new'), 'activity.something.new');
  assert.equal(businessEventLabel(null), '未命名调用');
  assert.equal(businessEventLabel('  '), '未命名调用');
});

test('the title keeps the raw id so it stays searchable', () => {
  assert.equal(businessEventTitle('activity.image.hires'), '图片放大细化 · activity.image.hires');
  // 未收录的事件不重复显示同一个字符串。
  assert.equal(businessEventTitle('activity.unknown'), 'activity.unknown');
});

test('the detail page groups match the plan order exactly', () => {
  assert.deepEqual(AI_CALL_DETAIL_SECTIONS.map((section) => section.title),
    ['来源', '优化', '规则', '最终输入', '实际图', '产物']);
  // 每组都要有说明，不能只给标题。
  assert.equal(AI_CALL_DETAIL_SECTIONS.every((section) => section.hint.length > 0), true);
});

test('a multi-stage trace is titled in Chinese', () => {
  assert.equal(traceGroupTitle([{ businessEvent: 'activity.image.hires' }]), '图片放大细化 · 多阶段作业');
});
