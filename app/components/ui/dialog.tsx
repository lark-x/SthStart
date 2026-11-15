'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CloseButton, Modal } from '@mantine/core';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { OverlayFlexScrollArea, OverlayLayer, useModalFocusContainment, useOverlayEscapeLayer, useOverlayTransitionDuration } from './overlay-policy';
import { useWebKitReturnFocus } from './use-webkit-return-focus';

export interface DialogProps extends Omit<React.ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 宽度由显式 variant 控制（§7.1）：sm 适合短确认，md 默认，lg 适合复杂表单。 */
  size?: 'sm' | 'md' | 'lg';
  /** 危险确认等场景把首焦点交给特定控件（如取消按钮）；默认聚焦首个输入或容器。 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

const sizeClassName: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

/**
 * Native Mantine Modal adapter.
 * Preserves unified LIFO Escape stacking, WebKit pointer/unmount return-focus,
 * custom initialFocusRef priority, and scoped portal host for nested popovers.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  className,
  ref,
  style,
  ...props
}: DialogProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const requestClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  useModalFocusContainment(open, host);
  useWebKitReturnFocus(open, { containerRef: panelRef });
  useOverlayEscapeLayer(open, requestClose, 'dialog');

  const attachPanel = useCallback((node: HTMLElement | null) => {
    panelRef.current = node;
    setHost(node);
    if (typeof ref === 'function') ref(node as HTMLDivElement | null);
    else if (ref) ref.current = node as HTMLDivElement | null;
  }, [ref]);

  useLayoutEffect(() => {
    if (!open || !host) return;
    const preferred = initialFocusRef?.current;
    if (!preferred || !host.contains(preferred) || preferred.hasAttribute('data-autofocus')) return;
    preferred.setAttribute('data-autofocus', 'true');
    return () => {
      preferred.removeAttribute('data-autofocus');
    };
  }, [open, host, initialFocusRef]);

  useEffect(() => {
    if (!open || !host) return;
    const focusInitial = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const preferred = initialFocusRef?.current;
      const auto = panel.querySelector<HTMLElement>('[data-autofocus]');
      const firstField = Array.from(panel.querySelectorAll<HTMLElement>('input, select, textarea')).find(
        (element) => element.getClientRects().length > 0,
      );
      const target = preferred ?? auto ?? firstField;
      if (target && panel.contains(target) && document.activeElement !== target) {
        target.focus({ preventScroll: true });
      }
    };
    focusInitial();
    const timer = window.setTimeout(focusInitial, 0);
    return () => window.clearTimeout(timer);
  }, [open, host, initialFocusRef]);

  const transitionDuration = useOverlayTransitionDuration(160);

  return (
    <OverlayLayer kind="dialog" host={host}>
      <Modal.Root
        opened={open}
        onClose={requestClose}
        centered
        size="auto"
        yOffset="1rem"
        xOffset="1rem"
        withinPortal
        trapFocus
        lockScroll
        closeOnEscape={false}
        returnFocus={false}
        closeOnClickOutside
        padding={0}
        scrollAreaComponent={OverlayFlexScrollArea}
        transitionProps={{ duration: transitionDuration, transition: 'pop', timingFunction: 'var(--motion-spring)' }}
      >
        <Modal.Overlay />
        <Modal.Content
          {...(props as Record<string, unknown>)}
          ref={attachPanel}
          data-state={open ? 'open' : 'closed'}
          styles={{
            content: { '--modal-content-flex': '0 1 auto', ...style } as React.CSSProperties,
          }}
          classNames={{
            content: cn(
              'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-dialog border border-border-subtle bg-surface p-6 shadow-dialog',
              sizeClassName[size],
              className,
            ),
          }}
        >
          <div data-dialog-header className="flex shrink-0 items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              <Modal.Title className="text-lg font-semibold text-ink">
                {title}
              </Modal.Title>
              {description && (
                <Modal.Body className="!p-0 text-sm text-muted leading-relaxed mt-1">
                  {description}
                </Modal.Body>
              )}
            </div>
            <CloseButton
              onClick={requestClose}
              size={44}
              aria-label="关闭对话框"
              icon={<X className="h-5 w-5" aria-hidden="true" />}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div data-dialog-lining className="my-4 min-h-0 overflow-x-clip overflow-y-auto overscroll-contain pr-1" data-autohide-scroll>
            {children}
          </div>

          {footer && (
            <div data-dialog-footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 mt-6 pt-4 border-t border-border-subtle">
              {footer}
            </div>
          )}
        </Modal.Content>
      </Modal.Root>
    </OverlayLayer>
  );
}
