import crypto from 'node:crypto';
import type {
  BackupCapabilities, BackupCleanupPreview, BackupObject, BackupPlan, BackupRestore, BackupRun,
  BackupRunStatus, BackupScope, BackupSnapshot, BackupTarget, BackupTargetRun, BackupTargetRunState,
  BackupVault,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

const DEFAULT_CAPABILITIES: BackupCapabilities = { resumableUpload: false, delete: true, remoteChecksum: false, list: true };

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function parseList(value: unknown, limit = 200): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))].slice(0, limit);
}

/** 备份相关数据库访问。不含加密与网络逻辑。 */
export class BackupStore {
  constructor(private readonly database: ServiceDatabase) {}

  private get connection() {
    return this.database.connection;
  }

  // ---------------------------------------------------------------- 仓库

  getVault(id: string): BackupVault | null {
    const row = this.connection.prepare('SELECT * FROM backup_vaults WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      formatVersion: Number(row.format_version ?? 1),
      kdf: parseJson<BackupVault['kdf']>(row.kdf_json, { algorithm: 'scrypt', salt: '', N: 16_384, r: 8, p: 1, keyLength: 32 }),
      wrappedMasterKey: parseJson<BackupVault['wrappedMasterKey']>(row.wrapped_master_key_json, { algorithm: 'aes-256-gcm', nonce: '', ciphertext: '' }),
      ...(row.recovery_wrap_json ? { recoveryWrap: parseJson<NonNullable<BackupVault['recoveryWrap']>>(row.recovery_wrap_json, undefined as never) } : {}),
      unlockPolicy: String(row.unlock_policy ?? 'manual') as BackupVault['unlockPolicy'],
      rememberedOnDevice: Boolean(row.remembered),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  /** 单工作区一个仓库：没有 id 时返回最早创建的那个，页面可直接进入。 */
  getPrimaryVault(): BackupVault | null {
    const row = this.connection.prepare('SELECT id FROM backup_vaults ORDER BY created_at LIMIT 1').get() as { id?: string } | undefined;
    return row?.id ? this.getVault(String(row.id)) : null;
  }

  listVaults(): BackupVault[] {
    return (this.connection.prepare('SELECT id FROM backup_vaults ORDER BY created_at').all() as Array<{ id: string }>)
      .map((row) => this.getVault(String(row.id))!).filter(Boolean);
  }

  saveVault(vault: BackupVault): void {
    this.connection.prepare(`INSERT INTO backup_vaults
      (id,format_version,kdf_json,wrapped_master_key_json,recovery_wrap_json,unlock_policy,remembered,credential_account,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        format_version=excluded.format_version,kdf_json=excluded.kdf_json,wrapped_master_key_json=excluded.wrapped_master_key_json,
        recovery_wrap_json=excluded.recovery_wrap_json,unlock_policy=excluded.unlock_policy,remembered=excluded.remembered,
        updated_at=excluded.updated_at`)
      .run(
        vault.id, vault.formatVersion, JSON.stringify(vault.kdf), JSON.stringify(vault.wrappedMasterKey),
        vault.recoveryWrap ? JSON.stringify(vault.recoveryWrap) : null, vault.unlockPolicy, vault.rememberedOnDevice ? 1 : 0,
        'backup-vault:' + vault.id, vault.createdAt, vault.updatedAt,
      );
  }

  // ---------------------------------------------------------------- 目标

  getTarget(id: string): BackupTarget | null {
    const row = this.connection.prepare('SELECT * FROM backup_targets WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      kind: String(row.kind) as BackupTarget['kind'],
      accountLabel: String(row.account_label ?? ''),
      rootPath: String(row.root_path ?? ''),
      vaultId: String(row.vault_id),
      connected: Boolean(row.connected),
      capabilities: { ...DEFAULT_CAPABILITIES, ...parseJson<Partial<BackupCapabilities>>(row.capabilities_json, {}) },
      ...(row.last_error ? { lastError: String(row.last_error) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  /** local_test 适配器需要本地目录；单独读取，不混进对外契约。 */
  getTargetLocalDirectory(id: string): string | null {
    const row = this.connection.prepare('SELECT local_directory FROM backup_targets WHERE id=?').get(id) as { local_directory?: string | null } | undefined;
    return row?.local_directory ?? null;
  }

  listTargets(vaultId?: string): BackupTarget[] {
    const rows = vaultId
      ? this.connection.prepare('SELECT id FROM backup_targets WHERE vault_id=? ORDER BY created_at').all(vaultId)
      : this.connection.prepare('SELECT id FROM backup_targets ORDER BY created_at').all();
    return (rows as Array<{ id: string }>).map((row) => this.getTarget(String(row.id))!).filter(Boolean);
  }

  saveTarget(input: {
    id?: string;
    vaultId: string;
    kind: BackupTarget['kind'];
    accountLabel: string;
    rootPath: string;
    localDirectory?: string | null;
    capabilities: BackupCapabilities;
    connected?: boolean;
    lastError?: string | null;
  }): BackupTarget {
    const existing = input.id ? this.getTarget(input.id) : null;
    const id = existing?.id ?? input.id ?? crypto.randomUUID();
    const now = nowIso();
    const localDirectory = input.localDirectory === undefined
      ? (existing ? this.getTargetLocalDirectory(id) : null)
      : input.localDirectory;
    this.connection.prepare(`INSERT INTO backup_targets
      (id,vault_id,kind,account_label,root_path,local_directory,credential_account,connected,capabilities_json,last_error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        kind=excluded.kind,account_label=excluded.account_label,root_path=excluded.root_path,
        local_directory=COALESCE(excluded.local_directory,backup_targets.local_directory),
        connected=excluded.connected,capabilities_json=excluded.capabilities_json,last_error=excluded.last_error,
        updated_at=excluded.updated_at`)
      .run(
        id, input.vaultId, input.kind, input.accountLabel.slice(0, 200), input.rootPath.slice(0, 400),
        localDirectory, 'backup-target:' + id, (input.connected ?? true) ? 1 : 0, JSON.stringify(input.capabilities),
        input.lastError ?? null, existing?.createdAt ?? now, now,
      );
    return this.getTarget(id)!;
  }

  setTargetError(id: string, message: string | null): void {
    this.connection.prepare('UPDATE backup_targets SET last_error=?,updated_at=? WHERE id=?').run(message, nowIso(), id);
  }

  /** 删除目标不删除云端数据，也不影响其他目标。 */
  deleteTarget(id: string): boolean {
    const result = this.connection.prepare('DELETE FROM backup_targets WHERE id=?').run(id);
    return Number(result.changes) > 0;
  }

  // ---------------------------------------------------------------- 计划

  getPlan(id: string): BackupPlan | null {
    const row = this.connection.prepare('SELECT * FROM backup_plans WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      scope: String(row.scope) as BackupScope,
      activityIds: parseJson<string[]>(row.activity_ids_json, []),
      works: parseJson<string[]>(row.works_json, []),
      targetIds: parseJson<string[]>(row.target_ids_json, []),
      frequency: String(row.frequency ?? 'manual') as BackupPlan['frequency'],
      dailyTime: String(row.daily_time ?? '03:00'),
      ...(row.weekday === null || row.weekday === undefined ? {} : { weekday: Number(row.weekday) }),
      timezone: String(row.timezone ?? 'Asia/Shanghai'),
      ...(row.next_run_at ? { nextRunAt: String(row.next_run_at) } : {}),
      enabled: Boolean(row.enabled),
      retainCount: Number(row.retain_count ?? 10),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listPlans(): BackupPlan[] {
    return (this.connection.prepare('SELECT id FROM backup_plans ORDER BY created_at').all() as Array<{ id: string }>)
      .map((row) => this.getPlan(String(row.id))!).filter(Boolean);
  }

  savePlan(input: {
    id?: string;
    name: string;
    scope: BackupScope;
    activityIds: string[];
    works: string[];
    targetIds: string[];
    frequency: BackupPlan['frequency'];
    dailyTime: string;
    weekday?: number | null;
    timezone: string;
    nextRunAt?: string | null;
    enabled: boolean;
    retainCount: number;
  }): BackupPlan {
    const existing = input.id ? this.getPlan(input.id) : null;
    const id = existing?.id ?? input.id ?? crypto.randomUUID();
    const now = nowIso();
    this.connection.prepare(`INSERT INTO backup_plans
      (id,name,scope,activity_ids_json,works_json,target_ids_json,frequency,daily_time,weekday,timezone,next_run_at,enabled,retain_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,scope=excluded.scope,activity_ids_json=excluded.activity_ids_json,works_json=excluded.works_json,
        target_ids_json=excluded.target_ids_json,frequency=excluded.frequency,daily_time=excluded.daily_time,
        weekday=excluded.weekday,timezone=excluded.timezone,next_run_at=excluded.next_run_at,enabled=excluded.enabled,
        retain_count=excluded.retain_count,updated_at=excluded.updated_at`)
      .run(
        id, input.name.slice(0, 120), input.scope, JSON.stringify(parseList(input.activityIds, 100)), JSON.stringify(parseList(input.works, 50)),
        JSON.stringify(parseList(input.targetIds, 20)), input.frequency, input.dailyTime,
        input.frequency === 'weekly' ? (input.weekday ?? 1) : null, input.timezone,
        input.nextRunAt ?? null, input.enabled ? 1 : 0, Math.min(Math.max(Math.trunc(input.retainCount) || 10, 1), 200),
        existing?.createdAt ?? now, now,
      );
    return this.getPlan(id)!;
  }

  deletePlan(id: string): boolean {
    const result = this.connection.prepare('DELETE FROM backup_plans WHERE id=?').run(id);
    return Number(result.changes) > 0;
  }

  listDuePlans(now = new Date()): BackupPlan[] {
    return (this.connection.prepare(
      "SELECT id FROM backup_plans WHERE enabled=1 AND frequency<>'manual' AND (next_run_at IS NULL OR next_run_at<=?) ORDER BY next_run_at LIMIT 10",
    ).all(now.toISOString()) as Array<{ id: string }>).map((row) => this.getPlan(String(row.id))!).filter(Boolean);
  }

  // ---------------------------------------------------------------- 运行

  createRun(input: {
    planId?: string | null;
    planName: string;
    trigger: BackupRun['trigger'];
    scope: BackupScope;
    configSnapshot: Record<string, unknown>;
  }): BackupRun {
    const id = crypto.randomUUID();
    const now = nowIso();
    this.connection.prepare(`INSERT INTO backup_runs
      (id,plan_id,plan_name,trigger,status,phase,scope,config_snapshot_json,created_at,updated_at)
      VALUES (?,?,?,?,'queued','waiting',?,?,?,?)`)
      .run(id, input.planId ?? null, input.planName.slice(0, 120), input.trigger, input.scope, JSON.stringify(input.configSnapshot), now, now);
    return this.getRun(id)!;
  }

  getRun(id: string): BackupRun | null {
    const row = this.connection.prepare('SELECT * FROM backup_runs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const targets = (this.connection.prepare(`SELECT t.*, s.kind target_kind, s.account_label target_label
      FROM backup_target_runs t LEFT JOIN backup_targets s ON s.id=t.target_id WHERE t.run_id=? ORDER BY t.updated_at`)
      .all(id) as Record<string, unknown>[]).map((entry): BackupTargetRun => ({
      targetId: String(entry.target_id),
      targetLabel: String(entry.target_label ?? ''),
      kind: String(entry.target_kind ?? 'local_test') as BackupTarget['kind'],
      state: String(entry.state) as BackupTargetRunState,
      uploadedObjects: Number(entry.uploaded_objects ?? 0),
      uploadedBytes: Number(entry.uploaded_bytes ?? 0),
      totalObjects: Number(entry.total_objects ?? 0),
      totalBytes: Number(entry.total_bytes ?? 0),
      ...(entry.error_code ? { errorCode: String(entry.error_code) } : {}),
      ...(entry.error_message ? { errorMessage: String(entry.error_message) } : {}),
      manifestPublished: Boolean(entry.manifest_published),
      updatedAt: String(entry.updated_at),
    }));
    return {
      id: String(row.id),
      ...(row.plan_id ? { planId: String(row.plan_id) } : {}),
      planName: String(row.plan_name ?? ''),
      trigger: String(row.trigger) as BackupRun['trigger'],
      status: String(row.status) as BackupRunStatus,
      phase: String(row.phase) as BackupRun['phase'],
      ...(row.snapshot_id ? { snapshotId: String(row.snapshot_id) } : {}),
      scope: String(row.scope) as BackupScope,
      ...(row.progress_label ? { progressLabel: String(row.progress_label) } : {}),
      uploadedBytes: Number(row.uploaded_bytes ?? 0),
      contentBytes: Number(row.content_bytes ?? 0),
      objectCount: Number(row.object_count ?? 0),
      reusedObjectCount: Number(row.reused_object_count ?? 0),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      targets,
      ...(row.started_at ? { startedAt: String(row.started_at) } : {}),
      ...(row.finished_at ? { finishedAt: String(row.finished_at) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listRuns(limit = 30): BackupRun[] {
    return (this.connection.prepare('SELECT id FROM backup_runs ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 100)) as Array<{ id: string }>)
      .map((row) => this.getRun(String(row.id))!).filter(Boolean);
  }

  updateRun(id: string, patch: Partial<{
    status: BackupRunStatus;
    phase: BackupRun['phase'];
    snapshotId: string | null;
    progressLabel: string | null;
    uploadedBytes: number;
    contentBytes: number;
    objectCount: number;
    reusedObjectCount: number;
    errorMessage: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>): void {
    const columns: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => { columns.push(column + '=?'); values.push(value); };
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.phase !== undefined) push('phase', patch.phase);
    if (patch.snapshotId !== undefined) push('snapshot_id', patch.snapshotId);
    if (patch.progressLabel !== undefined) push('progress_label', patch.progressLabel);
    if (patch.uploadedBytes !== undefined) push('uploaded_bytes', patch.uploadedBytes);
    if (patch.contentBytes !== undefined) push('content_bytes', patch.contentBytes);
    if (patch.objectCount !== undefined) push('object_count', patch.objectCount);
    if (patch.reusedObjectCount !== undefined) push('reused_object_count', patch.reusedObjectCount);
    if (patch.errorMessage !== undefined) push('error_message', patch.errorMessage);
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt);
    if (patch.finishedAt !== undefined) push('finished_at', patch.finishedAt);
    if (!columns.length) return;
    push('updated_at', nowIso());
    values.push(id);
    this.connection.prepare('UPDATE backup_runs SET ' + columns.join(',') + ' WHERE id=?').run(...values as never[]);
  }

  getRunConfig(id: string): Record<string, unknown> {
    const row = this.connection.prepare('SELECT config_snapshot_json FROM backup_runs WHERE id=?').get(id) as { config_snapshot_json?: string } | undefined;
    return parseJson<Record<string, unknown>>(row?.config_snapshot_json, {});
  }

  findRunningRun(): BackupRun | null {
    const row = this.connection.prepare("SELECT id FROM backup_runs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get() as { id?: string } | undefined;
    return row?.id ? this.getRun(String(row.id)) : null;
  }

  /** 服务重启：把未结束的运行与恢复标记为中断，不伪造成功。 */
  interruptDanglingRuns(): number {
    const now = nowIso();
    const result = this.connection.prepare(
      // 处于「等待解锁」的运行不是中断，解锁后仍要补做一次。
      "UPDATE backup_runs SET status='interrupted', error_message=COALESCE(error_message,'服务重启导致中断'), progress_label='已中断', finished_at=?, updated_at=? WHERE status IN ('queued','running') AND COALESCE(phase,'') <> 'waiting_unlock'",
    ).run(now, now);
    this.connection.prepare("UPDATE backup_restore_runs SET status='interrupted', error_message=COALESCE(error_message,'服务重启导致中断'), progress_label='已中断', updated_at=? WHERE status IN ('queued','running')").run(now);
    return Number(result.changes);
  }

  // ---------------------------------------------------------------- 每目标状态

  upsertTargetRun(input: {
    runId: string;
    snapshotId: string;
    targetId: string;
    state: BackupTargetRunState;
    uploadedObjects?: number;
    uploadedBytes?: number;
    totalObjects?: number;
    totalBytes?: number;
    manifestPublished?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): void {
    const now = nowIso();
    this.connection.prepare(`INSERT INTO backup_target_runs
      (id,run_id,snapshot_id,target_id,state,uploaded_objects,uploaded_bytes,total_objects,total_bytes,manifest_published,error_code,error_message,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(snapshot_id,target_id) DO UPDATE SET
        run_id=excluded.run_id,state=excluded.state,uploaded_objects=excluded.uploaded_objects,uploaded_bytes=excluded.uploaded_bytes,
        total_objects=excluded.total_objects,total_bytes=excluded.total_bytes,manifest_published=excluded.manifest_published,
        error_code=excluded.error_code,error_message=excluded.error_message,updated_at=excluded.updated_at`)
      .run(
        crypto.randomUUID(), input.runId, input.snapshotId, input.targetId, input.state,
        input.uploadedObjects ?? 0, input.uploadedBytes ?? 0, input.totalObjects ?? 0, input.totalBytes ?? 0,
        input.manifestPublished ? 1 : 0, input.errorCode ?? null, input.errorMessage ?? null, now,
      );
  }

  getTargetRun(snapshotId: string, targetId: string): BackupTargetRun | null {
    const row = this.connection.prepare(`SELECT t.*, s.kind target_kind, s.account_label target_label
      FROM backup_target_runs t LEFT JOIN backup_targets s ON s.id=t.target_id WHERE t.snapshot_id=? AND t.target_id=?`)
      .get(snapshotId, targetId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      targetId: String(row.target_id),
      targetLabel: String(row.target_label ?? ''),
      kind: String(row.target_kind ?? 'local_test') as BackupTarget['kind'],
      state: String(row.state) as BackupTargetRunState,
      uploadedObjects: Number(row.uploaded_objects ?? 0),
      uploadedBytes: Number(row.uploaded_bytes ?? 0),
      totalObjects: Number(row.total_objects ?? 0),
      totalBytes: Number(row.total_bytes ?? 0),
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      manifestPublished: Boolean(row.manifest_published),
      updatedAt: String(row.updated_at),
    };
  }

  listTargetRuns(snapshotId: string): BackupTargetRun[] {
    const rows = this.connection.prepare(
      'SELECT target_id FROM backup_target_runs WHERE snapshot_id=? ORDER BY updated_at',
    ).all(snapshotId) as Array<{ target_id: string }>;
    return rows.map((row) => this.getTargetRun(snapshotId, String(row.target_id))!).filter(Boolean);
  }

  /** 该目标上所有已发布且仍可恢复的版本，按时间从新到旧。 */
  listPublishedSnapshotIds(targetId: string): string[] {
    return (this.connection.prepare(
      'SELECT snapshot_id FROM backup_target_runs WHERE target_id=? AND manifest_published=1 ORDER BY updated_at DESC',
    ).all(targetId) as Array<{ snapshot_id: string }>).map((row) => String(row.snapshot_id));
  }

  /** 让某个版本在单个目标上退出可恢复集合（逻辑过期），不影响其它目标。 */
  deleteTargetRun(snapshotId: string, targetId: string): void {
    this.connection.prepare('DELETE FROM backup_target_runs WHERE snapshot_id=? AND target_id=?').run(snapshotId, targetId);
  }

  deleteSnapshotObjectRefs(targetId: string, snapshotId: string): void {
    this.connection.prepare('DELETE FROM backup_snapshot_objects WHERE target_id=? AND snapshot_id=?').run(targetId, snapshotId);
  }

  deleteTargetObject(targetId: string, objectId: string): void {
    this.connection.prepare('DELETE FROM backup_target_objects WHERE target_id=? AND object_id=?').run(targetId, objectId);
  }

  /** 等待解锁的运行：解锁后各补做一次，不每分钟重复生成失败记录。 */
  listWaitingUnlockRuns(): BackupRun[] {
    return (this.connection.prepare(
      "SELECT id FROM backup_runs WHERE status='queued' AND phase='waiting_unlock' ORDER BY created_at LIMIT 10",
    ).all() as Array<{ id: string }>).map((row) => this.getRun(String(row.id))!).filter(Boolean);
  }

  /** 是否有真正在跑的运行；等待解锁的运行不占用执行位。 */
  hasActiveRun(): boolean {
    return Boolean(this.connection.prepare(
      "SELECT 1 FROM backup_runs WHERE status IN ('queued','running') AND COALESCE(phase,'') <> 'waiting_unlock' LIMIT 1",
    ).get());
  }

  // ---------------------------------------------------------------- 版本

  createSnapshot(input: {
    id?: string;
    vaultId: string;
    scope: BackupScope;
    scopeDetail: Record<string, unknown>;
    description: string;
    objectCount: number;
    contentBytes: number;
    missingCount: number;
    stagedDirectory: string | null;
  }): BackupSnapshot {
    const id = input.id ?? crypto.randomUUID();
    const now = nowIso();
    this.connection.prepare(`INSERT INTO backup_snapshots
      (id,vault_id,scope,scope_detail_json,description,object_count,content_bytes,uploaded_bytes,missing_count,retained,manifest_object_id,staged_directory,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,0,?,0,NULL,?,?,?)`)
      .run(id, input.vaultId, input.scope, JSON.stringify(input.scopeDetail), input.description.slice(0, 300),
        input.objectCount, input.contentBytes, input.missingCount, input.stagedDirectory, now, now);
    return this.getSnapshot(id)!;
  }

  getSnapshot(id: string): BackupSnapshot | null {
    const row = this.connection.prepare('SELECT * FROM backup_snapshots WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      vaultId: String(row.vault_id),
      scope: String(row.scope) as BackupScope,
      createdAt: String(row.created_at),
      objectCount: Number(row.object_count ?? 0),
      contentBytes: Number(row.content_bytes ?? 0),
      uploadedBytes: Number(row.uploaded_bytes ?? 0),
      retained: Boolean(row.retained),
      publishedTargetIds: (this.connection.prepare('SELECT target_id FROM backup_target_runs WHERE snapshot_id=? AND manifest_published=1').all(id) as Array<{ target_id: string }>).map((entry) => String(entry.target_id)),
      missingCount: Number(row.missing_count ?? 0),
      description: String(row.description ?? ''),
    };
  }

  /** 只有已发布到至少一个目标的版本才进入可恢复列表。 */
  listRecoverableSnapshots(limit = 50): BackupSnapshot[] {
    const rows = this.connection.prepare(`SELECT s.id FROM backup_snapshots s
      WHERE EXISTS (SELECT 1 FROM backup_target_runs t WHERE t.snapshot_id=s.id AND t.manifest_published=1)
      ORDER BY s.created_at DESC LIMIT ?`).all(Math.min(Math.max(limit, 1), 200)) as Array<{ id: string }>;
    return rows.map((row) => this.getSnapshot(String(row.id))!).filter(Boolean);
  }

  listAllSnapshots(limit = 50): BackupSnapshot[] {
    return (this.connection.prepare('SELECT id FROM backup_snapshots ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 200)) as Array<{ id: string }>)
      .map((row) => this.getSnapshot(String(row.id))!).filter(Boolean);
  }

  getSnapshotStaging(id: string): string | null {
    const row = this.connection.prepare('SELECT staged_directory FROM backup_snapshots WHERE id=?').get(id) as { staged_directory?: string | null } | undefined;
    return row?.staged_directory ?? null;
  }

  getSnapshotScopeDetail(id: string): Record<string, unknown> {
    const row = this.connection.prepare('SELECT scope_detail_json FROM backup_snapshots WHERE id=?').get(id) as { scope_detail_json?: string } | undefined;
    return parseJson<Record<string, unknown>>(row?.scope_detail_json, {});
  }

  setSnapshotManifestObject(id: string, objectId: string): void {
    this.connection.prepare('UPDATE backup_snapshots SET manifest_object_id=?,updated_at=? WHERE id=?').run(objectId, nowIso(), id);
  }

  getSnapshotManifestObject(id: string): string | null {
    const row = this.connection.prepare('SELECT manifest_object_id FROM backup_snapshots WHERE id=?').get(id) as { manifest_object_id?: string | null } | undefined;
    return row?.manifest_object_id ?? null;
  }

  addSnapshotUploadedBytes(id: string, uploadedBytes: number): void {
    this.connection.prepare('UPDATE backup_snapshots SET uploaded_bytes=uploaded_bytes+?,updated_at=? WHERE id=?').run(uploadedBytes, nowIso(), id);
  }

  setSnapshotRetained(id: string, retained: boolean): void {
    this.connection.prepare('UPDATE backup_snapshots SET retained=?,updated_at=? WHERE id=?').run(retained ? 1 : 0, nowIso(), id);
  }

  /** 记录某目标发布该版本时引用的对象集合，供清理判断独占对象。 */
  saveSnapshotObjects(targetId: string, snapshotId: string, vaultId: string, objectIds: string[]): void {
    this.connection.prepare(`INSERT INTO backup_snapshot_objects(target_id,snapshot_id,vault_id,object_ids_json,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(target_id,snapshot_id) DO UPDATE SET object_ids_json=excluded.object_ids_json,updated_at=excluded.updated_at`)
      .run(targetId, snapshotId, vaultId, JSON.stringify([...new Set(objectIds)]), nowIso());
  }

  listSnapshotObjectIds(snapshotId: string): string[] {
    const row = this.connection.prepare('SELECT object_ids_json FROM backup_snapshot_objects WHERE snapshot_id=?').get(snapshotId) as { object_ids_json?: string } | undefined;
    return parseJson<string[]>(row?.object_ids_json, []);
  }

  deleteSnapshot(id: string): void {
    this.connection.prepare('DELETE FROM backup_snapshots WHERE id=?').run(id);
  }

  // ---------------------------------------------------------------- 对象

  findObjectByContent(vaultId: string, contentHash: string): BackupObject | null {
    const row = this.connection.prepare('SELECT * FROM backup_objects WHERE vault_id=? AND content_hash=?').get(vaultId, contentHash) as Record<string, unknown> | undefined;
    return row ? this.mapObject(row) : null;
  }

  getObject(id: string): BackupObject | null {
    const row = this.connection.prepare('SELECT * FROM backup_objects WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapObject(row) : null;
  }

  private mapObject(row: Record<string, unknown>): BackupObject {
    return {
      id: String(row.id),
      contentHash: String(row.content_hash),
      cipherHash: String(row.cipher_hash),
      plaintextBytes: Number(row.plaintext_bytes ?? 0),
      cipherBytes: Number(row.cipher_bytes ?? 0),
      ...(row.local_cipher_path ? { localCipherPath: String(row.local_cipher_path) } : {}),
      pinned: Boolean(row.pinned),
      createdAt: String(row.created_at),
    };
  }

  saveObject(input: {
    /** 对象身份必须与密文头部记录的一致，否则解密时认证会失败。 */
    id?: string;
    vaultId: string;
    contentHash: string;
    cipherHash: string;
    plaintextBytes: number;
    cipherBytes: number;
    localCipherPath: string | null;
  }): BackupObject {
    const existing = this.findObjectByContent(input.vaultId, input.contentHash);
    if (existing) return existing;
    this.connection.prepare(`INSERT INTO backup_objects
      (id,vault_id,content_hash,cipher_hash,plaintext_bytes,cipher_bytes,local_cipher_path,pinned,created_at)
      VALUES (?,?,?,?,?,?,?,0,?) ON CONFLICT(vault_id,content_hash) DO NOTHING`)
      .run(input.id ?? crypto.randomUUID(), input.vaultId, input.contentHash, input.cipherHash, input.plaintextBytes, input.cipherBytes, input.localCipherPath, nowIso());
    return this.findObjectByContent(input.vaultId, input.contentHash)!;
  }

  updateObjectCipherPath(id: string, localCipherPath: string | null): void {
    this.connection.prepare('UPDATE backup_objects SET local_cipher_path=? WHERE id=?').run(localCipherPath, id);
  }

  setObjectPinned(id: string, pinned: boolean): void {
    this.connection.prepare('UPDATE backup_objects SET pinned=? WHERE id=?').run(pinned ? 1 : 0, id);
  }

  deleteObject(id: string): void {
    this.connection.prepare('DELETE FROM backup_objects WHERE id=?').run(id);
  }

  getTargetObject(targetId: string, vaultId: string, objectId: string): { uploaded: boolean; verified: boolean; verifyMethod?: string; remoteKey: string; remoteId?: string } | null {
    const row = this.connection.prepare('SELECT * FROM backup_target_objects WHERE target_id=? AND vault_id=? AND object_id=?')
      .get(targetId, vaultId, objectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      uploaded: Boolean(row.uploaded),
      verified: Boolean(row.verified),
      ...(row.verify_method ? { verifyMethod: String(row.verify_method) } : {}),
      remoteKey: String(row.remote_key),
      ...(row.remote_id ? { remoteId: String(row.remote_id) } : {}),
    };
  }

  upsertTargetObject(input: {
    targetId: string;
    vaultId: string;
    objectId: string;
    remoteKey: string;
    uploaded: boolean;
    verified: boolean;
    verifyMethod?: string | null;
    remoteId?: string | null;
    uploadedBytes?: number;
  }): void {
    this.connection.prepare(`INSERT INTO backup_target_objects
      (id,target_id,object_id,vault_id,remote_key,uploaded,verified,verify_method,remote_id,uploaded_bytes,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(target_id,vault_id,object_id) DO UPDATE SET
        remote_key=excluded.remote_key,uploaded=excluded.uploaded,verified=excluded.verified,
        verify_method=excluded.verify_method,remote_id=excluded.remote_id,uploaded_bytes=excluded.uploaded_bytes,
        updated_at=excluded.updated_at`)
      .run(
        crypto.randomUUID(), input.targetId, input.objectId, input.vaultId, input.remoteKey,
        input.uploaded ? 1 : 0, input.verified ? 1 : 0, input.verifyMethod ?? null, input.remoteId ?? null,
        input.uploadedBytes ?? 0, nowIso(),
      );
  }

  // ---------------------------------------------------------------- 恢复

  createRestore(input: {
    vaultId: string;
    snapshotId: string;
    targetId: string;
    scope: BackupScope;
    totalBytes: number;
    mode: BackupRestore['mode'] | null;
  }): BackupRestore {
    const id = crypto.randomUUID();
    const now = nowIso();
    this.connection.prepare(`INSERT INTO backup_restore_runs
      (id,vault_id,snapshot_id,target_id,scope,status,phase,total_bytes,mode,created_at,updated_at)
      VALUES (?,?,?,?,?,'queued','waiting',?,?,?,?)`)
      .run(id, input.vaultId, input.snapshotId, input.targetId, input.scope, input.totalBytes, input.mode ?? null, now, now);
    return this.getRestore(id)!;
  }

  getRestore(id: string): BackupRestore | null {
    const row = this.connection.prepare('SELECT * FROM backup_restore_runs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      vaultId: String(row.vault_id),
      snapshotId: String(row.snapshot_id),
      targetId: String(row.target_id),
      scope: String(row.scope) as BackupScope,
      status: String(row.status) as BackupRestore['status'],
      phase: String(row.phase) as BackupRestore['phase'],
      ...(row.progress_label ? { progressLabel: String(row.progress_label) } : {}),
      verifiedBytes: Number(row.verified_bytes ?? 0),
      totalBytes: Number(row.total_bytes ?? 0),
      ...(row.mode ? { mode: String(row.mode) as NonNullable<BackupRestore['mode']> } : {}),
      ...(row.pre_restore_backup_path ? { preRestoreBackupPath: String(row.pre_restore_backup_path) } : {}),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listRestores(limit = 20): BackupRestore[] {
    return (this.connection.prepare('SELECT id FROM backup_restore_runs ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 50)) as Array<{ id: string }>)
      .map((row) => this.getRestore(String(row.id))!).filter(Boolean);
  }

  updateRestore(id: string, patch: Partial<{
    status: BackupRestore['status'];
    phase: BackupRestore['phase'];
    progressLabel: string | null;
    verifiedBytes: number;
    totalBytes: number;
    preRestoreBackupPath: string | null;
    errorMessage: string | null;
  }>): void {
    const columns: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => { columns.push(column + '=?'); values.push(value); };
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.phase !== undefined) push('phase', patch.phase);
    if (patch.progressLabel !== undefined) push('progress_label', patch.progressLabel);
    if (patch.verifiedBytes !== undefined) push('verified_bytes', patch.verifiedBytes);
    if (patch.totalBytes !== undefined) push('total_bytes', patch.totalBytes);
    if (patch.preRestoreBackupPath !== undefined) push('pre_restore_backup_path', patch.preRestoreBackupPath);
    if (patch.errorMessage !== undefined) push('error_message', patch.errorMessage);
    if (!columns.length) return;
    push('updated_at', nowIso());
    values.push(id);
    this.connection.prepare('UPDATE backup_restore_runs SET ' + columns.join(',') + ' WHERE id=?').run(...values as never[]);
  }

  // ---------------------------------------------------------------- 保留清理

  /**
   * 清理预览：按目标计算淘汰集合与只被这些版本引用的独占对象。
   * 不读远端，也不修改任何状态。
   */
  buildCleanupPreview(targetId: string, retainCount: number, objectReferences: Map<string, string[]>): BackupCleanupPreview {
    const published = (this.connection.prepare(
      'SELECT snapshot_id FROM backup_target_runs WHERE target_id=? AND manifest_published=1 ORDER BY updated_at DESC',
    ).all(targetId) as Array<{ snapshot_id: string }>).map((row) => String(row.snapshot_id));
    const snapshots = published.map((id) => this.getSnapshot(id)).filter((item): item is BackupSnapshot => Boolean(item));
    const kept: string[] = [];
    const removable: string[] = [];
    let seen = 0;
    for (const snapshot of snapshots) {
      // 长期保留的版本不参与自动淘汰。
      if (snapshot.retained) { kept.push(snapshot.id); continue; }
      seen += 1;
      if (seen <= Math.max(retainCount, 1)) kept.push(snapshot.id);
      else removable.push(snapshot.id);
    }
    const removableSet = new Set(removable);
    const keptSet = new Set(kept);
    let deletableObjectCount = 0;
    let reclaimableBytes = 0;
    for (const [objectId, snapshotIds] of objectReferences) {
      const referencedByRemovable = snapshotIds.some((id) => removableSet.has(id));
      const referencedByKept = snapshotIds.some((id) => keptSet.has(id));
      if (!referencedByRemovable || referencedByKept) continue;
      const object = this.getObject(objectId);
      if (!object || object.pinned) continue;
      deletableObjectCount += 1;
      reclaimableBytes += object.cipherBytes;
    }
    const target = this.getTarget(targetId);
    const physicalDeleteSupported = target?.capabilities.delete ?? false;
    return {
      targetId,
      removableSnapshotIds: removable,
      retainedSnapshotIds: kept,
      deletableObjectCount,
      reclaimableBytes,
      physicalDeleteSupported,
      notice: physicalDeleteSupported
        ? '将删除 ' + removable.length + ' 个版本与 ' + deletableObjectCount + ' 个独占对象。'
        : '该网盘不支持删除：版本只会逻辑过期，历史文件需要在网盘端手动清理。',
    };
  }

  /** 某目标上所有已发布版本引用的对象集合；用于判断独占对象。 */
  objectReferencesForTarget(targetId: string): Map<string, string[]> {
    const rows = this.connection.prepare('SELECT snapshot_id, object_ids_json FROM backup_snapshot_objects WHERE target_id=?')
      .all(targetId) as Array<{ snapshot_id: string; object_ids_json: string }>;
    const refs = new Map<string, string[]>();
    for (const row of rows) {
      for (const objectId of parseJson<string[]>(row.object_ids_json, [])) {
        const list = refs.get(objectId) ?? [];
        list.push(String(row.snapshot_id));
        refs.set(objectId, list);
      }
    }
    return refs;
  }
}
