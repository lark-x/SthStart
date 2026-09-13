import React from 'react';
import {
  BookOpen,
  CalendarDays,
  Compass,
  FileText,
  Home,
  ListChecks,
  Server,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * 单一导航注册表（计划 §4.1 / F06）：
 * 侧栏、命令面板、门户目录都从这里取路由，避免各自维护一份互相遗漏的名单。
 * 新增页面时在此登记，各导航界面自动获得入口。
 */

export type NavGroup = '创作' | '应用' | '管理';

/** 侧栏分组：与 NavGroup 分离，避免改变既有命令面板分类口径。 */
export type NavSection = '创作' | '资料' | '应用' | '设置';

export interface NavApp {
  id: string;
  title: string;
  /** 侧栏使用的短标签；缺省回退 title。命令面板仍使用 title。 */
  navLabel?: string;
  navSection: NavSection;
  href: string;
  group: NavGroup;
  icon: LucideIcon;
  description: string;
  keywords: string[];
}

/** 门户作为壳层的入口单独暴露，不参与业务分组排序。 */
export const NAV_PORTAL: NavApp = {
  id: 'portal',
  title: '门户',
  navLabel: '工作台',
  navSection: '创作',
  href: '/',
  group: '应用',
  icon: Home,
  description: '返回门户首页与全部应用入口',
  keywords: ['home', 'portal', '门户', '首页'],
};

export const NAV_APPS: NavApp[] = [
  {
    id: 'activities',
    title: '活动工作室',
    navLabel: '活动',
    navSection: '创作',
    href: '/apps/activities',
    group: '创作',
    icon: ListChecks,
    description: '策划、生成与编排互动活动',
    keywords: ['activities', '活动', '工作室', '企划'],
  },
  {
    id: 'creative',
    title: '创作中心',
    navLabel: '图像与视频',
    navSection: '创作',
    href: '/apps/creative',
    group: '创作',
    icon: Sparkles,
    description: '文本生图、图生图与中央图片媒体库',
    keywords: ['creative', '创作', '生图', '图片', 'artifact'],
  },
  {
    id: 'characters',
    title: '角色资料库',
    navLabel: '角色',
    navSection: '创作',
    href: '/apps/characters',
    group: '创作',
    icon: Users,
    description: '管理角色设定、外貌、关系与发布版本',
    keywords: ['characters', '角色', '人物', 'dossier'],
  },
  {
    id: 'calendar',
    title: '角色日历',
    navLabel: '日历',
    navSection: '创作',
    href: '/apps/calendar',
    group: '创作',
    icon: CalendarDays,
    description: '查看角色生日与活动日程安排',
    keywords: ['calendar', '日历', '生日', '日程'],
  },
  {
    id: 'notebook',
    title: '创作笔记',
    navLabel: '笔记',
    navSection: '资料',
    href: '/apps/notebook',
    group: '创作',
    icon: BookOpen,
    description: '日记、灵感、世界设定与剧情素材',
    keywords: ['notebook', '笔记', '灵感', '日记'],
  },
  {
    id: 'narrative',
    title: '叙事档案',
    navLabel: '叙事档案',
    navSection: '资料',
    href: '/apps/narrative',
    group: '创作',
    icon: FileText,
    description: '任务链阅读、多作品追溯与原文检索',
    keywords: ['narrative', '叙事', '剧情', '档案'],
  },
  {
    id: 'linshe',
    title: '邻舍.EXE',
    navLabel: '邻舍',
    navSection: '应用',
    href: '/apps/linshe',
    group: '应用',
    icon: Compass,
    description: '进入邻舍应用延续角色生活与交互',
    keywords: ['linshe', '邻舍', 'agent'],
  },
  {
    id: 'public-services',
    title: '公共服务',
    navLabel: '模型与公共服务',
    navSection: '设置',
    href: '/settings/public-services',
    group: '管理',
    icon: Settings,
    description: '配置 LLM 模型、向量与应用生效模型',
    keywords: ['public services', '公共服务', '模型', 'llm', 'provider'],
  },
  {
    id: 'generation',
    title: '生成配置',
    navLabel: '生成配置',
    navSection: '设置',
    href: '/settings/generation',
    group: '管理',
    icon: SlidersHorizontal,
    description: '管理生成引擎、工作流与模型绑定',
    keywords: ['generation', '生成配置', '引擎', 'workflow'],
  },
  {
    id: 'control-center',
    title: '控制中心',
    navLabel: '运行与日志',
    navSection: '设置',
    href: '/settings/control-center',
    group: '管理',
    icon: Server,
    description: '管理邻舍后端运行栈、服务启停与运行日志',
    keywords: ['control center', '控制中心', '运行', '服务', 'runtime'],
  },
];

export const NAV_GROUPS: readonly NavGroup[] = ['创作', '应用', '管理'];

/** 侧栏分组顺序。 */
export const NAV_SECTIONS: readonly NavSection[] = ['创作', '资料', '应用', '设置'];

/** 侧栏显示名：优先短标签。 */
export function navDisplayLabel(app: NavApp): string {
  return app.navLabel ?? app.title;
}

/** 全部可导航应用（含门户），供需要扁平列表的场景使用。 */
export const NAV_ALL: NavApp[] = [NAV_PORTAL, ...NAV_APPS];

export function NavAppIcon({ app, className }: { app: NavApp; className?: string }) {
  const Icon = app.icon;
  return <Icon className={className} aria-hidden="true" />;
}
