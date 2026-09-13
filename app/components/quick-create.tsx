'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CalendarDays, ChevronDown, Film, Plus, Sparkles, Users } from 'lucide-react';

const ACTIONS = [
  { href: '/apps/activities/new', label: '新建活动', description: '策划并生成一场互动活动', icon: Film },
  { href: '/apps/characters/new', label: '新建角色', description: '手写或导入角色设定', icon: Users },
  { href: '/apps/creative', label: '新建生图', description: '文本生图与图生图', icon: Sparkles },
  { href: '/apps/notebook/new', label: '写笔记', description: '记录灵感与世界设定', icon: BookOpen },
  { href: '/apps/calendar', label: '查看日历', description: '角色生日与活动排期', icon: CalendarDays },
];

/** 工作台顶部的新建入口：一个明确的主动作加一个菜单，替代四散的入口网格。 */
export function QuickCreate() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>新建</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="新建"
          className="absolute right-0 z-[var(--z-menu)] mt-2 w-64 overflow-hidden rounded-[var(--radius-panel)] border border-border-default bg-surface py-1 shadow-[var(--shadow-floating)]"
        >
          {ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover"
            >
              <action.icon className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden="true" />
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

