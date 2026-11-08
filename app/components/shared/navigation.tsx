import React from 'react';
import {
  BookOpen,
  CalendarDays,
  CloudUpload,
  Compass,
  Film,
  FolderKanban,
  FileText,
  Home,
  Library,
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
 * 重构后分为 4 大核心领域：'创作' | '资源' | '工具' | '系统'。
 */

export type NavGroup = '创作' | '资源' | '工具' | '系统' | '应用' | '管理';

export type NavSection = '创作' | '资源' | '工具' | '系统';

/** 模块识别色，对应 theme.css 中的 [data-tone]。 */
export type NavTone = 'violet' | 'blue' | 'orange' | 'green' | 'pink' | 'slate';

export interface NavApp {
  id: string;
  title: string;
  /** 侧栏使用的短标签；缺省回退 title。命令面板仍使用 title。 */
  navLabel?: string;
  navSection: NavSection;
  /** 模块识别色：侧栏图标、页面标题与卡片强调都使用它。缺省使用强调色。 */
  tone?: NavTone;
  href: string;
  group: NavGroup;
  icon: LucideIcon;
  description: string;
  keywords: string[];
  /** 为 true 时在侧栏隐藏（用于旧路由兼容），命令面板和搜索仍可索引 */
  hiddenFromSidebar?: boolean;
  /** 自定义激活路径匹配列表，优先于默认前缀匹配 */
  activePaths?: string[];
}

/** 门户作为壳层的入口单独暴露，不参与业务分组排序。 */
export const NAV_PORTAL: NavApp = {
  id: 'portal',
  title: '门户',
  navLabel: '工作台',
  navSection: '创作',
  tone: 'slate',
  href: '/',
  group: '创作',
  icon: Home,
  description: '返回门户首页与全部应用入口',
  keywords: ['home', 'portal', '门户', '首页', '工作台'],
};

/** 核心应用入口与可路由应用登记（侧栏展示 + 命令面板索引） */
export const NAV_APPS: NavApp[] = [
  // 1. 创作
  {
    id: 'projects',
    title: '创作项目',
    navLabel: '创作项目',
    navSection: '创作',
    tone: 'blue',
    href: '/apps/projects',
    group: '创作',
    icon: FolderKanban,
    description: '串联大纲正文、角色、资料参考与多模态制作',
    keywords: ['projects', '创作项目', '项目', '正文', '小说', '大纲'],
    activePaths: ['/apps/projects', '/apps/story', '/apps/activities'],
  },

  // 2. 资源
  {
    id: 'resources',
    title: '资料库',
    navLabel: '资料库',
    navSection: '资源',
    tone: 'green',
    href: '/apps/resources',
    group: '资源',
    icon: Library,
    description: '集中管理创作笔记、灵感素材、搜集任务与参考资料',
    keywords: ['resources', '资料库', '笔记', '灵感', '素材', '知识', '搜集'],
    activePaths: ['/apps/resources', '/apps/notebook', '/apps/inspiration', '/apps/narrative'],
  },
  {
    id: 'characters',
    title: '角色资料库',
    navLabel: '角色库',
    navSection: '资源',
    tone: 'violet',
    href: '/apps/characters',
    group: '资源',
    icon: Users,
    description: '管理角色设定、外貌、关系与发布版本',
    keywords: ['characters', '角色', '人物', 'dossier'],
    activePaths: ['/apps/characters'],
  },
  {
    id: 'media',
    title: '媒体库',
    navLabel: '媒体库',
    navSection: '资源',
    tone: 'orange',
    href: '/apps/media',
    group: '资源',
    icon: Film,
    description: '统一浏览与检索图像、音频等多模态创作资产',
    keywords: ['media', '媒体库', '图像', '音频', '资产', 'artifact'],
    activePaths: ['/apps/media'],
  },

  // 3. 工具
  {
    id: 'creative',
    title: '自由生成',
    navLabel: '自由生成',
    navSection: '工具',
    tone: 'pink',
    href: '/apps/creative',
    group: '工具',
    icon: Sparkles,
    description: '自由文本生图、图生图与多模态创意工坊',
    keywords: ['creative', '自由生成', '图像工坊', '生图', '图生图', '媒体库', 'artifact'],
    activePaths: ['/apps/creative'],
  },
  {
    id: 'calendar',
    title: '创作日历',
    navLabel: '创作日历',
    navSection: '工具',
    tone: 'orange',
    href: '/apps/calendar',
    group: '工具',
    icon: CalendarDays,
    description: '查看角色生日与互动活动日程安排',
    keywords: ['calendar', '创作日历', '日历', '生日', '日程'],
    activePaths: ['/apps/calendar'],
  },

  // 4. 系统
  {
    id: 'linshe',
    title: '邻舍.EXE',
    navLabel: '邻舍',
    navSection: '系统',
    tone: 'green',
    href: '/apps/linshe',
    group: '系统',
    icon: Compass,
    description: '进入邻舍应用延续角色生活与交互',
    keywords: ['linshe', '邻舍', 'agent'],
    activePaths: ['/apps/linshe'],
  },
  {
    id: 'settings',
    title: '系统设置',
    navLabel: '系统设置',
    navSection: '系统',
    tone: 'slate',
    href: '/settings/public-services',
    group: '系统',
    icon: Settings,
    description: '模型连接、生成方案、运行诊断、调用记录与数据备份',
    keywords: ['settings', '系统设置', '设置', '配置', '模型', '备份'],
    activePaths: ['/settings'],
  },

  // 旧版路由兼容（侧栏隐藏，但命令面板及直接 URL 访问均可索引）
  {
    id: 'activities',
    title: '制作',
    navLabel: '活动',
    navSection: '创作',
    tone: 'blue',
    href: '/apps/activities',
    group: '创作',
    icon: ListChecks,
    description: '查看章节制作版本与独立互动制作',
    keywords: ['activities', '活动', '工作室', '企划'],
    hiddenFromSidebar: true,
  },
  {
    id: 'story',
    title: '正文与感想',
    navLabel: '剧情',
    navSection: '创作',
    tone: 'blue',
    href: '/apps/story',
    group: '创作',
    icon: BookOpen,
    description: '编辑故事正文、设定与对话感想',
    keywords: ['story', '剧情', '大纲', '世界观', '会话', 'reflection'],
    hiddenFromSidebar: true,
  },
  {
    id: 'inspiration',
    title: '灵感素材',
    navLabel: '灵感素材',
    navSection: '资源',
    tone: 'green',
    href: '/apps/inspiration',
    group: '资源',
    icon: Lightbulb,
    description: '定时搜集关注作品的新梗与讨论，现可在资料库中直接访问',
    keywords: ['inspiration', '灵感素材', '话题', '素材', '灵感', '新梗', 'topic'],
    hiddenFromSidebar: true,
  },
  {
    id: 'notebook',
    title: '创作笔记',
    navLabel: '创作笔记',
    navSection: '资源',
    tone: 'green',
    href: '/apps/notebook',
    group: '资源',
    icon: BookOpen,
    description: '创作资料与笔记历史入口，现可在资料库中直接编辑管理',
    keywords: ['notebook', '创作笔记', '笔记', '资料库', '日记', '知识'],
    hiddenFromSidebar: true,
  },
  {
    id: 'narrative',
    title: '原作档案',
    navLabel: '叙事档案',
    navSection: '资源',
    tone: 'green',
    href: '/apps/narrative',
    group: '资源',
    icon: FileText,
    description: '任务链阅读、多作品追溯与原文检索档案',
    keywords: ['narrative', '叙事', '剧情', '档案'],
    hiddenFromSidebar: true,
  },
];

/** 设置中心子页面列表（供命令面板 Cmd+K 深度直达） */
export const SETTINGS_SUB_PAGES: NavApp[] = [
  {
    id: 'public-services',
    title: '模型与连接',
    navLabel: '模型与连接',
    navSection: '系统',
    tone: 'slate',
    href: '/settings/public-services',
    group: '系统',
    icon: Settings,
    description: '配置 LLM 模型、向量与服务提供商连接',
    keywords: ['public services', '模型与连接', '模型', 'llm', 'provider', '连接'],
  },
  {
    id: 'generation',
    title: '生成方案',
    navLabel: '生成方案',
    navSection: '系统',
    tone: 'slate',
    href: '/settings/generation',
    group: '系统',
    icon: SlidersHorizontal,
    description: '管理生成引擎、工作流与参数方案绑定',
    keywords: ['generation', '生成方案', '引擎', 'workflow', '方案'],
  },
  {
    id: 'control-center',
    title: '运行诊断',
    navLabel: '运行诊断',
    navSection: '系统',
    tone: 'slate',
    href: '/settings/control-center',
    group: '系统',
    icon: Server,
    description: '管理邻舍后端运行栈、服务监控与运行诊断日志',
    keywords: ['control center', '运行诊断', '控制中心', '运行', '服务', 'runtime', '诊断'],
  },
  {
    id: 'ai-logs',
    title: '调用记录',
    navLabel: '调用记录',
    navSection: '系统',
    tone: 'slate',
    href: '/settings/ai-logs',
    group: '系统',
    icon: Activity,
    description: '查看业务模型调用、生成工作流与脱敏审计记录',
    keywords: ['ai logs', '调用记录', '审计', '模型请求', '生成记录'],
  },
  {
    id: 'backups',
    title: '数据备份',
    navLabel: '数据备份',
    navSection: '系统',
    tone: 'slate',
    href: '/settings/backups',
    group: '系统',
    icon: CloudUpload,
    description: '加密备份工作区、活动与创作资料，并按版本恢复',
    keywords: ['backup', '数据备份', '网盘', '加密', '恢复', 'restore'],
  },
];

export const NAV_GROUPS: readonly NavGroup[] = ['创作', '资源', '工具', '系统'];

/** 侧栏分组顺序（收敛为 4 大核心领域） */
export const NAV_SECTIONS: readonly NavSection[] = ['创作', '资源', '工具', '系统'];

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
