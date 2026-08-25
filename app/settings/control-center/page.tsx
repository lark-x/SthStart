import Link from 'next/link';
import { ControlCenter } from './control-center-client';

export const dynamic = 'force-dynamic';

export default function ControlCenterPage() {
  return <main className="portal-shell control-shell">
    <header className="portal-header">
      <Link className="brand" href="/"><span className="brand-mark">S</span><span>SthStart</span></Link>
      <nav className="header-nav"><Link href="/settings/public-services">应用与角色</Link><Link className="text-link" href="/">← 返回主页</Link></nav>
    </header>
    <section className="settings-hero control-hero">
      <p className="eyebrow">LOCAL CONTROL CENTER</p>
      <h1>运行与诊断</h1>
      <p>从一个地方启动邻舍、管理共用配置，并在需要时开启有时限的详细日志。</p>
    </section>
    <ControlCenter />
  </main>;
}
