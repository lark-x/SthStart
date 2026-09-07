import Link from 'next/link';
import { ArrowRight, Film } from 'lucide-react';

export function ActivityStudioCard() {
  return (
    <article className="app-card activity-studio-portal-card">
      <div className="card-art activity-studio-card-art" aria-hidden="true">
        <span className="creative-glow creative-glow-one" />
        <Film className="creative-spark creative-spark-one" />
        <span className="art-core">演</span>
      </div>
      <div className="card-content">
        <div className="card-meta">
          <span className="status-dot status-online" />
          <span>LOCAL · HYPERFRAMES</span>
        </div>
        <h3>活动工作室</h3>
        <p>群聊与动态故事工坊。多阶段大纲规划、记录编写、AI生成与采纳、媒体绑定及多端回放导出。</p>
        <div className="card-actions">
          <Link className="primary-action inline-flex items-center gap-2" href="/apps/activities">
            <span>进入工作室</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <span className="service-hint">群聊 · 动态 · 回放</span>
        </div>
      </div>
    </article>
  );
}
