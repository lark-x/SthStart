import crypto from 'node:crypto';
import type { BackupUnlockPolicy, BackupVault } from '@sthstart/contracts';
import type { SecretStore } from '../security.js';
import { nowIso } from '../database.js';
import {
  BACKUP_FORMAT_VERSION, defaultScryptParams, deriveRecoveryWrappingKey, deriveSubkey, deriveWrappingKey,
  generateRecoveryKey, randomKey, recoveryVerifier, unwrapMasterKey, verifyRecoveryKey, wrapMasterKey,
  type ScryptParams, type WrappedKey,
} from './crypto.js';

/** SecretStore 账户名：只保存「解锁材料」，不保存主密钥或密码明文。 */
function credentialAccount(vaultId: string, purpose: 'password' | 'recovery') {
  return 'backup-vault:' + vaultId + ':' + purpose;
}

/** 跨进程缓存的解锁主密钥：只在内存里，进程结束即失效。 */
const unlocked = new Map<string, Buffer>();

export class BackupVaultService {
  constructor(private readonly secrets: SecretStore) {}

  /** 进程内是否已解锁。 */
  isUnlocked(vaultId: string): boolean {
    return unlocked.has(vaultId);
  }

  getMasterKey(vaultId: string): Buffer | null {
    return unlocked.get(vaultId) ?? null;
  }

  /** 锁定：不再启动新的加密/恢复任务；已冻结的密文上传可以完成。 */
  lock(vaultId: string): void {
    unlocked.delete(vaultId);
  }

  /**
   * 创建仓库：随机主密钥 + 密码包裹 + 恢复密钥包裹。
   * 返回恢复密钥仅此一次；仓库头与数据库都不保存它。
   */
  createVault(input: { vaultId?: string; password: string; generateRecoveryKey?: boolean }): {
    vault: BackupVault;
    recoveryKey: string | null;
  } {
    const vaultId = input.vaultId ?? crypto.randomUUID();
    const kdf = defaultScryptParams();
    const masterKey = randomKey();
    const passwordKey = deriveWrappingKey(input.password, kdf);
    const wrapped = wrapMasterKey(masterKey, passwordKey, 'password');
    const wantsRecovery = input.generateRecoveryKey !== false;
    const recoveryKey = wantsRecovery ? generateRecoveryKey() : null;
    const recovery = recoveryKey
      ? (() => {
          const wrappedRecovery = wrapMasterKey(masterKey, deriveRecoveryWrappingKey(recoveryKey, kdf), 'recovery');
          const verifier = recoveryVerifier(recoveryKey, Buffer.from(kdf.salt, 'base64'));
          return { ...wrappedRecovery, ...verifier };
        })()
      : undefined;
    const now = nowIso();
    unlocked.set(vaultId, masterKey);
    return {
      vault: {
        id: vaultId,
        formatVersion: BACKUP_FORMAT_VERSION,
        kdf,
        wrappedMasterKey: wrapped,
        ...(recovery ? { recoveryWrap: recovery } : {}),
        unlockPolicy: 'manual',
        rememberedOnDevice: false,
        createdAt: now,
        updatedAt: now,
      },
      recoveryKey,
    };
  }

  /**
   * 解锁：密码或恢复密钥二选一。
   * 只能解出主密钥；任何失败都不写入本地状态。
   */
  unlock(vault: BackupVault, input: { password?: string; recoveryKey?: string }): { ok: true } {
    const kdf = vault.kdf as ScryptParams;
    let masterKey: Buffer | null = null;
    if (input.password) {
      try {
        masterKey = unwrapMasterKey(vault.wrappedMasterKey as WrappedKey, deriveWrappingKey(input.password, kdf), 'password');
      } catch { masterKey = null; }
    }
    if (!masterKey && input.recoveryKey) {
      const wrap = vault.recoveryWrap;
      if (!wrap) throw new Error('backup_recovery_key_not_configured');
      // 先校验恢复密钥，避免把明显输错的密钥拿去做昂贵派生。
      if (!verifyRecoveryKey(input.recoveryKey, wrap.verifierSalt, wrap.verifierHash)) throw new Error('backup_unlock_failed');
      try {
        masterKey = unwrapMasterKey({ algorithm: wrap.algorithm, nonce: wrap.nonce, ciphertext: wrap.ciphertext }, deriveRecoveryWrappingKey(input.recoveryKey, kdf), 'recovery');
      } catch { masterKey = null; }
    }
    if (!masterKey) throw new Error('backup_unlock_failed');
    unlocked.set(vault.id, masterKey);
    return { ok: true };
  }

