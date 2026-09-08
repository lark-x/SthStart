import { Buffer } from 'node:buffer';
import { createReadStream, createWriteStream, readFileSync, statSync } from 'node:fs';
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';

export interface ZipEntryInput {
  path: string;
  data?: Buffer | string;
  filePath?: string;
  mtime?: Date;
}

export interface ZipEntryOutput {
  path: string;
  data: Buffer;
}

function dateToDosTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function sanitizeZipPath(rawPath: string): string {
  // Normalize slashes
  let p = rawPath.replace(/\\/g, '/');
  // Strip leading slashes
  while (p.startsWith('/')) p = p.slice(1);

  // Security check: no path traversal
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '') {
      // ignore empty, but throw on '..'
      if (seg === '..') {
        throw new Error(`zip_path_traversal_forbidden: ${rawPath}`);
      }
    }
  }
  return p;
}

async function computeFileCrc32(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentCrc = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => {
      currentCrc = crc32(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), currentCrc);
    });
    stream.on('end', () => resolve(currentCrc));
    stream.on('error', reject);
  });
}

export async function createZipToFile(
  entries: ZipEntryInput[],
  outputFilePath: string,
): Promise<{ totalBytes: number }> {
  const outStream = createWriteStream(outputFilePath);
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanPath = sanitizeZipPath(entry.path);
    const pathBuf = Buffer.from(cleanPath, 'utf8');
    const mtime = entry.mtime ?? new Date();
    const { dosTime, dosDate } = dateToDosTime(mtime);

    if (entry.filePath) {
      // Large file streamed from disk without loading into RAM (use STORE method 0)
      const stat = statSync(entry.filePath);
      const fileCrc = await computeFileCrc32(entry.filePath);
      const compressionMethod = 0; // STORE
      const compressedSize = stat.size;
      const uncompressedSize = stat.size;

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0); // signature
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(0x0800, 6); // flags (UTF-8)
      localHeader.writeUInt16LE(compressionMethod, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(fileCrc, 14);
      localHeader.writeUInt32LE(compressedSize, 18);
      localHeader.writeUInt32LE(uncompressedSize, 22);
      localHeader.writeUInt16LE(pathBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);

      outStream.write(localHeader);
      outStream.write(pathBuf);

      // Stream file data in chunks to output
      await new Promise<void>((resolve, reject) => {
        const fileStream = createReadStream(entry.filePath!);
        fileStream.on('data', (chunk) => {
          if (!outStream.write(chunk)) {
            fileStream.pause();
            outStream.once('drain', () => fileStream.resume());
          }
        });
        fileStream.on('end', () => resolve());
        fileStream.on('error', reject);
      });

      // Central directory header
      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      cdHeader.writeUInt16LE(20, 4);
      cdHeader.writeUInt16LE(20, 6);
      cdHeader.writeUInt16LE(0x0800, 8);
      cdHeader.writeUInt16LE(compressionMethod, 10);
      cdHeader.writeUInt16LE(dosTime, 12);
      cdHeader.writeUInt16LE(dosDate, 14);
      cdHeader.writeUInt32LE(fileCrc, 16);
      cdHeader.writeUInt32LE(compressedSize, 20);
      cdHeader.writeUInt32LE(uncompressedSize, 24);
      cdHeader.writeUInt16LE(pathBuf.length, 28);
      cdHeader.writeUInt16LE(0, 30);
      cdHeader.writeUInt16LE(0, 32);
      cdHeader.writeUInt16LE(0, 34);
      cdHeader.writeUInt16LE(0, 36);
      cdHeader.writeUInt32LE(0, 38);
      cdHeader.writeUInt32LE(offset, 42);

      centralHeaders.push(cdHeader, pathBuf);
      offset += localHeader.length + pathBuf.length + compressedSize;
    } else {
      // In-memory buffer or string
      const rawData = typeof entry.data === 'string'
        ? Buffer.from(entry.data, 'utf8')
        : (entry.data ?? Buffer.alloc(0));

      const dataCrc = crc32(rawData);
      const compressedData = deflateRawSync(rawData);
      const useCompression = compressedData.length < rawData.length;
      const finalData = useCompression ? compressedData : rawData;
      const compressionMethod = useCompression ? 8 : 0;

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(compressionMethod, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(dataCrc, 14);
      localHeader.writeUInt32LE(finalData.length, 18);
      localHeader.writeUInt32LE(rawData.length, 22);
      localHeader.writeUInt16LE(pathBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);

      outStream.write(localHeader);
      outStream.write(pathBuf);
      outStream.write(finalData);

      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      cdHeader.writeUInt16LE(20, 4);
      cdHeader.writeUInt16LE(20, 6);
      cdHeader.writeUInt16LE(0x0800, 8);
      cdHeader.writeUInt16LE(compressionMethod, 10);
      cdHeader.writeUInt16LE(dosTime, 12);
      cdHeader.writeUInt16LE(dosDate, 14);
      cdHeader.writeUInt32LE(dataCrc, 16);
      cdHeader.writeUInt32LE(finalData.length, 20);
      cdHeader.writeUInt32LE(rawData.length, 24);
      cdHeader.writeUInt16LE(pathBuf.length, 28);
      cdHeader.writeUInt16LE(0, 30);
      cdHeader.writeUInt16LE(0, 32);
      cdHeader.writeUInt16LE(0, 34);
      cdHeader.writeUInt16LE(0, 36);
      cdHeader.writeUInt32LE(0, 38);
      cdHeader.writeUInt32LE(offset, 42);

      centralHeaders.push(cdHeader, pathBuf);
      offset += localHeader.length + pathBuf.length + finalData.length;
    }
  }

  const centralDirOffset = offset;
  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuffer.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  outStream.write(centralDirBuffer);
  outStream.write(eocd);

  await new Promise<void>((resolve, reject) => {
    outStream.end(() => resolve());
    outStream.on('error', reject);
  });

  return { totalBytes: offset + centralDirSize + 22 };
}

