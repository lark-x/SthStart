'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CalendarDays, ChevronDown, Film, PenLine, Plus, Sparkles, Users } from 'lucide-react';

const ACTIONS = [
  { href: '/apps/projects?new=1', label: '新建创作项目', description: '串联大纲正文、角色设定与制作版本', icon: BookOpen },
  { href: '/apps/activities/new', label: '新建制作', description: '从章节制作，或开始独立互动创作', icon: Film },
  { href: '/apps/characters/new', label: '新建角色', description: '手写或导入角色公共设定', icon: Users },
  { href: '/apps/notebook/new', label: '写资料笔记', description: '记录灵感随记、世界设定与参考资料', icon: PenLine },
  { href: '/apps/creative', label: '自由生成', description: '文本生图、图生图与创意工坊', icon: Sparkles },
  { href: '/apps/calendar', label: '查看日历', description: '角色生日与活动排期', icon: CalendarDays },
];

/** 工作台顶部的新建入口：一个明确的主动作加一个菜单，替代四散的入口网格。 */
export function QuickCreate() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  return (
    <div
      className="relative"
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        }
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          setOpen(true);
          return;
        }
        if (!open) return;
        const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'));
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        const next =
          event.key === 'ArrowDown'
            ? (index + 1) % links.length
            : event.key === 'ArrowUp'
            ? (index - 1 + links.length) % links.length
            : event.key === 'Home'
            ? 0
            : event.key === 'End'
            ? links.length - 1
            : -1;
        if (next >= 0) {
          event.preventDefault();
          links[next]?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>新建创作</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="新建"
          className="absolute left-0 sm:left-auto sm:right-0 z-[var(--z-menu)] mt-2 w-64 max-w-[calc(100vw-32px)] overflow-hidden rounded-panel border border-border-default bg-surface py-1 shadow-floating"
        >
          {ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover"
            >
              <action.icon className="mt-0.5 h-4 w-4 flex-none text-muted" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{action.label}</span>
                <span className="block text-xs text-fg-subtle">{action.description}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
