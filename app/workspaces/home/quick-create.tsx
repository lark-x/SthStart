'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { BookOpen, CalendarDays, ChevronDown, Film, PenLine, Plus, Sparkles, Users } from 'lucide-react';
import { Menu } from '@mantine/core';
import { Button } from '@/app/components/ui/button';

const ACTIONS = [
  { href: '/apps/projects?new=1', label: '新建创作项目', description: '串联大纲正文、角色设定与制作版本', icon: BookOpen },
  { href: '/apps/activities/new', label: '新建制作', description: '从章节制作，或开始独立互动创作', icon: Film },
  { href: '/apps/characters/new', label: '新建角色', description: '手写或导入角色公共设定', icon: Users },
  { href: '/apps/notebook/new', label: '新建创作笔记', description: '记录灵感、设定与参考资料', icon: PenLine },
  { href: '/apps/creative', label: '自由生成', description: '文本生图、图生图与创意工坊', icon: Sparkles },
  { href: '/apps/calendar', label: '查看日历', description: '角色生日与活动排期', icon: CalendarDays },
];

/** 工作台顶部的新建入口：一个明确的主动作加一个菜单，替代四散的入口网格。 */
export function QuickCreate() {
  const triggerRef = useRef<HTMLButtonElement>(null);

  /*
   * WebKit 点击按钮不会把焦点交给按钮，按下时焦点落在可聚焦的祖先上；
   * Mantine 的 returnFocus 在菜单打开时采样 document.activeElement，
   * 采到的不是这个按钮，关闭后焦点就回不来。
   * 所以在点击里先把焦点放回真实按钮（Mantine 随后才采样），
   * 让鼠标、触屏和键盘三条路径采到同一个元素；preventScroll 只移动焦点、不改滚动。
   */
  const focusTrigger = () => {
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <Menu position="bottom-end" width={288} returnFocus shadow="md" radius="md">
      <Menu.Target>
        <Button ref={triggerRef} variant="primary" onClick={focusTrigger}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>新建创作</span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </Menu.Target>
      <Menu.Dropdown
        aria-label="新建"
        onKeyDown={(event) => {
          // Esc 收起菜单时显式把焦点交还触发按钮；跟随条目链接跳转时不抢焦点。
          if (event.key === 'Escape') focusTrigger();
        }}
      >
        {ACTIONS.map((action) => (
          <Menu.Item
            key={action.href}
            component={Link}
            href={action.href}
            leftSection={<action.icon className="h-4 w-4 text-muted" aria-hidden="true" />}
          >
            <span className="block text-sm font-medium text-ink">{action.label}</span>
            <span className="block text-xs text-fg-subtle">{action.description}</span>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
