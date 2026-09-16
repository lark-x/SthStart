import { deleteJson, getJson, postJson } from '@/app/lib/api-client';
import type {
  BackupCleanupPreview, BackupPlan, BackupRestore, BackupRestorePreview, BackupRun, BackupSnapshot,
  BackupTarget, BackupVault,
} from '@sthstart/contracts';

export interface BackupTargetView extends BackupTarget {
  localDirectory?: string | null;
}

export interface BackupPlanView extends BackupPlan {
  nextRunAt?: string;
}

export interface QuarkCapabilityReport {
  status: string;
  cliPath: string | null;
  cliVersion: string | null;
  platform: string;
  deleteSupported: boolean;
  items: Array<{ key: string; question: string; result: string; detail: string }>;
  notes: string[];
  checkedAt: string;
}

export interface BackupOverview {
  vault: BackupVault | null;
  unlocked: boolean;
  maintenance: { active: boolean; startedAt: string | null; label: string | null };
  targets: BackupTargetView[];
  plans: BackupPlanView[];
  runs: BackupRun[];
  snapshots: BackupSnapshot[];
  recoverable: BackupSnapshot[];
  lastRun: BackupRun | null;
  quarkReport: QuarkCapabilityReport;
  paths: { base: string; stagingRoot: string; objectDirectory: string; restoreRoot: string };
}

const base = '/api/admin/backups';

export function fetchBackupOverview(): Promise<BackupOverview> {
  return getJson<BackupOverview>(base + '/overview');
}

export function createBackupVault(password: string): Promise<{ vault: BackupVault; recoveryKey: string | null }> {
  return postJson(base + '/vault', { password, generateRecoveryKey: true });
}

export function unlockBackupVault(input: { password?: string; recoveryKey?: string; remember?: boolean }): Promise<{ unlocked: boolean; remembered: boolean; resumedRuns: string[] }> {
  return postJson(base + '/vault/unlock', input);
}

export function lockBackupVault(): Promise<{ unlocked: boolean }> {
  return postJson(base + '/vault/lock', {});
}

export function changeBackupPassword(input: { currentPassword: string; newPassword: string }): Promise<{ credentialsUpdated: number; targets: Array<{ targetId: string; updated: boolean; message: string }> }> {
  return postJson(base + '/vault/password', input);
}

export function saveBackupTarget(input: {
  kind: BackupTarget['kind'];
  accountLabel: string;
  rootPath: string;
  localDirectory?: string;
  credential?: string;
}): Promise<{ target: BackupTargetView }> {
  return postJson(base + '/targets', input);
}

export function removeBackupTarget(targetId: string): Promise<{ removed: boolean }> {
  return deleteJson(base + '/targets/' + encodeURIComponent(targetId));
}

export function verifyBackupTarget(targetId: string): Promise<{ connected: boolean; quota: { totalBytes: number | null; usedBytes: number | null } | null }> {
  return postJson(base + '/targets/' + encodeURIComponent(targetId) + '/verify', {});
}

/** 发起授权：返回官方授权地址，由用户在浏览器里完成登录。 */
export function startBackupOAuth(kind: 'google_drive' | 'onedrive', input: { clientId: string; clientSecret?: string; targetId?: string }): Promise<{ authorizationUrl: string }> {
  const query = new URLSearchParams({ clientId: input.clientId });
  if (input.clientSecret) query.set('clientSecret', input.clientSecret);
  if (input.targetId) query.set('targetId', input.targetId);
  return getJson(base + '/oauth/' + kind + '/start?' + query.toString());
}

export function saveBackupPlan(input: {
  id?: string;
  name?: string;
  scope: BackupPlan['scope'];
  activityIds?: string[];
  works?: string[];
  targetIds: string[];
  frequency: BackupPlan['frequency'];
  dailyTime?: string;
  weekday?: number;
  timezone?: string;
  enabled?: boolean;
  retainCount?: number;
}): Promise<{ plan: BackupPlanView }> {
  return postJson(base + '/plans', input);
}

export function removeBackupPlan(planId: string): Promise<{ removed: boolean }> {
  return deleteJson(base + '/plans/' + encodeURIComponent(planId));
}

