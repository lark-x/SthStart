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

async function initializeKeyring() {
  if (initialized) return;
  initialized = true;
  try {
    await initBackend((backend) => backend.id !== 'file' && backend.id !== 'null');
    backendId = (await getKeyring()).id;
  } catch {
    backendId = null;
  }
}

export class SecretStore {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {}

  async status() {
    await initializeKeyring();
    return { available: backendId !== null, backend: backendId, envFallback: true };
  }

  async get(account: string, environmentName?: string) {
    await initializeKeyring();
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
    await initializeKeyring();
    if (!backendId) throw new Error('系统安全凭据库不可用；请改用环境变量。');
    await setPassword(serviceName, keyringAccount(account), value);
  }

  async delete(account: string) {
    await initializeKeyring();
    if (!backendId) throw new Error('系统安全凭据库不可用。');
    await deletePassword(serviceName, keyringAccount(account));
  }
}
