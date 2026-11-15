import { RecentWork } from '@/app/workspaces/home/recent-work';
import { UpcomingSchedule } from '@/app/workspaces/home/upcoming-schedule';
import { RuntimeStrip } from '@/app/workspaces/home/runtime-strip';
import { QuickCreate } from '@/app/workspaces/home/quick-create';
import { HomeGreeting } from '@/app/workspaces/home/home-greeting';
import { HomeModules } from '@/app/workspaces/home/home-modules';
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