export function runBackupPlan(planId: string): Promise<{ run: BackupRun }> {
  return postJson(base + '/plans/' + encodeURIComponent(planId) + '/run', {});
}

export function startBackupRun(input: {
  planId?: string;
  scope?: BackupPlan['scope'];
  targetIds?: string[];
  activityIds?: string[];
  works?: string[];
} = {}): Promise<{ run: BackupRun }> {
  return postJson(base + '/runs', input);
}

export function retryBackupRun(runId: string): Promise<{ run: BackupRun }> {
  return postJson(base + '/runs/' + encodeURIComponent(runId) + '/retry', {});
}

export function cancelBackupRun(runId: string): Promise<{ cancelled: boolean }> {
  return postJson(base + '/runs/' + encodeURIComponent(runId) + '/cancel', {});
}

export function fetchBackupSnapshots(): Promise<{ items: BackupSnapshot[]; recoverable: BackupSnapshot[] }> {
  return getJson(base + '/snapshots');
}

export function setSnapshotRetained(snapshotId: string, retained: boolean): Promise<{ snapshot: BackupSnapshot }> {
  return postJson(base + '/snapshots/' + encodeURIComponent(snapshotId) + '/retain', { retained });
}

export function fetchRestorePreview(snapshotId: string, targetId: string): Promise<{ preview: BackupRestorePreview }> {
  const query = new URLSearchParams({ snapshotId, targetId });
  return getJson(base + '/restore-preview?' + query.toString());
}

export function fetchCleanupPreview(targetId: string, retainCount: number): Promise<{ preview: BackupCleanupPreview }> {
  const query = new URLSearchParams({ targetId, retainCount: String(retainCount) });
  return getJson(base + '/cleanup-preview?' + query.toString());
}

export function runCleanup(targetId: string, retainCount: number): Promise<{ result: { expiredSnapshotIds: string[]; deletedObjectCount: number; reclaimedBytes: number; physicalDelete: boolean; notice: string; failures: string[] } }> {
  return postJson(base + '/cleanup', { targetId, retainCount });
}

export function startRestore(input: { snapshotId: string; targetId: string; mode: 'activity_copy' | 'knowledge_import' | 'workspace_replace'; confirm?: boolean }): Promise<{ restore: BackupRestore }> {
  return postJson(base + '/restores', input);
}

export function fetchRestores(): Promise<{ items: BackupRestore[] }> {
  return getJson(base + '/restores');
}

export function fetchQuarkCapability(): Promise<{ report: QuarkCapabilityReport }> {
  return getJson(base + '/quark/capability');
}

export function fetchTaskLogs(taskId: string, limit = 100): Promise<{ items: Array<{ eventId?: string; timestamp: string; level: string; message: string }>; nextCursor: string | null }> {
  const query = new URLSearchParams({ taskId, limit: String(limit) });
  return getJson('/api/admin/logs/history?' + query.toString());
}

/**
 * 新设备：连接已有仓库。
 * 已有目标时传 targetId；本机还没有仓库时传网盘类型、目录与远端仓库 ID。
 */
export function connectRemoteVault(input: {
  targetId?: string;
  kind?: BackupTarget['kind'];
  rootPath?: string;
  localDirectory?: string;
  vaultId?: string;
  import?: boolean;
}): Promise<{ remoteVault: BackupVault; imported: boolean; targetId: string | null }> {
  return postJson(base + '/vault/connect-remote', input);
}

export function fetchRemoteSnapshots(targetId: string): Promise<{ items: Array<{ snapshotId: string; size: number; adopted: boolean }> }> {
  const query = new URLSearchParams({ targetId });
  return getJson(base + '/snapshots/remote?' + query.toString());
}

export function adoptRemoteSnapshot(input: { targetId: string; snapshotId: string }): Promise<{ result: { snapshotId: string; adopted: boolean; objectCount: number }; snapshot: BackupSnapshot }> {
  return postJson(base + '/snapshots/adopt', input);
}

/** 补传到其它目标：继续使用原快照，不重新捕获工作区。 */
export function replicateSnapshot(snapshotId: string, targetIds: string[]): Promise<{ run: BackupRun }> {
  return postJson(base + '/snapshots/' + encodeURIComponent(snapshotId) + '/replicate', { targetIds });
}
