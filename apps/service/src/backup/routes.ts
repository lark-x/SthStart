import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  BackupPlanSave, BackupRestoreStart, BackupRunStart, BackupTarget, BackupTargetKind, BackupTargetSave, BackupVaultCreate,
  BackupVaultPasswordChange, BackupVaultUnlock,
} from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { RuntimeLogService } from '../runtime.js';
import type { SecretStore } from '../security.js';
import { backupMaintenance } from './capture.js';
import { backupPaths } from './layout.js';
import { createProvider, providerCapabilities, probeQuarkCapabilities } from './providers/index.js';
import { cleanupPreview, cleanupTarget } from './retention.js';
import type { BackupRestoreService } from './restore.js';
import type { BackupRunner } from './runner.js';
import { nextBackupRun } from './scheduler.js';
import type { BackupStore } from './store.js';
import type { BackupVaultService } from './vault.js';
import {
  createPkcePair, buildAuthorizationUrl, createState, exchangeAuthorizationCode,
} from './providers/oauth.js';
import { googleDriveEndpoints } from './providers/google-drive.js';
import { oneDriveEndpoints } from './providers/onedrive.js';

export interface BackupRouteOptions {
  config: ServiceConfig;
  database: ServiceDatabase;
  store: BackupStore;
  vaults: BackupVaultService;
  runner: BackupRunner;
  restores: BackupRestoreService;
  secrets: SecretStore;
  logs: RuntimeLogService;
  fetcher?: typeof fetch;
}

/** OAuth 回调的临时状态：只放内存，进程重启后重新发起授权即可。 */
interface PendingAuthorization { verifier: string; kind: BackupTargetKind; targetId: string | null; createdAt: number; clientId: string; clientSecret?: string }

function checkAdmin(config: ServiceConfig, request: FastifyRequest, reply: FastifyReply): boolean {
  if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
    reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
    return false;
  }
  return true;
}

/** 错误码 → 中文提示；未列出的错误原样返回 code 便于诊断。 */
const ERROR_MESSAGES: Record<string, string> = {
  backup_vault_missing: '还没有创建加密仓库，请先在「网盘与加密」里创建。',
  backup_locked: '仓库已锁定，请先解锁再继续。',
  backup_unlock_failed: '密码或恢复密钥不正确。',
  backup_recovery_key_not_configured: '该仓库没有配置恢复密钥。',
  backup_busy: '已有备份正在执行，请稍后再试。',
  backup_target_required: '请至少选择一个目标网盘。',
  backup_target_missing: '目标网盘不存在或已被删除。',
  backup_target_not_published: '该版本还没有完整发布到这个目标，不能恢复。',
  backup_snapshot_missing: '找不到这个备份版本。',
  backup_manifest_missing: '该版本的清单缺失，无法恢复。',
  backup_no_failed_target: '没有需要重试的目标。',
  backup_restore_confirm_required: '恢复整个工作区需要显式确认。',
  backup_activity_selection_required: '指定活动备份需要先选择活动。',
  backup_format_too_new: '该备份由更新版本的应用创建，请先升级应用再恢复。',
  backup_cipher_cache_missing: '本地密文缓存已丢失且远端没有可用副本，本次不能继续。',
  backup_remote_vault_missing: '远端没有找到仓库头，请确认目录与仓库 ID 是否正确。',
  backup_remote_vault_mismatch: '远端仓库 ID 与填写的不一致，请核对后重试。',
  backup_remote_vault_target_required: '请填写远端仓库 ID，并选择网盘类型与目录。',
  backup_snapshot_adopt_invalid: '请选择目标网盘与要找回的版本。',
  backup_target_directory_missing: '这个目标还没有配置本地目录。',
  backup_quark_unverified: '夸克网盘尚未完成能力联调，暂不参与备份。',
};

function errorResponse(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code ?? message.split(':')[0] ?? 'backup_failed';
  const status = message.includes('backup_locked') || message.includes('backup_unlock_failed') ? 409 : 400;
  return reply.code(status).send({ error: code, message: ERROR_MESSAGES[code] ?? message });
}

