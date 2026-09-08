import Link from 'next/link';
import { RecentWork } from './components/recent-work';
import { Plus, PenLine, Sparkles, BookOpen, Film } from 'lucide-react';
import { LinsheCard } from './components/linshe-card';
import { NotebookCard } from './components/notebook-card';
import { NarrativeCard } from './components/narrative-card';
import { RuntimeStrip } from './components/runtime-strip';
import { CharacterLibraryCard } from './components/character-library-card';
import { CreativeCard } from './components/creative-card';
import { ActivityStudioCard } from './components/activity-studio-card';
import { EyeCareToggle } from './components/shared/eye-care-toggle';

export default function Home() {
  return (
    <div className="portal-page-wrapper w-full min-h-screen bg-[#f4f0e7]">
      <main className="portal-shell">
        <header className="portal-header">
          <Link className="brand" href="/" aria-label="SthStart 首页">
            <span className="brand-mark">S</span>
            <span>SthStart</span>
          </Link>
          <nav className="header-nav">
            <Link href="/apps/activities">活动工作室</Link>
            <Link href="/apps/creative">创作中心</Link>
            <Link href="/settings/control-center">控制中心</Link>
            <Link href="/settings/public-services">公共服务</Link>
            <EyeCareToggle />
            <span className="header-note">LOCAL EXPERIENCE HUB</span>
          </nav>
        </header>

        <div className="portal-dashboard">
          {/* Left Column: Status & Control Central (38%) */}
          <div className="portal-sidebar-col">
            <section className="hero" aria-labelledby="portal-title">
              <h1 id="portal-title">今天，继续创作。</h1>
              <p className="hero-copy">活动、角色与灵感，都在这里。</p>
            </section>
            <RecentWork />

            <RuntimeStrip />

            <section className="quick-channel-card" aria-label="快捷通道">
              <div className="quick-channel-header">
                <span className="quick-channel-kicker">QUICK ACTIONS</span>
                <span className="quick-channel-title">快捷通道</span>
              </div>
              <div className="quick-channel-grid">
                <Link href="/apps/characters/new" className="quick-action-pill">
                  <Plus className="h-3.5 w-3.5 text-[#e45d35]" aria-hidden="true" />
                  <span>新建角色</span>
                </Link>
                <Link href="/apps/notebook/new?kind=diary" className="quick-action-pill">
                  <PenLine className="h-3.5 w-3.5 text-[#e45d35]" aria-hidden="true" />
                  <span>写篇日记</span>
                </Link>
                <Link href="/apps/creative" className="quick-action-pill">
                  <Sparkles className="h-3.5 w-3.5 text-[#e45d35]" aria-hidden="true" />
                  <span>新建生图</span>
                </Link>
                <Link href="/apps/activities/new" className="quick-action-pill">
                  <Film className="h-3.5 w-3.5 text-[#e45d35]" aria-hidden="true" />
                  <span>新建活动</span>
                </Link>
                <Link href="/apps/narrative" className="quick-action-pill">
                  <BookOpen className="h-3.5 w-3.5 text-[#e45d35]" aria-hidden="true" />
                  <span>查阅档案</span>
                </Link>
              </div>
            </section>
          </div>

          {/* Right Column: Applications Matrix (62%) */}
          <div className="portal-main-col">
            <section className="app-section" aria-labelledby="apps-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">APPLICATIONS</p>
                  <h2 id="apps-title">已接入应用</h2>
                </div>
                <span className="app-count">06</span>
              </div>

              <div className="app-list">
                <ActivityStudioCard />
                <LinsheCard />
                <CreativeCard />
                <CharacterLibraryCard />
                <NotebookCard />
                <NarrativeCard />
              </div>
            </section>
          </div>
        </div>

        <footer className="portal-footer">
          <span>STHSTART / 2026</span>
          <span>LOCAL FIRST · OPEN ENDED</span>
        </footer>
      </main>
    </div>
  );
}
