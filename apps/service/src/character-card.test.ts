import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { parseCharacterCard } from './characters/card-parser.js';
import { mapCharacterCard } from './characters/card-mapper.js';
import { CharacterTavernProvider } from './characters/source-providers/character-tavern.js';

function crc32(value: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), 8 + data.length);
  return result;
}

function cardPng(card: Record<string, unknown>) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const metadata = Buffer.concat([Buffer.from('chara\0'), Buffer.from(Buffer.from(JSON.stringify(card)).toString('base64'), 'ascii')]);
  const imageData = deflateSync(Buffer.from([0, 255, 255, 255, 255]));
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('tEXt', metadata), pngChunk('IDAT', imageData), pngChunk('IEND', Buffer.alloc(0))]);
}

function plainPng() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const imageData = deflateSync(Buffer.from([0, 255, 255, 255, 255]));
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', imageData), pngChunk('IEND', Buffer.alloc(0))]);
}

test('character card parser validates PNG metadata, supports V2 mapping, and rejects tampering', () => {
  const bytes = cardPng({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'PNG 角色', description: '保留 <START> 的描述', personality: '冷静\n观察' } });
  const parsed = parseCharacterCard({ bytes, mimeType: 'image/png' });
  assert.equal(parsed.format, 'v2-png');
  assert.equal(parsed.width, 1);
  const mapped = mapCharacterCard(parsed);
  assert.equal(mapped.candidate.draft.displayName, 'PNG 角色');
  assert.deepEqual(mapped.candidate.draft.personality, ['冷静', '观察']);
  assert.equal(mapped.compatibility.supported, true);
  const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => parseCharacterCard({ bytes: corrupted, mimeType: 'image/png' }), /invalid_png_crc|invalid_png_end/);
});

test('character card parser recognizes V3 JSON and keeps ordinary images out of card mapping', () => {
  const v3 = parseCharacterCard({ bytes: Buffer.from(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'V3 角色', description: '基础字段' } })), mimeType: 'application/json' });
  assert.equal(v3.format, 'v3-json');
  assert.equal(mapCharacterCard(v3).candidate.draft.displayName, 'V3 角色');
  const ordinary = parseCharacterCard({ bytes: plainPng(), mimeType: 'image/png' });
  assert.equal(ordinary.format, 'image');
  assert.equal(ordinary.card, null);
});

test('Character Tavern provider keeps search/detail/download boundaries and blocks foreign redirects', async () => {
  const png = cardPng({ spec: 'chara_card_v2', data: { name: 'Remote' } });
  const provider = new CharacterTavernProvider(async (input, init) => {
    const url = String(input);
    if (url.includes('/api/search/cards')) return new Response(JSON.stringify({ hits: [{ path: 'author/remote', name: 'Remote', tagline: 'summary' }], totalHits: 1, totalPages: 1, page: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/api/character/')) return new Response(JSON.stringify({ card: { name: 'Remote', versionId: 3 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (init?.redirect === 'manual') return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    return new Response('not found', { status: 404 });
  });
  const search = await provider.search({ query: 'Remote', limit: 10, signal: AbortSignal.timeout(1_000) });
  assert.equal(search.items[0].externalId, 'author/remote');
  const detail = await provider.getDetail('author/remote', AbortSignal.timeout(1_000));
  assert.equal(detail.remoteVersion, '3');
  const download = await provider.download('author/remote', AbortSignal.timeout(1_000));
  assert.equal(download.contentType, 'image/png');
  assert.equal(provider.parseSupportedUrl('https://character-tavern.com/character/author/remote')?.externalId, 'author/remote');
  assert.equal(provider.parseSupportedUrl('https://evil.test/character/author/remote'), null);
});