export function createZip(entries: ZipEntryInput[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanPath = sanitizeZipPath(entry.path);
    const pathBuf = Buffer.from(cleanPath, 'utf8');
    const rawData = entry.filePath
      ? readFileSync(entry.filePath)
      : (typeof entry.data === 'string'
        ? Buffer.from(entry.data, 'utf8')
        : (entry.data ?? Buffer.alloc(0)));

    const dataCrc = crc32(rawData);
    const compressedData = deflateRawSync(rawData);
    // Use compressed unless uncompressed is smaller
    const useCompression = compressedData.length < rawData.length;
    const finalData = useCompression ? compressedData : rawData;
    const compressionMethod = useCompression ? 8 : 0;

    const mtime = entry.mtime ?? new Date();
    const { dosTime, dosDate } = dateToDosTime(mtime);

    // Local file header (30 bytes + name + data)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // general purpose flags (UTF-8)
    localHeader.writeUInt16LE(compressionMethod, 8); // compression method
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(dataCrc, 14);
    localHeader.writeUInt32LE(finalData.length, 18); // compressed size
    localHeader.writeUInt32LE(rawData.length, 22); // uncompressed size
    localHeader.writeUInt16LE(pathBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localHeaders.push(localHeader, pathBuf, finalData);

    // Central directory header (46 bytes + name)
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0x0800, 8); // flags
    cdHeader.writeUInt16LE(compressionMethod, 10);
    cdHeader.writeUInt16LE(dosTime, 12);
    cdHeader.writeUInt16LE(dosDate, 14);
    cdHeader.writeUInt32LE(dataCrc, 16);
    cdHeader.writeUInt32LE(finalData.length, 20);
    cdHeader.writeUInt32LE(rawData.length, 24);
    cdHeader.writeUInt16LE(pathBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30); // extra field length
    cdHeader.writeUInt16LE(0, 32); // comment length
    cdHeader.writeUInt16LE(0, 34); // disk number start
    cdHeader.writeUInt16LE(0, 36); // internal file attributes
    cdHeader.writeUInt32LE(0, 38); // external file attributes
    cdHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralHeaders.push(cdHeader, pathBuf);

    offset += localHeader.length + pathBuf.length + finalData.length;
  }

  const centralDirOffset = offset;
  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuffer.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

export function readZip(
  buffer: Buffer,
  options: { maxTotalBytes?: number; maxFileCount?: number } = {},
): Map<string, Buffer> {
  const maxTotalBytes = options.maxTotalBytes ?? 500 * 1024 * 1024; // default 500MB
  const maxFileCount = options.maxFileCount ?? 2000;
  const b: any = buffer;

  // Find End of Central Directory Record (search backwards from end)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('invalid_zip_archive: EOCD record not found');
  }

  const totalEntries = b.readUInt16LE(eocdOffset + 10);
  if (totalEntries > maxFileCount) {
    throw new Error(`zip_bomb_detected: entry count ${totalEntries} exceeds max ${maxFileCount}`);
  }

  const centralDirSize = b.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = b.readUInt32LE(eocdOffset + 16);

  if (centralDirOffset + centralDirSize > buffer.length) {
    throw new Error('invalid_zip_archive: central directory extends beyond file');
  }

  const files = new Map<string, Buffer>();
  let cdPtr = centralDirOffset;
  let totalExtractedBytes = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (cdPtr + 46 > buffer.length) {
      throw new Error('invalid_zip_archive: truncated central directory header');
    }
    const sig = b.readUInt32LE(cdPtr);
    if (sig !== 0x02014b50) {
      throw new Error(`invalid_zip_archive: expected CD header signature at ${cdPtr}, got 0x${sig.toString(16)}`);
    }

    const compressionMethod = b.readUInt16LE(cdPtr + 10);
    const expectedCrc = b.readUInt32LE(cdPtr + 16);
    const compressedSize = b.readUInt32LE(cdPtr + 20);
    const uncompressedSize = b.readUInt32LE(cdPtr + 24);
    const fileNameLen = b.readUInt16LE(cdPtr + 28);
    const extraFieldLen = b.readUInt16LE(cdPtr + 30);
    const commentLen = b.readUInt16LE(cdPtr + 32);
    const localHeaderOffset = b.readUInt32LE(cdPtr + 42);

    const fileNameRaw = new TextDecoder().decode(buffer.subarray(cdPtr + 46, cdPtr + 46 + fileNameLen));
    cdPtr += 46 + fileNameLen + extraFieldLen + commentLen;

    // Check path traversal & normalize
    const cleanPath = sanitizeZipPath(fileNameRaw);

    // Skip directories
    if (fileNameRaw.endsWith('/')) {
      continue;
    }

    // Check size limit
    totalExtractedBytes += uncompressedSize;
    if (totalExtractedBytes > maxTotalBytes) {
      throw new Error(`zip_bomb_detected: total extracted bytes exceeds limit of ${maxTotalBytes} bytes`);
    }

    // Read from local file header
    if (localHeaderOffset + 30 > buffer.length) {
      throw new Error(`invalid_zip_archive: truncated local header at ${localHeaderOffset}`);
    }
    const localSig = b.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new Error(`invalid_zip_archive: local header signature mismatch at ${localHeaderOffset}`);
    }

    const localNameLen = b.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = b.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    if (dataOffset + compressedSize > centralDirOffset) throw new Error('invalid_zip_archive: compressed data extends beyond file area');
    const dataSlice = buffer.subarray(dataOffset, dataOffset + compressedSize);

    let extractedData: Buffer;
    if (compressionMethod === 0) {
      extractedData = Buffer.from(dataSlice);
    } else if (compressionMethod === 8) {
      extractedData = inflateRawSync(dataSlice, { maxOutputLength: Math.max(1, Math.min(uncompressedSize, maxTotalBytes)) });
    } else {
      throw new Error(`unsupported_zip_compression: method ${compressionMethod}`);
    }

    if (extractedData.length !== uncompressedSize || crc32(extractedData) !== expectedCrc) throw new Error('invalid_zip_archive: size or CRC mismatch');
    if (files.has(cleanPath)) throw new Error('invalid_zip_archive: duplicate path');
    files.set(cleanPath, extractedData);
  }

  return files;
}
