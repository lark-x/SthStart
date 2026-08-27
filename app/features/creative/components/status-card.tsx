'use client';

import { CircleDashed, Loader2, RefreshCw } from 'lucide-react';
import type { CreativeStatusResponse } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { statusCopy, statusVariant } from '../types';

export function CreativeStatusCard({ status, onRefresh }: { status?: CreativeStatusResponse; onRefresh: () => void }) {
  const modes = status?.modes;
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">GENERATION ROUTING</span>
            <CardTitle className="mt-1">公共生成状态</CardTitle>
          </div>
          <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="刷新生成状态">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">刷新</span>
          </Button>
        </div>
        <CardDescription>创作中心只使用 SthStart 分配的工作流。模板、引擎与密钥不会出现在创作页面。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {modes ? (
          <>
            {([
              ['textToImage', '文本生图'],
              ['imageToImage', '图生图'],
              ['h3T2v', 'H3 文生视频'],
              ['h3I2v', 'H3 图生视频'],
              ['h3Fl2va', 'H3 首尾帧视频'],
            ] as const).map(([key, label]) => {
              const binding = modes[key];
              return (
                <div key={key} className="flex items-start justify-between gap-3 rounded-[3px_12px_3px_3px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <CircleDashed className={`mt-0.5 h-4 w-4 flex-none ${binding.ready ? 'text-[#4e9b6b]' : 'text-[#d0a731]'}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#18201d]">{label}</p>
                      <p className="mt-1 truncate text-[11px] text-[#68716d]">{statusCopy(binding)}</p>
                    </div>
                  </div>
                  <Badge variant={statusVariant(binding)} dot>{binding.ready ? '就绪' : '待配置'}</Badge>
                </div>
              );
            })}
            {(!modes.textToImage.ready || !modes.imageToImage.ready || !modes.h3T2v.ready || !modes.h3I2v.ready || !modes.h3Fl2va.ready) && (
              <Alert variant="warning" title="生成工作流尚未完全配置">
                <span>未就绪的模式会保留明确原因；请在管理页绑定对应的工作流版本并检查 Worker 状态。</span>{' '}
                <a href="/settings/generation" className="font-semibold underline underline-offset-2">进入生成配置</a>
              </Alert>
            )}
          </>
        ) : (
          <div className="flex min-h-[180px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-[#e45d35]" aria-label="正在读取生成状态" /></div>
        )}
      </CardContent>
    </Card>
  );
}
