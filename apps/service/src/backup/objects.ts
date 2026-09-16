import { copyFileSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { BackupManifestObject, BackupObject } from '@sthstart/contracts';
import { computeFileSha256 } from '../portable-backup.js';
import { decryptFileToFile, encryptFileToFile, objectRemoteKey } from './crypto.js';
import type { BackupStore } from './store.js';

/** 捕获阶段登记的一个待加密文件；路径是逻辑路径，真实位置只在加密清单里。 */
export interface StagedObjectSource {
  relativePath: string;
  kind: string;
  storage: BackupManifestObject['storage'];
  resourceId?: string;
  referencedBy: string[];
  contentType?: string;
  /** 明文来源文件（暂存副本或原始资产）。 */
  sourcePath: string;
}

export interface WrittenObject {
  object: BackupObject;
  entry: BackupManifestObject;
  /** 该内容在本仓库已有密文，本次没有重新加密也没有重新上传。 */
  reused: boolean;
}

/**
 * 对象仓库写入器：把明文内容变成「一个仓库内唯一的加密对象」。
 *
 * - 以明文 SHA-256 判定变化，而不是文件名或修改时间。
 * - 同一内容在仓库内复用一个密文对象；密文缓存仍在时直接复用，不重新随机加密。
 * - 密文缓存丢失时**不能**重新加密覆盖：旧清单里的密文 hash 会失效。
 *   这种情况交由调用方从远端有效副本取回（restoreCipherFromRemote），否则本次失败。
 */
export class BackupObjectWriter {
  constructor(private readonly options: {
    store: BackupStore;
    vaultId: string;
    /** 本地密文对象目录。 */
    directory: string;
    masterKey: Buffer;
    namingKey: Buffer;
  }) {}

  private cipherPathFor(objectId: string) {
    return resolve(this.options.directory, objectId + '.bin');
  }

  /** 该内容是否已有可复用的密文缓存。 */
  hasUsableCipher(object: BackupObject): boolean {
    if (!object.localCipherPath || !existsSync(object.localCipherPath)) return false;
    try {
      return statSync(object.localCipherPath).size === object.cipherBytes;
    } catch {
      return false;
    }
  }

  async add(source: StagedObjectSource): Promise<WrittenObject> {
    const contentHash = await computeFileSha256(source.sourcePath);
    const existing = this.options.store.findObjectByContent(this.options.vaultId, contentHash);
    if (existing) {
      if (!this.hasUsableCipher(existing)) throw new Error('backup_cipher_cache_missing');
      return { object: existing, entry: this.entryFor(existing, source), reused: true };
    }
    const objectId = randomUUID();
    const targetPath = this.cipherPathFor(objectId);
    const encrypted = await encryptFileToFile({
      sourcePath: source.sourcePath,
      targetPath,
      masterKey: this.options.masterKey,
      vaultId: this.options.vaultId,
      objectId,
    });
    const object = this.options.store.saveObject({
      id: objectId,
      vaultId: this.options.vaultId,
      contentHash,
      cipherHash: encrypted.cipherHash,
      plaintextBytes: statSync(source.sourcePath).size,
      cipherBytes: encrypted.cipherBytes,
      localCipherPath: targetPath,
    });
    return {
      object,
      entry: {
        ...this.entryFor(object, source),
        cipherSha256: object.cipherHash,
        cipherBytes: object.cipherBytes,
      },
      reused: false,
    };
  }

  private entryFor(object: BackupObject, source: StagedObjectSource): BackupManifestObject {
    return {
      relativePath: source.relativePath,
      kind: source.kind,
      ...(source.resourceId ? { resourceId: source.resourceId } : {}),
      storage: source.storage,
      plaintextSha256: object.contentHash,
      plaintextBytes: object.plaintextBytes,
      cipherSha256: object.cipherHash,
      cipherBytes: object.cipherBytes,
      remoteKey: objectRemoteKey(this.options.namingKey, object.contentHash),
      referencedBy: source.referencedBy,
      ...(source.contentType ? { contentType: source.contentType } : {}),
    };
  }

  /**
   * 从远端副本把丢失的密文缓存取回来。
   * 只接受能通过认证解密的字节：解不开的副本不会成为「可复用密文」。
   */
  async restoreCipherFromRemote(object: BackupObject, downloadedPath: string): Promise<boolean> {
    const sha = await computeFileSha256(downloadedPath);
    if (sha !== object.cipherHash) return false;
    const probePath = resolve(this.options.directory, 'probe-' + object.id);
    try {
      await decryptFileToFile({
        cipherPath: downloadedPath,
        targetPath: probePath,
        masterKey: this.options.masterKey,
        vaultId: this.options.vaultId,
        objectId: object.id,
      });
    } catch {
      return false;
    }
    const targetPath = this.cipherPathFor(object.id);
    copyFileSync(downloadedPath, targetPath);
    this.options.store.updateObjectCipherPath(object.id, targetPath);
    return true;
  }
}
