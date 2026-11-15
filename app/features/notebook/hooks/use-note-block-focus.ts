'use client';

import { useCallback, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { NoteBlock } from '@sthstart/contracts';

export interface NoteBlockFocusRefs {
  blockListRef: RefObject<HTMLDivElement | null>;
  insertTriggerRef: RefObject<HTMLButtonElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  lastFocusedBlockRef: MutableRefObject<string | null>;
  imageAnchorRef: MutableRefObject<string | null>;
}

/** 内容块焦点、插入锚点与文件选择器行为；DOM 引用由编辑器组件持有。 */
export function useNoteBlockFocus(content: NoteBlock[], refs: NoteBlockFocusRefs) {
  const { blockListRef, insertTriggerRef, fileInputRef, lastFocusedBlockRef, imageAnchorRef } = refs;
  const pendingBlockFocus = useRef<string | null>(null);
  const keepInsertedFocus = useRef(false);

  useLayoutEffect(() => {
    if (!pendingBlockFocus.current) return;
    const block = blockListRef.current?.querySelector<HTMLElement>(
      `[data-note-block-id="${CSS.escape(pendingBlockFocus.current)}"]`,
    );
    if (!block) return;
    pendingBlockFocus.current = null;
    const input = block.querySelector<HTMLElement>('[data-block-entry]');
    (input ?? block).focus({ preventScroll: true });
    (input ?? block).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [blockListRef, content]);

  const focusBlock = useCallback((id: string | null) => {
    pendingBlockFocus.current = id;
  }, []);
  const rememberFocusedBlock = useCallback((id: string) => {
    lastFocusedBlockRef.current = id;
  }, [lastFocusedBlockRef]);
  const focusInsertTrigger = useCallback(() => {
    insertTriggerRef.current?.focus({ preventScroll: true });
  }, [insertTriggerRef]);
  const prepareImageInsert = useCallback((after: string | null) => {
    imageAnchorRef.current = after;
    fileInputRef.current?.click();
  }, [fileInputRef, imageAnchorRef]);
  const keepFocusAfterInsert = useCallback(() => {
    keepInsertedFocus.current = true;
  }, []);
  const handleInsertPopoverCloseAutoFocus = useCallback((event: Event) => {
    if (keepInsertedFocus.current) event.preventDefault();
    keepInsertedFocus.current = false;
  }, []);

  return {
    focusBlock,
    rememberFocusedBlock,
    focusInsertTrigger,
    prepareImageInsert,
    keepFocusAfterInsert,
    handleInsertPopoverCloseAutoFocus,
  };
}
