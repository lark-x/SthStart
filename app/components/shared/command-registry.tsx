import React from 'react';
import { Sun, Moon, Plus, Terminal, Palette } from 'lucide-react';
import type { CommandItem } from '../ui/command';
import { NAV_APPS, NAV_PORTAL, SETTINGS_SUB_PAGES } from './navigation';
import { THEMES, type ThemeId } from '@/app/lib/theme-preference';

/**
 * 命令面板注册表：
 * 应用入口全部由统一导航注册表生成，
 * 包含偏好主题切换与快捷操作。
 */
export function createCommandRegistry(
  push: (href: string) => void,
  toggleColorModeOrEyeCare?: () => void,
  setThemeId?: (id: ThemeId) => void,
): CommandItem[] {
  const groupCategory: Record<string, string> = {
    '创作': '应用',
    '应用': '应用',
    '管理': '设置',
  };

  const appItems: CommandItem[] = [
    {
      id: 'app-portal',
      title: '返回门户',
      description: NAV_PORTAL.description,
      category: '应用',
      keywords: NAV_PORTAL.keywords,
      icon: <NAV_PORTAL.icon className="h-4 w-4" />,
      action: () => push(NAV_PORTAL.href),
    },
    ...NAV_APPS.map((app) => ({
      id: `app-${app.id}`,
      title: app.title,
      description: app.description,
      category: groupCategory[app.group] ?? '应用',
      keywords: app.keywords,
      icon: <app.icon className="h-4 w-4" />,
      action: () => push(app.href),
    })),
    ...SETTINGS_SUB_PAGES.map((app) => ({
      id: `app-sub-${app.id}`,
      title: `${app.title} (系统设置)`,
      description: app.description,
      category: '设置',
      keywords: app.keywords,
      icon: <app.icon className="h-4 w-4" />,
      action: () => push(app.href),
    })),
  ];

  const themeActions: CommandItem[] = [
    {
      id: 'action-toggle-dark-mode',
      title: '切换日间 / 夜间模式',
      description: '在当前白天与黑夜基调之间快速翻转',
      category: '偏好',
      keywords: ['theme', 'dark', 'light', '黑夜', '白天', '日间', '夜间', '暗色', '模式'],
      icon: <Sun className="h-4 w-4 text-warning-fg" />,
      action: () => toggleColorModeOrEyeCare?.(),
    },
    ...THEMES.map((theme) => ({
      id: `action-theme-${theme.id}`,
      title: `主题：${theme.name}`,
      description: `${theme.category} · ${theme.description}`,
      category: '偏好',
      keywords: ['theme', '主题', theme.name, theme.id, theme.category],
      icon: <Palette className="h-4 w-4" style={{ color: theme.accent }} />,
      action: () => setThemeId ? setThemeId(theme.id) : toggleColorModeOrEyeCare?.(),
    })),
  ];

  const quickActions: CommandItem[] = [
    {
      id: 'action-new-activity',
      title: '新建互动活动',
      description: '策划并生成一场多角色互动活动',
      category: '快捷操作',
      keywords: ['new', 'activity', '新建活动', '活动'],
      icon: <Plus className="h-4 w-4" />,
      action: () => push('/apps/activities/new'),
    },
    {
      id: 'action-new-story',
      title: '进入剧情创作 (Story Studio)',
      description: '编剧工作室、大纲世界观与角色设定',
      category: '快捷操作',
      keywords: ['new', 'story', '剧情', '剧本', '大纲', '小说'],
      icon: <Plus className="h-4 w-4" />,
      action: () => push('/apps/story'),
    },
    {
      id: 'action-new-character',
      title: '新建角色',
      description: '在角色资料库中创建新角色草稿',
      category: '快捷操作',
      keywords: ['new', 'character', '新建角色'],
      icon: <Plus className="h-4 w-4" />,
      action: () => push('/apps/characters/new'),
    },
    {
      id: 'action-new-creative',
      title: '进入图像工坊 (生图)',
      description: '高质量文本生图、图生图与创作媒体资产库',
      category: '快捷操作',
      keywords: ['image', 'creative', '生图', '绘图', '画画', '图像工坊'],
      icon: <Plus className="h-4 w-4" />,
      action: () => push('/apps/creative'),
    },
    {
      id: 'action-new-note',
      title: '新建创作笔记',
      description: '随手记录新的灵感或设定',
      category: '快捷操作',
      keywords: ['new', 'note', '新建笔记'],
      icon: <Plus className="h-4 w-4" />,
      action: () => push('/apps/notebook/new'),
    },
    {
      id: 'action-logs',
      title: '实时日志流',
      description: '查看邻舍与各服务实时输出日志',
      category: '设置',
      keywords: ['logs', '日志', 'stream'],
      icon: <Terminal className="h-4 w-4" />,
      action: () => push('/settings/control-center?tab=logs'),
    },
  ];

  return [...themeActions, ...quickActions, ...appItems];
}
