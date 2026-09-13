import Link from 'next/link';
import { RecentWork } from './components/recent-work';
import { UpcomingSchedule } from './components/upcoming-schedule';
import { QuickCreate } from './components/quick-create';
import { RuntimeStrip } from './components/runtime-strip';
import { PageContainer } from './components/shared/page-layout';
import { PageHeader } from './components/shared/page-header';
import { NAV_APPS, NAV_PORTAL, NAV_SECTIONS, navDisplayLabel } from './components/shared/navigation';

/**
 * 工作台首页：以“继续做什么”为主，应用入口收敛为底部目录。
 * 不再使用大号欢迎语与等权应用卡片网格；导航入口由 AppShell 侧栏承担。
 */
export default function Home() {
  return (
    <PageContainer className="space-y-5 pb-8">
      <PageHeader
        title="工作台"
        description="继续最近的创作，或从下方目录进入其他应用。"
        actions={<QuickCreate />}
      />

      {/*
       * 用明确的 .dash-grid 规则代替工具类媒体查询：轨道宽度始终受容器约束，
       * 子项显式 min-width:0，避免任何一帧出现内容撑破单列宽度的横向溢出。
       */}
      <div className="dash-grid">
        <RecentWork />

        <div className="space-y-5">
          <UpcomingSchedule />
          <RuntimeStrip />
        </div>
      </div>

      <section aria-labelledby="app-directory-title" className="space-y-3">
        <h2 id="app-directory-title" className="tpl-section-title">全部应用</h2>

        {NAV_SECTIONS.map((section) => {
          const apps = NAV_APPS.filter((app) => app.navSection === section);
          if (apps.length === 0) return null;
          return (
            <div key={section} className="space-y-2">
              <h3 className="text-sm font-semibold text-fg-subtle">{section}</h3>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {apps.map((app) => (
                  <li key={app.href}>
                    <Link
                      href={app.href}
                      className="tpl-panel flex h-full items-start gap-3 p-3 transition-colors hover:bg-surface-hover"
                    >
                      <app.icon className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{navDisplayLabel(app)}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-fg-subtle">{app.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <p className="pt-1 text-xs text-fg-subtle">
          <Link href={NAV_PORTAL.href} className="transition-colors hover:text-accent">
            回到工作台
          </Link>
        </p>
      </section>
    </PageContainer>
  );
}
