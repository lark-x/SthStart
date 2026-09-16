'use client';

import React, { useState } from 'react';
import { Cloud, KeyRound, Link2, Lock, ShieldAlert, Unlock } from 'lucide-react';
import type { BackupTarget } from '@sthstart/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Switch } from '@/app/components/ui/switch';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { useToast } from '@/app/providers/ui-provider';
import {
  useChangeBackupPassword, useConnectRemoteVault, useCreateBackupVault, useLockBackupVault, useRemoveBackupTarget,
  useSaveBackupTarget, useUnlockBackupVault, useVerifyBackupTarget,
} from '../mutations';
import { startBackupOAuth, type BackupOverview, type BackupTargetView } from '../api';
import { describeError } from './backups-workspace';

export function BackupVaultPanel({ overview }: { overview: BackupOverview }) {
  const toast = useToast();
  const createVault = useCreateBackupVault();
  const unlockVault = useUnlockBackupVault();
  const lockVault = useLockBackupVault();
  const changePassword = useChangeBackupPassword();
  const saveTarget = useSaveBackupTarget();
  const removeTarget = useRemoveBackupTarget();
  const verifyTarget = useVerifyBackupTarget();

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [remember, setRemember] = useState(true);
  const [issuedRecoveryKey, setIssuedRecoveryKey] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [targetKind, setTargetKind] = useState<BackupTarget['kind']>('local_test');
  const [targetLabel, setTargetLabel] = useState('');
  const [targetDirectory, setTargetDirectory] = useState('');
  const [targetRoot, setTargetRoot] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [remoteVaultId, setRemoteVaultId] = useState('');
  const connectRemote = useConnectRemoteVault();

  const vault = overview.vault;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" aria-hidden="true" />加密仓库
          </CardTitle>
          <CardDescription>
            密码只用来包裹主密钥；恢复密钥是第二份独立材料。两者都丢失就无法恢复，请自行妥善保存。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!vault && (
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="text-muted">设置解锁密码（至少 8 个字符）</span>
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="text-muted">再输入一次</span>
                <Input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} />
              </label>
              <Button
                disabled={createVault.isPending || password.length < 8 || password !== passwordConfirm}
                onClick={async () => {
                  try {
                    const created = await createVault.mutateAsync(password);
                    setIssuedRecoveryKey(created.recoveryKey);
                    setPassword(''); setPasswordConfirm('');
                    toast.success('加密仓库已创建', '请立刻保存恢复密钥，它只会显示这一次。');
                  } catch (error) {
                    toast.error('创建失败', describeError(error));
                  }
                }}
              >
                创建加密仓库
              </Button>
              <div className="mt-3 space-y-2 border-t border-border-default pt-3">
                <p className="text-sm text-muted">换机或已有备份：连接已有加密仓库</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    className="h-9 w-full rounded-[var(--radius-control)] border border-border-default bg-surface px-2 text-sm"
                    value={targetKind}
                    onChange={(event) => setTargetKind(event.target.value as BackupTarget['kind'])}
                  >
                    <option value="local_test">本地测试目录</option>
                    <option value="google_drive">Google Drive</option>
                    <option value="onedrive">OneDrive</option>
                  </select>
                  <Input value={remoteVaultId} onChange={(event) => setRemoteVaultId(event.target.value)} placeholder="远端仓库 ID" />
                  <Input
                    value={targetKind === 'local_test' ? targetDirectory : targetRoot}
                    onChange={(event) => (targetKind === 'local_test' ? setTargetDirectory(event.target.value) : setTargetRoot(event.target.value))}
                    placeholder={targetKind === 'local_test' ? '备份目录' : '远端根目录'}
                  />
                </div>
                <Button
                  variant="secondary"
                  disabled={connectRemote.isPending || !remoteVaultId}
                  onClick={async () => {
                    try {
                      const result = await connectRemote.mutateAsync({
                        kind: targetKind,
                        rootPath: targetKind === 'local_test' ? 'SthStart' : targetRoot,
                        ...(targetKind === 'local_test' ? { localDirectory: targetDirectory } : {}),
                        vaultId: remoteVaultId.trim(),
                        import: true,
                      });
                      toast.success('已连接已有仓库', '现在用原密码或恢复密钥解锁，再在「备份历史」里找回版本。');
                      void result;
                    } catch (error) {
                      toast.error('连接失败', describeError(error));
                    }
                  }}
                >
                  连接已有仓库
                </Button>
                <p className="text-xs text-muted">仓库 ID 可以在旧设备的这张卡片里复制；远端根目录要与旧设备一致。</p>
              </div>
            </div>
          )}

          {vault && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={overview.unlocked ? 'online' : 'warning'}>{overview.unlocked ? '已解锁' : '已锁定'}</Badge>
                <span className="text-muted">格式版本 {vault.formatVersion}</span>
                <span className="text-muted">恢复密钥{vault.recoveryWrap ? '已生成' : '未生成'}</span>
                <span className="text-muted">{vault.unlockPolicy === 'remember' ? '本机已记住解锁材料' : '每次需要手动解锁'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>仓库 ID（换机时需要）：</span>
                <code className="select-all rounded bg-ink/5 px-1.5 py-0.5 font-mono">{vault.id}</code>
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(vault.id); toast.success('已复制仓库 ID'); }}>复制</Button>
              </div>
              {!overview.unlocked && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={!useRecovery} onChange={() => setUseRecovery(false)} />用密码解锁
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={useRecovery} onChange={() => setUseRecovery(true)} disabled={!vault.recoveryWrap} />用恢复密钥解锁
                    </label>
                  </div>
                  {useRecovery
                    ? <Input value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} placeholder="XXXXX-XXXXX-…" />
                    : <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="解锁密码" />}
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                    在这台设备记住（使用系统凭据库）
                  </label>
                  <Button
                    disabled={unlockVault.isPending}
                    onClick={async () => {
                      try {
                        const result = await unlockVault.mutateAsync(useRecovery ? { recoveryKey, remember } : { password, remember });
                        setPassword(''); setRecoveryKey('');
                        toast.success('已解锁', result.remembered ? '本机已记住解锁材料。' : '本次解锁只在当前进程有效。');
                      } catch (error) {
                        toast.error('解锁失败', describeError(error));
                      }
                    }}
                  >
                    <Unlock className="mr-1.5 h-4 w-4" aria-hidden="true" />解锁
                  </Button>
                </div>
              )}
              {overview.unlocked && (
                <Button variant="secondary" onClick={async () => {
                  try { await lockVault.mutateAsync(); toast.info('已锁定', '正在上传的冻结密文可以完成，但不会开始新的加密任务。'); }
                  catch (error) { toast.error('锁定失败', describeError(error)); }
                }}>
                  <Lock className="mr-1.5 h-4 w-4" aria-hidden="true" />立即锁定
                </Button>
              )}
              <div className="grid gap-2 border-t border-border-default pt-3 sm:grid-cols-3">
                <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前密码" />
                <Input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="新密码（至少 8 位）" />
                <Button variant="secondary" disabled={changePassword.isPending || nextPassword.length < 8} onClick={async () => {
                  try {
                    const result = await changePassword.mutateAsync({ currentPassword, newPassword: nextPassword });
                    setCurrentPassword(''); setNextPassword('');
                    const failed = result.targets.filter((target) => !target.updated);
                    toast.success('密码已修改', failed.length ? failed.length + ' 个目标的仓库头仍需更新：' + failed.map((target) => target.message).join('；') : '主密钥未变化，不需要重传已上传的媒体。');
                  } catch (error) {
                    toast.error('修改失败', describeError(error));
                  }
                }}>
                  修改密码
                </Button>
              </div>
              <p className="text-xs text-muted">修改密码只重新包裹主密钥；旧副本仍可能被旧密码解开，泄露后请重新创建仓库。</p>
            </>
          )}
        </CardContent>
      </Card>

      {issuedRecoveryKey && (
        <Alert variant="warning" title="请立刻保存恢复密钥">
          <div className="mt-1 select-all break-all font-mono text-sm">{issuedRecoveryKey}</div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => {
              void navigator.clipboard?.writeText(issuedRecoveryKey);
              toast.success('已复制', '请粘贴到密码管理器或纸上保存。');
            }}>复制</Button>
            <Button size="sm" variant="ghost" onClick={() => setIssuedRecoveryKey(null)}>我已保存</Button>
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-4 w-4" aria-hidden="true" />目标网盘
          </CardTitle>
          <CardDescription>每个目标独立上传、独立校验、独立重试；一个失败不影响其它目标。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              onVerify={async () => {
                try { const result = await verifyTarget.mutateAsync(target.id); toast.success('连接正常', result.quota ? '剩余空间可读取。' : '已确认可写入。'); }
                catch (error) { toast.error('连接失败', describeError(error)); }
              }}
              onRemove={async () => {
                try { await removeTarget.mutateAsync(target.id); toast.info('已断开该目标', '云端已有的备份版本不会被删除。'); }
                catch (error) { toast.error('操作失败', describeError(error)); }
              }}
            />
          ))}
          {overview.targets.length === 0 && <p className="text-sm text-muted">还没有连接网盘。</p>}

          <div className="space-y-2 border-t border-border-default pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-muted">网盘类型</span>
                <select
                  className="mt-1 h-9 w-full rounded-[var(--radius-control)] border border-border-default bg-surface px-2 text-sm"
                  value={targetKind}
                  onChange={(event) => setTargetKind(event.target.value as BackupTarget['kind'])}
                >
                  <option value="local_test">本地测试目录</option>
                  <option value="google_drive">Google Drive</option>
                  <option value="onedrive">OneDrive</option>
                  <option value="quark">夸克网盘（待联调）</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-muted">显示名称</span>
                <Input value={targetLabel} onChange={(event) => setTargetLabel(event.target.value)} placeholder="例如：主力网盘" />
              </label>
            </div>

            {targetKind === 'local_test' && (
              <label className="block text-sm">
                <span className="text-muted">本地目录（用于测试与模拟验证）</span>
                <Input value={targetDirectory} onChange={(event) => setTargetDirectory(event.target.value)} placeholder="/path/to/backup-dir" />
              </label>
            )}

            {(targetKind === 'google_drive' || targetKind === 'onedrive') && (
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="text-muted">自己申请的 client ID（应用不提供公共凭据）</span>
                  <Input value={clientId} onChange={(event) => setClientId(event.target.value)} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">client secret（如平台需要；只写入系统凭据库）</span>
                  <Input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">远端目录 / 应用专用文件夹</span>
                  <Input value={targetRoot} onChange={(event) => setTargetRoot(event.target.value)} placeholder={targetKind === 'google_drive' ? 'appDataFolder' : 'approot'} />
                </label>
                <Button
                  disabled={!clientId || saveTarget.isPending}
                  onClick={async () => {
                    try {
                      const saved = await saveTarget.mutateAsync({
                        kind: targetKind,
                        accountLabel: targetLabel || (targetKind === 'google_drive' ? 'Google Drive' : 'OneDrive'),
                        rootPath: targetRoot || (targetKind === 'google_drive' ? 'appDataFolder' : 'approot'),
                      });
                      const started = await startBackupOAuth(targetKind, {
                        clientId,
                        ...(clientSecret ? { clientSecret } : {}),
                        targetId: saved.target.id,
                      });
                      // 授权在官方页面完成，回调把刷新令牌写进系统凭据库。
                      window.location.href = started.authorizationUrl;
                    } catch (error) {
                      toast.error('无法发起授权', describeError(error));
                    }
                  }}
                >
                  <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />保存并去授权
                </Button>
                <p className="text-xs text-muted">
                  回调地址：http://127.0.0.1:4100/api/v1/admin/backups/oauth/{targetKind}/callback（需在平台后台登记为允许的重定向地址）。
                </p>
              </div>
            )}

            {targetKind === 'quark' && (
              <Alert variant="warning" title="夸克网盘尚未完成能力联调">
                <ul className="mt-1 space-y-1">
                  {overview.quarkReport.items.map((item) => (
                    <li key={item.key}>
                      {item.result === 'unsupported' ? '不支持：' : '待验证：'}{item.question}（{item.detail}）
                    </li>
                  ))}
                </ul>
                <div className="mt-1 text-xs">{overview.quarkReport.notes.join(' ')}</div>
              </Alert>
            )}

            {targetKind !== 'quark' && (
              <Button
                variant="secondary"
                disabled={saveTarget.isPending || (targetKind === 'local_test' ? !targetDirectory : false)}
                onClick={async () => {
                  try {
                    await saveTarget.mutateAsync({
                      kind: targetKind,
                      accountLabel: targetLabel || (targetKind === 'local_test' ? '本地测试目录' : targetLabel),
                      rootPath: targetRoot || (targetKind === 'local_test' ? 'SthStart' : ''),
                      ...(targetDirectory ? { localDirectory: targetDirectory } : {}),
                    });
                    toast.success('目标已保存', '建议先点「验证连接」确认可写入。');
                    setTargetLabel(''); setTargetDirectory(''); setTargetRoot('');
                  } catch (error) {
                    toast.error('保存失败', describeError(error));
                  }
                }}
              >
                {targetKind === 'local_test' ? '添加本地测试目标' : '保存目标'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Alert variant="info" title="加密范围说明">
        本功能只加密上传到网盘的备份与导出文件。本地媒体、模型输入和整个硬盘不受影响；云端仍能看到密文的大小、数量和上传时间。
      </Alert>
      {overview.vault && !overview.unlocked && (
        <Alert variant="warning" title="未解锁时不会开始新的加密任务">
          <ShieldAlert className="mr-1 inline h-4 w-4" aria-hidden="true" />
          定时到点时会记录「等待解锁」，解锁后补做一次，不会改用明文，也不会每分钟产生新的失败记录。
        </Alert>
      )}
    </div>
  );
}

function TargetRow({ target, onVerify, onRemove }: {
  target: BackupTargetView;
  onVerify: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-border-default p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{target.accountLabel || target.kind}</div>
          <div className="text-xs text-muted">
            {target.kind === 'local_test' ? '本地测试目录' : target.kind === 'google_drive' ? 'Google Drive' : target.kind === 'onedrive' ? 'OneDrive' : '夸克网盘'}
            {' · '}{target.rootPath || '默认目录'}
            {target.localDirectory ? ' · ' + target.localDirectory : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={target.lastError ? 'warning' : 'online'}>{target.lastError ? '需要处理' : '已连接'}</Badge>
          <Button size="sm" variant="ghost" onClick={() => void onVerify()}>验证连接</Button>
          <Button size="sm" variant="ghost" onClick={() => void onRemove()}>断开</Button>
        </div>
      </div>
      {target.lastError && <div className="mt-1 text-xs text-muted">{target.lastError}</div>}
    </div>
  );
}
