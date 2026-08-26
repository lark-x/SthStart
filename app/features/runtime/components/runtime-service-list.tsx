'use client';

import React from 'react';
import { Play, Square, RotateCw } from 'lucide-react';
import type { RuntimeService } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { StatusIndicator } from '@/app/components/shared/status-indicator';

export function RuntimeServiceList({
  services,
  onStart,
  onStop,
  onRestart,
  busy,
}: {
  services: RuntimeService[];
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  busy?: string;
}) {
  const stateLabel = (state: string) => {
    return (
      ({
        running: '运行中',
        starting: '启动中',
        stopping: '停止中',
        stopped: '已停止',
        external: '外部启动',
        degraded: '降级',
        error: '异常',
      } as Record<string, string>)[state] ?? state
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {services.map((service) => {
        const isRunning = service.state === 'running';

        return (
          <div
            key={service.id}
            className="flex items-center justify-between gap-4 p-4 rounded-[3px_14px_3px_3px] border border-[rgb(24_32_29/13%)] bg-[#fffdf8]"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <StatusIndicator status={service.state} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-semibold text-[#18201d] truncate">
                    {service.name}
                  </strong>
                  <Badge
                    variant={
                      service.state === 'running'
                        ? 'running'
                        : service.state === 'error'
                        ? 'error'
                        : service.state === 'external'
                        ? 'warning'
                        : 'stopped'
                    }
                  >
                    {stateLabel(service.state)}
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-[#68716d] flex items-center gap-2">
                  <span>端口 :{service.port}</span>
                  {service.pid && <span>· PID {service.pid}</span>}
                  {service.message && <span className="text-[#c9674a] truncate">· {service.message}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isRunning ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRestart(service.id)}
                    disabled={Boolean(busy)}
                    title="重启服务"
                  >
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">重启</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[#c9674a] hover:bg-[#c9674a]/10"
                    onClick={() => onStop(service.id)}
                    disabled={Boolean(busy)}
                    title="停止服务"
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">停止</span>
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onStart(service.id)}
                  disabled={Boolean(busy) || !service.installed}
                  title={service.installed ? '启动服务' : '未检测到安装'}
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>启动</span>
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