  /**
   * 记住本机：把解锁材料写进 SecretStore，数据库只留凭据引用。
   * 没有可用后端时不静默写明文，直接报错让前端提示手动解锁。
   */
  async remember(vaultId: string, material: { password?: string; recoveryKey?: string }): Promise<void> {
    const value = material.password ? 'password:' + material.password : material.recoveryKey ? 'recovery:' + material.recoveryKey : null;
    if (!value) throw new Error('backup_unlock_material_required');
    await this.secrets.set(credentialAccount(vaultId, material.password ? 'password' : 'recovery'), value);
  }

  /** 用已记住的凭据解锁；没有记住或后端不可用时返回 false。 */
  async unlockRemembered(vault: BackupVault): Promise<boolean> {
    for (const purpose of ['password', 'recovery'] as const) {
      let stored: Awaited<ReturnType<SecretStore['get']>> | null = null;
      try {
        stored = await this.secrets.get(credentialAccount(vault.id, purpose));
      } catch {
        return false;
      }
      if (!stored?.value) continue;
      const raw = stored.value.startsWith(purpose + ':') ? stored.value.slice(purpose.length + 1) : stored.value;
      try {
        this.unlock(vault, purpose === 'password' ? { password: raw } : { recoveryKey: raw });
        return true;
      } catch {
        // 记住的凭据失效时继续尝试下一种，不抛错。
      }
    }
    return false;
  }

  async forget(vaultId: string): Promise<void> {
    for (const purpose of ['password', 'recovery'] as const) {
      await this.secrets.delete(credentialAccount(vaultId, purpose)).catch(() => undefined);
    }
  }

  /**
   * 修改密码：只重新包裹主密钥，主密钥不变，因此无需重传已上传的媒体。
   * 返回新的仓库头交给调用方分别更新到各目标。
   */
  changePassword(vault: BackupVault, input: { currentPassword: string; newPassword: string }): BackupVault {
    const kdf = vault.kdf as ScryptParams;
    let masterKey: Buffer;
    try {
      masterKey = unwrapMasterKey(vault.wrappedMasterKey as WrappedKey, deriveWrappingKey(input.currentPassword, kdf), 'password');
    } catch {
      throw new Error('backup_unlock_failed');
    }
    const wrapped = wrapMasterKey(masterKey, deriveWrappingKey(input.newPassword, kdf), 'password');
    // 主密钥未变化：内存中的解锁状态继续有效。
    unlocked.set(vault.id, masterKey);
    return { ...vault, wrappedMasterKey: wrapped, updatedAt: nowIso() };
  }

  setUnlockPolicy(vault: BackupVault, policy: BackupUnlockPolicy, rememberedOnDevice: boolean): BackupVault {
    return { ...vault, unlockPolicy: policy, rememberedOnDevice, updatedAt: nowIso() };
  }

  /** 子密钥供对象加密与命名使用；未解锁时抛错，避免意外写出明文。 */
  subkeys(vaultId: string): { encryption: Buffer; naming: Buffer } {
    const masterKey = unlocked.get(vaultId);
    if (!masterKey) throw new Error('backup_locked');
    return {
      encryption: deriveSubkey(masterKey, 'object-encryption'),
      naming: deriveSubkey(masterKey, 'object-naming'),
    };
  }

  /** 仅用于测试与诊断：重置进程内解锁缓存。 */
  reset(): void {
    unlocked.clear();
  }
}
