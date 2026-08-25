import Link from 'next/link';

export function NotebookCard() {
  return <article className="app-card notebook-portal-card">
    <div className="card-art notebook-card-art" aria-hidden="true"><span className="paper-line line-one"/><span className="paper-line line-two"/><span className="paper-line line-three"/><span className="art-core">拾</span></div>
    <div className="card-content"><div className="card-meta"><span className="status-dot status-online"/><span>LOCAL · READY</span></div><h3>创作笔记</h3><p>收纳日记、灵感、角色与世界设定，让零散素材逐渐靠近一段可以书写的剧情。</p><div className="card-actions"><Link className="primary-action" href="/apps/notebook">打开笔记 <span aria-hidden="true">→</span></Link><span className="service-hint">适配电脑与手机</span></div></div>
  </article>;
}
