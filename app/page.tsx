import { RecentWork } from './components/recent-work';
import { UpcomingSchedule } from './components/upcoming-schedule';
import { RuntimeStrip } from './components/runtime-strip';
import { QuickCreate } from './components/quick-create';
import { HomeGreeting } from './components/home-greeting';
import { HomeModules } from './components/home-modules';
import { PageContainer } from './components/shared/page-layout';

export default function Home() {
  return (
    <PageContainer className="space-y-4">
      {/* 问候 + 全局唯一的显式首要操作 QuickCreate */}
      <HomeGreeting actions={<QuickCreate />} />

      <HomeModules />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="home-card">
          <RecentWork limit={7} />
        </div>
        <aside className="min-w-0 space-y-4" aria-label="日程与服务状态">
          <div className="home-card">
            <UpcomingSchedule limit={5} />
          </div>
          <RuntimeStrip />
        </aside>
      </div>
    </PageContainer>
  );
}
