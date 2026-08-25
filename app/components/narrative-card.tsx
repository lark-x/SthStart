import Link from 'next/link';

export function NarrativeCard() {
  return <article className="app-card narrative-portal-card">
    <div className="card-art narrative-card-art" aria-hidden="true"><span className="archive-axis"/><span className="archive-node node-a"/><span className="archive-node node-b"/><span className="archive-node node-c"/><span className="art-core">叙</span></div>
    <div className="card-content"><div className="card-meta"><span className="status-dot status-online"/><span>LOCAL ARCHIVE · READY</span></div><h3>叙事档案</h3><p>按任务连续回顾剧情，沿着角色、事件与设定找到原文证据，也为未来的创作保留可靠出处。</p><div className="card-actions"><Link className="primary-action" href="/apps/narrative">进入档案 <span aria-hidden="true">→</span></Link><span className="service-hint">多作品 · 可追溯</span></div></div>
  </article>;
}
