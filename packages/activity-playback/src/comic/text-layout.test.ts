import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutBubbleText } from './text-layout.js';

const context = {
  measureText(text: string) { return { width: Array.from(text).length * 10 }; },
} as CanvasRenderingContext2D;

test('text layout preserves manual newlines and never drops Chinese graphemes', () => {
  const text = '你好世界，雪山实验！\n观察结晶';
  const result = layoutBubbleText(context, { text, fontSize: 32, rect: { x: 0, y: 0, width: 0.5, height: 0.3 } }, 50, 500);
  assert.deepEqual(result.lines, ['你好世界，', '雪山实验！', '观察结晶']);
  assert.equal(result.lines.join(''), text.replace('\n', ''));
  assert.equal(result.overflow, false);
});

test('text layout wraps long Latin tokens by grapheme and reports overflow', () => {
  const result = layoutBubbleText(context, {
    text: 'supercalifragilistic 中文', fontSize: 32, rect: { x: 0, y: 0, width: 0.5, height: 0.1 },
  }, 40, 40);
  assert.deepEqual(result.lines.slice(0, 5), ['supe', 'rcal', 'ifra', 'gili', 'stic']);
  assert.equal(result.lines.join('').replace(/\s/gu, ''), 'supercalifragilistic中文');
  assert.equal(result.overflow, true);
});

test('explicit paragraph breaks are retained even for empty paragraphs', () => {
  const result = layoutBubbleText(context, { text: '第一行\n\n第三行', fontSize: 24, rect: { x: 0, y: 0, width: 1, height: 1 } }, 300, 500);
  assert.deepEqual(result.lines, ['第一行', '', '第三行']);
});
