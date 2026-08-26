import Link from 'next/link';
import { PublicServicesSettings } from './settings-client';

export const dynamic = 'force-dynamic';

export default function PublicServicesPage() {
  return <main className="portal-shell settings-shell">
    <header className="portal-header"><Link className="brand" href="/"><span className="brand-mark">S</span><span>SthStart</span></Link><nav className="header-nav"><Link href="/settings/control-center">运行与诊断</Link><Link className="text-link" href="/">← 返回主页</Link></nav></header>
    <section className="settings-hero"><p className="eyebrow">LOCAL SERVICE CONTROL</p><h1>公共服务设置</h1><p>集中管理应用身份、供应商能力和可复用角色模板。所有服务仍只监听本机回环地址。</p></section>
    <PublicServicesSettings />
  </main>;
}
