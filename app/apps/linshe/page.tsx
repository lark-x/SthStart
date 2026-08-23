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

export default function LinshePage() {
  const [app, setApp] = useState<AppDescriptor | null>(null);
  const [state, setState] = useState<EmbedLoadState>('loading');
  const [forceOpen, setForceOpen] = useState(false);
  const launchUrl = app?.launchUrl ?? fallbackLinsheUrl;

  const refresh = useCallback(async () => {
    setState('loading');
    setForceOpen(false);
    try {
      const result = await getLinshe();
      setApp(result);
      setState(embedStateForStatus(result.status));
    } catch {
      setState('unknown');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getLinshe()
      .then((result) => {
        if (!active) return;
        setApp(result);
        setState(embedStateForStatus(result.status));
      })
      .catch(() => {
        if (active) setState('unknown');
      });
    return () => { active = false; };
  }, []);

  const showFrame = shouldRenderLinshe(state, forceOpen);

  return (
    <main className="embed-shell">
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
          <a href={launchUrl} target="_blank" rel="noreferrer">新窗口打开 ↗</a>
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
            <p className="eyebrow">{state === 'loading' ? 'CONNECTING' : 'LOCAL SERVICE OFFLINE'}</p>
            <h2>{state === 'loading' ? '正在寻找邻舍…' : '邻舍还没有启动'}</h2>
            <p>
              {state === 'unknown'
                ? '公共服务暂时不可用。你仍可以尝试直接加载默认的本地地址。'
                : '请在项目根目录启动邻舍，服务就绪后再重新连接。'}
            </p>
            {state !== 'loading' && (
              <div className="empty-actions">
                <button className="primary-action" type="button" onClick={() => void refresh()}>重新检测</button>
                <button className="secondary-action" type="button" onClick={() => setForceOpen(true)}>仍然尝试加载</button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
