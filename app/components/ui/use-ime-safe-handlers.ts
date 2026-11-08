'use client';

import { useRef, type CompositionEventHandler, type KeyboardEventHandler } from 'react';

interface ImeHandlers<T extends HTMLElement> {
  onKeyDown?: KeyboardEventHandler<T>;
  onCompositionStart?: CompositionEventHandler<T>;
  onCompositionEnd?: CompositionEventHandler<T>;
}

/** Let the IME handle candidate keys without invoking application shortcuts. */
export function useImeSafeHandlers<T extends HTMLElement>(handlers: ImeHandlers<T>): ImeHandlers<T> {
  const composing = useRef(false);
  return {
    onCompositionStart(event) {
      composing.current = true;
      handlers.onCompositionStart?.(event);
    },
    onCompositionEnd(event) {
      composing.current = false;
      handlers.onCompositionEnd?.(event);
    },
    onKeyDown(event) {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
        event.stopPropagation();
        return;
      }
      handlers.onKeyDown?.(event);
    },
  };
}
