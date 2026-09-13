import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createZip, readZip } from './activities/zip.js';
import { normalizeModelOutput, validateGeneratedOutput } from './activities/generation-validation.js';
import { parseAiJsonOutput } from './activities/prompts.js';
import type { ContentDocument } from '@sthstart/contracts';

test('Activity ZIP rejects falsely declared output lengths and changed CRC', () => {
  const zip = createZip([{ path: 'test.txt', data: Buffer.alloc(4096, 65) }]);
  assert.equal(readZip(zip).get('test.txt')?.length, 4096);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cd = new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(eocd + 16, true);
  const falseSize = Buffer.from(zip); falseSize.writeUInt32LE(1, cd + 24);
  assert.throws(() => readZip(falseSize, { maxTotalBytes: 100 }));
  const falseCrc = Buffer.from(zip); falseCrc.writeUInt32LE(0, cd + 16);
  assert.throws(() => readZip(falseCrc), /CRC mismatch/);
});

test('Activity AI output must have schema and valid entity references', () => {
  const doc = { actors: [{ id: 'a' }], stages: [{ id: 's' }], conversations: [{ id: 'c' }] } as ContentDocument;
  const output = { schemaVersion: 1, stageId: 's', summary: 'summary', messages: [{ clientId: 'm', conversationId: 'c', speakerActorId: 'a', text: 'hello', order: 1 }], posts: [], comments: [], facts: [], mediaSlots: [] };
  assert.doesNotThrow(() => validateGeneratedOutput(output, doc, 'stage', 's'));
  assert.throws(() => validateGeneratedOutput({}, doc, 'stage', 's'), /schemaVersion/);
  assert.throws(() => validateGeneratedOutput({ ...output, messages: [{ ...output.messages[0], speakerActorId: 'outsider' }] }, doc, 'stage', 's'), /unknown actor/);
  assert.throws(() => validateGeneratedOutput({ ...output, messages: [{ ...output.messages[0], mediaClientIds: ['missing'] }] }, doc, 'stage', 's'), /media references/);
});

test('parseAiJsonOutput tolerates fenced and prose-wrapped model output', () => {
  assert.deepEqual(parseAiJsonOutput('```json\n{"schemaVersion": 1}\n```'), { schemaVersion: 1 });
  assert.deepEqual(
    parseAiJsonOutput('好的，以下是生成结果：{"a": {"b": "包含}花括号"}, "schemaVersion": 1} 希望符合要求'),
    { a: { b: '包含}花括号' }, schemaVersion: 1 }
  );
  assert.throws(() => parseAiJsonOutput('这段回复里没有 JSON'), /无法解析为 JSON/);
});

test('normalizeModelOutput repairs common real-model deviations before validation', () => {
  const doc = {
    actors: [{ id: 'a1', displayName: '小明' }, { id: 'a2', displayName: '小红' }],
    stages: [{ id: 's1' }],
    conversations: [{ id: 'conv1' }],
  } as unknown as ContentDocument;
  const input: Record<string, unknown> = {
    schemaVersion: '1',
    summary: 12345,
    messages: [
      { conversationId: 'conv1', speakerActorId: '小明', text: 42, order: '10' },
      { clientId: 'm2', conversationId: 'conv1', speakerActorId: 'a2', text: 'hi' },
      { clientId: 'm2', conversationId: 'conv1', speakerActorId: 'a2', text: '重复 ID' },
    ],
    posts: [{ clientId: 'p1', authorActorId: 'a1', text: '动态正文', order: 20 }],
    comments: [{ clientId: 'c1', postClientId: 'p1', authorActorId: 'a2', text: '评论' }],
    facts: [{ clientId: 'f1', text: '成员已集合', status: '已发生' }],
    mediaSlots: [{ kind: '图片', shotDescription: '营地合影' }],
  };
  const normalized = normalizeModelOutput(input, doc, { stageId: 's1' }) as Record<string, unknown>;

  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.stageId, 's1');
  assert.equal(normalized.summary, '12345');
  const messages = normalized.messages as Array<Record<string, unknown>>;
  assert.deepEqual(messages.map((row) => row.clientId), ['m_1', 'm2', 'm_3']);
  assert.equal(messages[0].speakerActorId, 'a1');
  assert.equal(messages[0].text, '42');
  assert.equal(messages[0].order, 10);
  assert.equal(messages[1].order, 20);
  const slots = normalized.mediaSlots as Array<Record<string, unknown>>;
  assert.equal(slots[0].kind, 'image');
  assert.equal(slots[0].caption, '营地合影');
  assert.deepEqual(slots[0].actorIds, []);
  const facts = normalized.facts as Array<Record<string, unknown>>;
  assert.equal(facts[0].status, 'happened');
  assert.deepEqual(facts[0].knownByActorIds, []);
  // 修复结果必须能直接通过严格校验（含用户遇到的 caption must be text 场景）。
  assert.doesNotThrow(() => validateGeneratedOutput(normalized, doc, 'stage', 's1'));
});
