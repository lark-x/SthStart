import React from 'react';
import { Eye, Plus, Terminal } from 'lucide-react';
import type { CommandItem } from '../ui/command';
import { NAV_APPS, NAV_PORTAL } from './navigation';

/**
 * 命令面板注册表：应用入口全部由统一导航注册表生成（§4.1），
 * 保证与应用切换器名称、覆盖范围一致；这里只补充偏好与快捷操作。
 */
export function createCommandRegistry(push: (href: string) => void, toggleEyeCare?: () => void): CommandItem[] {
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
  ];

  const quickActions: CommandItem[] = [
    {
      id: 'action-toggle-eyecare',
      title: '切换暖杏护眼模式',
      description: '开启或关闭全局温润羊皮纸暖色显示',
      category: '偏好',
      keywords: ['eyecare', '护眼', '暖杏', '羊皮纸', 'theme', '模式'],
      icon: <Eye className="h-4 w-4 text-accent" />,
      action: () => toggleEyeCare?.(),
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
      id: 'action-new-note',
      title: '新建笔记',
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

  return [...quickActions, ...appItems];
}
