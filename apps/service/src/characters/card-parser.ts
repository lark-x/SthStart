import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';

export const CARD_PARSER_VERSION = 'character-card-parser-v1';
export const MAX_CARD_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_CARD_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_DECODED_IMAGE_PIXELS = 40_000_000;
const MAX_JSON_DEPTH = 64;

export type CharacterCardFormat = 'v1-json' | 'v2-json' | 'v3-json' | 'v2-png' | 'v3-png' | 'image';

export interface ParsedCharacterCard {
  card: Record<string, unknown> | null;
  format: CharacterCardFormat;
  mimeType: string;
  bytes: Buffer;
  width: number | null;
  height: number | null;
  metadataKey: 'chara' | 'ccv3' | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function jsonDepth(value: unknown, current = 0): number {
  if (current > MAX_JSON_DEPTH) return current;
  if (Array.isArray(value)) return Math.max(current, ...value.map((item) => jsonDepth(item, current + 1)));
  if (isRecord(value)) return Math.max(current, ...Object.values(value).map((item) => jsonDepth(item, current + 1)));
  return current;
}

function assertJsonLimits(value: unknown, byteLength: number) {
  if (byteLength > MAX_CARD_JSON_BYTES) throw new Error('character_card_json_too_large');
  if (jsonDepth(value) > MAX_JSON_DEPTH) throw new Error('character_card_json_too_deep');
}

function detectJsonFormat(card: Record<string, unknown>): 'v1-json' | 'v2-json' | 'v3-json' {
  const spec = typeof card.spec === 'string' ? card.spec.toLowerCase() : '';
  const version = typeof card.spec_version === 'string' || typeof card.spec_version === 'number'
    ? String(card.spec_version)
    : '';
  if (spec.includes('v3') || spec === 'ccv3' || version.startsWith('3')) return 'v3-json';
  if (spec.includes('v2') || isRecord(card.data)) return 'v2-json';
  return 'v1-json';
}

function pngChunkType(buffer: Buffer, offset: number) {
  return decodeBytes(buffer.subarray(offset + 4, offset + 8), 'latin1');
}

function decodeBytes(value: Uint8Array, encoding: 'utf8' | 'latin1' | 'ascii' = 'utf8') {
  return new TextDecoder(encoding === 'latin1' ? 'windows-1252' : encoding).decode(value);
}

function firstZero(value: Uint8Array, from = 0) {
  for (let index = from; index < value.length; index += 1) if (value[index] === 0) return index;
  return -1;
}

function readUInt32BE(value: Uint8Array, offset: number) {
  return (((value[offset] ?? 0) << 24) | ((value[offset + 1] ?? 0) << 16) | ((value[offset + 2] ?? 0) << 8) | (value[offset + 3] ?? 0)) >>> 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeTextValue(key: string, value: Buffer): string | null {
  try {
    if (key === 'tEXt') {
      const split = firstZero(value);
      return split < 0 ? null : decodeBytes(value.subarray(split + 1), 'latin1');
    }
    if (key === 'zTXt') {
      const split = firstZero(value);
      if (split < 0 || value[split + 1] !== 0) return null;
      return decodeBytes(inflateSync(value.subarray(split + 2), { maxOutputLength: MAX_CARD_JSON_BYTES * 2 }), 'utf8');
    }
    if (key === 'iTXt') {
      let cursor = firstZero(value);
      if (cursor < 0) return null;
      const compressed = value[cursor + 1] === 1;
      const compressionMethod = value[cursor + 2];
      cursor += 3;
      const languageEnd = firstZero(value, cursor);
      if (languageEnd < 0) return null;
      cursor = languageEnd + 1;
      const translatedEnd = firstZero(value, cursor);
      if (translatedEnd < 0) return null;
      const text = value.subarray(translatedEnd + 1);
      if (!compressed) return decodeBytes(text, 'utf8');
      if (compressionMethod !== 0) return null;
      return decodeBytes(inflateSync(text, { maxOutputLength: MAX_CARD_JSON_BYTES * 2 }), 'utf8');
    }
  } catch {
    return null;
  }
  return null;
}

function decodeCardMetadata(raw: string): Record<string, unknown> | null {
  const candidate = raw.trim();
  const values = [candidate];
  try {
    values.unshift(decodeBytes(Buffer.from(candidate, 'base64'), 'utf8'));
  } catch {
    // Try the raw value below.
  }
  for (const value of values) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) {
        assertJsonLimits(parsed, Buffer.byteLength(value));
        return parsed;
      }
    } catch {
      // Other PNG text chunks may contain unrelated text.
    }
  }
  return null;
}

