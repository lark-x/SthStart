import Link from 'next/link';
import { Film, BookOpen, Users, Sparkles } from 'lucide-react';
import { RecentWork } from './components/recent-work';
import { UpcomingSchedule } from './components/upcoming-schedule';
import { RuntimeStrip } from './components/runtime-strip';
import { PageContainer } from './components/shared/page-layout';

/**
 * 工作台首页 (Mission Control):
 * 彻底移除冗余装饰性 Banner 与平铺 App 目录；
 * 采用 Claude 人文排版美学与双栏高密工作台设计 (65% 最近工作 + 35% 态势与运行指标)。
 */
export default function Home() {
  return (
    <PageContainer className="space-y-6 pt-5 sm:pt-6 pb-12">
      {/* 顶部标题与高频快捷动作胶囊 */}
      <header className="desk-header">
        <div>
          <h1 className="desk-header-title" id="desk-title">工作台</h1>
          <p className="desk-header-subtitle">
            让角色、故事与画面在灵感心流中自由生长。
          </p>
        </div>

        <nav aria-label="快捷创作操作" className="desk-capsules">
          <Link href="/apps/activities/new" className="desk-capsule-btn primary">
            <Film className="h-3.5 w-3.5" aria-hidden="true" />
            <span>新建活动</span>
          </Link>
          <Link href="/apps/story" className="desk-capsule-btn">
            <BookOpen className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>新建剧情</span>
          </Link>
          <Link href="/apps/characters/new" className="desk-capsule-btn">
            <Users className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>创建角色</span>
          </Link>
          <Link href="/apps/creative" className="desk-capsule-btn">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>生图工坊</span>
          </Link>
        </nav>
      </header>

      {/* 创作驾驶舱双栏栅格 (65% / 35%) */}
      <div className="dash-grid">
        {/* 左侧核心栏：高密度最近创作草稿与活动 */}
        <div className="min-w-0">
          <RecentWork limit={10} />
        </div>

        {/* 右侧态势栏：近期日程、运行健康指标与快捷枢纽 */}
        <div className="space-y-5 min-w-0">
          <UpcomingSchedule limit={5} />
          <RuntimeStrip />

          {/* 创作知识库快捷枢纽 */}
          <div className="tpl-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="tpl-section-title text-sm">创作枢纽</h2>
              <span className="text-[11px] text-muted">工作区快速索引</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link
                href="/apps/inspiration"
                className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-ink transition-colors hover:border-accent/40 hover:bg-surface-hover"
              >
                <span className="h-2 w-2 rounded-full bg-accent/70" aria-hidden="true" />
                <span className="font-medium">灵感素材</span>
              </Link>
              <Link
                href="/apps/notebook"
                className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-ink transition-colors hover:border-accent/40 hover:bg-surface-hover"
              >
                <span className="h-2 w-2 rounded-full bg-accent/70" aria-hidden="true" />
                <span className="font-medium">创作笔记</span>
              </Link>
              <Link
                href="/apps/narrative"
                className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-ink transition-colors hover:border-accent/40 hover:bg-surface-hover"
              >
                <span className="h-2 w-2 rounded-full bg-accent/70" aria-hidden="true" />
                <span className="font-medium">叙事档案</span>
              </Link>
              <Link
                href="/settings/public-services"
                className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-ink transition-colors hover:border-accent/40 hover:bg-surface-hover"
              >
                <span className="h-2 w-2 rounded-full bg-accent/70" aria-hidden="true" />
                <span className="font-medium">系统设置</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
