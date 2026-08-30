'use client';

import { useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { adminFetch } from '@/app/lib/admin-fetch';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';

type TimingResult = {
  sessionMs: number;
  requestMs: number;
  serverTiming: string;
  checkedAt: string;
};

function milliseconds(value: number) {
  return `${Math.round(value)} ms`;
}

export function RemotePerformancePanel() {
  const [result, setResult] = useState<TimingResult>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const diagnose = async () => {
    setRunning(true);
    setError('');
    try {
      const sessionStarted = performance.now();
      const sessionResponse = await fetch('/api/auth/admin-session', { cache: 'no-store', credentials: 'same-origin' });
      const sessionMs = performance.now() - sessionStarted;
      if (!sessionResponse.ok) throw new Error('管理会话检查失败');

      const requestStarted = performance.now();
      const response = await adminFetch('runtime/overview', { cache: 'no-store' });
      const requestMs = performance.now() - requestStarted;
      if (!response.ok) throw new Error('公共服务检查失败');
      await response.body?.cancel().catch(() => undefined);
      setResult({
        sessionMs,
        requestMs,
        serverTiming: response.headers.get('server-timing') ?? '',
        checkedAt: new Date().toLocaleTimeString('zh-CN'),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRunning(false);
    }
  };

  const slow = result && (result.sessionMs > 800 || result.requestMs > 1_000);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[#e45d35]" aria-hidden="true" />
              远程访问性能
            </CardTitle>
            <CardDescription>只测量当前浏览器到 Portal 和本机公共服务的耗时，不上传日志、IP 或请求内容。</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void diagnose()} loading={running}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>运行检测</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-xs text-[#c9674a]">{error}</p>}
        {result && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded border border-[rgb(24_32_29/10%)] p-3">
              <span className="text-[#68716d]">会话往返</span>
              <strong className="mt-1 block text-lg text-[#18201d]">{milliseconds(result.sessionMs)}</strong>
            </div>
            <div className="rounded border border-[rgb(24_32_29/10%)] p-3">
              <span className="text-[#68716d]">完整 API 往返</span>
              <strong className="mt-1 block text-lg text-[#18201d]">{milliseconds(result.requestMs)}</strong>
            </div>
            <div className="rounded border border-[rgb(24_32_29/10%)] p-3">
              <span className="text-[#68716d]">Portal 内部分段</span>
              <strong className="mt-1 block break-words text-[#18201d]">{result.serverTiming || '未返回'}</strong>
            </div>
            <p className={`sm:col-span-3 ${slow ? 'text-[#b83b1b]' : 'text-[#4e7659]'}`}>
              {slow
                ? '远程链路明显慢于本机处理。请优先让 SthStart 域名和 Cloudflare Access 域名绕过代理/VPN，再比较结果。'
                : '当前动态链路处于可用范围。若页面仍慢，可继续检查首次静态资源缓存和具体页面请求数量。'}
              <span className="ml-2 text-[#68716d]">检测时间 {result.checkedAt}</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
