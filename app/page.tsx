import Link from 'next/link';
import { ArrowRight, Library, Lightbulb, NotebookPen, SlidersHorizontal } from 'lucide-react';
import { RecentWork } from './components/recent-work';
import { UpcomingSchedule } from './components/upcoming-schedule';
import { RuntimeStrip } from './components/runtime-strip';
import { QuickCreate } from './components/quick-create';
import { AppDirectory } from './components/app-directory';
import { PageContainer } from './components/shared/page-layout';

const RESOURCES = [
  { href: '/apps/inspiration', title: '灵感素材', description: '收集话题与创作点子', icon: Lightbulb },
  { href: '/apps/notebook', title: '创作笔记', description: '记录资料、设定与摘录', icon: NotebookPen },
  { href: '/apps/narrative', title: '叙事档案', description: '阅读原文与检索证据', icon: Library },
  { href: '/settings/public-services', title: '系统设置', description: '管理模型与生成服务', icon: SlidersHorizontal },
];

export default function Home() {
  return (
    <PageContainer className="space-y-8 py-6 pb-16">
      {/* 首页主入口收敛：全局唯一的显式首要操作 QuickCreate */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-border-subtle pb-6">
        <div className="space-y-1">
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-ink sm:text-3xl">工作台</h1>
          <p className="font-sans text-sm text-muted">从最近的进度继续，或快速开启一段新的创作旅程。</p>
        </div>
        <div className="flex-none">
          <QuickCreate />
        </div>
      </div>

      <div className="dash-grid items-start gap-8">
        <RecentWork limit={10} />
        <aside className="min-w-0 space-y-8" aria-label="日程与资源">
          <UpcomingSchedule limit={5} />
          <RuntimeStrip />
          <section aria-labelledby="creative-hub-title" className="space-y-3">
            <div className="border-b border-border-subtle pb-2">
              <h2 id="creative-hub-title" className="font-sans text-sm font-semibold text-ink">创作资源与快速通道</h2>
            </div>
            <ul className="divide-y divide-border-subtle" role="list">
              {RESOURCES.map(({ href, title, description, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="group flex items-center gap-3 px-2 py-2.5 rounded-[var(--radius-control)] transition-colors hover:bg-surface-hover"
                  >
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-control)] bg-surface-sunken text-muted group-hover:text-ink transition-colors">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{title}</span>
                      <span className="block truncate text-xs text-muted">{description}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 flex-none text-muted opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      <AppDirectory />
    </PageContainer>
  );
}
