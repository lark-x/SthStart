'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AppDescriptor } from '@sthstart/contracts';
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
  const launchUrl = app?.launchUrl ?? fallbackLinsheUrl;
  const localOnlyLaunch = remoteBrowser && isLoopbackUrl(launchUrl);

  function markRemoteBrowser() {
    setRemoteBrowser(!isLoopbackHost(window.location.hostname));
  }

  const refresh = useCallback(async () => {
    setState('loading');
    setForceOpen(false);
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
          <Link className="back-link" href="/" aria-label="返回 SthStart 首页">←</Link>
          <div>
            <p>STHSTART / APPLICATION</p>
            <h1>邻舍.EXE</h1>
          </div>
        </div>
        <div className="embed-actions">
          <span className={`embed-status embed-status-${state}`}>
            {embedStatusLabel(state)}
          </span>
          <button type="button" onClick={() => void refresh()}>重新连接</button>
          {localOnlyLaunch ? <span className="embed-disabled-link">本机地址未对外开放</span> : <a href={launchUrl} target="_blank" rel="noreferrer">新窗口打开 ↗</a>}
        </div>
      </header>

      <section className="embed-stage" aria-live="polite">
        {showFrame ? (
          <iframe
            className="linshe-frame"
            src={launchUrl}
            title="邻舍.EXE"
            allow="clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="embed-empty">
            <span className="empty-symbol" aria-hidden="true">邻</span>
            <p className="eyebrow">{localOnlyLaunch ? 'REMOTE APP NOT EXPOSED' : state === 'loading' ? 'CONNECTING' : 'LOCAL SERVICE OFFLINE'}</p>
            <h2>{localOnlyLaunch ? '邻舍需要单独的远程入口' : state === 'loading' ? '正在寻找邻舍…' : '邻舍还没有启动'}</h2>
            <p>
              {localOnlyLaunch
                ? '当前 Named Tunnel 只暴露了 SthStart Portal（4173）。邻舍生产入口仍在本机 3099；请为邻舍域名增加指向 3099 的受 Access 保护的 ingress。'
                : state === 'unknown'
                ? '公共服务暂时不可用。你仍可以尝试直接加载默认的本地地址。'
                : '请在项目根目录启动邻舍，服务就绪后再重新连接。'}
            </p>
            {state !== 'loading' && (
              <div className="empty-actions">
                <button className="primary-action" type="button" onClick={() => void refresh()}>重新检测</button>
                {!localOnlyLaunch && <button className="secondary-action" type="button" onClick={() => setForceOpen(true)}>仍然尝试加载</button>}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
