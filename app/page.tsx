import Link from 'next/link';
import { LinsheCard } from './components/linshe-card';

export default function Home() {
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href="/" aria-label="SthStart 首页">
          <span className="brand-mark">S</span>
          <span>SthStart</span>
        </Link>
        <span className="header-note">LOCAL EXPERIENCE HUB</span>
      </header>

      <section className="hero" aria-labelledby="portal-title">
        <p className="eyebrow">你的本地互动世界，从这里开始</p>
        <h1 id="portal-title">
          一个入口，连接每一段
          <span>正在生长的故事。</span>
        </h1>
        <p className="hero-copy">
          SthStart 是你的本地应用门户。先从邻舍.EXE 出发，之后更多角色、创作与生成能力会陆续汇集于此。
        </p>
      </section>

      <section className="app-section" aria-labelledby="apps-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">APPLICATIONS</p>
            <h2 id="apps-title">已接入应用</h2>
          </div>
          <span className="app-count">01</span>
        </div>

        <LinsheCard />
      </section>

      <footer className="portal-footer">
        <span>STHSTART / 2026</span>
        <span>LOCAL FIRST · OPEN ENDED</span>
      </footer>
    </main>
  );
}
