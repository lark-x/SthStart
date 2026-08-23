'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AppStatus } from '@sthstart/contracts';
import { getLinshe } from '../lib/sthstart-service';
import { homeStatusHint, homeStatusLabel } from '../lib/linshe-state';

export function LinsheCard() {
  const [status, setStatus] = useState<AppStatus>('unknown');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const app = await getLinshe();
        if (active) setStatus(app.status);
      } catch {
        if (active) setStatus('unknown');
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <article className="app-card">
      <div className="card-art" aria-hidden="true">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <span className="art-core">邻</span>
      </div>
      <div className="card-content">
        <div className="card-meta">
          <span className={`status-dot status-${status}`} />
          <span>{homeStatusLabel(status)}</span>
        </div>
        <h3>邻舍.EXE</h3>
        <p>让角色拥有记忆、情绪与生活节奏，在对话中自然延伸出图像与故事。</p>
        <div className="card-actions">
          <Link className="primary-action" href="/apps/linshe">
            进入邻舍
            <span aria-hidden="true">↗</span>
          </Link>
          <span className="service-hint">
            {homeStatusHint(status)}
          </span>
        </div>
      </div>
    </article>
  );
}
