import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendSnippet, completeDialogue, findHeadings, findMentionTrigger,
  formatChineseIndentation, lineStartOffset, parseScriptBody, wrapSelection,
} from './story-editor-text';

test('headings and line offsets locate the same source positions used by the outline', () => {
  const body = '前言\n## 第一节\ntext\n### 小节';
  assert.deepEqual(findHeadings(body), [{ line: 1, text: '第一节', depth: 2 }, { line: 3, text: '小节', depth: 3 }]);
  assert.equal(lineStartOffset(body, 1), 3);
  assert.equal(lineStartOffset(body, 3), 15);
  assert.equal(lineStartOffset(body, 0), 0);
});

test('wrapSelection keeps the caret inside the inserted markers and handles empty selections', () => {
  assert.deepEqual(wrapSelection('hello world', 6, 11, '**', '**'), {
    body: 'hello **world**', selectionStart: 8, selectionEnd: 13,
  });
  assert.deepEqual(wrapSelection('abc', 1, 1, '**', '**'), {
    body: 'a**文本**bc', selectionStart: 3, selectionEnd: 5,
  });
  assert.deepEqual(wrapSelection('abc', 1, 1, '## '), {
    body: 'a## bc', selectionStart: 4, selectionEnd: 4,
  });
  assert.equal(appendSnippet('', '```\n', '\n```'), '```\n\n```');
  assert.equal(appendSnippet('正文', '## '), '正文\n## ');
});

test('Chinese indentation skips headings, lists, quotes and code fences', () => {
  const body = ['# 标题', '', '- 列表', '> 引用', '```', 'code', '```', '  正文  ', '第二段'].join('\n');
  // 与原实现一致：只按行首规则跳过，不追踪代码块内部状态。
  assert.equal(formatChineseIndentation(body), ['# 标题', '', '- 列表', '> 引用', '```', '\u3000\u3000code', '```', '\u3000\u3000正文', '\u3000\u3000第二段'].join('\n'));
});

test('mention trigger requires a nearby @ after whitespace or punctuation', () => {
  assert.deepEqual(findMentionTrigger('你好 @阿', 6), { anchor: 3, query: '阿' });
  assert.deepEqual(findMentionTrigger('@阿', 2), { anchor: 0, query: '阿' });
  assert.deepEqual(findMentionTrigger('。@阿澜', 4), { anchor: 1, query: '阿澜' });
  assert.equal(findMentionTrigger('邮箱a@b', 5), null);
  assert.equal(findMentionTrigger('你好 @阿澜 后面', 8), null);
  assert.equal(findMentionTrigger('@12345678901', 12), null);
});

test('dialogue completion replaces the mention and places the caret inside quotes', () => {
  const result = completeDialogue('你好 @阿澜 再见', 3, 6, '阿澜');
  assert.equal(result.body, '你好 阿澜：“” 再见');
  assert.equal(result.caret, '你好 阿澜：“'.length);
  assert.equal(result.body.slice(result.caret, result.caret + 1), '”');
});

test('script preview parses scenes, dialogues, narration and blank lines', () => {
  const body = ['## 第一幕', '', '阿澜：“走吧。”', '阿澜: 嗯', '雨落在码头上。'].join('\n');
  assert.deepEqual(parseScriptBody(body), [
    { kind: 'scene', text: '第一幕' },
    { kind: 'blank' },
    { kind: 'dialogue', speaker: '阿澜', dialogue: '“走吧。' },
    { kind: 'dialogue', speaker: '阿澜', dialogue: '嗯' },
    { kind: 'narration', text: '雨落在码头上。' },
  ]);
});