export function registerBackupRoutes(app: FastifyInstance, options: BackupRouteOptions): void {
  const { config, store, vaults, runner, restores, secrets } = options;
  const pending = new Map<string, PendingAuthorization>();

  /**
   * 维护窗口：捕获期间拒绝写入型业务请求，给出可重试的提示，
   * 而不是让用户在不知情的情况下写进一份「正在备份」的数据。
   * 备份自身的接口不拦截（否则无法查询进度）。
   */
  app.addHook('onRequest', async (request, reply) => {
    if (!backupMaintenance.state.active) return;
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    if (request.url.startsWith('/api/v1/admin/backups')) return;
    return reply.code(503).send({
      error: 'backup_maintenance',
      message: '正在创建备份快照（' + (backupMaintenance.state.label ?? '') + '），请稍后重试。草稿会保留在本地。',
      retryable: true,
    });
  });

  app.get('/api/v1/admin/backups/overview', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const vault = store.getPrimaryVault();
    const plans = store.listPlans();
    const runs = store.listRuns(20);
    const targets = store.listTargets();
    const lastSuccess = runs.find((run) => run.status === 'succeeded' || run.status === 'partial') ?? null;
    return {
      vault,
      unlocked: vault ? vaults.isUnlocked(vault.id) : false,
      maintenance: backupMaintenance.state,
      targets: targets.map((target) => ({
        ...target,
        capabilities: providerCapabilities(target.kind),
        localDirectory: store.getTargetLocalDirectory(target.id),
      })),
      plans,
      runs,
      snapshots: store.listAllSnapshots(20),
      recoverable: store.listRecoverableSnapshots(20),
      lastRun: lastSuccess,
      quota: null,
      quarkReport: probeQuarkCapabilities(),
      paths: backupPaths(config),
    };
  });

  // ---------------------------------------------------------------- 仓库

  app.post<{ Body: BackupVaultCreate }>('/api/v1/admin/backups/vault', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    if (store.getPrimaryVault()) return reply.code(409).send({ error: 'backup_vault_exists', message: '已经存在加密仓库。' });
    const body = request.body ?? ({ password: '' } as BackupVaultCreate);
    if (typeof body.password !== 'string' || body.password.length < 8) {
      return reply.code(400).send({ error: 'backup_password_too_short', message: '密码至少 8 个字符。' });
    }
    const created = vaults.createVault({ password: body.password, generateRecoveryKey: body.generateRecoveryKey });
    store.saveVault(created.vault);
    options.logs.append({ appId: 'sthstart', serviceId: 'backup', stream: 'system', level: 'info', message: '已创建加密仓库。', force: true, taskId: 'backup' });
    // 恢复密钥只在这里返回一次，之后不再可读取。
    return { vault: created.vault, recoveryKey: created.recoveryKey };
  });

  app.get('/api/v1/admin/backups/vault', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const vault = store.getPrimaryVault();
    return { vault, unlocked: vault ? vaults.isUnlocked(vault.id) : false };
  });

  app.post<{ Body: BackupVaultUnlock }>('/api/v1/admin/backups/vault/unlock', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const vault = store.getPrimaryVault();
    if (!vault) return errorResponse(reply, new Error('backup_vault_missing'));
    try {
      vaults.unlock(vault, { ...(request.body?.password ? { password: request.body.password } : {}), ...(request.body?.recoveryKey ? { recoveryKey: request.body.recoveryKey } : {}) });
    } catch (error) {
      return errorResponse(reply, error);
    }
    let remembered = false;
    if (request.body?.remember) {
      try {
        await vaults.remember(vault.id, { ...(request.body.password ? { password: request.body.password } : {}), ...(request.body.recoveryKey ? { recoveryKey: request.body.recoveryKey } : {}) });
        remembered = true;
      } catch {
        remembered = false;
      }
    }
    const policy = vaults.setUnlockPolicy(store.getVault(vault.id)!, remembered ? 'remember' : vault.unlockPolicy, remembered);
    store.saveVault(policy);
    // 解锁后把等待中的计划补做一次。
    const resumed = await runner.resumePending();
    return { unlocked: true, remembered, resumedRuns: resumed, vault: policy };
  });

  app.post('/api/v1/admin/backups/vault/lock', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const vault = store.getPrimaryVault();
    if (!vault) return errorResponse(reply, new Error('backup_vault_missing'));
    vaults.lock(vault.id);
    return { unlocked: false };
  });

  app.post<{ Body: BackupVaultPasswordChange }>('/api/v1/admin/backups/vault/password', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const vault = store.getPrimaryVault();
    if (!vault) return errorResponse(reply, new Error('backup_vault_missing'));
    const body = request.body;
    if (!body?.currentPassword || !body.newPassword || body.newPassword.length < 8) {
      return reply.code(400).send({ error: 'backup_password_invalid', message: '请提供当前密码与至少 8 个字符的新密码。' });
    }
    let updated;
    try {
      updated = vaults.changePassword(vault, { currentPassword: body.currentPassword, newPassword: body.newPassword });
    } catch (error) {
      return errorResponse(reply, error);
    }
    store.saveVault(updated);
    // 主密钥未变，无需重传媒体；但已记住的旧凭据必须更新，否则下次自动解锁会失败。
    let credentialsUpdated = 0;
    const results: Array<{ targetId: string; updated: boolean; message: string }> = [];
    if (vault.unlockPolicy === 'remember') {
      try {
        await vaults.remember(vault.id, { password: body.newPassword });
        credentialsUpdated = 1;
      } catch {
        credentialsUpdated = 0;
      }
    }
    for (const target of store.listTargets()) {
      try {
        const provider = await providerForTarget(target.id);
        const info = await provider.writeVaultHeader(target.vaultId, JSON.stringify(updated));
        results.push({ targetId: target.id, updated: true, message: '已更新（' + info.size + ' 字节）' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ targetId: target.id, updated: false, message: '仍需更新：' + message });
      }
    }
    return { vault: updated, credentialsUpdated, targets: results };
  });

  /**
   * 新设备：连接已有仓库。只读取远端仓库头，不依赖旧数据库；
   * 传 import 时把仓库头写入本机，之后就能解锁并登记远端版本。
   */
  app.post<{ Body: { targetId?: string; kind?: BackupTarget['kind']; rootPath?: string; localDirectory?: string; vaultId?: string; import?: boolean } }>('/api/v1/admin/backups/vault/connect-remote', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const result = await restores.connectRemoteVault({
        ...(request.body?.targetId ? { targetId: request.body.targetId } : {}),
        ...(request.body?.kind ? { kind: request.body.kind } : {}),
        ...(request.body?.rootPath !== undefined ? { rootPath: request.body.rootPath } : {}),
        ...(request.body?.localDirectory !== undefined ? { localDirectory: request.body.localDirectory } : {}),
        ...(request.body?.vaultId ? { vaultId: request.body.vaultId } : {}),
        import: request.body?.import === true,
      });
      if (!result.vault) return reply.code(404).send({ error: 'backup_remote_vault_missing', message: '远端没有找到仓库头。' });
      return { remoteVault: result.vault, imported: result.imported, targetId: result.targetId };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  // ---------------------------------------------------------------- 目标

  app.get('/api/v1/admin/backups/targets', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return {
      items: store.listTargets().map((target) => ({
        ...target,
        capabilities: providerCapabilities(target.kind),
        localDirectory: store.getTargetLocalDirectory(target.id),
      })),
    };
  });

  app.post<{ Body: BackupTargetSave }>('/api/v1/admin/backups/targets', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const vault = store.getPrimaryVault();
    if (!vault) return errorResponse(reply, new Error('backup_vault_missing'));
    const body = request.body;
    if (!body?.kind) return reply.code(400).send({ error: 'backup_target_invalid', message: '缺少网盘类型。' });
    const capabilities = providerCapabilities(body.kind);
    const target = store.saveTarget({
      vaultId: vault.id,
      kind: body.kind,
      accountLabel: body.accountLabel ?? body.kind,
      rootPath: body.rootPath ?? '',
      localDirectory: body.localDirectory ?? null,
      capabilities,
      connected: body.kind !== 'quark',
      lastError: body.kind === 'quark' ? '夸克网盘尚未完成能力联调，暂不参与备份。' : null,
    });
    if (body.credential) await secrets.set('backup-target:' + target.id, body.credential).catch(() => undefined);
    return { target: { ...target, capabilities, localDirectory: store.getTargetLocalDirectory(target.id) } };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/backups/targets/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    // 删除目标不删除云端数据，也不影响其他目标。
    return { removed: store.deleteTarget(request.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/backups/targets/:id/verify', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const provider = await providerForTarget(request.params.id);
      await provider.connect();
      const quota = await provider.quota().catch(() => null);
      store.setTargetError(request.params.id, null);
      return { connected: true, capabilities: provider.capabilities, quota };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.setTargetError(request.params.id, message);
      return errorResponse(reply, error);
    }
  });

  // ---------------------------------------------------------------- 授权

  app.get<{ Params: { kind: string }; Querystring: { targetId?: string; clientId?: string; clientSecret?: string; redirectUri?: string } }>(
    '/api/v1/admin/backups/oauth/:kind/start',
    async (request, reply) => {
      if (!checkAdmin(config, request, reply)) return;
      const kind = request.params.kind;
      if (kind !== 'google_drive' && kind !== 'onedrive') {
        return reply.code(400).send({ error: 'backup_oauth_unsupported', message: '这个网盘类型不支持应用内授权。' });
      }
      const clientId = request.query.clientId?.trim();
      const redirectUri = request.query.redirectUri?.trim() || defaultRedirect(config, kind);
      if (!clientId) return reply.code(400).send({ error: 'backup_oauth_client_required', message: '请先填写自己申请的应用 client ID。' });
      const endpoints = kind === 'google_drive' ? googleDriveEndpoints(redirectUri) : oneDriveEndpoints(redirectUri);
      const pkce = createPkcePair();
      const state = createState();
      pending.set(state, {
        verifier: pkce.verifier, kind, targetId: request.query.targetId ?? null, createdAt: Date.now(), clientId,
        ...(request.query.clientSecret?.trim() ? { clientSecret: request.query.clientSecret.trim() } : {}),
      });
      return {
        authorizationUrl: buildAuthorizationUrl(endpoints, {
          clientId, state, codeChallenge: pkce.challenge,
          ...(kind === 'onedrive' ? { extra: { prompt: 'select_account' } } : { extra: { access_type: 'offline', prompt: 'consent' } }),
        }),
        state,
        redirectUri,
      };
    },
  );

  /** OAuth 回调：用授权码换 token，写入 SecretStore，不落任何明文到数据库或日志。 */
  app.get<{ Params: { kind: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/v1/admin/backups/oauth/:kind/callback',
    async (request, reply) => {
      const kind = request.params.kind;
      const state = request.query.state ?? '';
      const authorization = pending.get(state);
      pending.delete(state);
      if (request.query.error) return reply.code(400).send({ error: 'backup_oauth_denied', message: '授权被拒绝：' + request.query.error });
      if (!authorization || !request.query.code) return reply.code(400).send({ error: 'backup_oauth_state_invalid', message: '授权状态无效或已过期，请重新发起。' });
      if (authorization.kind !== kind) return reply.code(400).send({ error: 'backup_oauth_state_invalid', message: '授权状态与网盘类型不匹配。' });
      const redirectUri = defaultRedirect(config, kind);
      const endpoints = kind === 'google_drive' ? googleDriveEndpoints(redirectUri) : oneDriveEndpoints(redirectUri);
      try {
        const tokens = await exchangeAuthorizationCode(endpoints, {
          fetcher: options.fetcher ?? fetch, clientId: authorization.clientId, code: request.query.code, codeVerifier: authorization.verifier,
          ...(authorization.clientSecret ? { clientSecret: authorization.clientSecret } : {}),
        });
        const vault = store.getPrimaryVault();
        if (!vault) return errorResponse(reply, new Error('backup_vault_missing'));
        const target = authorization.targetId && store.getTarget(authorization.targetId)
          ? store.getTarget(authorization.targetId)!
          : store.saveTarget({
              vaultId: vault.id,
              kind,
              accountLabel: kind === 'google_drive' ? 'Google Drive' : 'OneDrive',
              rootPath: kind === 'google_drive' ? 'appDataFolder' : 'approot',
              capabilities: providerCapabilities(kind),
              connected: true,
              lastError: null,
            });
        // 只保存必要凭据；access token 只留在内存，刷新令牌进 SecretStore。
        await secrets.set('backup-target:' + target.id, JSON.stringify({
          clientId: authorization.clientId,
          ...(authorization.clientSecret ? { clientSecret: authorization.clientSecret } : {}),
          refreshToken: tokens.refreshToken ?? null, redirectUri,
        }));
        return reply.type('text/html').send('<!doctype html><meta charset="utf-8"><title>授权完成</title><p>授权已完成，可以关闭这个页面并回到「云备份」设置。</p>');
      } catch (error) {
        return errorResponse(reply, error);
      }
    },
  );

  // ---------------------------------------------------------------- 计划

  app.get('/api/v1/admin/backups/plans', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: store.listPlans() };
  });

  app.post<{ Body: BackupPlanSave }>('/api/v1/admin/backups/plans', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const body = request.body;
    if (!body?.scope) return reply.code(400).send({ error: 'backup_plan_invalid', message: '缺少备份范围。' });
    // 没选目标时默认使用全部已配置目标，避免保存出一个永远不会执行的空计划。
    const targetIds = body.targetIds?.length ? body.targetIds : store.listTargets().map((target) => target.id);
    if (!targetIds.length) return errorResponse(reply, new Error('backup_target_required'));
    const plan = store.savePlan({
      name: body.name ?? '云备份计划',
      scope: body.scope,
      activityIds: body.activityIds ?? [],
      works: body.works ?? [],
      targetIds,
      frequency: body.frequency ?? 'manual',
      dailyTime: body.dailyTime ?? '03:00',
      weekday: body.weekday ?? null,
      timezone: body.timezone ?? 'Asia/Shanghai',
      enabled: body.enabled ?? true,
      retainCount: body.retainCount ?? 10,
      nextRunAt: null,
    });
    // 保存计划默认不立即上传；需要时由调用方再触发一次手动备份。
    const saved = store.savePlan({ ...plan, nextRunAt: nextBackupRun(new Date(), plan) });
    return { plan: saved };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/backups/plans/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    // 暂停计划不等于取消当前任务；删除计划也不会删除任何云端数据。
    return { removed: store.deletePlan(request.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/backups/plans/:id/run', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      return { run: await runner.start({ planId: request.params.id, trigger: 'manual' }) };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  // ---------------------------------------------------------------- 运行

  app.get<{ Querystring: { limit?: string } }>('/api/v1/admin/backups/runs', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: store.listRuns(Number(request.query.limit ?? 30)) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/backups/runs/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const run = store.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'backup_run_missing', message: '找不到这次运行。' });
    return { run };
  });

  app.post<{ Body: BackupRunStart }>('/api/v1/admin/backups/runs', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const run = await runner.start({
        planId: request.body?.planId ?? null,
        trigger: 'manual',
        ...(request.body?.scope ? { scope: request.body.scope } : {}),
        ...(request.body?.targetIds ? { targetIds: request.body.targetIds } : {}),
        ...(request.body?.activityIds ? { activityIds: request.body.activityIds } : {}),
        ...(request.body?.works ? { works: request.body.works } : {}),
      });
      return { run };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/backups/runs/:id/retry', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const run = store.getRun(request.params.id);
    if (!run?.snapshotId) return reply.code(400).send({ error: 'backup_run_without_snapshot', message: '这次运行没有可复用的快照，请重新备份。' });
    const failed = run.targets.filter((target) => !target.manifestPublished).map((target) => target.targetId);
    if (!failed.length) return errorResponse(reply, new Error('backup_no_failed_target'));
    try {
      return { run: await runner.retryTargets({ snapshotId: run.snapshotId, targetIds: failed }) };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  /** 取消：停止安排新的上传，保留已成功目标与可续传状态。 */
  app.post<{ Params: { id: string } }>('/api/v1/admin/backups/runs/:id/cancel', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const cancelled = runner.cancel(request.params.id);
    if (!cancelled) return reply.code(409).send({ error: 'backup_run_not_cancellable', message: '这次运行已经结束，无法取消。' });
    return { cancelled: true, run: store.getRun(request.params.id) };
  });

  // ---------------------------------------------------------------- 版本

  app.get('/api/v1/admin/backups/snapshots', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: store.listAllSnapshots(60), recoverable: store.listRecoverableSnapshots(60) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/backups/snapshots/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const snapshot = store.getSnapshot(request.params.id);
    if (!snapshot) return reply.code(404).send({ error: 'backup_snapshot_missing', message: '找不到这个备份版本。' });
    return { snapshot, targets: store.listTargetRuns(request.params.id), objects: store.listSnapshotObjectIds(request.params.id) };
  });

  app.post<{ Params: { id: string }; Body: { retained?: boolean } }>('/api/v1/admin/backups/snapshots/:id/retain', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    store.setSnapshotRetained(request.params.id, request.body?.retained !== false);
    return { snapshot: store.getSnapshot(request.params.id) };
  });

  /** 新设备：列出远端仓库里已有的版本（不需要旧数据库）。 */
  app.get<{ Querystring: { targetId?: string } }>('/api/v1/admin/backups/snapshots/remote', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    if (!request.query.targetId) return reply.code(400).send({ error: 'backup_target_required', message: '请选择目标网盘。' });
    try {
      const listed = await restores.listRemoteSnapshots({ targetId: request.query.targetId });
      // 已经登记过的版本标注出来，避免重复登记。
      return { items: listed.map((item) => ({ ...item, adopted: Boolean(store.getSnapshot(item.snapshotId)) })) };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  /** 把远端版本登记到本机，之后可以预览并恢复。 */
  app.post<{ Body: { targetId?: string; snapshotId?: string } }>('/api/v1/admin/backups/snapshots/adopt', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    if (!request.body?.targetId || !request.body?.snapshotId) {
      return reply.code(400).send({ error: 'backup_snapshot_adopt_invalid', message: '请选择目标网盘与要找回的版本。' });
    }
    try {
      const result = await restores.adoptRemoteSnapshot({ targetId: request.body.targetId, snapshotId: request.body.snapshotId });
      return { result, snapshot: store.getSnapshot(result.snapshotId) };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  /**
   * 补传到其它目标：继续使用同一份快照与冻结密文，不重新捕获工作区。
   * 只有还没在该目标上发布清单的版本会被补齐，因此可以安全地重复调用。
   */
  app.post<{ Params: { id: string }; Body: { targetIds?: string[] } }>('/api/v1/admin/backups/snapshots/:id/replicate', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const targetIds = request.body?.targetIds?.length ? request.body.targetIds : store.listTargets().map((target) => target.id);
    try {
      return { run: await runner.retryTargets({ snapshotId: request.params.id, targetIds }) };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  app.get<{ Querystring: { snapshotId?: string; targetId?: string } }>('/api/v1/admin/backups/restore-preview', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    if (!request.query.snapshotId || !request.query.targetId) return reply.code(400).send({ error: 'backup_restore_preview_invalid', message: '请选择版本与目标。' });
    try {
      return { preview: await restores.preview({ snapshotId: request.query.snapshotId, targetId: request.query.targetId }) };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  app.get<{ Querystring: { targetId?: string; retainCount?: string } }>('/api/v1/admin/backups/cleanup-preview', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    if (!request.query.targetId) return reply.code(400).send({ error: 'backup_cleanup_target_required', message: '请选择目标网盘。' });
    return { preview: cleanupPreview(store, request.query.targetId, Number(request.query.retainCount ?? 10)) };
  });

  app.post<{ Body: { targetId?: string; retainCount?: number } }>('/api/v1/admin/backups/cleanup', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const targetId = request.body?.targetId;
    const target = targetId ? store.getTarget(targetId) : null;
    if (!target) return reply.code(400).send({ error: 'backup_cleanup_target_required', message: '请选择目标网盘。' });
    try {
      const provider = await providerForTarget(target.id);
      const result = await cleanupTarget({ store, provider, target, vaultId: target.vaultId, retainCount: request.body?.retainCount ?? 10 });
      options.logs.append({ appId: 'sthstart', serviceId: 'backup', stream: 'system', level: result.failures.length ? 'warn' : 'info', message: result.notice, force: true, taskId: 'backup', targetId: target.id, phase: 'done' });
      return { result };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  // ---------------------------------------------------------------- 恢复

  app.post<{ Body: BackupRestoreStart }>('/api/v1/admin/backups/restores', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    try {
      const restore = await restores.start({
        snapshotId: request.body?.snapshotId ?? '',
        targetId: request.body?.targetId ?? '',
        mode: request.body?.mode ?? 'activity_copy',
        ...(request.body?.confirm ? { confirm: true } : {}),
      });
      return { restore };
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  app.get('/api/v1/admin/backups/restores', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: store.listRestores(20) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/backups/restores/:id', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const restore = store.getRestore(request.params.id);
    if (!restore) return reply.code(404).send({ error: 'backup_restore_missing', message: '找不到这次恢复。' });
    return { restore };
  });

  app.get('/api/v1/admin/backups/quark/capability', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    // 能力核实报告：明确未支持项，不提供看似可用的按钮。
    return { report: probeQuarkCapabilities() };
  });

  async function providerForTarget(targetId: string) {
    const target = store.getTarget(targetId);
    if (!target) throw new Error('backup_target_missing');
    const stored = await secrets.get('backup-target:' + target.id).catch(() => ({ value: null }));
    return createProvider(target, {
      fetcher: options.fetcher ?? fetch,
      credential: stored?.value ?? null,
      directory: store.getTargetLocalDirectory(target.id),
      downloadVerifyLimitBytes: 64 * 1024 * 1024,
    });
  }
}

function defaultRedirect(config: ServiceConfig, kind: string): string {
  // 回调必须落到服务本身（OAuth 会把浏览器带到这里），因此用服务的地址而不是门户页面地址。
  return 'http://' + config.host + ':' + config.port + '/api/v1/admin/backups/oauth/' + kind + '/callback';
}
