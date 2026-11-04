'use client';

import React, { useState } from 'react';
import { Brain, ChevronDown, Copy, Check } from 'lucide-react';
import { cn } from '@/app/lib/cn';

/**
 * ==============================================================================
 * ThinkingAccordion.tsx
 *
 * 逆向还原自 Claude Desktop: cd5a31703-B4nKQMBN.js
 *
 * 核心特性：
 * 1. 生成中 (isThinkingLive = true) 强制锁定展开，剥夺折叠权限，防止流式输出时视口剧烈抖动；
 * 2. 思考完成后交还折叠控制权；
 * 3. 纯 CSS Grid (0fr -> 1fr) 硬件加速弹性展开，零 JS 尺寸计算与 0 framer-motion 依赖；
 * 4. 陶土明度呼吸指示灯与毫秒级耗时统计；
 * 5. 一键带引用前缀 ('> ') 复制全文，严格贯彻 Zero-Emoji 准则。
 * ==============================================================================
 */

export interface ThinkingAccordionProps {
  thoughtText: string;
  isThinkingLive?: boolean;
  elapsedMs?: number;
  defaultExpanded?: boolean;
  onCopyQuote?: (text: string) => void;
  className?: string;
  title?: string;
}

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = ({
  thoughtText,
  isThinkingLive = false,
  elapsedMs = 0,
  defaultExpanded = true,
  onCopyQuote,
  className = '',
  title = '思考过程',
}) => {
  const [userExpanded, setUserExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  // 核心互斥物理：生成中必定展开，不受用户历史偏好影响
  const isOpen = isThinkingLive || userExpanded;

  const handleToggle = () => {
    if (isThinkingLive) return; // 思考中剥夺折叠权限
    setUserExpanded((prev) => !prev);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!thoughtText.trim()) return;
    const quoteText = thoughtText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    navigator.clipboard.writeText(quoteText);
    setCopied(true);
    onCopyQuote?.(quoteText);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!thoughtText.trim() && !isThinkingLive) return null;

  const formattedTime =
    elapsedMs > 0
      ? elapsedMs >= 1000
        ? `${(elapsedMs / 1000).toFixed(1)}s`
        : `${elapsedMs}ms`
      : null;

  return (
    <div
      role="region"
      aria-label="推理思考链"
      className={cn(
        'group/thinking my-2 rounded-[var(--radius-control)] border border-border-subtle bg-surface-sunken/40 transition-colors',
        className,
      )}
    >
      {/* 头部标题与控制栏 */}
      <div
        onClick={handleToggle}
        className={cn(
          'flex items-center justify-between px-3 py-2 select-none text-xs transition-colors',
          isThinkingLive ? 'cursor-default' : 'cursor-pointer hover:bg-surface-hover/60',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="size-3.5 text-accent shrink-0" />
          <span className="font-medium text-ink truncate">{title}</span>

          {/* 状态徽标与时间指示 */}
          {isThinkingLive ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-accent">
              <span className="size-1.5 rounded-full bg-accent animate-pulse" />
              <span>思考中…</span>
            </span>
          ) : formattedTime ? (
            <span className="text-[11px] text-muted font-mono">
              已思考 {formattedTime}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* 一键引用复制按钮 */}
          {thoughtText.trim() && (
            <button
              type="button"
              title="复制思考过程（带引用前缀）"
              onClick={handleCopy}
              className="rounded p-1 text-muted hover:bg-surface hover:text-ink transition-colors"
            >
              {copied ? (
                <Check className="size-3 text-emerald-600" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          )}

          {/* 展开/折叠三角 */}
          {!isThinkingLive && (
            <ChevronDown
              className={cn(
                'size-3.5 text-muted transition-transform duration-200',
                isOpen && 'rotate-180',
              )}
            />
          )}
        </div>
      </div>

      {/* 纯 CSS Grid 0fr -> 1fr 弹性伸缩正文 */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          isOpen ? 'grid-template-rows-[1fr]' : 'grid-template-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border-subtle/60 px-3.5 py-2.5 text-xs text-muted leading-relaxed whitespace-pre-wrap font-sans selection:bg-accent/20">
            {thoughtText}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThinkingAccordion;
