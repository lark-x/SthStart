'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Legacy overlay helper kept only for non-modal consumers that still use the
 * pre-Mantine accessibility path. Dialog and Drawer use the native dialog as
 * the single modal owner; never attach this helper to them, because it would
 * create a second focus trap, Escape listener and body scroll lock. The command
 * palette uses overlay-policy.tsx for its own single layer policy.
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
      // 下层弹窗不能抢走上层弹窗的 Tab 焦点。
      if (overlayStack[overlayStack.length - 1] !== overlayId) return;
      // 输入法组合中的 Escape 用于取消候选词，不能连带关闭弹窗。
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
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
      // 恢复触发器焦点，但不因滚动容器变化而跳动页面；触发器已卸载时交给浏览器回退。
      if (previousFocus && previousFocus.isConnected && previousFocus !== document.body) {
        try {
          previousFocus.focus({ preventScroll: true });
        } catch {
          // 某些宿主环境（如测试桩）的 focus 不接受选项参数。
          previousFocus.focus();
        }
      }
    };
  }, [open, containerRef, initialFocusRef]);
}
