'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Dialog/Drawer 共享的弹层行为（计划 §7.3）：
 * - 滚动锁引用计数：嵌套弹层只关闭最上层时不误恢复底层锁，关闭最后一层才还原 overflow。
 * - Escape 只关闭栈顶弹层，避免一次按键误关多层。
 * - 焦点陷阱只命中可见、可交互元素；关闭后恢复触发器焦点（触发器已卸载则交给浏览器回退）。
 * 背景内容 inert 化需要门户级根节点配合，本轮未实现，见交付说明中的遗留风险。
 */

let scrollLockCount = 0;
let savedBodyOverflow = '';

export function acquireBodyScrollLock() {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

export function releaseBodyScrollLock() {
  if (typeof document === 'undefined' || scrollLockCount === 0) return;
  scrollLockCount -= 1;
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = '';
  }
}

const overlayStack: symbol[] = [];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isFocusableCandidate(element: HTMLElement): boolean {
  if (element.closest('[disabled], [hidden], [inert]')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  // display:none / 未渲染的元素没有任何盒
  return element.getClientRects().length > 0;
}

export interface OverlayAccessibilityOptions {
  open: boolean;
  onRequestClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  /** 危险确认等场景显式指定首焦点（如取消按钮）；未提供时依次尝试 [data-autofocus]、第一个文本输入、容器本身。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useOverlayAccessibility({
  open,
  onRequestClose,
  containerRef,
  initialFocusRef,
}: OverlayAccessibilityOptions) {
  const onRequestCloseRef = useRef(onRequestClose);
  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!open) return;

    const overlayId = Symbol('overlay');
    overlayStack.push(overlayId);
    acquireBodyScrollLock();
    const previousFocus = document.activeElement as HTMLElement | null;

    const focusInitial = () => {
      const root = containerRef.current;
      if (!root) return;
      const preferred = initialFocusRef?.current;
      if (preferred && preferred.isConnected && isFocusableCandidate(preferred)) {
        preferred.focus();
        return;
      }
      const auto = root.querySelector<HTMLElement>('[data-autofocus]');
      if (auto && isFocusableCandidate(auto)) {
        auto.focus();
        return;
      }
      const firstTextField = Array.from(
        root.querySelectorAll<HTMLElement>('input, select, textarea')
      ).find(isFocusableCandidate);
      if (firstTextField) {
        firstTextField.focus();
        return;
      }
      root.focus();
    };
    focusInitial();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (overlayStack[overlayStack.length - 1] !== overlayId) return;
        event.preventDefault();
        onRequestCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const active = document.activeElement;
      const candidates = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(isFocusableCandidate);
      if (candidates.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      const activeInside = active instanceof HTMLElement && root.contains(active);
      if (event.shiftKey && (active === first || (activeInside && active === root))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!activeInside) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = overlayStack.indexOf(overlayId);
      if (stackIndex !== -1) overlayStack.splice(stackIndex, 1);
      releaseBodyScrollLock();
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [open, containerRef, initialFocusRef]);
}
