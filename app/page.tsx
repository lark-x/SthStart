import { RecentWork, ContinueCreatingCard, HomeNextSteps, HOME_RECENT_LIMIT } from '@/app/workspaces/home/recent-work';
import { UpcomingSchedule } from '@/app/workspaces/home/upcoming-schedule';
import { RuntimeStrip } from '@/app/workspaces/home/runtime-strip';
import { QuickCreate } from '@/app/workspaces/home/quick-create';
import { HomeGreeting } from '@/app/workspaces/home/home-greeting';
import { HomeModules } from '@/app/workspaces/home/home-modules';
import { OverviewLayout } from './components/shared/page-archetypes';

/** Overview 原型：问候 → 继续创作主卡 → 少数据建议 → 统计 → 最近工作与日程。 */
export default function Home() {
  return (
    <OverviewLayout
      greeting={<HomeGreeting actions={<QuickCreate />} />}
      hero={<ContinueCreatingCard />}
      nextSteps={<HomeNextSteps />}
      stats={<HomeModules />}
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="home-card">
          <RecentWork limit={HOME_RECENT_LIMIT} />
        </div>
        <aside className="min-w-0 space-y-4" aria-label="日程与服务状态">
          <div className="home-card">
            <UpcomingSchedule limit={5} />
          </div>
          <RuntimeStrip />
        </aside>
      </div>
    </OverviewLayout>
  );
}
