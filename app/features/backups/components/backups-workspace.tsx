'use client';

import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CloudUpload, DatabaseBackup, HardDrive, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BackupRun, BackupSnapshot, BackupTarget } from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';
import { useBackupOverview } from '../queries';
import {
  useCancelBackupRun, useRetryBackupRun, useStartBackupRun,
} from '../mutations';
import { BackupHistoryPanel } from './backup-history-panel';
import { BackupPlansPanel } from './backup-plans-panel';
import { BackupVaultPanel } from './backup-vault-panel';

type Tab = 'overview' | 'plans' | 'history' | 'security';

const RUN_STATE_LABEL: Record<string, string> = {
  succeeded: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消',
  interrupted: '已中断', running: '进行中', queued: '等待中',
};

const TARGET_STATE_LABEL: Record<string, string> = {
  succeeded: '已完成', failed: '需要处理', uploading: '上传中', verifying: '校验中',
  pending: '等待中', skipped: '已跳过',
};

/** 把服务端错误码翻译成用户能照着做的提示，不暴露内部细节。 */
export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'backup_maintenance') return '正在创建备份快照，请稍后重试；草稿会保留在本地。';
    if (error.code === 'backup_busy') return '已有备份正在执行，请稍后再试。';
    if (error.code === 'backup_locked') return '仓库已锁定，请先解锁。';
    if (error.code === 'unauthorized') return '管理会话已失效，请刷新页面后重试。';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(value: number | null | undefined): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return size.toFixed(size >= 10 || index === 0 ? 0 : 1) + ' ' + units[index];
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function BackupsWorkspace() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab | null) ?? 'overview');
  const toast = useToast();
  const overview = useBackupOverview();
  const startRun = useStartBackupRun();
  const retryRun = useRetryBackupRun();
  const cancelRun = useCancelBackupRun();

  const data = overview.data;
  const activeRun = useMemo(
    () => data?.runs.find((run) => run.status === 'running' || run.status === 'queued') ?? null,
    [data],
  );
  const lastRun = data?.lastRun ?? null;

  const handleStart = async () => {
    try {
      const created = await startRun.mutateAsync({});
      toast.success('已开始备份', '运行 ' + created.run.id.slice(0, 8) + '，可以关闭页面，后端会继续执行。');
    } catch (error) {
      toast.error('无法开始备份', describeError(error));
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="云备份"
        description="把内容加密后备份到一个或多个网盘，支持增量上传与按版本恢复。"
        actions={(
          <Button onClick={handleStart} disabled={startRun.isPending || Boolean(activeRun)}>
            <CloudUpload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {activeRun ? '正在备份' : '立即备份'}
          </Button>
        )}
      />

      {overview.isLoading && <Skeleton className="h-24 w-full" />}
      {overview.error && (
        <Alert variant="danger" title="无法读取备份状态">{describeError(overview.error)}</Alert>
      )}

      {data && (
        <>
          {data.maintenance.active && (
            <Alert variant="warning" title="正在创建备份快照">
              捕获期间会短暂拒绝写入型请求，请稍后重试；未保存的草稿会保留在本地。
            </Alert>
          )}
          {!data.vault && (
            <Alert variant="info" title="还没有创建加密仓库">
              先在「网盘与加密」里创建仓库并保存恢复密钥，然后连接网盘即可开始备份。
            </Alert>
          )}
          {data.vault && !data.unlocked && (
            <Alert variant="warning" title="仓库已锁定">
              解锁后才能备份与恢复。{data.vault.unlockPolicy === 'remember' ? '本机已记住解锁材料，解锁一次即可继续。' : '请在「网盘与加密」里解锁。'}
            </Alert>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <DatabaseBackup className="h-4 w-4" aria-hidden="true" />最近完成
                </CardTitle>
                <CardDescription>{lastRun ? formatTime(lastRun.finishedAt ?? lastRun.updatedAt) : '还没有完成过备份'}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                {lastRun
                  ? <>{RUN_STATE_LABEL[lastRun.status] ?? lastRun.status}：{lastRun.targets.filter((target) => target.manifestPublished).length}/{lastRun.targets.length} 个目标完成</>
                  : '第一次备份会完整上传所需内容，之后只上传变化的部分。'}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <HardDrive className="h-4 w-4" aria-hidden="true" />目标网盘
                </CardTitle>
                <CardDescription>{data.targets.length} 个目标</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted">
                {data.targets.length === 0 && <div>还没有连接网盘。</div>}
                {data.targets.map((target) => (
                  <div key={target.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{target.accountLabel || target.kind}</span>
                    <Badge variant={target.lastError ? 'warning' : 'online'}>{target.lastError ? '需要处理' : '可用'}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />加密仓库
                </CardTitle>
                <CardDescription>{data.vault ? (data.unlocked ? '已解锁' : '已锁定') : '未创建'}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                {data.vault
                  ? <>格式版本 {data.vault.formatVersion}，恢复密钥{data.vault.recoveryWrap ? '已生成' : '未生成'}。</>
                  : '仓库头只保存被包裹的主密钥，密码与恢复密钥都不会落库。'}
              </CardContent>
            </Card>
          </div>

          {activeRun && <ActiveRunCard run={activeRun} onCancel={async () => {
            try { await cancelRun.mutateAsync(activeRun.id); toast.info('已请求取消', '已完成的目标会保留，未上传的部分保留可续传状态。'); }
            catch (error) { toast.error('取消失败', describeError(error)); }
          }} />}

          {lastRun && (lastRun.status === 'partial' || lastRun.status === 'failed') && (
            <Alert variant="warning" title="上次备份没有全部完成">
              {lastRun.progressLabel ?? '部分目标失败，可以只重试失败的目标。'}
              <div className="mt-2">
                <Button variant="secondary" size="sm" onClick={async () => {
                  try { const retried = await retryRun.mutateAsync(lastRun.id); toast.info('已开始重试', '继续使用原快照，不会重新捕获已变化的工作区。'); void retried; }
                  catch (error) { toast.error('重试失败', describeError(error)); }
                }}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />重试失败目标
                </Button>
              </div>
            </Alert>
          )}

          <PageTabs
            tabs={[
              { id: 'overview', label: '概览' },
              { id: 'plans', label: '备份计划' },
              { id: 'history', label: '备份历史' },
              { id: 'security', label: '网盘与加密' },
            ]}
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            ariaLabel="云备份分区"
          />

          {tab === 'overview' && <OverviewPanel runs={data.runs} snapshots={data.snapshots} onRefresh={() => void overview.refetch()} />}
          {tab === 'plans' && <BackupPlansPanel plans={data.plans} targets={data.targets} />}
          {tab === 'history' && <BackupHistoryPanel snapshots={data.snapshots} targets={data.targets} />}
          {tab === 'security' && <BackupVaultPanel overview={data} />}
        </>
      )}
    </PageContainer>
  );
}

function ActiveRunCard({ run, onCancel }: { run: BackupRun; onCancel: () => Promise<void> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">正在进行：{run.planName}</CardTitle>
        <CardDescription>{run.progressLabel ?? '准备中'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {run.targets.map((target) => (
          <div key={target.targetId} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{target.targetLabel || target.kind}</span>
              <span className="text-muted">
                {TARGET_STATE_LABEL[target.state] ?? target.state}
                {target.totalObjects ? ' · ' + target.uploadedObjects + '/' + target.totalObjects + ' 个对象' : ''}
                {target.uploadedBytes ? ' · ' + formatBytes(target.uploadedBytes) : ''}
              </span>
            </div>
            {target.errorMessage && <div className="text-xs text-muted">{target.errorMessage}</div>}
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => void onCancel()}>取消这次备份</Button>
      </CardContent>
    </Card>
  );
}

function OverviewPanel({ runs, snapshots, onRefresh }: { runs: BackupRun[]; snapshots: BackupSnapshot[]; onRefresh: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" aria-hidden="true" />最近运行
        </CardTitle>
        <CardDescription>查看每次备份的阶段、实际上传量与每个目标的结果。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {runs.length === 0 && <EmptyState title="还没有备份记录" description="点击右上角「立即备份」开始第一次备份。" />}
        {runs.slice(0, 8).map((run) => (
          <div key={run.id} className="rounded-[var(--radius-panel)] border border-border-default p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">{run.planName} · {run.trigger === 'manual' ? '手动' : run.trigger === 'scheduled' ? '定时' : '重试'}</div>
              <Badge variant={run.status === 'succeeded' ? 'online' : run.status === 'partial' ? 'warning' : run.status === 'failed' ? 'error' : 'accent'}>
                {RUN_STATE_LABEL[run.status] ?? run.status}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted">
              {formatTime(run.createdAt)} · 逻辑内容 {formatBytes(run.contentBytes)} · 本次上传 {formatBytes(run.uploadedBytes)} · 复用 {run.reusedObjectCount} 个对象
            </div>
            {run.progressLabel && <div className="mt-1 text-xs text-muted">{run.progressLabel}</div>}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {run.targets.map((target) => (
                <span key={target.targetId} className="rounded-full border border-border-default px-2 py-0.5">
                  {target.targetLabel || target.kind}：{TARGET_STATE_LABEL[target.state] ?? target.state}
                  {target.uploadedBytes ? '（' + formatBytes(target.uploadedBytes) + '）' : ''}
                </span>
              ))}
            </div>
            <a
              className="mt-2 inline-block text-xs text-accent hover:underline"
              href={'/settings/control-center?tab=logs&taskId=backup&runId=' + run.id}
            >
              查看这次运行的日志
            </a>
          </div>
        ))}
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>共 {snapshots.length} 个版本</span>
          <Button variant="ghost" size="sm" onClick={onRefresh}><RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />刷新</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { formatBytes, formatTime, RUN_STATE_LABEL, TARGET_STATE_LABEL };
