import type { NotebookSyncStatus } from '../local-store';

export interface LocalNoteBadge {
  label: string;
  status: NotebookSyncStatus;
}

/**
 * Presentation-only status for a note that exists in IndexedDB. The server list
 * is authoritative when it is available; without it, a cached synced note is
 * still a local copy and should be identified as such.
 */
export function localNoteBadge(
  status: NotebookSyncStatus | undefined,
  hasServerList: boolean,
): LocalNoteBadge | null {
  if (!status || status === 'deleted') return null;
  if (status === 'synced') return hasServerList ? null : { label: '本机缓存', status };
  const labels: Record<Exclude<NotebookSyncStatus, 'synced' | 'deleted'>, string> = {
    pending: '待同步',
    syncing: '同步中',
    error: '同步失败',
    conflict: '版本冲突',
  };
  return { label: labels[status], status };
}
