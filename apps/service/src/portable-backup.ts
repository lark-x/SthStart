import { copyFileSync, statSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from './config.js';

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', (err) => rejectPromise(err));
  });
}

export interface BackupItem {
  storage?: 'artifact' | 'note';
  id: string;
  backupRelativePath: string;
  byteSize: number;
  sha256: string;
  contentType: string | null;
  referencedBy: string[];
}

export interface PortableBackupManifest {
  schemaVersion: 1;
  type: 'sthstart-portable-backup';
  createdAt: string;
  databases: string[];
  databaseRoles?: { service: string; narrative?: string };
  totalArtifacts: number;
  totalBytes: number;
  missingFiles: Array<{ id: string; originalPath: string; referencedBy: string[] }>;
  items: BackupItem[];
  reconfigurationNotice: string;
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function createPortableBackup(options?: {
  destination?: string;
  config?: ReturnType<typeof readConfig>;
}): Promise<{ destination: string; manifest: PortableBackupManifest }> {
  const config = options?.config || readConfig();
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const destination = resolve(
    options?.destination || resolve(dirname(config.databasePath), 'backups', `portable-${timestamp}`)
  );
  mkdirSync(destination, { recursive: true });

  if (!existsSync(config.databasePath)) throw new Error('Service database not found; no backup was created.');
  const backupDatabases: string[] = [];
  const databaseRoles: { service: string; narrative?: string } = { service: basename(config.databasePath) };
  const dbPaths = [
    { name: 'service', path: config.databasePath },
    { name: 'narrative', path: config.narrativeDatabasePath },
  ];

  // 1. Consistent SQLite snapshots via VACUUM INTO
  for (const dbEntry of dbPaths) {
    if (!existsSync(dbEntry.path)) continue;
    const destDbName = dbEntry.name === 'narrative' && basename(dbEntry.path) === databaseRoles.service ? 'narrative-backup.sqlite' : basename(dbEntry.path);
    if (dbEntry.name === 'narrative') databaseRoles.narrative = destDbName;
    const destDbPath = resolve(destination, destDbName);
    const db = new DatabaseSync(dbEntry.path, { readOnly: false });
    try {
      db.exec(`VACUUM INTO ${sqlString(destDbPath)}`);
      backupDatabases.push(destDbName);
    } finally {
      db.close();
    }
  }

  // 2. Scan references from snapshotted service db
  const snapshottedServiceDbPath = resolve(destination, basename(config.databasePath));
  const backupArtifactsDir = resolve(destination, 'artifacts');
  mkdirSync(backupArtifactsDir, { recursive: true });

  const items: BackupItem[] = [];
  const missingFiles: PortableBackupManifest['missingFiles'] = [];
  let totalBytes = 0;

  if (existsSync(snapshottedServiceDbPath)) {
    const db = new DatabaseSync(snapshottedServiceDbPath, { readOnly: true });
    try {
      // Query artifacts table
      const artifactRows = db.prepare(`
        SELECT id, app_id, local_path, byte_size, sha256, content_type, file_status
        FROM artifacts
      `).all() as Array<{
        id: string;
        app_id: string;
        local_path: string | null;
        byte_size: number;
        sha256: string | null;
        content_type: string | null;
        file_status: string;
      }>;

      // Query references to know which apps use them
      const refRows = db.prepare(`
        SELECT artifact_id, app_id, ref_type
        FROM artifact_references
      `).all() as Array<{ artifact_id: string; app_id: string; ref_type: string }>;

      const refMap = new Map<string, Set<string>>();
      for (const r of refRows) {
        if (!refMap.has(r.artifact_id)) refMap.set(r.artifact_id, new Set());
        refMap.get(r.artifact_id)!.add(`${r.app_id}:${r.ref_type}`);
      }

      for (const row of artifactRows) {
        const refs = Array.from(refMap.get(row.id) || [row.app_id || 'general']);
        if (!row.local_path || !existsSync(row.local_path)) {
          missingFiles.push({
            id: row.id,
            originalPath: row.local_path || 'null',
            referencedBy: refs,
          });
          continue;
        }

        // Compute relative path
        const ext = basename(row.local_path).includes('.')
          ? `.${basename(row.local_path).split('.').pop()}`
          : '';
        const backupFileName = `${row.id}${ext}`;
        const targetFilePath = resolve(backupArtifactsDir, backupFileName);
        const relPath = `artifacts/${backupFileName}`;

        copyFileSync(row.local_path, targetFilePath);
        const sha = (await computeFileSha256(targetFilePath)) || row.sha256 || '';
        const size = statSync(targetFilePath).size;
        totalBytes += size;

        items.push({
          id: row.id,
          backupRelativePath: relPath,
          byteSize: size,
          sha256: sha,
          contentType: row.content_type,
          referencedBy: refs,
        });
      }
      // Notebook uploads still use their own table and may not have Artifact rows.
      const notes = (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='note_assets'").get() ? db.prepare('SELECT id,local_path,content_type FROM note_assets').all() : []) as Array<{ id: string; local_path: string; content_type: string }>;
      for (const note of notes) {
        if (!existsSync(note.local_path)) {
          missingFiles.push({ id: note.id, originalPath: note.local_path, referencedBy: ['notebook:attachment'] });
          continue;
        }
        const relativePath = 'artifacts/note_' + note.id + '_' + basename(note.local_path);
        const target = resolve(destination, relativePath);
        copyFileSync(note.local_path, target);
        const size = statSync(target).size;
        items.push({ storage: 'note', id: note.id, backupRelativePath: relativePath, byteSize: size,
          sha256: await computeFileSha256(target), contentType: note.content_type, referencedBy: ['notebook:attachment'] });
        totalBytes += size;
      }
    } finally {
      db.close();
    }
  }

  // 3. Write Portable Manifest
  const manifest: PortableBackupManifest = {
    schemaVersion: 1,
    type: 'sthstart-portable-backup',
    createdAt: new Date().toISOString(),
    databases: backupDatabases,
    databaseRoles,
    totalArtifacts: items.length,
    totalBytes,
    missingFiles,
    items,
    reconfigurationNotice:
      '系统钥匙串未打包；数据库配置会保留，请妥善保存备份，并在新机器重新配置不可用的凭据。备份和恢复前请停止服务。',
  };

  writeFileSync(
    resolve(destination, 'backup-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return { destination, manifest };
}

export async function restorePortableBackup(
  backupDir: string,
  options?: {
    confirm?: boolean;
    config?: ReturnType<typeof readConfig>;
  }
): Promise<{ restoredDatabases: string[]; restoredArtifacts: number }> {
  if (!options?.confirm) {
    throw new Error('Refusing to restore data without --confirm flag.');
  }

  const config = options?.config || readConfig();
  const manifestPath = resolve(backupDir, 'backup-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Invalid backup directory: missing backup-manifest.json in ${backupDir}`);
  }

  const manifest: PortableBackupManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const verification = await verifyPortableBackup(backupDir);
  if (!verification.valid) throw new Error('Backup verification failed: ' + verification.errors.join('; '));
  const restoredDatabases: string[] = [];

  // Ensure target directories exist
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(dirname(config.narrativeDatabasePath), { recursive: true });
  mkdirSync(config.artifactDirectory, { recursive: true });

  // 1. Restore databases
  const targetDbMap: Record<string, string> = {
    [manifest.databaseRoles?.service || basename(config.databasePath)]: config.databasePath,
    [manifest.databaseRoles?.narrative || basename(config.narrativeDatabasePath)]: config.narrativeDatabasePath,
  };

  for (const dbName of manifest.databases) {
    const srcPath = resolve(backupDir, dbName);
    const targetPath = targetDbMap[dbName];
    if (targetPath && existsSync(srcPath)) {
      // Remove WAL/SHM files
      for (const suffix of ['-wal', '-shm']) {
        rmSync(`${targetPath}${suffix}`, { force: true });
      }
      copyFileSync(srcPath, targetPath);
      restoredDatabases.push(targetPath);
    }
  }

  // 2. Restore artifacts
  let restoredArtifacts = 0;
  for (const item of manifest.items) {
    const srcArtifact = resolve(backupDir, item.backupRelativePath);
    if (existsSync(srcArtifact)) {
      const destArtifactName = basename(item.backupRelativePath);
      const destArtifactPath = resolve(config.artifactDirectory, destArtifactName);
      copyFileSync(srcArtifact, destArtifactPath);
      restoredArtifacts += 1;
    }
  }

  // 3. Update artifacts.local_path in restored SQLite database to point to the current machine's artifactDirectory
  if (existsSync(config.databasePath)) {
    const db = new DatabaseSync(config.databasePath, { readOnly: false });
    try {
      for (const item of manifest.items) {
        const destArtifactName = basename(item.backupRelativePath);
        const newLocalPath = resolve(config.artifactDirectory, destArtifactName);
        const table = item.storage === 'note' ? 'note_assets' : 'artifacts';
        db.prepare(`UPDATE ${table} SET local_path = ? WHERE id = ?`).run(newLocalPath, item.id);
      }
    } finally {
      db.close();
    }
  }

  return { restoredDatabases, restoredArtifacts };
}

export async function verifyPortableBackup(
  backupDir: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const manifestPath = resolve(backupDir, 'backup-manifest.json');
  if (!existsSync(manifestPath)) {
    return { valid: false, errors: ['missing backup-manifest.json'] };
  }

  let manifest: PortableBackupManifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch { return { valid: false, errors: ['invalid backup manifest'] }; }
  if (manifest.type !== 'sthstart-portable-backup' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.items) || !manifest.databases?.length) {
    return { valid: false, errors: ['invalid backup manifest'] };
  }
  const base = resolve(backupDir) + '/';
  if ([...manifest.databases, ...manifest.items.map(i => i.backupRelativePath)].some(p => typeof p !== 'string' || !resolve(backupDir, p).startsWith(base))) {
    return { valid: false, errors: ['backup path is outside archive'] };
  }
  for (const missing of manifest.missingFiles || []) errors.push('missing original resource: ' + missing.id);

  // Verify databases
  for (const dbName of manifest.databases) {
    const dbPath = resolve(backupDir, dbName);
    if (!existsSync(dbPath)) {
      errors.push(`missing database file: ${dbName}`);
    } else {
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try { if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') errors.push('invalid database: ' + dbName); } finally { db.close(); }
      } catch { errors.push('unreadable database: ' + dbName); }
    }
  }

  // Verify artifacts
  for (const item of manifest.items) {
    const filePath = resolve(backupDir, item.backupRelativePath);
    if (!existsSync(filePath)) {
      errors.push(`missing artifact file: ${item.backupRelativePath}`);
      continue;
    }
    const actualSha = await computeFileSha256(filePath);
    if (item.sha256 && actualSha !== item.sha256) {
      errors.push(`checksum mismatch for ${item.backupRelativePath}: expected ${item.sha256}, got ${actualSha}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
