import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ServiceConfig {
  host: string;
  port: number;
  portalOrigins: readonly string[];
  linsheAppUrl: string;
  linsheHealthUrl: string;
  linsheVersion: string | null;
  linsheSourceRevision: string | null;
  probeTimeoutMs: number;
  databasePath: string;
  narrativeDatabasePath: string;
  artifactDirectory: string;
  adminToken: string | null;
  vectorDefaultUrl: string;
  imageSigningSecret: string;
  akashaMcpUrl: string | null;
  mcpTimeoutMs: number;
  linsheRoot: string;
  logDirectory: string;
}

interface LinsheMetadata {
  version: string | null;
  sourceRevision: string | null;
}

function discoverLinsheMetadata(): LinsheMetadata {
  const root = resolve(import.meta.dirname, '../../../upstream/linshe');
  let version: string | null = null;
  let sourceRevision: string | null = null;

  try {
    version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim() || null;
  } catch {
    // The service remains usable before the submodule is initialized.
  }

  try {
    sourceRevision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    // Source revision is optional metadata, never a startup dependency.
  }

  return { version, sourceRevision };
}

function integer(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function httpUrl(value: string, name: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function loopbackHost(value: string) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(value)) throw new Error('SERVICE_HOST must be a loopback host');
  return value;
}

function optionalSecret(value: string | undefined, name: string) {
  const secret = value?.trim();
  if (!secret) return null;
  if (secret.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return secret;
}

function optionalHttpUrl(value: string | undefined, name: string) {
  const normalized = value?.trim();
  return normalized ? httpUrl(normalized, name) : null;
}

export function readConfig(environment: Readonly<Record<string, string | undefined>> = process.env): ServiceConfig {
  const metadata = discoverLinsheMetadata();
  const adminToken = optionalSecret(environment.STHSTART_ADMIN_TOKEN, 'STHSTART_ADMIN_TOKEN');
  const signingSecret = optionalSecret(environment.STHSTART_IMAGE_SIGNING_SECRET, 'STHSTART_IMAGE_SIGNING_SECRET');
  const portalOrigins = (environment.PORTAL_ORIGINS ?? 'http://127.0.0.1:4173,http://localhost:4173')
    .split(',')
    .map((origin) => httpUrl(origin.trim(), 'PORTAL_ORIGINS'));

  return {
    host: loopbackHost(environment.SERVICE_HOST ?? '127.0.0.1'),
    port: integer(environment.SERVICE_PORT, 4100, 'SERVICE_PORT', 1, 65_535),
    portalOrigins,
    linsheAppUrl: httpUrl(environment.LINSHE_APP_URL ?? 'http://127.0.0.1:5173', 'LINSHE_APP_URL'),
    linsheHealthUrl: httpUrl(environment.LINSHE_HEALTH_URL ?? 'http://127.0.0.1:3099/api/health', 'LINSHE_HEALTH_URL'),
    linsheVersion: environment.LINSHE_VERSION?.trim() || metadata.version,
    linsheSourceRevision: environment.LINSHE_SOURCE_REVISION?.trim() || metadata.sourceRevision,
    probeTimeoutMs: integer(environment.PROBE_TIMEOUT_MS, 2_000, 'PROBE_TIMEOUT_MS', 100, 30_000),
    databasePath: resolve(environment.STHSTART_DATABASE_PATH ?? resolve(import.meta.dirname, '../../../data/sthstart.db')),
    narrativeDatabasePath: resolve(environment.STHSTART_NARRATIVE_DATABASE_PATH ?? resolve(import.meta.dirname, '../../../data/narrative.db')),
    artifactDirectory: resolve(environment.STHSTART_ARTIFACT_DIR ?? resolve(import.meta.dirname, '../../../data/artifacts')),
    adminToken,
    vectorDefaultUrl: httpUrl(environment.STHSTART_VECTOR_URL ?? 'http://127.0.0.1:8765', 'STHSTART_VECTOR_URL'),
    imageSigningSecret: signingSecret ?? adminToken ?? Buffer.from(randomBytes(32)).toString('hex'),
    akashaMcpUrl: optionalHttpUrl(environment.STHSTART_AKASHA_MCP_URL, 'STHSTART_AKASHA_MCP_URL'),
    mcpTimeoutMs: integer(environment.STHSTART_MCP_TIMEOUT_MS, 45_000, 'STHSTART_MCP_TIMEOUT_MS', 1_000, 120_000),
    linsheRoot: resolve(environment.STHSTART_LINSHE_ROOT ?? resolve(import.meta.dirname, '../../../upstream/linshe')),
    logDirectory: resolve(environment.STHSTART_LOG_DIR ?? resolve(import.meta.dirname, '../../../data/logs')),
  };
}
