import Link from 'next/link';

export function CharacterLibraryCard() {
  return <article className="app-card character-portal-card">
    <div className="card-art character-card-art" aria-hidden="true"><span className="character-orbit orbit-one"/><span className="character-orbit orbit-two"/><span className="art-core">角</span></div>
    <div className="card-content"><div className="card-meta"><span className="status-dot status-online"/><span>SHARED · VERSIONED</span></div><h3>角色资料库</h3><p>整理角色身份、性格、外观、表达与关系，让邻舍、笔记和未来应用使用同一份可信资料。</p><div className="card-actions"><Link className="primary-action" href="/apps/characters">打开资料库 <span aria-hidden="true">→</span></Link><span className="service-hint">草稿与发布版本分离</span></div></div>
  </article>;
}
