import assert from 'node:assert/strict';
import test from 'node:test';
import { StoryCompiler } from './compiler.js';

test('StoryCompiler parses novel chapters into script projects with dialogue and narration', () => {
  const chapterContent = `
### 场景：离岛码头 - 夜晚

海风吹拂着枫树林，潮水轻轻拍打着木质栈道。整座小岛在月色下格外静谧。

派蒙（叉腰生气）：“你这家伙，到底有没有在听我说话啊！”
荧（轻笑）：“在听呢，派蒙。”
钟离：“欲买桂花同载酒，终不似，少年游。”

远处传来守卫巡逻的脚步声。
`;

  const script = StoryCompiler.compileToScript(chapterContent, {
    projectTitle: '提瓦特漫游录',
    chapterTitle: '第一章 离岛初见',
  });

  assert.equal(script.title, '提瓦特漫游录');
  assert.equal(script.chapterTitle, '第一章 离岛初见');
  assert.deepEqual(script.characters, ['派蒙', '荧', '钟离']);

  // 验证分行
  assert.ok(script.lines.length >= 6);

  const sceneHeader = script.lines.find((l) => l.type === 'scene_header');
  assert.ok(sceneHeader);
  assert.equal(sceneHeader.content, '离岛码头 - 夜晚');

  const paimonLine = script.lines.find((l) => l.speaker === '派蒙');
  assert.ok(paimonLine);
  assert.equal(paimonLine.type, 'dialogue');
  assert.equal(paimonLine.emotion, '叉腰生气');
  assert.equal(paimonLine.content, '你这家伙，到底有没有在听我说话啊！');

  const zhongliLine = script.lines.find((l) => l.speaker === '钟离');
  assert.ok(zhongliLine);
  assert.equal(zhongliLine.type, 'dialogue');
  assert.equal(zhongliLine.content, '欲买桂花同载酒，终不似，少年游。');

  const narrationLine = script.lines.find((l) => l.type === 'narration');
  assert.ok(narrationLine);
  assert.ok(narrationLine.content.includes('海风吹拂'));
});
