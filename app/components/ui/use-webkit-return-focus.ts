'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { getBlockingModalElements } from './overlay-policy';

let pressedInvoker: HTMLElement | null = null;
let pressedInvokerExpiry = 0;
let pressedInvokerWatching = 0;

const INVOKER_SELECTOR =
  'button, a[href], [role="button"], [role="menuitem"], summary, [tabindex]:not([tabindex="-1"])';

function forgetPressedInvoker() {
  if (typeof window !== 'undefined') {
    window.clearTimeout(pressedInvokerExpiry);
  }
  pressedInvoker = null;
}

function handleInvokerClick(event: MouseEvent) {
  // Keyboard activation and programmatic element.click() emit detail=0.
  // Keep using activeElement unless WebKit left focus on document.body.
  const active = document.activeElement;
  if (event.detail === 0 && active instanceof HTMLElement && active !== document.body) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  pressedInvoker = target.closest<HTMLElement>(INVOKER_SELECTOR);
  window.clearTimeout(pressedInvokerExpiry);
  pressedInvokerExpiry = window.setTimeout(() => {
    pressedInvoker = null;
  }, 0);
}

function handleInvokerKeyDown() {
  forgetPressedInvoker();
}

function watchInvokerActivation() {
  if (typeof document === 'undefined') return;
  if (pressedInvokerWatching++ > 0) return;
  document.addEventListener('click', handleInvokerClick, true);
  document.addEventListener('keydown', handleInvokerKeyDown, true);
}

function unwatchInvokerActivation() {
  if (typeof document === 'undefined') return;
  if (pressedInvokerWatching === 0 || --pressedInvokerWatching > 0) return;
  document.removeEventListener('click', handleInvokerClick, true);
  document.removeEventListener('keydown', handleInvokerKeyDown, true);
  forgetPressedInvoker();
}

function takePressedInvoker(): HTMLElement | null {
  const invoker = pressedInvoker?.isConnected ? pressedInvoker : null;
  forgetPressedInvoker();
  return invoker;
}

export interface UseWebKitReturnFocusOptions {
  invokerRef?: React.RefObject<HTMLElement | null>;
  containerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Single reliable return-focus hook for Mantine modals, drawers and palettes:
 * - Tracks real pointer clicks when WebKit leaves document.activeElement on body
 * - Captures explicit invokerRef when supplied (e.g. AppShell nav button)
 * - Handles conditional-mount overlays that open on mount and unmount on close
 * Pass `returnFocus={false}` to Mantine Modal/Drawer so only one owner restores focus.
 */
export function useWebKitReturnFocus(
  open: boolean,
  options?: UseWebKitReturnFocusOptions,
) {
  const invokerRef = options?.invokerRef;
  const containerRef = options?.containerRef;
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFrameRef = useRef(0);
  const wasOpenRef = useRef(false);
  const isOpenRef = useRef(open);

  const restoreFocusAfterClose = useCallback((returnTo: HTMLElement | null, closedNode: HTMLElement | null) => {
    if (!returnTo || typeof window === 'undefined') return;
    window.cancelAnimationFrame(restoreFrameRef.current);
    const attempt = (remaining: number) => {
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        // Wait if this overlay is still marked open in the DOM.
        if (
          closedNode &&
          closedNode.isConnected &&
          closedNode.getAttribute('data-state') === 'open'
        ) {
          if (remaining > 0) attempt(remaining - 1);
          return;
        }
        // Do not steal focus from another open modal unless the invoker lives inside it.
        const openModals = getBlockingModalElements().filter((el) => el !== closedNode);
        const topModal = openModals[openModals.length - 1];
        if (topModal && !topModal.contains(returnTo)) return;
        if (!returnTo.isConnected || returnTo.getClientRects().length === 0) return;

        const active = document.activeElement;
        const unowned =
          !active ||
          active === document.body ||
          active === returnTo ||
          (closedNode?.contains(active) ?? false);
        if (unowned && active !== returnTo) {
          returnTo.focus({ preventScroll: true });
        }
        if (remaining > 0 && document.activeElement !== returnTo) {
          attempt(remaining - 1);
        }
      });
    };
    attempt(2);
  }, []);

  useLayoutEffect(() => {
    watchInvokerActivation();
    return unwatchInvokerActivation;
  }, []);

  useLayoutEffect(() => {
    isOpenRef.current = open;
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      if (typeof window !== 'undefined') {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
      const explicit = invokerRef?.current;
      const pointerInvoker = takePressedInvoker();
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const stablePointerInvoker =
        pointerInvoker &&
        pointerInvoker.isConnected &&
        !pointerInvoker.closest('[role="menu"]')
          ? pointerInvoker
          : null;
      returnFocusRef.current = explicit?.isConnected
        ? explicit
        : stablePointerInvoker ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      restoreFocusAfterClose(target, containerRef?.current ?? null);
    }
  }, [open, invokerRef, containerRef, restoreFocusAfterClose]);

  useEffect(() => {
    return () => {
      if (isOpenRef.current && returnFocusRef.current) {
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        restoreFocusAfterClose(target, null);
        return;
      }
      if (typeof window !== 'undefined') {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
    };
  }, [restoreFocusAfterClose]);
}
