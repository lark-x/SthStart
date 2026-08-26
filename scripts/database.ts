import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from '../apps/service/src/config.js';
import { ServiceDatabase, SERVICE_DATABASE_MIGRATIONS } from '../apps/service/src/database.js';
import { NarrativeDatabase, NARRATIVE_DATABASE_MIGRATIONS } from '../apps/service/src/narrative-database.js';

const command = process.argv[2] ?? 'check';
const config = readConfig();
const paths = [config.databasePath, config.narrativeDatabasePath];

function integrity(path: string, full = false) {
  if (!existsSync(path)) return { path, exists: false, result: 'missing' };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const pragma = full ? 'PRAGMA integrity_check' : 'PRAGMA quick_check';
    const row = database.prepare(pragma).get() as Record<string, string>;
    return { path, exists: true, result: Object.values(row)[0] ?? 'unknown' };
  } finally { database.close(); }
}

function migrationCheck(path: string, expected: number) {
  if (!existsSync(path)) return { path, exists: false, result: 'missing', version: 0, expected };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const table = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get();
    if (!table) return { path, exists: true, result: 'unversioned', version: 0, expected };
    const row = database.prepare('SELECT COALESCE(MAX(version),0) version FROM schema_migrations').get() as { version: number };
    return { path, exists: true, result: row.version === expected ? 'ok' : 'migration_mismatch', version: row.version, expected };
  } finally { database.close(); }
}

function sqlString(value: string) { return `'${value.replaceAll("'", "''")}'`; }

if (command === 'reset') {
  if (!process.argv.includes('--confirm')) throw new Error('Refusing to reset data without --confirm.');
  for (const path of paths) for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  rmSync(config.artifactDirectory, { recursive: true, force: true });
  rmSync(resolve(dirname(config.databasePath), 'notebook'), { recursive: true, force: true });
  const service = new ServiceDatabase(config.databasePath); service.close();
  const narrative = new NarrativeDatabase(config.narrativeDatabasePath); narrative.close();
  console.log(JSON.stringify({ reset: paths, artifacts: config.artifactDirectory }, null, 2));
} else if (command === 'migrate') {
  const service = new ServiceDatabase(config.databasePath); service.close();
  const narrative = new NarrativeDatabase(config.narrativeDatabasePath); narrative.close();
  console.log(JSON.stringify({ migrated: paths }, null, 2));
} else if (command === 'backup') {
  const destination = resolve(process.argv[3] ?? resolve(dirname(config.databasePath), 'backups', new Date().toISOString().replaceAll(':', '-')));
  mkdirSync(destination, { recursive: true });
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const database = new DatabaseSync(path, { readOnly: false });
    try { database.exec(`VACUUM INTO ${sqlString(resolve(destination, basename(path)))}`); }
    finally { database.close(); }
  }
  if (existsSync(config.databasePath)) {
    const db = new DatabaseSync(config.databasePath, { readOnly: true });
    const artifacts = db.prepare('SELECT id, app_id, local_path, byte_size, sha256, content_type, file_status, created_at, updated_at FROM artifacts ORDER BY created_at').all() as Array<{ id: string; app_id: string; local_path: string | null; byte_size: number; sha256: string | null; content_type: string | null; file_status: string; created_at: string; updated_at: string | null }>;
    db.close();

    const manifestItems = artifacts.map((row) => {
      let exists = false;
      let relPath: string | null = null;
      if (row.local_path) {
        exists = existsSync(row.local_path);
        relPath = relative(config.artifactDirectory, row.local_path);
      }
      return {
        id: row.id,
        appId: row.app_id,
        relativePath: relPath,
        byteSize: row.byte_size,
        sha256: row.sha256,
        contentType: row.content_type,
        fileStatus: exists ? (row.file_status || 'ready') : 'missing',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      notice: 'Database backup contains metadata and references only. Media binary files are stored in the artifact storage directory and must be backed up separately.',
      totalArtifacts: manifestItems.length,
      totalBytes: manifestItems.reduce((sum, item) => sum + item.byteSize, 0),
      items: manifestItems,
    };

    writeFileSync(resolve(destination, 'media-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }
  console.log(JSON.stringify({ backup: destination }, null, 2));
} else if (command === 'restore') {
  if (!process.argv.includes('--confirm')) throw new Error('Refusing to restore data without --confirm.');
  const source = resolve(process.argv[3] ?? '');
  if (!source || !existsSync(source)) throw new Error('Backup directory does not exist.');
  const files = new Set(readdirSync(source));
  for (const path of paths) {
    const name = basename(path);
    if (!files.has(name)) throw new Error(`Backup is missing ${name}.`);
  }
  for (const path of paths) {
    for (const suffix of ['-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    copyFileSync(resolve(source, basename(path)), path);
  }
  console.log(JSON.stringify({ restored: source, databases: paths }, null, 2));
} else if (command === 'check' || command === 'integrity') {
  const expected = [SERVICE_DATABASE_MIGRATIONS.at(-1)?.version ?? 0, NARRATIVE_DATABASE_MIGRATIONS.at(-1)?.version ?? 0];
  const results = command === 'check' ? paths.map((path, index) => migrationCheck(path, expected[index])) : paths.map((path) => integrity(path, true));
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.exists && result.result !== 'ok')) process.exitCode = 1;
} else throw new Error(`Unknown database command: ${command}`);
