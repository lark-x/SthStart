import React from 'react';
import {
  BookOpen,
  CalendarDays,
  CloudUpload,
  Compass,
  FileText,
  Home,
  Lightbulb,
  ListChecks,
  Server,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Activity,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * 单一导航注册表：
 * 侧栏、命令面板、门户目录都从这里取路由。
 * 重构后分为 3 大核心集群：'创作' | '资料' | '系统'。
 */

export type NavGroup = '创作' | '应用' | '管理';

export type NavSection = '创作工坊' | '知识素材' | '系统与应用';

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
  navSection: '创作工坊',
  href: '/',
  group: '应用',
  icon: Home,
  description: '返回门户首页与全部应用入口',
  keywords: ['home', 'portal', '门户', '首页', '工作台'],
};

/** 侧栏展示的核心应用入口（三大高内聚集群） */
export const NAV_APPS: NavApp[] = [
  // 1. 创作工坊
  {
    id: 'activities',
    title: '活动工作室',
    navLabel: '活动',
    navSection: '创作工坊',
    href: '/apps/activities',
    group: '创作',
    icon: ListChecks,
    description: '策划、生成与编排互动活动',
    keywords: ['activities', '活动', '工作室', '企划'],
  },
  {
    id: 'story',
    title: '剧情工作室',
    navLabel: '剧情',
    navSection: '创作工坊',
    href: '/apps/story',
    group: '创作',
    icon: BookOpen,
    description: '整理大纲、世界观与角色，开启独立 AI 剧情讨论会话',
    keywords: ['story', '剧情', '大纲', '世界观', '会话'],
  },
  {
    id: 'characters',
    title: '角色资料库',
    navLabel: '角色',
    navSection: '创作工坊',
    href: '/apps/characters',
    group: '创作',
    icon: Users,
    description: '管理角色设定、外貌、关系与发布版本',
    keywords: ['characters', '角色', '人物', 'dossier'],
  },
  {
    id: 'creative',
    title: '图像工坊',
    navLabel: '图像工坊',
    navSection: '创作工坊',
    href: '/apps/creative',
    group: '创作',
    icon: Sparkles,
    description: '高质量文本生图、图生图与创作媒体资产库',
    keywords: ['creative', '图像工坊', '生图', '图生图', '媒体库', 'artifact'],
  },

  // 2. 知识素材
  {
    id: 'inspiration',
    title: '灵感素材',
    navLabel: '灵感素材',
    navSection: '知识素材',
    href: '/apps/inspiration',
    group: '创作',
    icon: Lightbulb,
    description: '定时搜集作品新梗与灵感讨论，生成活动点子并无缝带入企划',
    keywords: ['inspiration', '灵感素材', '话题', '素材', '灵感', '新梗', 'topic'],
  },
  {
    id: 'notebook',
    title: '创作笔记',
    navLabel: '创作笔记',
    navSection: '知识素材',
    href: '/apps/notebook',
    group: '创作',
    icon: BookOpen,
    description: '资料、日记、灵感与世界设定；标为可参考后可在企划中引用',
    keywords: ['notebook', '创作笔记', '笔记', '资料库', '日记', '知识'],
  },
  {
    id: 'narrative',
    title: '叙事档案',
    navLabel: '叙事档案',
    navSection: '知识素材',
    href: '/apps/narrative',
    group: '创作',
    icon: FileText,
    description: '任务链阅读、多作品追溯与原文检索',
    keywords: ['narrative', '叙事', '剧情', '档案'],
  },
  {
    id: 'calendar',
    title: '创作日历',
    navLabel: '创作日历',
    navSection: '知识素材',
    href: '/apps/calendar',
    group: '创作',
    icon: CalendarDays,
    description: '查看角色生日与互动活动日程安排',
    keywords: ['calendar', '创作日历', '日历', '生日', '日程'],
  },

  // 3. 系统与应用
  {
    id: 'linshe',
    title: '邻舍.EXE',
    navLabel: '邻舍',
    navSection: '系统与应用',
    href: '/apps/linshe',
    group: '应用',
    icon: Compass,
    description: '进入邻舍应用延续角色生活与交互',
    keywords: ['linshe', '邻舍', 'agent'],
  },
  {
    id: 'settings',
    title: '系统设置',
    navLabel: '系统设置',
    navSection: '系统与应用',
    href: '/settings',
    group: '管理',
    icon: Settings,
    description: '模型服务、生成引擎、运行控制、审计与备份设置中心',
    keywords: ['settings', '系统设置', '设置', '配置', '模型', '备份'],
  },
];

/** 设置中心子页面列表（供命令面板 Cmd+K 深度直达） */
export const SETTINGS_SUB_PAGES: NavApp[] = [
  {
    id: 'public-services',
    title: '公共服务',
    navLabel: '模型与公共服务',
    navSection: '系统与应用',
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
    navSection: '系统与应用',
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
    navSection: '系统与应用',
    href: '/settings/control-center',
    group: '管理',
    icon: Server,
    description: '管理邻舍后端运行栈、服务启停与运行日志',
    keywords: ['control center', '控制中心', '运行', '服务', 'runtime'],
  },
  {
    id: 'ai-logs',
    title: 'AI 调用记录',
    navLabel: 'AI 调用记录',
    navSection: '系统与应用',
    href: '/settings/ai-logs',
    group: '管理',
    icon: Activity,
    description: '查看业务模型调用、生成工作流与脱敏响应记录',
    keywords: ['ai logs', 'AI 调用', '审计', '模型请求', '生成记录'],
  },
  {
    id: 'backups',
    title: '云备份',
    navLabel: '云备份',
    navSection: '系统与应用',
    href: '/settings/backups',
    group: '管理',
    icon: CloudUpload,
    description: '加密备份工作区、活动与创作资料到多个网盘，并按版本恢复',
    keywords: ['backup', '云备份', '网盘', '加密', '恢复', 'restore'],
  },
];

export const NAV_GROUPS: readonly NavGroup[] = ['创作', '应用', '管理'];

/** 侧栏分组顺序（收敛为 3 大逻辑集群） */
export const NAV_SECTIONS: readonly NavSection[] = ['创作工坊', '知识素材', '系统与应用'];

/** 侧栏显示名：优先短标签。 */
export function navDisplayLabel(app: NavApp): string {
  return app.navLabel ?? app.title;
}

/** 全部可导航应用（含门户及设置子项），供命令面板等需要完整扁平列表的场景使用。 */
export const NAV_ALL: NavApp[] = [NAV_PORTAL, ...NAV_APPS, ...SETTINGS_SUB_PAGES];

export function NavAppIcon({ app, className }: { app: NavApp; className?: string }) {
  const Icon = app.icon;
  return <Icon className={className} aria-hidden="true" />;
}
