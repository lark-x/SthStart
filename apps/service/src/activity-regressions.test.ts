import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createZip, readZip } from './activities/zip.js';
import { validateGeneratedOutput } from './activities/generation-validation.js';
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
