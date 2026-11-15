'use client';

import React, { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { Popover } from '@mantine/core';
import { useMergedRef } from '@mantine/hooks';
import { cn } from '../../lib/cn';
import { useOverlayEscapeLayer, useOverlayPortalTarget, useOverlayTransitionDuration } from './overlay-policy';

interface AnchoredPopoverProps {
  trigger: ReactElement;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}

/**
 * Non-modal popover. The owner layer is explicit: inside a native dialog the
 * dropdown portals into that dialog's top-layer subtree; outside a dialog it
 * uses Mantine's normal document portal. No z-index override is involved.
 */
export function AnchoredPopover({ trigger, title, open, onOpenChange, align = 'end', side = 'top', className, onCloseAutoFocus, children }: AnchoredPopoverProps) {
  const titleId = useId();
  const host = useOverlayPortalTarget();
  const triggerRef = useRef<HTMLElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(open);
  const position = `${side}-${align}` as 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

  useOverlayEscapeLayer(open, () => {
    onOpenChange(false);
    if (!onCloseAutoFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, 'popover');

  // Mantine restores focus after its own close handling; expose the old
  // onCloseAutoFocus contract at the same point, with a native Event.
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const event = new Event('sthstart:popover-close-autofocus', { cancelable: true });
      onCloseAutoFocus?.(event);
      if (onCloseAutoFocus) {
        if (!event.defaultPrevented) triggerRef.current?.focus({ preventScroll: true });
      } else {
        // No legacy callback: return focus to the stable trigger. Mantine may
        // also request return focus, which is harmless when it is already there.
        triggerRef.current?.focus({ preventScroll: true });
      }
    }
    wasOpenRef.current = open;
  }, [open, onCloseAutoFocus]);

  // Mantine Popover is controlled by `opened`/`onChange`, so it intentionally
  // does not install a target click toggle. Preserve the trigger's own handler
  // and add the adapter toggle explicitly.
  const triggerProps = trigger.props as { onClick?: (event: React.MouseEvent) => void; ref?: React.Ref<HTMLElement> };
  const mergedTriggerRef = useMergedRef(triggerRef, triggerProps.ref);
  const controlledTrigger = React.cloneElement(trigger as ReactElement<{ onClick?: (event: React.MouseEvent) => void; ref?: React.Ref<HTMLElement> }>, {
    onClick: (event: React.MouseEvent) => {
      triggerProps.onClick?.(event);
      if (!event.defaultPrevented) onOpenChange(!open);
    },
    ref: mergedTriggerRef,
  });

  const transitionDuration = useOverlayTransitionDuration(140);

  return (
    <Popover
      opened={open}
      onChange={onOpenChange}
      position={position}
      offset={8}
      withinPortal
      portalProps={host ? { target: host } : undefined}
      trapFocus
      returnFocus={!onCloseAutoFocus}
      closeOnEscape={false}
      closeOnClickOutside
      shadow="md"
      radius="md"
      transitionProps={{ duration: transitionDuration, transition: 'pop', timingFunction: 'var(--motion-spring)' }}
      middlewares={{ flip: true, shift: true, inline: false }}
      onOpen={() => {
        window.requestAnimationFrame(() => {
          const dropdown = dropdownRef.current;
          const target = dropdown?.querySelector<HTMLElement>('[data-popover-focus]');
          if (!target) return;
          if (target instanceof HTMLInputElement && window.matchMedia('(pointer: coarse)').matches) dropdown?.focus();
          else target.focus({ preventScroll: true });
        });
      }}
    >
      <Popover.Target>{controlledTrigger}</Popover.Target>
      <Popover.Dropdown
        ref={dropdownRef}
        aria-labelledby={titleId}
        className={cn('anchored-popover', className)}
        data-sthstart-layer="popover"
        onKeyDownCapture={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
          if (!onCloseAutoFocus) {
            window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
          }
        }}
      >
        <h2 id={titleId} className="anchored-popover-title">{title}</h2>
        {children}
      </Popover.Dropdown>
    </Popover>
  );
}
