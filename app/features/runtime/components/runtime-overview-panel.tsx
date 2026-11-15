'use client';

import React from 'react';
import { Play, Square, ExternalLink } from 'lucide-react';
import type { RuntimeOverview } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Button as LinkButton } from '@mantine/core';
import Link from 'next/link';

export function RuntimeOverviewPanel({
  overview,
  launchUrl,
  onStartAll,
  onStopAll,
  busy,
}: {
  overview?: RuntimeOverview;
  launchUrl: string;
  onStartAll: () => Promise<void>;
  onStopAll: () => Promise<void>;
  busy?: string;
}) {
  const services = overview?.services ?? [];
  const runningServices = services.filter((s) => s.state === 'running');
  const allRunning = services.length > 0 && services.every((s) => s.state === 'running');
  const anyRunning = runningServices.length > 0;
  const isLinsheRunning = services.find((s) => s.id === 'linshe')?.state === 'running';
  const healthPercent = services.length > 0
    ? Math.round((runningServices.length / services.length) * 100)
    : 0;
  const healthFill = allRunning ? 'bg-success' : anyRunning ? 'bg-warning' : 'bg-muted';

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-[0.06em] text-muted">运行栈状态</span>
              <Badge variant={allRunning ? 'running' : anyRunning ? 'warning' : 'stopped'}>
                {allRunning ? '全部就绪' : anyRunning ? '部分运行' : '已停止'}
              </Badge>
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">邻舍运行栈</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              本地微服务组合管理。支持独立启停、自动拉起与实时诊断。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="md"
                disabled={Boolean(busy) || allRunning}
                onClick={onStartAll}
                loading={busy === 'start-all'}
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>全部启动</span>
              </Button>

              <Button
                variant="ghost"
                size="md"
                disabled={Boolean(busy) || !anyRunning}
                onClick={onStopAll}
                loading={busy === 'stop-all'}
              >
                <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>全部停止</span>
              </Button>

              <LinkButton
                component={Link}
                href={launchUrl}
                target={isLinsheRunning ? '_blank' : undefined}
                rel="noreferrer"
                variant="subtle"
                size="sm"
                className="ml-auto"
                rightSection={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
              >
                <span>打开邻舍界面</span>
              </LinkButton>
            </div>

            {overview && !overview.linsheHosted.ready && (
              <Alert variant="warning" title="邻舍托管配置未完全就绪" className="mt-4">
                <ul className="list-disc space-y-0.5 pl-5">
                  {overview.linsheHosted.missing.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </Alert>
            )}
        </section>

        <aside className="rounded-panel border border-border-subtle bg-surface-sunken/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">服务健康度</span>
            <span className="text-xs font-semibold tabular-nums text-muted">{healthPercent}%</span>
          </div>
          <div className="mt-2 text-4xl font-semibold tracking-tight text-ink">
            {runningServices.length}
            <span className="text-lg text-muted font-sans font-normal"> / {services.length}</span>
          </div>
          <p className="mt-1 text-sm text-muted">当前运行中服务</p>

          <div
            role="progressbar"
            aria-label="服务运行比例"
            aria-valuemin={0}
            aria-valuemax={services.length || 1}
            aria-valuenow={runningServices.length}
            aria-valuetext={`${runningServices.length} / ${services.length} 项服务运行中`}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/8"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-[var(--motion-base)] ${healthFill}`}
              style={{ width: `${healthPercent}%` }}
            />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-control border border-border-subtle bg-surface/70 px-2.5 py-2">
              <dt className="text-xs text-muted">最近异常</dt>
              <dd className={`mt-0.5 text-base font-semibold tabular-nums ${overview?.recentErrors ? 'text-danger-fg' : 'text-ink'}`}>
                {overview?.recentErrors ?? 0}
              </dd>
            </div>
            <div className="rounded-control border border-border-subtle bg-surface/70 px-2.5 py-2">
              <dt className="text-xs text-muted">丢弃日志</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                {overview?.droppedLogs ?? 0}
              </dd>
            </div>
          </dl>
        </aside>
    </div>
  );
}
