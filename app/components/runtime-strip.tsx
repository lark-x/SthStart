'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useRuntimeOverview } from '@/app/features/runtime/queries';

export function RuntimeStrip() {
  const { data: overview } = useRuntimeOverview();

  const running = overview?.services.filter((item) => item.state === 'running').length ?? 0;

  return (
    <section className="runtime-strip" aria-label="本地服务状态" data-visual-dynamic="true">
      <div className="runtime-strip-info">
        <span className={`service-light ${running ? 'state-running' : 'state-stopped'}`} />
        <div className="runtime-strip-text">
          <strong>{running ? '邻舍服务正在运行' : '邻舍服务尚未启动'}</strong>
          <small>{running} 个服务在线 · 最近异常 {overview?.recentErrors ?? 0}</small>
        </div>
      </div>
      <Link href="/settings/control-center" className="runtime-strip-action inline-flex items-center gap-1.5 font-semibold text-[#18201d] hover:text-[#e45d35] transition-colors">
        <span>打开控制中心</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
