import {
  createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scryptSync, timingSafeEqual,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

/**
 * 版本化文件封装。
 *
 * 设计要点（对应计划 §5.1）：
 * - 仓库有随机 256 位主密钥；密码不直接作为文件加密密钥。
 * - 密码经 scrypt + 随机 salt 派生「包裹密钥」，只用于包裹主密钥。
 * - 主密钥经 HKDF 派生不同用途子密钥（数据加密、对象命名），不复用同一密钥。
 * - 每个对象使用独立随机文件密钥与唯一随机 nonce；nonce 绝不固定或复用。
 * - 头部记录格式版本、算法、nonce 与被包裹的文件密钥。
 * - 认证关联数据（AAD）绑定仓库与对象身份，防止密文被挪用到别的位置。
 * - 全流式处理，不把视频读进内存。
 */

export const BACKUP_FORMAT_VERSION = 1;
const HEADER_MAGIC = 'STHBAK01';
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
/** 头部长度字段固定宽度，便于流式解析。 */
const HEADER_LENGTH_BYTES = 4;

/**
 * 显式字节转换辅助。
 *
 * 本仓库同一份源码会被两套 tsconfig 编译（Next 应用配置合并了
 * \`@cloudflare/workers-types\`，服务端配置只加载 Node 类型），两套配置对全局
 * \`Buffer\` 的类型解析不一致。这里把「字节 ↔ 文本」与「大端整数读写」收口，
 * 避免依赖 Buffer 实例方法的推断结果。
 */
type ByteSource = { toString(encoding: string): string };

function encodeBytes(view: Uint8Array, encoding: 'base64' | 'base64url' | 'ascii' | 'utf8'): string {
  return (view as unknown as ByteSource).toString(encoding);
}

function readUInt32BEAt(view: Uint8Array, offset: number): number {
  return (((view[offset] ?? 0) << 24) | ((view[offset + 1] ?? 0) << 16) | ((view[offset + 2] ?? 0) << 8) | (view[offset + 3] ?? 0)) >>> 0;
}

function writeUInt32BEAt(view: Uint8Array, value: number, offset: number): void {
  view[offset] = (value >>> 24) & 0xff;
  view[offset + 1] = (value >>> 16) & 0xff;
  view[offset + 2] = (value >>> 8) & 0xff;
  view[offset + 3] = value & 0xff;
}

export interface ScryptParams {
  algorithm: 'scrypt';
  salt: string;
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

export interface WrappedKey {
  algorithm: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
}

export function randomKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function randomSalt(): Buffer {
  return randomBytes(32);
}

function scryptKey(password: string, params: ScryptParams): Buffer {
  const salt = Buffer.from(params.salt, 'base64');
  return scryptSync(password.normalize('NFC'), salt, params.keyLength, {
    N: params.N, r: params.r, p: params.p,
    // scrypt 需要略高于 128*N*r 的内存上限，否则 Node 会拒绝。
    maxmem: Math.max(64 * 1024 * 1024, 256 * params.N * params.r),
  });
}

/** 包裹密钥：AES-256-GCM，AAD 绑定用途，避免密文被挪用到别的场景。 */
function wrapKey(key: Buffer, wrappingKey: Buffer, purpose: string): WrappedKey {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce);
  cipher.setAAD(Buffer.from(purpose, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  return { algorithm: 'aes-256-gcm', nonce: encodeBytes(nonce, 'base64'), ciphertext: encodeBytes(ciphertext, 'base64') };
}

function unwrapKey(wrapped: WrappedKey, wrappingKey: Buffer, purpose: string): Buffer {
  const nonce = Buffer.from(wrapped.nonce, 'base64');
  const payload = Buffer.from(wrapped.ciphertext, 'base64');
  if (payload.length <= TAG_BYTES) throw new Error('backup_ciphertext_truncated');
  const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', wrappingKey, nonce);
  decipher.setAAD(Buffer.from(purpose, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // 认证失败统一语义：密码错误或被篡改，不能接受部分明文。
    throw new Error('backup_unlock_failed');
  }
}

/** 默认 scrypt 参数：在 Node 默认内存限制内的稳健取值。 */
export function defaultScryptParams(): ScryptParams {
  return { algorithm: 'scrypt', salt: encodeBytes(randomSalt(), 'base64'), N: 16_384, r: 8, p: 1, keyLength: KEY_BYTES };
}

/** 密码 → 包裹密钥。 */
export function deriveWrappingKey(password: string, params: ScryptParams): Buffer {
  return scryptKey('password:' + password, params);
}

/** 恢复密钥 → 包裹密钥；用独立前缀，避免与密码派生空间重叠。 */
export function deriveRecoveryWrappingKey(recoveryKey: string, params: ScryptParams): Buffer {
  return scryptKey('recovery:' + recoveryKey, params);
}

export function wrapMasterKey(masterKey: Buffer, wrappingKey: Buffer, purpose: 'password' | 'recovery'): WrappedKey {
  return wrapKey(masterKey, wrappingKey, 'sthstart-backup-master:' + purpose);
}

export function unwrapMasterKey(wrapped: WrappedKey, wrappingKey: Buffer, purpose: 'password' | 'recovery'): Buffer {
  return unwrapKey(wrapped, wrappingKey, 'sthstart-backup-master:' + purpose);
}

/**
 * 主密钥派生子密钥。用途分离：数据加密与对象命名各用一条 HKDF 信息串。
 */
export function deriveSubkey(masterKey: Buffer, purpose: 'object-encryption' | 'object-naming'): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('sthstart-backup-v1', 'utf8'), Buffer.from(purpose, 'utf8'), KEY_BYTES));
}

/** 生成人类可读的恢复密钥（高熵，分组便于抄写）。 */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(32);
  const base = encodeBytes(bytes, 'base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
  return base.match(/.{1,5}/g)!.join('-');
}

/** 恢复密钥校验段：用于快速判断输入是否正确，不泄露密钥本身。 */
export function recoveryVerifier(recoveryKey: string, salt: Buffer): { verifierSalt: string; verifierHash: string } {
  const hash = createHash('sha256').update('verifier:' + recoveryKey + ':' + encodeBytes(salt, 'base64')).digest('hex');
  return { verifierSalt: encodeBytes(salt, 'base64'), verifierHash: hash };
}

export function verifyRecoveryKey(recoveryKey: string, verifierSalt: string, verifierHash: string): boolean {
  const expected = createHash('sha256').update('verifier:' + recoveryKey + ':' + verifierSalt).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(verifierHash, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 远端对象键：由仓库子密钥做 HMAC 派生，避免暴露明文内容 hash 与原始文件名。
 */
export function objectRemoteKey(namingKey: Buffer, contentHash: string): string {
  return createHash('sha256').update(Buffer.concat([namingKey, Buffer.from('object:' + contentHash, 'utf8')])).digest('hex').slice(0, 40);
}

/**
 * 加密文件头部（明文）：解析时先读它，再流式解密正文。
 * 不含主密钥、恢复密钥或密码材料。
 */
interface FileHeader {
  magic: string;
  formatVersion: number;
  vaultId: string;
  objectId: string;
  wrappedFileKey: WrappedKey;
}

function encodeHeader(header: FileHeader): Buffer {
  const body = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(HEADER_LENGTH_BYTES);
  writeUInt32BEAt(length, body.length, 0);
  return Buffer.concat([Buffer.from(HEADER_MAGIC, 'ascii'), length, body]);
}

function decodeHeader(buffer: Buffer): { header: FileHeader; headerBytes: number } {
  if (buffer.length < HEADER_MAGIC.length + HEADER_LENGTH_BYTES) throw new Error('backup_header_truncated');
  if (encodeBytes(buffer.subarray(0, HEADER_MAGIC.length), 'ascii') !== HEADER_MAGIC) throw new Error('backup_header_invalid');
  const length = readUInt32BEAt(buffer, HEADER_MAGIC.length);
  const start = HEADER_MAGIC.length + HEADER_LENGTH_BYTES;
  // 读不满时必须报截断：handle.read 读不到的部分会留在缓冲区里全是零。
  if (length === 0 || length > 64 * 1024 || buffer.length < start + length) throw new Error('backup_header_truncated');
  let header: FileHeader;
  try {
    header = JSON.parse(encodeBytes(buffer.subarray(start, start + length), 'utf8')) as FileHeader;
  } catch {
    throw new Error('backup_header_invalid');
  }
  return { header, headerBytes: start + length };
}

/** FileHandle.read 在不同 Node 版本返回 number 或 { bytesRead }，这里统一取字节数。 */
async function readAt(handle: Awaited<ReturnType<typeof import('node:fs/promises').open>>, buffer: Buffer, position: number): Promise<number> {
  const result = await handle.read(buffer, 0, buffer.length, position);
  return typeof result === 'number' ? result : result.bytesRead;
}

export interface EncryptResult {
  cipherHash: string;
  cipherBytes: number;
}

/**
 * 读取密文头部里的仓库与对象身份。
 *
 * 头部是明文，但它的内容被认证保护：文件密钥用「仓库 + 对象」作为 AAD 包裹，
 * 改动头部会让解包失败。因此新设备可以只凭远端密文与解锁材料认出对象身份，
 * 不需要旧设备的本地索引。
 */
export async function readCipherIdentity(cipherPath: string): Promise<{ formatVersion: number; vaultId: string; objectId: string }> {
  const handle = await (await import('node:fs/promises')).open(cipherPath, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    const prefixLength = HEADER_MAGIC.length + HEADER_LENGTH_BYTES;
    if (fileSize < prefixLength + 1) throw new Error('backup_header_truncated');
    const prefixBuffer = Buffer.alloc(prefixLength);
    if (await readAt(handle, prefixBuffer, 0) !== prefixLength) throw new Error('backup_header_truncated');
    const bodyLength = readUInt32BEAt(prefixBuffer, HEADER_MAGIC.length);
    if (bodyLength === 0 || prefixLength + bodyLength + 1 > fileSize) throw new Error('backup_header_truncated');
    const fullHeader = Buffer.alloc(prefixLength + bodyLength);
    if (await readAt(handle, fullHeader, 0) !== fullHeader.length) throw new Error('backup_header_truncated');
    const { header } = decodeHeader(fullHeader);
    return { formatVersion: header.formatVersion, vaultId: header.vaultId, objectId: header.objectId };
  } finally {
    await handle.close();
  }
}

/**
 * 头部前置 + 认证标签后置的单遍流式封装。
 * 输出的 hash 覆盖「头部+密文正文+标签」整个文件，可直接用于上传后校验。
 */
function frameStream(header: Buffer, nonce: Buffer, getTag: () => Buffer) {
  const prefix = Buffer.concat([header, Buffer.from([nonce.length]), nonce]);
  let prefixSent = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!prefixSent) {
        prefixSent = true;
        callback(null, Buffer.concat([prefix, chunk]));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      // 极端情况下没有任何正文：仍然要写出头部与标签。
      if (!prefixSent) {
        prefixSent = true;
        callback(null, Buffer.concat([prefix, getTag()]));
        return;
      }
      callback(null, getTag());
    },
  });
}

