import {
  createPortableBackup,
  restorePortableBackup,
  verifyPortableBackup,
  type BackupItem,
  type PortableBackupManifest,
} from '../apps/service/src/portable-backup.js';

export {
  createPortableBackup,
  restorePortableBackup,
  verifyPortableBackup,
  type BackupItem,
  type PortableBackupManifest,
};

// CLI entry point
const isDirectCli =
  process.argv[1] &&
  (process.argv[1].endsWith('portable-backup.ts') || process.argv[1].endsWith('portable-backup.js'));

if (isDirectCli) {
  const cmd = process.argv[2] || 'backup';
  const targetArg = process.argv[3];
  const confirm = process.argv.includes('--confirm');

  if (cmd === 'backup') {
    createPortableBackup({ destination: targetArg })
      .then((res) => {
        console.log(`[portable-backup] Backup completed successfully to: ${res.destination}`);
        console.log(
          `[portable-backup] Artifacts packaged: ${res.manifest.totalArtifacts}, size: ${(res.manifest.totalBytes / (1024 * 1024)).toFixed(2)} MB`
        );
        if (res.manifest.missingFiles.length > 0) {
          console.warn(
            `[portable-backup] Warning: ${res.manifest.missingFiles.length} missing files recorded in manifest.`
          );
        }
      })
      .catch((err) => {
        console.error('[portable-backup] Backup failed:', err);
        process.exitCode = 1;
      });
  } else if (cmd === 'restore') {
    if (!targetArg) {
      console.error('Usage: tsx scripts/portable-backup.ts restore <backup-dir> --confirm');
      process.exit(1);
    }
    restorePortableBackup(targetArg, { confirm })
      .then((res) => {
        console.log(`[portable-backup] Restore completed successfully!`);
        console.log(`[portable-backup] Databases restored: ${res.restoredDatabases.join(', ')}`);
        console.log(`[portable-backup] Artifacts restored: ${res.restoredArtifacts}`);
      })
      .catch((err) => {
        console.error('[portable-backup] Restore failed:', err);
        process.exitCode = 1;
      });
  } else if (cmd === 'verify') {
    if (!targetArg) {
      console.error('Usage: tsx scripts/portable-backup.ts verify <backup-dir>');
      process.exit(1);
    }
    verifyPortableBackup(targetArg)
      .then((res) => {
        if (res.valid) {
          console.log(`[portable-backup] Verification passed! All databases and artifacts are intact.`);
        } else {
          console.error(`[portable-backup] Verification failed:`, res.errors);
          process.exitCode = 1;
        }
      })
      .catch((err) => {
        console.error('[portable-backup] Verify error:', err);
        process.exitCode = 1;
      });
  } else {
    console.error(`Unknown command: ${cmd}. Available: backup, restore, verify`);
    process.exit(1);
  }
}
