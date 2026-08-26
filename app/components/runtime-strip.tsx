'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RuntimeOverview } from '@sthstart/contracts';
import { adminFetch } from '@/app/lib/admin-fetch';

export function RuntimeStrip() {
  const [overview, setOverview] = useState<RuntimeOverview | null>(null);
  useEffect(() => { adminFetch('runtime/overview', { cache: 'no-store' }).then(async (response) => response.ok ? await response.json() as RuntimeOverview : null).then(setOverview).catch(() => undefined); }, []);
  const running = overview?.services.filter((item) => item.state === 'running').length ?? 0;
  return <section className="runtime-strip" aria-label="本地服务状态"><div><span className={`service-light ${running ? 'state-running' : 'state-stopped'}`}/><div><strong>{running ? '邻舍服务正在运行' : '邻舍服务尚未启动'}</strong><small>{running} 个服务在线 · 最近异常 {overview?.recentErrors ?? 0}</small></div></div><Link href="/settings/control-center">打开控制中心 <span>→</span></Link></section>;
}
