'use client';

import React from 'react';
import { Play, Square, ExternalLink, AlertTriangle } from 'lucide-react';
import type { RuntimeOverview } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';

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

  return (
    <div className="grid grid-cols-1 gap-6 border-y border-border-subtle py-6 md:grid-cols-[minmax(0,1fr)_14rem]">
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

              <a
                href={launchUrl}
                target={isLinsheRunning ? '_blank' : undefined}
                rel="noreferrer"
                className="ml-auto inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-ink"
              >
                <span>打开邻舍界面</span>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            {overview && !overview.linsheHosted.ready && (
              <div className="mt-4 flex items-start gap-2.5 border-l-2 border-warning-border bg-warning-bg/35 p-3 text-sm text-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-fg" />
                <div>
                  <span className="font-semibold">邻舍托管配置未完全就绪：</span>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {overview.linsheHosted.missing.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            )}
        </section>

        <aside className="flex flex-col justify-between border-t border-border-subtle pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <div>
            <span className="text-xs font-semibold text-muted">服务健康度</span>
            <div className="mt-2 text-5xl font-semibold tracking-tight text-ink">
              {runningServices.length}
              <span className="text-xl text-muted font-sans font-normal"> / {services.length}</span>
            </div>
            <p className="mt-1 text-sm text-muted">当前运行中服务</p>
          </div>

          <div className="mt-5 space-y-2 border-t border-border-subtle pt-4 text-sm text-muted">
            <div className="flex justify-between">
              <span>最近异常:</span>
              <span className={`font-semibold ${overview?.recentErrors ? 'text-danger' : 'text-success'}`}>
                {overview?.recentErrors ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span>丢弃日志:</span>
              <span>{overview?.droppedLogs ?? 0}</span>
            </div>
          </div>
        </aside>
    </div>
  );
}
