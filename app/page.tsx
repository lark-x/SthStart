import Link from 'next/link';
import { Film, BookOpen, Users, Sparkles, Lightbulb, NotebookPen, Library, SlidersHorizontal, ArrowUpRight } from 'lucide-react';
import { RecentWork } from './components/recent-work';
import { UpcomingSchedule } from './components/upcoming-schedule';
import { RuntimeStrip } from './components/runtime-strip';
import { PageContainer } from './components/shared/page-layout';

/**
 * 工作台首页 (Mission Control):
 * 采用 Notion / Craft 轻盈温暖纸感与现代无衬线排版层级，
 * 双栏高密创作驾驶舱设计 (64% 最近工作 + 36% 日程态势与创作枢纽)。
 */
export default function Home() {
  return (
    <PageContainer className="space-y-6 pt-5 sm:pt-6 pb-12">
      {/* 顶部标题与高频快捷动作胶囊 */}
      <header className="desk-header">
        <div>
          <p className="desk-eyebrow">CREATIVE WORKSPACE · 创作工作台</p>
          <h1 className="desk-header-title" id="desk-title">工作台</h1>
          <p className="desk-header-subtitle">
            让角色、故事与分镜画面在轻盈纸感心流中自由生长。
          </p>
        </div>

        <nav aria-label="快捷创作操作" className="desk-capsules">
          <Link href="/apps/activities/new" className="desk-capsule-btn primary">
            <Film className="h-4 w-4" aria-hidden="true" />
            <span>新建活动</span>
          </Link>
          <Link href="/apps/story" className="desk-capsule-btn">
            <BookOpen className="h-4 w-4 text-accent" aria-hidden="true" />
            <span>新建剧情</span>
          </Link>
          <Link href="/apps/characters/new" className="desk-capsule-btn">
            <Users className="h-4 w-4 text-accent" aria-hidden="true" />
            <span>创建角色</span>
          </Link>
          <Link href="/apps/creative" className="desk-capsule-btn">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
            <span>生图工坊</span>
          </Link>
        </nav>
      </header>

      {/* 创作驾驶舱双栏栅格 */}
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
          <section className="tpl-panel p-4 sm:p-5 space-y-3.5" aria-labelledby="creative-hub-title">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="creative-hub-title" className="tpl-section-title">创作枢纽</h2>
              <span className="text-xs text-muted">工作区快速索引</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
              <Link
                href="/apps/inspiration"
                className="group flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-sunken/45 p-3 text-ink transition-all duration-150 hover:border-accent/35 hover:bg-surface hover:shadow-xs"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-accent shadow-2xs transition-transform duration-150 group-hover:scale-105">
                  <Lightbulb className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm text-ink group-hover:text-accent transition-colors">灵感素材</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </div>
                  <p className="truncate text-xs text-muted">热点采集与企划点子</p>
                </div>
              </Link>

              <Link
                href="/apps/notebook"
                className="group flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-sunken/45 p-3 text-ink transition-all duration-150 hover:border-accent/35 hover:bg-surface hover:shadow-xs"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-accent shadow-2xs transition-transform duration-150 group-hover:scale-105">
                  <NotebookPen className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm text-ink group-hover:text-accent transition-colors">创作资料库</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </div>
                  <p className="truncate text-xs text-muted">笔记、设定与随手摘录</p>
                </div>
              </Link>

              <Link
                href="/apps/narrative"
                className="group flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-sunken/45 p-3 text-ink transition-all duration-150 hover:border-accent/35 hover:bg-surface hover:shadow-xs"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-accent shadow-2xs transition-transform duration-150 group-hover:scale-105">
                  <Library className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm text-ink group-hover:text-accent transition-colors">叙事档案</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </div>
                  <p className="truncate text-xs text-muted">沉浸阅读与证据检索</p>
                </div>
              </Link>

              <Link
                href="/settings/public-services"
                className="group flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-sunken/45 p-3 text-ink transition-all duration-150 hover:border-accent/35 hover:bg-surface hover:shadow-xs"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-accent shadow-2xs transition-transform duration-150 group-hover:scale-105">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm text-ink group-hover:text-accent transition-colors">系统设置</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </div>
                  <p className="truncate text-xs text-muted">模型绑定与生成引擎</p>
                </div>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
