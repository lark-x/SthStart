'use client';

import React, { useCallback, useRef, useState } from 'react';
import { CloseButton, Drawer as MantineDrawer } from '@mantine/core';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { OverlayFlexScrollArea, OverlayLayer, useModalFocusContainment, useOverlayEscapeLayer, useOverlayTransitionDuration } from './overlay-policy';
import { useWebKitReturnFocus } from './use-webkit-return-focus';

export interface DrawerProps extends Omit<React.ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExitTransitionEnd?: () => void;
  title: string;
  description?: string;
  keepMounted?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  position?: 'right' | 'bottom';
  /**
   * 打开抽屉的控件。指针打开时 WebKit 不聚焦按钮，传入它可保证关闭后焦点
   * 回到真正的触发器；未传时退回指针激活追踪，再退回 activeElement。
   */
  invokerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Native Mantine Drawer adapter.
 * Uses Drawer.Root + Drawer.Overlay + flex-column Drawer.Content with
 * OverlayFlexScrollArea so Mantine's 100vh inner scroll never breaks bottom sheets
 * or short-viewport footer visibility.
 */
export function Drawer({
  open,
  onOpenChange,
  onExitTransitionEnd,
  title,
  description,
  keepMounted,
  children,
  footer,
  position = 'right',
  invokerRef,
  className,
  style,
  ref,
  ...props
}: DrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const requestClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  useModalFocusContainment(open, host);
  useWebKitReturnFocus(open, { invokerRef, containerRef: panelRef });
  useOverlayEscapeLayer(open, requestClose, 'drawer');

  const attachPanel = useCallback((node: HTMLElement | null) => {
    panelRef.current = node;
    setHost(node);
    if (typeof ref === 'function') ref(node as HTMLDivElement | null);
    else if (ref) ref.current = node as HTMLDivElement | null;
  }, [ref]);

  const transitionDuration = useOverlayTransitionDuration(180);

  return (
    <OverlayLayer kind="drawer" host={host}>
      <MantineDrawer.Root
        opened={open}
        keepMounted={keepMounted}
        onClose={requestClose}
        onExitTransitionEnd={onExitTransitionEnd}
        position={position}
        size={position === 'right' ? 'min(28rem, 100vw)' : '80dvh'}
        withinPortal
        trapFocus
        lockScroll
        closeOnEscape={false}
        returnFocus={false}
        closeOnClickOutside
        padding={0}
        scrollAreaComponent={OverlayFlexScrollArea}
        transitionProps={{ duration: transitionDuration, timingFunction: 'var(--motion-ease)' }}
      >
        <MantineDrawer.Overlay />
        <MantineDrawer.Content
          {...(props as Record<string, unknown>)}
          ref={attachPanel}
          data-position={position}
          data-state={open ? 'open' : 'closed'}
          styles={style ? { content: style } : undefined}
          classNames={{
            content: cn(
              'relative flex flex-col overflow-visible bg-surface shadow-dialog',
              position === 'right' &&
                'ml-auto h-full w-full max-w-md border-l border-border-subtle p-6',
              position === 'bottom' &&
                'mt-auto h-[80dvh] w-full rounded-t-2xl border-t border-border-subtle p-6 safe-area-bottom',
              className,
            ),
          }}
        >
          <div data-dialog-header className="flex shrink-0 items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              <MantineDrawer.Title className="text-lg font-semibold text-ink">
                {title}
              </MantineDrawer.Title>
              {description && (
                <MantineDrawer.Body className="!p-0 text-sm text-muted leading-relaxed mt-1">
                  {description}
                </MantineDrawer.Body>
              )}
            </div>
            <CloseButton
              data-drawer-close
              data-autofocus
              onClick={requestClose}
              size={44}
              aria-label="关闭抽屉"
              icon={<X className="h-5 w-5" aria-hidden="true" />}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div data-dialog-lining className="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain py-2" data-autohide-scroll>
            {children}
          </div>

          {footer && (
            <div data-dialog-footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-4 mt-auto border-t border-border-subtle">
              {footer}
            </div>
          )}
        </MantineDrawer.Content>
      </MantineDrawer.Root>
    </OverlayLayer>
  );
}
