'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react';
import { LinsheBridgeDrawer } from '@/app/features/linshe-bridge/components/linshe-bridge-drawer';
import { useCallback, useEffect, useState } from 'react';
import type { AppDescriptor } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { EmptyState } from '@/app/components/ui/empty-state';
import { fallbackLinsheUrl, getLinshe } from '../../lib/sthstart-service';
import {
  embedStateForStatus,
  embedStatusLabel,
  shouldRenderLinshe,
  type EmbedLoadState,
} from '../../lib/linshe-state';

function isLoopbackUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string) {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value.endsWith('.localhost');
}

export default function LinshePage() {
  const [app, setApp] = useState<AppDescriptor | null>(null);
  const [state, setState] = useState<EmbedLoadState>('loading');
  const [forceOpen, setForceOpen] = useState(false);
  const [remoteBrowser, setRemoteBrowser] = useState(false);
  const [bridgeDrawerOpen, setBridgeDrawerOpen] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const launchUrl = app?.launchUrl ?? fallbackLinsheUrl;
  const localOnlyLaunch = remoteBrowser && isLoopbackUrl(launchUrl);

  function markRemoteBrowser() {
    setRemoteBrowser(!isLoopbackHost(window.location.hostname));
  }

  const refresh = useCallback(async () => {
    setState('loading');
    setForceOpen(false);
    setFrameFailed(false);
    try {
      const result = await getLinshe();
      markRemoteBrowser();
      setApp(result);
      setState(embedStateForStatus(result.status));
    } catch {
      markRemoteBrowser();
      setState('unknown');
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-app', 'linshe');
    let active = true;
    void getLinshe()
      .then((result) => {
        if (!active) return;
        markRemoteBrowser();
        setApp(result);
        setState(embedStateForStatus(result.status));
      })
      .catch(() => {
        if (active) { markRemoteBrowser(); setState('unknown'); }
      });
    return () => {
      active = false;
      document.documentElement.removeAttribute('data-app');
    };
  }, []);

  const showFrame = shouldRenderLinshe(state, forceOpen) && !localOnlyLaunch;

  return (
    <main className="embed-shell" data-app="linshe">
      <header className="embed-toolbar">
        <div className="embed-toolbar-main">
          {/* 恢复全站导航的动作（§8.13）：精简外框下仍保留明确的返回入口。 */}
          <Link className="back-link" href="/" aria-label="返回 SthStart 工作台"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
          <div>
            <h1>邻舍.EXE</h1>
          </div>
        </div>
        <div className="embed-actions">
          <Badge variant={state === 'ready' ? 'online' : state === 'loading' ? 'unknown' : 'offline'} className={`embed-status embed-status-${state}`}>
            {embedStatusLabel(state)}
          </Badge>
          <Button className="embed-action" size="sm" variant="ghost" loading={state === 'loading'} onClick={() => void refresh()}>重新连接</Button>
          <Button
            className="embed-action"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              // WebKit 的指针点击不会聚焦按钮；先聚焦真实触发器，关闭后对话框才能归还焦点。
              event.currentTarget.focus({ preventScroll: true });
              setBridgeDrawerOpen(true);
            }}
            title="打开 SthStart × 邻舍 数据互通与资产回流工作台"
          >
            数据互通
          </Button>
          {localOnlyLaunch ? <span className="embed-disabled-link">本机地址未对外开放</span> : <a className="embed-action" href={launchUrl} target="_blank" rel="noreferrer">新窗口打开 <ExternalLink className="inline h-3.5 w-3.5" aria-hidden="true" /></a>}
        </div>
      </header>

      <section className="embed-stage" aria-live="polite">
        {showFrame && !frameFailed ? (
          <>
            <iframe
              className="linshe-frame"
              src={launchUrl}
              title="邻舍.EXE"
              allow="clipboard-read; clipboard-write; fullscreen"
              referrerPolicy="no-referrer"
              onError={() => setFrameFailed(true)}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
              <a className="pointer-events-auto rounded-control border border-on-media/20 bg-[color-mix(in_srgb,var(--console-bg)_90%,transparent)] px-3 py-2 text-xs font-medium text-[var(--console-fg)] hover:bg-[var(--console-bar)]" href={launchUrl} target="_blank" rel="noreferrer">页面没有响应？在新窗口打开</a>
            </div>
          </>
        ) : (
          <div className="embed-empty">
            <EmptyState
              icon={frameFailed ? AlertTriangle : undefined}
              symbol={frameFailed ? undefined : '邻'}
              title={frameFailed ? '邻舍页面没有成功载入' : localOnlyLaunch ? '邻舍需要单独的远程入口' : state === 'loading' ? '正在寻找邻舍…' : '邻舍还没有启动'}
              description={frameFailed
                ? 'iframe 没有完成载入。可以重试，或在新窗口直接打开；SthStart 的数据互通仍可从上方进入。'
                : localOnlyLaunch
                ? '当前 Named Tunnel 只暴露了 SthStart Portal（4173）。邻舍生产入口仍在本机 3099；请为邻舍域名增加指向 3099 的受 Access 保护的 ingress。'
                : state === 'unknown'
                ? '公共服务暂时不可用。你仍可以尝试直接加载默认的本地地址。'
                : '请在项目根目录启动邻舍，服务就绪后再重新连接。'}
              actions={state !== 'loading' ? <>
                <Button variant="primary" onClick={() => void refresh()}>重新检测</Button>
                {!localOnlyLaunch && <Button variant="outline" onClick={() => { setFrameFailed(false); setForceOpen(true); }}>仍然尝试加载</Button>}
                {!localOnlyLaunch && <a className="inline-flex min-h-10 items-center justify-center rounded-control border border-on-media/20 px-4 text-sm font-semibold text-[var(--console-fg)] hover:bg-on-media/10" href={launchUrl} target="_blank" rel="noreferrer">在新窗口打开</a>}
              </> : undefined}
            />
            {frameFailed && <Alert variant="warning" title="iframe 加载失败" className="mt-4 w-full max-w-xl text-left">页面可能拒绝嵌入、尚未启动，或网络连接中断。工具与返回入口仍可使用。</Alert>}
          </div>
        )}
      </section>
      <LinsheBridgeDrawer open={bridgeDrawerOpen} onOpenChange={setBridgeDrawerOpen} />
    </main>
  );
}
