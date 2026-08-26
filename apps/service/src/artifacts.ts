import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';

export async function persistArtifact(
  config: ServiceConfig,
  database: ServiceDatabase,
  input: { appId: string; taskId: string; sourceUrl: string; contentType?: string | null },
) {
  const existing = database.connection.prepare('SELECT id FROM artifacts WHERE task_id=? AND provider_url=?').get(input.taskId, input.sourceUrl) as { id: string } | undefined;
  if (existing) return existing.id;
  const response = await fetch(input.sourceUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`artifact download returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const id = randomUUID();
  const suffix = extname(new URL(input.sourceUrl).searchParams.get('filename') ?? '') || '.bin';
  const directory = resolve(config.artifactDirectory, input.appId);
  const path = resolve(directory, `${id}${suffix}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path, bytes, { flag: 'wx' });
  try {
    database.connection.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, input.appId, input.taskId, input.sourceUrl, path, input.contentType ?? response.headers.get('content-type'), bytes.length, 0, nowIso());
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
  await enforceRetention(database, input.appId);
  return id;
}

export async function readArtifact(database: ServiceDatabase, artifactId: string) {
  const row = database.connection.prepare('SELECT local_path,content_type FROM artifacts WHERE id=?').get(artifactId) as { local_path: string | null; content_type: string | null } | undefined;
  if (!row?.local_path) return null;
  return { bytes: await readFile(row.local_path), contentType: row.content_type };
}

export async function removeArtifact(database: ServiceDatabase, artifactId: string, appId: string) {
  const row = database.connection.prepare('SELECT local_path FROM artifacts WHERE id=? AND app_id=?').get(artifactId, appId) as { local_path: string | null } | undefined;
  if (!row) return false;
  if (row.local_path) await unlink(row.local_path).catch(() => undefined);
  database.connection.prepare('DELETE FROM artifacts WHERE id=? AND app_id=?').run(artifactId, appId);
  return true;
}

export async function enforceRetention(database: ServiceDatabase, appId: string, currentTime = Date.now()) {
  const policy = database.connection.prepare('SELECT mode,ttl_days,max_bytes FROM storage_policies WHERE app_id=?').get(appId) as { mode: string; ttl_days: number | null; max_bytes: number | null } | undefined;
  if (!policy || policy.mode === 'keep') return 0;
  const rows = database.connection.prepare('SELECT id,local_path,byte_size,created_at,pinned FROM artifacts WHERE app_id=? ORDER BY created_at ASC').all(appId) as { id: string; local_path: string | null; byte_size: number; created_at: string; pinned: number }[];
  const remove = new Set<string>();
  if (policy.mode === 'ttl' && policy.ttl_days) {
    const cutoff = currentTime - policy.ttl_days * 86_400_000;
    for (const row of rows) if (!row.pinned && Date.parse(row.created_at) < cutoff) remove.add(row.id);
  }
  if (policy.mode === 'quota' && policy.max_bytes) {
    let total = rows.reduce((sum, row) => sum + row.byte_size, 0);
    for (const row of rows) {
      if (total <= policy.max_bytes) break;
      if (row.pinned) continue;
      remove.add(row.id); total -= row.byte_size;
    }
  }
  for (const row of rows) {
    if (!remove.has(row.id)) continue;
    if (row.local_path) await unlink(row.local_path).catch(() => undefined);
    database.connection.prepare('DELETE FROM artifacts WHERE id=?').run(row.id);
  }
  return remove.size;
}

export async function enforceAllRetention(database: ServiceDatabase, currentTime = Date.now()) {
  const apps = database.connection.prepare("SELECT app_id FROM storage_policies WHERE mode != 'keep'").all() as { app_id: string }[];
  let removed = 0;
  for (const app of apps) removed += await enforceRetention(database, app.app_id, currentTime);
  return removed;
}
