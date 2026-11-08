'use client';

import { useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { adminFetch } from '@/app/lib/admin-fetch';
import { Button } from '@/app/components/ui/button';

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
    <section className="border-b border-border-subtle pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Gauge className="h-4 w-4 text-muted" aria-hidden="true" />
            远程访问性能
          </h2>
          <p className="mt-1 text-sm text-muted">只测量当前浏览器到 Portal 和本机公共服务的耗时，不上传日志、IP 或请求内容。</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void diagnose()} loading={running}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>运行检测</span>
        </Button>
      </div>
      <div className="mt-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && (
          <div className="grid grid-cols-1 border-y border-border-subtle text-sm sm:grid-cols-3">
            <div className="py-3 sm:pr-4">
              <span className="text-muted">会话往返</span>
              <span className="mt-1 block text-lg font-semibold text-ink">{milliseconds(result.sessionMs)}</span>
            </div>
            <div className="border-t border-border-subtle py-3 sm:border-l sm:border-t-0 sm:px-4">
              <span className="text-muted">完整 API 往返</span>
              <span className="mt-1 block text-lg font-semibold text-ink">{milliseconds(result.requestMs)}</span>
            </div>
            <div className="border-t border-border-subtle py-3 sm:border-l sm:border-t-0 sm:pl-4">
              <span className="text-muted">Portal 内部分段</span>
              <span className="mt-1 block break-words font-semibold text-ink">{result.serverTiming || '未返回'}</span>
            </div>
            <p className={`sm:col-span-3 ${slow ? 'text-warning-fg' : 'text-success-fg'}`}>
              {slow
                ? '远程链路明显慢于本机处理。请优先让 SthStart 域名和 Cloudflare Access 域名绕过代理/VPN，再比较结果。'
                : '当前动态链路处于可用范围。若页面仍慢，可继续检查首次静态资源缓存和具体页面请求数量。'}
              <span className="ml-2 text-muted">检测时间 {result.checkedAt}</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
