import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { readConfig } from './config.js';
import { ServiceDatabase, nowIso } from './database.js';
import { createPortableBackup, verifyPortableBackup } from './portable-backup.js';

test('portable backup resolves a legacy Windows path through the active storage key', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'sthstart-portable-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const artifactDirectory = resolve(root, 'artifacts');
  const storageKey = 'characters/windows-current.png';
  const sourcePath = resolve(artifactDirectory, storageKey);
  const bytes = Buffer.from('portable-backup-from-storage-key');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);

  const databasePath = resolve(root, 'service.db');
  const database = new ServiceDatabase(databasePath);
  try {
    const now = nowIso();
    database.connection.prepare(
      `INSERT INTO managed_apps (id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
       VALUES ('activities','活动','portable-test-hash','["artifact"]',1,?,?)`,
    ).run(now, now);
    database.connection.prepare(
      `INSERT INTO artifacts
       (id,app_id,local_path,storage_key,content_type,byte_size,sha256,file_status,created_at,updated_at)
       VALUES ('windows-image','activities',?,?,?,?,?,'missing',?,?)`,
    ).run(
      'C:\\legacy-host\\data\\artifacts\\characters\\windows-current.png',
      storageKey,
      'image/png',
      bytes.length,
      sha256,
      now,
      now,
    );
    database.connection.prepare(
      `INSERT INTO artifact_references (id,artifact_id,app_id,ref_type,ref_id,created_at)
       VALUES ('ref-windows-image','windows-image','activities','activity_asset','activity-1',?)`,
    ).run(now);
  } finally {
    database.close();
  }

  const config = readConfig({
    STHSTART_DATABASE_PATH: databasePath,
    STHSTART_NARRATIVE_DATABASE_PATH: resolve(root, 'narrative.db'),
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const backup = await createPortableBackup({ config, destination: resolve(root, 'backup') });

  assert.equal(backup.manifest.totalArtifacts, 1);
  assert.equal(backup.manifest.missingFiles.length, 0);
  assert.equal(backup.manifest.items[0].sha256, sha256);
  assert.deepEqual(await readFile(resolve(backup.destination, backup.manifest.items[0].backupRelativePath)), bytes);
  assert.deepEqual(await verifyPortableBackup(backup.destination), { valid: true, errors: [] });
});
