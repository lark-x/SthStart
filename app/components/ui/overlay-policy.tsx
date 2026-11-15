'use client';

import React, { createContext, use, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap, useReducedMotion } from '@mantine/hooks';

/**
 * Shared overlay policy.
 *
 * Mantine Modals, Drawers, Popovers and Menus share a single LIFO Escape stack
 * so pressing Escape closes only the topmost layer (with IME composition guard)
 * and nested popovers/menus portal into the enclosing dialog surface so Mantine
 * FocusTrap keeps Tab navigation scoped correctly.
 */

export type OverlayKind = 'dialog' | 'drawer' | 'palette' | 'menu' | 'popover';

interface OverlayContextValue {
  layerId: string;
  kind: OverlayKind;
  host: HTMLElement | null;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function useOverlayLayer(): OverlayContextValue | null {
  return use(OverlayContext);
}

export function useOverlayPortalTarget(): HTMLElement | undefined {
  return useOverlayLayer()?.host ?? undefined;
}

const FLOATING_OVERLAY_ROOT_ATTRIBUTE = 'data-overlay-floating-root';
let floatingOverlayRoot: HTMLElement | null = null;

/**
 * Viewport-anchored layers (fixed coordinates, own scroll containers) must
 * live outside transformed modal content, otherwise fixed offsets resolve
 * against the dialog and its horizontal scroll. This root is a direct body
 * child and is exempt from modal inerting below.
 */
export function getFloatingOverlayRoot(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (floatingOverlayRoot?.isConnected) return floatingOverlayRoot;
  const existing = document.querySelector<HTMLElement>(`[${FLOATING_OVERLAY_ROOT_ATTRIBUTE}]`);
  const root = existing ?? document.createElement('div');
  if (!existing) {
    root.setAttribute(FLOATING_OVERLAY_ROOT_ATTRIBUTE, '');
    document.body.appendChild(root);
  }
  floatingOverlayRoot = root;
  return root;
}

export function useFloatingOverlayRoot(active: boolean): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    const next = getFloatingOverlayRoot();
    setRoot((current) => (current === next ? current : next));
  }, [active]);

  return active ? root : null;
}

export function useOverlayTransitionDuration(durationMs: number): number {
  const reducedMotion = useReducedMotion();
  return reducedMotion ? 0 : durationMs;
}

export function OverlayLayer({ kind, host, children }: {
  kind: OverlayKind;
  host: HTMLElement | null;
  children: React.ReactNode;
}) {
  const layerId = useId();
  const value = useMemo(() => ({ layerId, kind, host }), [layerId, kind, host]);
  return <OverlayContext value={value}>{children}</OverlayContext>;
}

/**
 * Passthrough scrollAreaComponent for Mantine Modal.Root / Drawer.Root.
 * Prevents Mantine's built-in NativeScrollArea from injecting `height: 100vh`
 * so the panel's own flex header + `[data-autohide-scroll]` body + footer
 * geometry controls scrolling across full-height and bottom-sheet drawers.
 */
export function OverlayFlexScrollArea({
  children,
}: {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <>{children}</>;
}

interface EscapeLayerEntry {
  id: symbol;
  kind: OverlayKind;
  onEscape: () => void;
}

const escapeStack: EscapeLayerEntry[] = [];
let escapeWatcherActive = false;

function hasOpenUnregisteredFloatingLayer(target: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false;
  if (
    target instanceof Element &&
    target.closest('[data-menu-dropdown]:not([data-sthstart-layer]), [data-popover-dropdown]:not([data-sthstart-layer])')
  ) {
    return true;
  }
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="tooltip"], [data-menu-dropdown]:not([data-sthstart-layer]), [data-popover-dropdown]:not([data-sthstart-layer])',
    ),
  ).some((node) => {
    if (
      node.hasAttribute('data-hidden') ||
      node.hasAttribute('data-exiting') ||
      node.getAttribute('aria-hidden') === 'true' ||
      node.closest('[inert], [hidden], [aria-hidden="true"]')
    ) return false;
    if (node.style.opacity === '0' || node.style.pointerEvents === 'none') return false;
    const computed = window.getComputedStyle(node);
    if (Number.parseFloat(computed.opacity) <= 0.05 || computed.pointerEvents === 'none') return false;
    const ownerId = node.getAttribute('aria-labelledby');
    const owner = ownerId ? document.getElementById(ownerId) : null;
    if (owner && owner.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
    return node.getClientRects().length > 0;
  });
}

function handleGlobalEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (event.isComposing || event.keyCode === 229) return;
  if (escapeStack.length === 0) return;
  if (hasOpenUnregisteredFloatingLayer(event.target)) return;
  const top = escapeStack[escapeStack.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.onEscape();
}

function syncEscapeWatcher() {
  if (typeof window === 'undefined') return;
  if (escapeStack.length > 0 && !escapeWatcherActive) {
    window.addEventListener('keydown', handleGlobalEscape);
    escapeWatcherActive = true;
  } else if (escapeStack.length === 0 && escapeWatcherActive) {
    window.removeEventListener('keydown', handleGlobalEscape);
    escapeWatcherActive = false;
  }
}

/**
 * Registers an active overlay on the LIFO Escape stack while `active` is true.
 * Mantine Modals/Drawers/Popovers pass `closeOnEscape={false}` so only the
 * topmost layer closes per Escape key press.
 */
