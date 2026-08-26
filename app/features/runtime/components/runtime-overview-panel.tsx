'use client';

import React from 'react';
import { Play, Square, ExternalLink, AlertTriangle } from 'lucide-react';
import type { RuntimeOverview } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/app/components/ui/card';

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
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#18201d] text-[#f4f0e7] border-none md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#e45d35]">
                RUNTIME ENVIRONMENT
              </span>
              <Badge variant={allRunning ? 'running' : anyRunning ? 'warning' : 'stopped'}>
                {allRunning ? '全部就绪' : anyRunning ? '部分运行' : '已停止'}
              </Badge>
            </div>
            <CardTitle className="text-[#f4f0e7] text-2xl mt-1">邻舍运行栈</CardTitle>
            <CardDescription className="text-[#f4f0e7]/70">
              本地微服务组合管理。支持独立启停、自动拉起与实时诊断。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 mt-4">
              <Button
                variant="accent"
                size="md"
                disabled={Boolean(busy) || allRunning}
                onClick={onStartAll}
                loading={busy === 'start-all'}
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>全部启动</span>
              </Button>

              <Button
                variant="secondary"
                size="md"
                className="border-white/20 text-[#f4f0e7] hover:bg-white/10"
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
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-[3px_12px_3px_3px] border border-white/20 text-[#f4f0e7] hover:bg-white/10 transition-colors ml-auto"
              >
                <span>打开邻舍界面</span>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            {overview?.linsheLlm.enabled && !overview.linsheLlm.ready && (
              <div className="mt-4 flex items-start gap-2.5 rounded border border-[#e45d35]/30 bg-[#e45d35]/15 p-3 text-xs text-[#f4f0e7]">
                <AlertTriangle className="h-4 w-4 text-[#e45d35] flex-shrink-0 mt-0.5" />
                <div>
                  <strong>公共模型未完全就绪：</strong>
                  <span> 请在公共服务中配置生效文本模型，否则邻舍无法生成对话。</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#68716d]">
              SERVICE HEALTH
            </span>
            <div className="mt-3 font-serif text-5xl font-medium text-[#18201d]">
              {runningServices.length}
              <span className="text-xl text-[#68716d] font-sans font-normal"> / {services.length}</span>
            </div>
            <p className="mt-1 text-xs text-[#68716d]">当前运行中服务</p>
          </div>

          <div className="pt-4 border-t border-[rgb(24_32_29/10%)] text-xs text-[#68716d] space-y-1">
            <div className="flex justify-between">
              <span>最近异常:</span>
              <strong className={overview?.recentErrors ? 'text-[#c9674a]' : 'text-[#4e9b6b]'}>
                {overview?.recentErrors ?? 0}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>丢弃日志:</span>
              <span>{overview?.droppedLogs ?? 0}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
