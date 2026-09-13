import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { deletePassword, getKeyring, getPassword, initBackend, setPassword } from 'cross-keychain';

const serviceName = 'SthStart';
let initialized = false;
let backendId: string | null = null;

/**
 * cross-keychain restricts account names to a portable character set. Database
 * identifiers are logical names and may contain separators such as `:`. Keep
 * already-safe names untouched and deterministically encode only unsafe ones,
 * so existing environment-variable fallbacks and safe keyring entries remain
 * compatible.
 */
export function keyringAccount(account: string) {
  if (/^[A-Za-z0-9._@-]+$/.test(account)) return account;
  const readable = account.replace(/[^A-Za-z0-9._@-]+/g, '-').replace(/^-+|-+$/g, '') || 'credential';
  return `${readable}-${createHash('sha256').update(account, 'utf8').digest('hex').slice(0, 16)}`;
}

export function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueToken(prefix = 'sth') {
  return `${prefix}_${Buffer.from(randomBytes(32)).toString('base64url')}`;
}

export function tokensEqual(left: string, right: string) {
  const a = Buffer.from(hashToken(left));
  const b = Buffer.from(hashToken(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 只探测存在性，不写入任何内容，因此对真实凭据库没有副作用。 */
const probeAccount = 'availability-probe';

/**
 * cross-keychain 的 Linux 后端只检查“平台是 Linux 且原生模块可加载”，并不会真正连接
 * Secret Service。因此在没有 D-Bus / gnome-keyring 的容器里，它会被误判为可用，直到
 * 写入密钥时才抛出 PermissionDenied。选中这类后端后必须做一次真实读取探测。
 */
const nativeLinuxBackends = new Set(['native-linux', 'secret-service']);

/**
 * `file` 后端以 AES-256-GCM 把凭据加密存放在数据目录，适合没有系统凭据库的容器环境，
 * 但必须显式提供 `KEYRING_FILE_MASTER_KEY` 作为主密钥；否则 cross-keychain 会把随机
 * 主密钥写到容器临时目录，容器重建后旧凭据再也无法解密。`null` 后端不存储任何内容，
 * 始终排除。
 */
export function keyringBackendAllowed(
  backendId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (backendId === 'null') return false;
  if (backendId === 'file') return Boolean(environment.KEYRING_FILE_MASTER_KEY?.trim());
  return true;
}

function fileBackendConfigured(environment: Readonly<Record<string, string | undefined>>) {
  return Boolean(environment.KEYRING_FILE_MASTER_KEY?.trim());
}

async function initializeKeyring(environment: Readonly<Record<string, string | undefined>>) {
  if (initialized) return;
  initialized = true;
  try {
    await initBackend((backend) => keyringBackendAllowed(backend.id, environment));
    backendId = (await getKeyring()).id;
  } catch {
    backendId = null;
    return;
  }
  if (!nativeLinuxBackends.has(backendId)) return;
  try {
    await getPassword(serviceName, probeAccount);
  } catch {
    // 系统凭据库实际不可用（最常见的原因：容器内没有 D-Bus / Secret Service）。
    backendId = null;
    if (!fileBackendConfigured(environment)) return;
    try {
      await initBackend((backend) => backend.id === 'file');
      backendId = (await getKeyring()).id;
    } catch {
      backendId = null;
    }
  }
}

export class SecretStore {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {}

  async status() {
    await initializeKeyring(this.environment);
    return { available: backendId !== null, backend: backendId, envFallback: true };
  }

  async get(account: string, environmentName?: string) {
    await initializeKeyring(this.environment);
    if (backendId) {
      try {
        const value = await getPassword(serviceName, keyringAccount(account));
        if (value) return { value, source: 'keyring' as const };
      } catch {
        // An unavailable or locked keyring falls through to the explicit environment variable.
      }
    }
    const value = environmentName ? this.environment[environmentName]?.trim() : undefined;
    return value ? { value, source: 'environment' as const } : { value: null, source: 'none' as const };
  }

  async set(account: string, value: string) {
    await initializeKeyring(this.environment);
    // 这里只做诊断，替代方案由调用方按各自场景补充（模型模板 vs 引擎令牌）。
    if (!backendId) throw new Error('系统安全凭据库不可用。');
    await setPassword(serviceName, keyringAccount(account), value);
  }

  async delete(account: string) {
    await initializeKeyring(this.environment);
    if (!backendId) throw new Error('系统安全凭据库不可用。');
    await deletePassword(serviceName, keyringAccount(account));
  }
}
