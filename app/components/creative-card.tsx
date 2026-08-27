import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';

export function CreativeCard() {
  return (
    <article className="app-card creative-portal-card">
      <div className="card-art creative-card-art" aria-hidden="true">
        <span className="creative-glow creative-glow-one" />
        <span className="creative-glow creative-glow-two" />
        <Sparkles className="creative-spark creative-spark-one" />
        <Sparkles className="creative-spark creative-spark-two" />
        <span className="art-core">创</span>
      </div>
      <div className="card-content">
        <div className="card-meta">
          <span className="status-dot status-online" />
          <span>LOCAL · ARTIFACT 2.0</span>
        </div>
        <h3>创作中心</h3>
        <p>用提示词和参考图开始一次创作，让每个结果都成为可以继续使用、固定与追溯的本地素材。</p>
        <div className="card-actions">
          <Link className="primary-action inline-flex items-center gap-2" href="/apps/creative">
            <span>开始创作</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <span className="service-hint">文本生图 · 图生图</span>
        </div>
      </div>
    </article>
  );
}
