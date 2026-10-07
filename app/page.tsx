import { RecentWork } from './components/recent-work';
import { UpcomingSchedule } from './components/upcoming-schedule';
import { QuickCreate } from './components/quick-create';
import { RuntimeStrip } from './components/runtime-strip';
import { AppDirectory } from './components/app-directory';
import { PageContainer } from './components/shared/page-layout';

/**
 * 工作台首页：以“继续做什么”为主，应用入口收敛为目录；英雄区与最近工作承担明确视觉层级。
 */
export default function Home() {
  return (
    <PageContainer className="space-y-5 pt-5 sm:pt-6 pb-8">
      <section className="desk-hero" aria-labelledby="desk-title">
        <div className="desk-hero-copy">
          <p className="desk-eyebrow">STHSTART <span aria-hidden="true">/</span> CREATIVE DESK</p>
          <h1 id="desk-title">工作台</h1>
          <p>让角色、故事与画面，在一个地方继续生长。</p>
        </div>
        <div className="desk-hero-actions">
          <QuickCreate />
          <span className="desk-hero-note">本地创作空间 · 内容保存在你的工作区</span>
        </div>
        <div className="desk-hero-orbit" aria-hidden="true"><span /><span /><span /></div>
      </section>

      {/*
       * 用明确的 .dash-grid 规则约束轨道宽度，子项显式 min-width:0，
       * 避免任何一帧出现内容撑破单列宽度的横向溢出。
       */}
      <div className="dash-grid">
        <RecentWork limit={5} />

        <div className="space-y-5">
          <UpcomingSchedule />
          <RuntimeStrip />
        </div>
      </div>

      <AppDirectory />
    </PageContainer>
  );
}
