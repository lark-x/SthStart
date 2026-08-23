import type { AppDescriptor } from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';

type Fetcher = typeof fetch;

function readVersion(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['version', 'app_version', 'appVersion']) {
    if (typeof record[key] === 'string' && record[key].trim() !== '') return record[key];
  }
  return null;
}

export async function inspectLinshe(config: ServiceConfig, fetcher: Fetcher = fetch): Promise<AppDescriptor> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.probeTimeoutMs);
  let status: AppDescriptor['status'] = 'offline';
  let version: string | null = config.linsheVersion;

  try {
    const response = await fetcher(config.linsheHealthUrl, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    status = response.ok ? 'online' : 'offline';
    if (response.ok) version = readVersion(await response.json().catch(() => null)) ?? config.linsheVersion;
  } catch {
    status = 'offline';
  } finally {
    clearTimeout(timeout);
  }

  return {
    id: 'linshe',
    name: '邻舍.EXE',
    description: '拥有长期记忆、情绪与视觉生成能力的本地 AI 角色陪伴应用。',
    launchUrl: config.linsheAppUrl,
    status,
    version,
    sourceRevision: config.linsheSourceRevision,
    capabilities: ['chat', 'moments', 'image-generation', 'memory'],
    checkedAt: new Date().toISOString(),
  };
}
