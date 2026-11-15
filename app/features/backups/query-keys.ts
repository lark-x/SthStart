/** Owned by this domain; tuple shapes are a cache compatibility contract. */
export const backupKeys = {
  all: ['backups'] as const,
  overview: () => [...backupKeys.all, 'overview'] as const,
  snapshots: () => [...backupKeys.all, 'snapshots'] as const,
  restores: () => [...backupKeys.all, 'restores'] as const,
  restorePreview: (snapshotId: string, targetId: string) => [...backupKeys.all, 'restorePreview', snapshotId, targetId] as const,
  quark: () => [...backupKeys.all, 'quark'] as const,
};