function parsePng(bytes: Buffer): { card: Record<string, unknown> | null; width: number; height: number; metadataKey: 'chara' | 'ccv3' | null } {
  if (bytes.length > MAX_CARD_IMAGE_BYTES) throw new Error('character_card_image_too_large');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!equalBytes(bytes.subarray(0, 8), signature)) throw new Error('invalid_png_signature');
  let offset = 8;
  let width = 0;
  let height = 0;
  const metadata: Array<{ key: string; value: string }> = [];
  let sawEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = readUInt32BE(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length || length > MAX_CARD_IMAGE_BYTES) throw new Error('invalid_png_chunk');
    const type = pngChunkType(bytes, offset);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = readUInt32BE(bytes, offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (expectedCrc !== actualCrc) throw new Error('invalid_png_crc');
    if (type === 'IHDR' && data.length >= 8) {
      width = readUInt32BE(data, 0);
      height = readUInt32BE(data, 4);
      if (width < 1 || height < 1 || width * height > MAX_DECODED_IMAGE_PIXELS) throw new Error('character_card_image_dimensions_too_large');
    }
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const keyEnd = firstZero(data);
      if (keyEnd > 0) {
        const key = decodeBytes(data.subarray(0, keyEnd), 'latin1');
        const value = decodeTextValue(type, data);
        if (value) metadata.push({ key, value });
      }
    }
    offset = chunkEnd;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  if (!sawEnd) throw new Error('invalid_png_end');

  let invalidMetadata = false;
  for (const key of ['ccv3', 'chara'] as const) {
    const entry = metadata.find((item) => item.key.toLowerCase() === key);
    if (!entry) continue;
    const card = decodeCardMetadata(entry.value);
    if (card) return { card, width, height, metadataKey: key };
    // A damaged V3 chunk may coexist with a valid legacy V2 chunk. Keep
    // looking so callers can make the downgrade explicit in the preview.
    invalidMetadata = true;
  }
  if (invalidMetadata) throw new Error('character_card_metadata_invalid');
  return { card: null, width, height, metadataKey: null };
}

function sniffMime(bytes: Buffer, supplied?: string): string {
  if (equalBytes(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (equalBytes(bytes.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (decodeBytes(bytes.subarray(0, 4), 'ascii') === 'RIFF' && decodeBytes(bytes.subarray(8, 12), 'ascii') === 'WEBP') return 'image/webp';
  return supplied?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

export function parseCharacterCard(input: { bytes: Buffer; mimeType?: string }): ParsedCharacterCard {
  const bytes = input.bytes;
  const mimeType = sniffMime(bytes, input.mimeType);
  if (bytes.length > MAX_CARD_IMAGE_BYTES && mimeType.startsWith('image/')) throw new Error('character_card_image_too_large');

  if (mimeType === 'image/png') {
    const parsed = parsePng(bytes);
    if (!parsed.card) return { card: null, format: 'image', mimeType, bytes, width: parsed.width, height: parsed.height, metadataKey: null };
    const version = detectJsonFormat(parsed.card);
    return { ...parsed, card: parsed.card, format: parsed.metadataKey === 'ccv3' || version === 'v3-json' ? 'v3-png' : 'v2-png', mimeType, bytes };
  }

  if (mimeType === 'application/json' || mimeType === 'text/json' || !mimeType.startsWith('image/')) {
    if (bytes.length > MAX_CARD_JSON_BYTES) throw new Error('character_card_json_too_large');
    let parsed: unknown;
    try { parsed = JSON.parse(decodeBytes(bytes, 'utf8')); } catch { throw new Error('invalid_character_card_json'); }
    if (!isRecord(parsed)) throw new Error('invalid_character_card_json');
    assertJsonLimits(parsed, bytes.length);
    return { card: parsed, format: detectJsonFormat(parsed), mimeType: 'application/json', bytes, width: null, height: null, metadataKey: null };
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/webp' || mimeType === 'image/gif' || mimeType === 'image/avif') {
    return { card: null, format: 'image', mimeType, bytes, width: null, height: null, metadataKey: null };
  }
  throw new Error('unsupported_character_card_format');
}
