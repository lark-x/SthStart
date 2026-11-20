'use client';

import Link from 'next/link';
import { ArrowUpRight, Compass, Film, Library, Users } from 'lucide-react';
import type { NavTone } from '@/app/shell/navigation';
import { useWorkspaceCounts } from '@/app/features/workspace/queries';

type CountKey = keyof ReturnType<typeof useWorkspaceCounts>;

const MODULES: Array<{ href: string; title: string; unit: string; description: string; icon: typeof Users; tone: NavTone; count: CountKey }> = [
  { href: '/apps/story-worlds', title: '作品', unit: '部作品', description: '世界观设定、章节脉络与正文创作', icon: Compass, tone: 'blue', count: 'worlds' },
  { href: '/apps/characters', title: '角色库', unit: '位角色', description: '跨应用复用的公共角色资料', icon: Users, tone: 'violet', count: 'characters' },
  { href: '/apps/resources', title: '资料库', unit: '条资料', description: '笔记、灵感采集与搜集任务', icon: Library, tone: 'green', count: 'notes' },
  { href: '/apps/media', title: '媒体库', unit: '个文件', description: '图像、音频与多模态资产', icon: Film, tone: 'orange', count: 'media' },
];

/** 首页统计卡：四个模块入口，图标、模块名与数量同一行，说明在下一行。 */
export function HomeModules() {
  const counts = useWorkspaceCounts();

  return (
    <nav aria-label="创作模块" className="home-modules" data-motion-list="">
      {MODULES.map(({ href, title, unit, description, icon: Icon, tone, count }) => {
        const value = counts[count];
        return (
          <Link
            key={href}
            href={href}
            className="home-module group"
            data-tone={tone}
          >
            {/* 标题在前：读屏名称以模块名开头、包含可见文字；视觉上由 CSS 把头部（图标与统计）排在最上。 */}
            <span id={`home-module-title-${count}`} className="home-module-title">{title}</span>
            <span id={`home-module-meta-${count}`} className="home-module-meta">{description}</span>
            <span className="home-module-head">
              <span className="home-module-icon" aria-hidden="true">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex items-center gap-2">
                {value !== undefined && (
                  <span id={`home-module-count-${count}`} className="home-module-count" data-visual-dynamic="true">
                    {value}<span className="sr-only">{unit}</span>
                  </span>
                )}
                <ArrowUpRight className="home-module-arrow h-4 w-4" aria-hidden="true" />
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
