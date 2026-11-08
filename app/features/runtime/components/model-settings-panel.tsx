'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { RuntimeLlmStatus } from '@sthstart/contracts';
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
    <section className="border-y border-border-subtle py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">邻舍模型接入状态</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">邻舍将对话和多模态理解委托给统一的公共模型服务，无需各自维护私有 API Key。</p>
        </div>
        <Badge variant={isReady ? 'online' : isEnabled ? 'warning' : 'stopped'}>
          {isReady ? '模型路由已就绪' : isEnabled ? '缺少模型指定' : '公共模型未启用'}
        </Badge>
      </div>
      <div className="mt-5 space-y-4">
        <div className="grid grid-cols-1 border-y border-border-subtle sm:grid-cols-2">
          <div className="py-4 sm:pr-6">
            <span className="block text-xs font-semibold text-muted">
              生效文本模型
            </span>
            <div className="mt-1 text-sm font-semibold text-ink">
              {linsheLlm?.textModel || linsheLlm?.textProfileId || '尚未配置'}
            </div>
          </div>

          <div className="border-t border-border-subtle py-4 sm:border-l sm:border-t-0 sm:pl-6">
            <span className="block text-xs font-semibold text-muted">
              生效多模态模型
            </span>
            <div className="mt-1 font-semibold text-sm text-ink">
              {linsheLlm?.multimodalModel || linsheLlm?.multimodalProfileId || '尚未配置'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/settings/public-services"
            className="inline-flex items-center gap-1.5 text-sm text-ink font-semibold hover:text-accent transition-colors"
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
      </div>
    </section>
  );
}
