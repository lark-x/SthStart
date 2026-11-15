'use client';

import React, { useCallback, useRef, useState } from 'react';
import type { NoteBlock, NoteKind } from '@sthstart/contracts';
import { newBlock } from '../schemas';
import {
  insertContentBlock,
  moveContentBlock,
  removeContentBlock,
  updateContentBlock,
} from '../model/note-content';
import type { NoteAdoptAction } from '../note-adoption';
import { useNoteDraftSession } from '../hooks/use-note-draft-session';
import { useNoteBlockFocus } from '../hooks/use-note-block-focus';
import { useNoteConflictRecovery } from '../hooks/use-note-conflict-recovery';
import { useNoteDeletion } from '../hooks/use-note-deletion';
import { useNoteImageUpload } from '../hooks/use-note-image-upload';
import { NoteEditorHeader } from './note-editor-header';
import { NoteEditorMessages } from './note-editor-messages';
import { NoteDocument } from './note-document';
import { NoteEditorLoading, NoteEditorUnavailable } from './note-editor-states';
import './notebook-layout.css';

export function NoteEditor({
  noteId,
  initialKind = 'note',
  standalone = true,
  onDeleted,
  onPersisted,
  listActions,
  adoptAction,
}: {
  noteId?: string;
  initialKind?: NoteKind;
  standalone?: boolean;
  onDeleted?: () => void;
  onPersisted?: (id: string) => void;
  listActions?: React.ReactNode;
  adoptAction?: NoteAdoptAction;
}) {
  const session = useNoteDraftSession({ noteId, initialKind, standalone, onPersisted });
  const blockListRef = useRef<HTMLDivElement>(null);
  const insertTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFocusedBlockRef = useRef<string | null>(null);
  const imageAnchorRef = useRef<string | null>(null);
  const { updateNoteState } = session;
  const {
    focusBlock,
    rememberFocusedBlock,
    focusInsertTrigger,
    prepareImageInsert,
    keepFocusAfterInsert,
    handleInsertPopoverCloseAutoFocus,
  } = useNoteBlockFocus(session.note.content, {
    blockListRef,
    insertTriggerRef,
    fileInputRef,
    lastFocusedBlockRef,
    imageAnchorRef,
  });
  const [zenMode, setZenMode] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertAfter, setInsertAfter] = useState<string | null>(null);

  const conflict = useNoteConflictRecovery({
    effectiveNoteId: session.effectiveNoteId,
    persistLocal: session.persistLocal,
    setNote: session.setNote,
    markClean: session.markClean,
    updateNoteCaches: session.updateNoteCaches,
    setErrorMessage: session.setErrorMessage,
  });
  const handleDelete = useNoteDeletion({
    effectiveNoteId: session.effectiveNoteId,
    note: session.note,
    online: session.online,
    standalone,
    onDeleted,
    markClean: session.markClean,
  });

  const insertBlock = useCallback((block: NoteBlock, after: string | null) => {
    focusBlock(block.id);
    updateNoteState((prev) => ({ ...prev, content: insertContentBlock(prev.content, block, after) }));
  }, [focusBlock, updateNoteState]);

  const handleUploadImage = useNoteImageUpload({
    effectiveNoteId: session.effectiveNoteId,
    online: session.online,
    imageAnchorRef,
    insertBlock,
  });

  const handleInsertOpenChange = (open: boolean) => {
    if (open) setInsertAfter(lastFocusedBlockRef.current);
    setInsertOpen(open);
  };

  const handleAddBlock = (type: 'text' | 'link' | 'character-reference') => {
    keepFocusAfterInsert();
    setInsertOpen(false);
    insertBlock(newBlock(type), insertAfter);
  };

  const handleChooseImage = (after: string | null) => {
    setInsertOpen(false);
    prepareImageInsert(after);
  };

  const handleUpdateBlock = (id: string, patch: Partial<NoteBlock>) => {
    session.updateNoteState((prev) => ({ ...prev, content: updateContentBlock(prev.content, id, patch) }));
  };

  const handleMoveBlock = (index: number, direction: -1 | 1) => {
    focusBlock(session.note.content[index]?.id ?? null);
    session.updateNoteState((prev) => ({ ...prev, content: moveContentBlock(prev.content, index, direction) }));
  };

  const handleDeleteBlock = (id: string) => {
    // 不在这里删除本地资产：笔记内容要等防抖落盘，若保存丢失会留下悬空
    // 引用导致同步永久失败；未引用的上传资产由同步结束后的 prune 统一回收。
    const index = session.note.content.findIndex((block) => block.id === id);
    const next = (session.note.content[index + 1] ?? session.note.content[index - 1])?.id ?? null;
    focusBlock(next);
    if (!next) focusInsertTrigger();
    session.updateNoteState((prev) => ({ ...prev, content: removeContentBlock(prev.content, id) }));
  };

  const MainTag = standalone ? 'main' : 'div';

  if (session.detailFailed && session.localNoteLoaded && !session.localRecord) {
    return (
      <NoteEditorUnavailable
        standalone={standalone}
        listActions={listActions}
        onRetry={() => void session.refetchDetail()}
      />
    );
  }

  if (!session.editorReady) {
    return <NoteEditorLoading standalone={standalone} listActions={listActions} />;
  }

  return (
    <MainTag inert={conflict.resolvingConflict} aria-busy={conflict.resolvingConflict} className="notebook-editor-page notebook-editor-shell notebook-editor-compact w-full bg-surface text-ink">
      {standalone && <h1 className="sr-only">创作笔记编辑器</h1>}
      <NoteEditorHeader
        note={session.note}
        effectiveNoteId={session.effectiveNoteId}
        dirty={session.dirty}
        savingLocal={session.savingLocal}
        online={session.online}
        localStatus={session.localRecord?.status}
        standalone={standalone}
        listActions={listActions}
        zenMode={zenMode}
        onToggleZen={() => setZenMode((prev) => !prev)}
        onSave={() => void session.handleSave()}
        onToggleFavorite={() => session.updateNoteState((prev) => ({ ...prev, favorite: !prev.favorite }))}
        onDelete={() => void handleDelete()}
        onKnowledgeChange={(knowledge) => session.updateNoteState((prev) => ({ ...prev, knowledge }))}
        adoptAction={adoptAction}
        insertTriggerRef={insertTriggerRef}
        onInsertCloseAutoFocus={handleInsertPopoverCloseAutoFocus}
        insertOpen={insertOpen}
        insertAfter={insertAfter}
        onInsertOpenChange={handleInsertOpenChange}
        onAddBlock={handleAddBlock}
        onChooseImage={handleChooseImage}
      />

      <NoteEditorMessages
        errorMessage={session.errorMessage}
        onDismissError={() => session.setErrorMessage('')}
        localStatus={session.localRecord?.status}
        localSyncError={session.localRecord?.error}
        onRetrySync={session.retrySync}
        resolvingConflict={conflict.resolvingConflict}
        onResolveConflict={() => void conflict.resolveConflict()}
        preservedCopyId={conflict.preservedCopyId}
      />

      <NoteDocument
        note={session.note}
        zenMode={zenMode}
        onChange={session.updateNoteState}
        blockListRef={blockListRef}
        insertOpen={insertOpen}
        insertAfter={insertAfter}
        onFocusBlock={rememberFocusedBlock}
        onStartWriting={() => insertBlock(newBlock('text'), null)}
        onUpdateBlock={handleUpdateBlock}
        onMoveBlock={handleMoveBlock}
        onDeleteBlock={handleDeleteBlock}
      />

      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="上传笔记图片"
        onChange={handleUploadImage}
      />
    </MainTag>
  );
}