/**
 * 流式加密：一遍写完，最后原子改名。
 * 生成中的部分密文使用 .part 名字，不会以最终对象名出现。
 */
export async function encryptFileToFile(input: {
  sourcePath: string;
  targetPath: string;
  masterKey: Buffer;
  vaultId: string;
  objectId: string;
}): Promise<EncryptResult> {
  await mkdir(dirname(input.targetPath), { recursive: true });
  const temporaryPath = input.targetPath + '.part';
  const fileKey = randomKey();
  const nonce = randomBytes(NONCE_BYTES);
  const header = encodeHeader({
    magic: HEADER_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    vaultId: input.vaultId,
    objectId: input.objectId,
    // 文件密钥由仓库密钥认证包裹，AAD 绑定仓库与对象身份。
    wrappedFileKey: wrapKey(fileKey, deriveSubkey(input.masterKey, 'object-encryption'), 'sthstart-backup-file:' + input.vaultId + ':' + input.objectId),
  });

  const cipher = createCipheriv('aes-256-gcm', fileKey, nonce);
  cipher.setAAD(Buffer.from('sthstart-backup-body:' + input.vaultId + ':' + input.objectId, 'utf8'));
  const framing = frameStream(header, nonce, () => cipher.getAuthTag());
  const cipherHash = createHash('sha256');
  let cipherBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      cipherBytes += chunk.length;
      cipherHash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(createReadStream(input.sourcePath), cipher, framing, meter, createWriteStream(temporaryPath, { flags: 'wx' }));
    await rename(temporaryPath, input.targetPath);
    return { cipherHash: cipherHash.digest('hex'), cipherBytes };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/**
 * 流式解密文件：认证标签校验通过后才原子改名。
 * 标签不匹配、文件截断、密码错误都不接受部分明文。
 */
export async function decryptFileToFile(input: {
  cipherPath: string;
  targetPath: string;
  masterKey: Buffer;
  vaultId: string;
  /**
   * 对象身份。留空表示按密文头部记录的身份解密：
   * 新设备没有本地索引时，头部身份是被认证的，仍然安全。
   */
  objectId: string;
}): Promise<{ plaintextBytes: number }> {
  const handle = await (await import('node:fs/promises')).open(input.cipherPath, 'r');
  try {
    // 先按文件真实大小校验，再读取头部：只按声明长度分配缓冲区会掩盖截断。
    const fileSize = (await handle.stat()).size;
    const prefixLength = HEADER_MAGIC.length + HEADER_LENGTH_BYTES;
    if (fileSize < prefixLength + 1) throw new Error('backup_header_truncated');
    const prefixBuffer = Buffer.alloc(prefixLength);
    const prefixRead = await readAt(handle, prefixBuffer, 0);
    if (prefixRead !== prefixLength) throw new Error('backup_header_truncated');
    const bodyLength = readUInt32BEAt(prefixBuffer, HEADER_MAGIC.length);
    if (bodyLength === 0 || prefixLength + bodyLength + 1 > fileSize) throw new Error('backup_header_truncated');
    const fullHeader = Buffer.alloc(prefixLength + bodyLength);
    const headerRead = await readAt(handle, fullHeader, 0);
    if (headerRead !== fullHeader.length) throw new Error('backup_header_truncated');
    const { header, headerBytes } = decodeHeader(fullHeader);
    if (header.formatVersion > BACKUP_FORMAT_VERSION) throw new Error('backup_format_too_new');
    if (header.vaultId !== input.vaultId) throw new Error('backup_object_identity_mismatch');
    if (input.objectId && header.objectId !== input.objectId) throw new Error('backup_object_identity_mismatch');
    const objectId = input.objectId || header.objectId;

    const nonceLength = Buffer.alloc(1);
    await readAt(handle, nonceLength, headerBytes);
    const nonce = Buffer.alloc(nonceLength[0]);
    await readAt(handle, nonce, headerBytes + 1);
    const fileStart = headerBytes + 1 + nonce.length;
    const total = (await handle.stat()).size;
    if (total < fileStart + TAG_BYTES) throw new Error('backup_ciphertext_truncated');

    const wrappingKey = deriveSubkey(input.masterKey, 'object-encryption');
    const fileKey = unwrapKey(header.wrappedFileKey, wrappingKey, 'sthstart-backup-file:' + input.vaultId + ':' + objectId);
    const decipher = createDecipheriv('aes-256-gcm', fileKey, nonce);
    decipher.setAAD(Buffer.from('sthstart-backup-body:' + input.vaultId + ':' + objectId, 'utf8'));
    const tag = Buffer.alloc(TAG_BYTES);
    await readAt(handle, tag, total - TAG_BYTES);
    decipher.setAuthTag(tag);

    await mkdir(dirname(input.targetPath), { recursive: true });
    const temporaryPath = input.targetPath + '.part';
    let plaintextBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        plaintextBytes += chunk.length;
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        createReadStream(input.cipherPath, { start: fileStart, end: total - TAG_BYTES - 1 }),
        decipher,
        meter,
        createWriteStream(temporaryPath, { flags: 'wx' }),
      );
      await rename(temporaryPath, input.targetPath);
      return { plaintextBytes };
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new Error('backup_decrypt_failed');
    }
  } finally {
    await handle.close();
  }
}
