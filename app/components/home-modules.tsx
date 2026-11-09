'use client';

import Link from 'next/link';
import { ArrowUpRight, Film, FolderKanban, Library, Users } from 'lucide-react';
import type { NavTone } from './shared/navigation';
import { useWorkspaceCounts } from '../features/workspace/queries';

type CountKey = keyof ReturnType<typeof useWorkspaceCounts>;

const MODULES: Array<{ href: string; title: string; unit: string; description: string; icon: typeof Users; tone: NavTone; count: CountKey }> = [
  { href: '/apps/projects', title: '创作项目', unit: '个项目', description: '大纲正文、角色设定与制作版本', icon: FolderKanban, tone: 'blue', count: 'projects' },
  { href: '/apps/characters', title: '角色库', unit: '位角色', description: '跨应用复用的公共角色资料', icon: Users, tone: 'violet', count: 'characters' },
  { href: '/apps/resources', title: '资料库', unit: '条资料', description: '笔记、灵感采集与搜集任务', icon: Library, tone: 'green', count: 'notes' },
  { href: '/apps/media', title: '媒体库', unit: '个文件', description: '图像、音频与多模态资产', icon: Film, tone: 'orange', count: 'media' },
];

/** 首页四个模块入口：模块色浅底卡片 + 数量，数量未取到时只显示说明。 */
export function HomeModules() {
  const counts = useWorkspaceCounts();

  return (
    <nav aria-label="创作模块" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {MODULES.map(({ href, title, unit, description, icon: Icon, tone, count }) => {
        const value = counts[count];
        return (
          <Link key={href} href={href} className="home-module" data-tone={tone}>
            <span className="home-module-head">
              <span className="home-module-icon" aria-hidden="true">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <ArrowUpRight className="home-module-arrow h-4 w-4" aria-hidden="true" />
            </span>
            <span className="home-module-title">{title}</span>
            <span className="home-module-meta" data-visual-dynamic="true">
              {value === undefined ? description : `${value} ${unit}`}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
