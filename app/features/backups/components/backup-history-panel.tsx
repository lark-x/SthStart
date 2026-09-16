'use client';

import React, { useState } from 'react';
import { Archive, DownloadCloud, RotateCcw, Trash2 } from 'lucide-react';
import type { BackupRestorePreview, BackupSnapshot } from '@sthstart/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { EmptyState } from '@/app/components/ui/empty-state';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { useToast } from '@/app/providers/ui-provider';
import { useRestorePreview } from '../queries';
import {
  useAdoptRemoteSnapshot, useConnectRemoteVault, useReplicateSnapshot, useRunCleanup,
  useSetSnapshotRetained, useStartRestore,
} from '../mutations';
import { fetchRemoteSnapshots } from '../api';
import type { BackupTargetView } from '../api';
import { describeError, formatBytes, formatTime } from './backups-workspace';

export function BackupHistoryPanel({ snapshots, targets }: { snapshots: BackupSnapshot[]; targets: BackupTargetView[] }) {
  const toast = useToast();
  const retainMutation = useSetSnapshotRetained();
  const cleanupMutation = useRunCleanup();
  const replicateMutation = useReplicateSnapshot();
  const adoptMutation = useAdoptRemoteSnapshot();
  const connectMutation = useConnectRemoteVault();
  const [restoreTarget, setRestoreTarget] = useState<{ snapshot: BackupSnapshot; targetId: string } | null>(null);
  const [cleanupTargetId, setCleanupTargetId] = useState('');
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [remoteTargetId, setRemoteTargetId] = useState('');
  const [remoteItems, setRemoteItems] = useState<Array<{ snapshotId: string; size: number; adopted: boolean }> | null>(null);
  const [listing, setListing] = useState(false);

  const toggleRetain = async (snapshot: BackupSnapshot) => {
    try {
      await retainMutation.mutateAsync({ snapshotId: snapshot.id, retained: !snapshot.retained });
      toast.success(snapshot.retained ? '已取消长期保留' : '已设为长期保留', '长期保留的版本不会被自动清理淘汰。');
    } catch (error) {
      toast.error('操作失败', describeError(error));
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4" aria-hidden="true" />备份版本
          </CardTitle>
          <CardDescription>每个版本都要在某个目标上完整发布后才能恢复。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshots.length === 0 && <EmptyState title="还没有备份版本" description="完成一次备份后，这里会列出可以恢复的版本。" />}
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="rounded-[var(--radius-panel)] border border-border-default p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {formatTime(snapshot.createdAt)} · {describeScope(snapshot.scope)}
                </div>
                <div className="flex items-center gap-2">
                  {snapshot.retained && <Badge variant="accent">长期保留</Badge>}
                  <Badge variant={snapshot.publishedTargetIds.length ? 'online' : 'warning'}>
                    {snapshot.publishedTargetIds.length ? snapshot.publishedTargetIds.length + ' 个目标可恢复' : '尚不可恢复'}
                  </Badge>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted">
                逻辑内容 {formatBytes(snapshot.contentBytes)} · {snapshot.objectCount} 个对象 · 本次上传 {formatBytes(snapshot.uploadedBytes)}
                {snapshot.missingCount > 0 && ' · 缺失 ' + snapshot.missingCount + ' 个必要文件（不算完整）'}
              </div>
              {snapshot.description && <div className="mt-1 text-xs text-muted">{snapshot.description}</div>}
              {snapshot.missingCount > 0 && (
                <Alert variant="warning" className="mt-2" title="这个版本不完整">
                  备份时发现必要文件缺失，恢复后需要人工确认缺了哪些内容。
                </Alert>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {targets.map((target) => (
                  <Button
                    key={target.id}
                    size="sm"
                    variant={snapshot.publishedTargetIds.includes(target.id) ? 'secondary' : 'ghost'}
                    disabled={!snapshot.publishedTargetIds.includes(target.id)}
                    onClick={() => setRestoreTarget({ snapshot, targetId: target.id })}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    从「{target.accountLabel || target.kind}」恢复
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => void toggleRetain(snapshot)}>
                  {snapshot.retained ? '取消长期保留' : '长期保留'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={replicateMutation.isPending || snapshot.publishedTargetIds.length >= targets.length}
                  onClick={async () => {
                    try {
                      await replicateMutation.mutateAsync({ snapshotId: snapshot.id, targetIds: targets.map((target) => target.id) });
                      toast.success('已开始补传', '继续使用这个版本的冻结密文，不会重新捕获工作区。');
                    } catch (error) {
                      toast.error('补传失败', describeError(error));
                    }
                  }}
                >
                  补传到其它目标
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="h-4 w-4" aria-hidden="true" />保留清理
          </CardTitle>
          <CardDescription>按目标保留最近若干次成功版本；长期保留的版本永不被自动淘汰。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-[var(--radius-control)] border border-border-default bg-surface px-2 text-sm"
              value={cleanupTargetId}
              onChange={(event) => setCleanupTargetId(event.target.value)}
            >
              <option value="">选择目标网盘</option>
              {targets.map((target) => <option key={target.id} value={target.id}>{target.accountLabel || target.kind}</option>)}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!cleanupTargetId}
              onClick={() => setCleanupConfirm(true)}
            >
              查看并执行清理
            </Button>
            <span className="text-xs text-muted">清理前会先显示会淘汰哪些版本、释放多少空间。</span>
          </div>
          <ConfirmDialog
            open={cleanupConfirm}
            onOpenChange={setCleanupConfirm}
            title="按保留规则清理这个目标的历史版本"
            description="过期版本会退出可恢复列表；只被这些版本引用的对象会被删除。被其它目标或长期保留版本引用的文件不会被删除。"
            confirmLabel="执行清理"
            danger
            onConfirm={async () => {
              try {
                const result = await cleanupMutation.mutateAsync({ targetId: cleanupTargetId, retainCount: 10 });
                toast.success('清理完成', result.result.notice);
              } catch (error) {
                toast.error('清理失败', describeError(error));
              }
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DownloadCloud className="h-4 w-4" aria-hidden="true" />从网盘找回版本（换机或本地数据丢失）
          </CardTitle>
          <CardDescription>
            只凭远端仓库和一个目标网盘就能列出可恢复版本；找回后会登记到本机，再进行预览与恢复。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-[var(--radius-control)] border border-border-default bg-surface px-2 text-sm"
              value={remoteTargetId}
              onChange={(event) => { setRemoteTargetId(event.target.value); setRemoteItems(null); }}
            >
              <option value="">选择目标网盘</option>
              {targets.map((target) => <option key={target.id} value={target.id}>{target.accountLabel || target.kind}</option>)}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!remoteTargetId || listing}
              onClick={async () => {
                setListing(true);
                try {
                  const result = await fetchRemoteSnapshots(remoteTargetId);
                  setRemoteItems(result.items);
                  if (!result.items.length) toast.info('远端没有找到版本', '确认这个目标指向的是同一份加密仓库。');
                } catch (error) {
                  toast.error('无法列出远端版本', describeError(error));
                } finally {
                  setListing(false);
                }
              }}
            >
              列出远端版本
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!remoteTargetId || connectMutation.isPending}
              onClick={async () => {
                try {
                  const result = await connectMutation.mutateAsync({ targetId: remoteTargetId, import: true });
                  toast.success('已导入远端仓库头', '现在可以用原密码或恢复密钥解锁这个仓库。');
                  void result;
                } catch (error) {
                  toast.error('导入失败', describeError(error));
                }
              }}
            >
              导入远端仓库（本机还没有仓库时）
            </Button>
          </div>
          {remoteItems && (
            <div className="space-y-2">
              {remoteItems.length === 0 && <p className="text-sm text-muted">这个目标上没有可登记的版本。</p>}
              {remoteItems.map((item) => (
                <div key={item.snapshotId} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-border-default p-3 text-sm">
                  <span className="font-mono text-xs">{item.snapshotId.slice(0, 8)} · {formatBytes(item.size)}</span>
                  {item.adopted
                    ? <Badge variant="accent">已登记</Badge>
                    : (
                      <Button
                        size="sm"
                        disabled={adoptMutation.isPending}
                        onClick={async () => {
                          try {
                            const adopted = await adoptMutation.mutateAsync({ targetId: remoteTargetId, snapshotId: item.snapshotId });
                            setRemoteItems((current) => current?.map((entry) => entry.snapshotId === item.snapshotId ? { ...entry, adopted: true } : entry) ?? null);
                            toast.success('已找回版本', adopted.result.objectCount + ' 个对象，可以在「备份版本」里预览并恢复。');
                          } catch (error) {
                            toast.error('找回失败', describeError(error));
                          }
                        }}
                      >
                        找回这个版本
                      </Button>
                    )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {restoreTarget && (
        <RestoreDialog
          snapshot={restoreTarget.snapshot}
          targetId={restoreTarget.targetId}
          targetLabel={targets.find((target) => target.id === restoreTarget.targetId)?.accountLabel ?? ''}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}

function describeScope(scope: string) {
  if (scope === 'workspace') return '完整工作区';
  if (scope === 'activities') return '指定活动';
  return '创作资料';
}

function RestoreDialog({ snapshot, targetId, targetLabel, onClose }: {
  snapshot: BackupSnapshot;
  targetId: string;
  targetLabel: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const restoreMutation = useStartRestore();
  const preview = useRestorePreview(snapshot.id, targetId);
  const [mode, setMode] = useState<'activity_copy' | 'knowledge_import' | 'workspace_replace'>(
    snapshot.scope === 'knowledge' ? 'knowledge_import' : snapshot.scope === 'activities' ? 'activity_copy' : 'workspace_replace',
  );
  const [confirmWorkspace, setConfirmWorkspace] = useState(false);
  const data: BackupRestorePreview | undefined = preview.data?.preview;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-[var(--radius-panel)] border border-border-default bg-surface p-4">
        <h2 className="text-lg font-semibold">恢复预览</h2>
        <p className="mt-1 text-sm text-muted">
          {formatTime(snapshot.createdAt)} 的版本 · 来自「{targetLabel}」。下载与验证不会修改当前数据。
        </p>
        {preview.isLoading && <p className="mt-3 text-sm text-muted">正在读取清单…</p>}
        {preview.error && <Alert variant="danger" className="mt-3" title="无法读取这个版本">{describeError(preview.error)}</Alert>}
        {data && (
          <div className="mt-3 space-y-2 text-sm">
            <div>范围：{describeScope(data.scope)} · 应用 schema 版本 {data.schemaVersion}{data.supported ? '' : '（需要升级应用）'}</div>
            <div>媒体 {data.mediaCount} 个 · 逻辑内容 {formatBytes(data.contentBytes)}</div>
            {data.activities.length > 0 && (
              <div>包含活动：{data.activities.map((activity) => activity.title).join('、')}</div>
            )}
            {data.scope === 'knowledge' && <div>包含资料 {data.knowledgeNoteCount} 篇、角色引用 {data.characterCount} 个</div>}
            {data.exclusions.length > 0 && (
              <Alert variant="warning" title="这个版本缺省了部分内容">{data.exclusions.join('；')}</Alert>
            )}
            <div className="space-y-1">
              <div className="font-medium">恢复方式</div>
              <label className="flex items-center gap-2">
                <input type="radio" name="restore-mode" checked={mode === 'activity_copy'} onChange={() => setMode('activity_copy')} />
                导入为新活动副本（保留当前活动）
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="restore-mode" checked={mode === 'knowledge_import'} onChange={() => setMode('knowledge_import')} />
                导入创作资料（重复导入会跳过已有内容）
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="restore-mode" checked={mode === 'workspace_replace'} onChange={() => setMode('workspace_replace')} />
                恢复完整工作区（替换当前数据）
              </label>
            </div>
            {mode === 'workspace_replace' && (
              <Alert variant="warning" title="会替换当前工作区">
                会先生成恢复前备份，并在停止服务后由恢复助手完成替换。运行中的任务恢复后不会自动重跑，备份计划默认暂停。
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={confirmWorkspace} onChange={(event) => setConfirmWorkspace(event.target.checked)} />
                  我确认要用这个版本替换当前工作区
                </label>
              </Alert>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            disabled={!data || (mode === 'workspace_replace' && !confirmWorkspace) || restoreMutation.isPending}
            onClick={async () => {
              try {
                const started = await restoreMutation.mutateAsync({ snapshotId: snapshot.id, targetId, mode, ...(mode === 'workspace_replace' ? { confirm: true } : {}) });
                toast.success('已开始恢复', started.restore.id.slice(0, 8) + ' · 可以关闭页面，后端会继续执行。');
                onClose();
              } catch (error) {
                toast.error('无法开始恢复', describeError(error));
              }
            }}
          >
            开始恢复
          </Button>
        </div>
      </div>
    </div>
  );
}