export function useOverlayEscapeLayer(active: boolean, onEscape: () => void, kind: OverlayKind) {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const entry: EscapeLayerEntry = {
      id: Symbol(kind),
      kind,
      onEscape: () => onEscapeRef.current(),
    };
    escapeStack.push(entry);
    syncEscapeWatcher();
    return () => {
      const index = escapeStack.indexOf(entry);
      if (index >= 0) escapeStack.splice(index, 1);
      syncEscapeWatcher();
    };
  }, [active, kind]);
}

/**
 * Focus containment for the non-native palette only. Native dialogs keep the
 * browser's focus behavior and must not add a second trap.
 */
export function useLayerFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  const trapRef = useFocusTrap(active);
  return useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
    trapRef(node);
  }, [containerRef, trapRef]);
}

/** Restore focus for non-native layers; native dialog returns it itself. */
export function useReturnFocus(open: boolean) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      const target = returnFocusRef.current;
      if (!target?.isConnected) return;
      const current = document.activeElement;
      if (!current || current === document.body) target.focus({ preventScroll: true });
    };
  }, [open]);
}

/**
 * Shared shortcut predicate. It ignores IME composition; callers additionally
 * check hasBlockingModal() before opening. Return true when the event matches.
 */
export function isCommandShortcut(event: KeyboardEvent | React.KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  if ('isComposing' in event && event.isComposing) return false;
  if ('keyCode' in event && event.keyCode === 229) return false;
  const target = event.target as HTMLElement | null;
  const editable =
    target?.isContentEditable ||
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.tagName === 'SELECT';
  return ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') ||
    (event.key === '/' && !editable);
}

/** Returns currently visible, open modal elements in DOM order. */
export function getBlockingModalElements(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
    .filter((element) => {
      if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
      if (element.getAttribute('data-state') === 'closed' || element.hasAttribute('data-hidden')) return false;
      return element.getClientRects().length > 0;
    });
}

/** A hidden or mid-transition modal is not a blocking layer. */
export function hasBlockingModal(): boolean {
  return getBlockingModalElements().length > 0;
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface BlockingModalEntry {
  id: symbol;
  panel: HTMLElement;
}

const activeBlockingModals: BlockingModalEntry[] = [];
const inertedByOverlay = new Set<HTMLElement>();
let focusContainmentActive = false;

function handleContainedFocusIn(event: FocusEvent) {
  const top = [...activeBlockingModals].reverse().find((entry) => entry.panel.isConnected);
  if (!top) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (top.panel.contains(target)) return;
  if (
    target instanceof Element &&
    target.closest(
      '.mantine-Menu-dropdown, .mantine-Popover-dropdown, .mantine-Combobox-dropdown, .mantine-Notifications-root, [role="menu"], [role="listbox"], [role="tooltip"]',
    )
  ) {
    return;
  }
  const focusTarget =
    top.panel.querySelector<HTMLElement>('[data-autofocus]') ??
    Array.from(
      top.panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).find((el) => el.getClientRects().length > 0) ??
    top.panel;
  focusTarget.focus({ preventScroll: true });
}

function syncModalContainment() {
  for (const el of inertedByOverlay) {
    el.inert = false;
  }
  inertedByOverlay.clear();

  const top = [...activeBlockingModals].reverse().find((entry) => entry.panel.isConnected);
  if (!top || typeof document === 'undefined' || !document.body) {
    if (focusContainmentActive && typeof document !== 'undefined') {
      document.removeEventListener('focusin', handleContainedFocusIn, true);
      focusContainmentActive = false;
    }
    return;
  }

  const markInert = (el: HTMLElement) => {
    if (!el.inert) {
      el.inert = true;
      inertedByOverlay.add(el);
    }
  };

  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.tagName;
    if (
      tag === 'SCRIPT' ||
      tag === 'STYLE' ||
      tag === 'LINK' ||
      tag === 'META' ||
      tag === 'TEMPLATE' ||
      tag === 'NEXT-ROUTE-ANNOUNCER'
    ) {
      continue;
    }
    if (child.classList.contains('mantine-Notifications-root') || child.hasAttribute('data-mantine-notifications')) {
      continue;
    }
    if (child.hasAttribute(FLOATING_OVERLAY_ROOT_ATTRIBUTE)) {
      continue;
    }
    if (child.contains(top.panel)) {
      if (child.hasAttribute('data-portal')) {
        for (const portalChild of Array.from(child.children)) {
          if (!(portalChild instanceof HTMLElement)) continue;
          if (portalChild.contains(top.panel)) continue;
          const isUnderlyingModal =
            portalChild.classList.contains('mantine-Modal-root') ||
            portalChild.classList.contains('mantine-Drawer-root') ||
            Boolean(portalChild.querySelector('[aria-modal="true"]'));
          if (isUnderlyingModal) {
            markInert(portalChild);
          }
        }
      }
      continue;
    }
    markInert(child);
  }

  if (!focusContainmentActive) {
    document.addEventListener('focusin', handleContainedFocusIn, true);
    focusContainmentActive = true;
  }
}

/**
 * Restores `<dialog>.showModal()` background-inert and focus-containment
 * semantics for Mantine Modal/Drawer/CommandPalette surfaces while keeping
 * nested OverlayLayer portals and notifications interactive.
 */
export function useModalFocusContainment(active: boolean, panel: HTMLElement | null) {
  useIsomorphicLayoutEffect(() => {
    if (!active || !panel) return;
    const entry: BlockingModalEntry = { id: Symbol('blocking-modal'), panel };
    activeBlockingModals.push(entry);
    syncModalContainment();
    return () => {
      const index = activeBlockingModals.indexOf(entry);
      if (index >= 0) activeBlockingModals.splice(index, 1);
      syncModalContainment();
    };
  }, [active, panel]);
}
