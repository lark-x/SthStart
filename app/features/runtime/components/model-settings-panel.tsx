'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { RuntimeLlmStatus } from '@sthstart/contracts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';

export function ModelSettingsPanel({
  linsheLlm,
  onSync,
  syncing,
}: {
  linsheLlm?: RuntimeLlmStatus;
  onSync?: () => Promise<void>;
  syncing?: boolean;
}) {
  const isEnabled = linsheLlm?.enabled ?? false;
  const isReady = linsheLlm?.ready ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">
            PUBLIC LLM ROUTING
          </span>
          <Badge variant={isReady ? 'online' : isEnabled ? 'warning' : 'stopped'}>
            {isReady ? '模型路由已就绪' : isEnabled ? '缺少模型指定' : '公共模型未启用'}
          </Badge>
        </div>
        <CardTitle>邻舍模型接入状态</CardTitle>
        <CardDescription>
          邻舍将对话和多模态理解委托给统一的公共模型服务，无需各自维护私有 API Key。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8]">
            <span className="text-[10px] font-bold text-[#68716d] uppercase tracking-wider block">
              生效文本模型
            </span>
            <div className="mt-1 font-semibold text-sm text-[#18201d]">
              {linsheLlm?.textModel || linsheLlm?.textProfileId || '尚未配置'}
            </div>
          </div>

          <div className="p-3.5 rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8]">
            <span className="text-[10px] font-bold text-[#68716d] uppercase tracking-wider block">
              生效多模态模型
            </span>
            <div className="mt-1 font-semibold text-sm text-[#18201d]">
              {linsheLlm?.multimodalModel || linsheLlm?.multimodalProfileId || '尚未配置'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[rgb(24_32_29/10%)]">
          <Link
            href="/settings/public-services"
            className="inline-flex items-center gap-1.5 text-xs text-[#18201d] font-semibold hover:text-[#e45d35] transition-colors"
          >
            <span>进入公共模型服务管理与分配</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>

          {onSync && (
            <Button size="sm" variant="outline" loading={syncing} onClick={onSync}>
              同步最新模型设置
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
