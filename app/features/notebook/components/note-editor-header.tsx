'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  Image as ImageIcon,
  Link as LinkIcon,
  Plus,
  Save,
  Sparkles,
  Star,
  Trash2,
  User,
} from 'lucide-react';
import type { CreativeNote, NoteKnowledge } from '@sthstart/contracts';
import type { NoteBlock } from '@sthstart/contracts';
import type { NotebookSyncStatus } from '../local-store';
import type { NoteAdoptAction } from '../note-adoption';
import { Button } from '@/app/components/ui/button';
import { AnchoredPopover } from '@/app/components/ui/anchored-popover';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { NoteKnowledgePanel } from './note-knowledge-panel';

export function NoteEditorHeader({
  note,
  effectiveNoteId,
  dirty,
  savingLocal,
  online,
  localStatus,
  standalone,
  listActions,
  zenMode,
  onToggleZen,
  onSave,
  onToggleFavorite,
  onDelete,
  onKnowledgeChange,
  adoptAction,
  insertTriggerRef,
  onInsertCloseAutoFocus,
  insertOpen,
  insertAfter,
  onInsertOpenChange,
  onAddBlock,
  onChooseImage,
}: {
  note: CreativeNote;
  effectiveNoteId: string;
  dirty: boolean;
  savingLocal: boolean;
  online: boolean;
  localStatus?: NotebookSyncStatus;
  standalone: boolean;
  listActions?: React.ReactNode;
  zenMode: boolean;
  onToggleZen: () => void;
  onSave: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onKnowledgeChange: (knowledge: NoteKnowledge) => void;
  adoptAction?: NoteAdoptAction;
  insertTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onInsertCloseAutoFocus: (event: Event) => void;
  insertOpen: boolean;
  insertAfter: string | null;
  onInsertOpenChange: (open: boolean) => void;
  onAddBlock: (type: Extract<NoteBlock['type'], 'text' | 'link' | 'character-reference'>) => void;
  onChooseImage: (after: string | null) => void;
}) {
  const insertIndex = insertAfter === null ? -1 : note.content.findIndex((block) => block.id === insertAfter);

  return (
    <header className="notebook-editor-header sticky top-0 z-20 flex items-center justify-between gap-4 px-5 sm:px-8 py-2 bg-surface/95 backdrop-blur-md border-b border-border-subtle">
      <div className="notebook-editor-leading flex min-w-0 flex-1 items-center gap-2">
        {listActions}
        {standalone && (
          <Link
            href="/apps/notebook"
            className="notebook-back-link inline-flex min-h-[34px] items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回笔记列表</span>
          </Link>
        )}
        <span className="notebook-save-status flex items-center gap-1.5 text-sm text-muted font-medium" role="status">
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${
            savingLocal
              ? 'bg-accent animate-pulse'
              : dirty
              ? 'bg-warning'
              : localStatus === 'syncing'
              ? 'bg-accent animate-pulse'
              : localStatus === 'pending'
              ? online ? 'bg-success' : 'bg-muted'
              : localStatus === 'error'
              ? 'bg-danger'
              : localStatus === 'conflict'
              ? 'bg-warning'
              : 'bg-success'
          }`} />
          <span>
            {savingLocal
              ? '正在保存到本机…'
              : dirty
              ? '等待本机保存…'
              : localStatus === 'syncing'
              ? '正在同步…'
              : localStatus === 'pending'
              ? online ? '已保存到本机 · 等待同步' : '已保存到本机 · 离线'
              : localStatus === 'error'
              ? '本机已保存 · 同步失败'
              : localStatus === 'conflict'
              ? '本机已保存 · 版本冲突'
              : localStatus === 'synced'
              ? '已同步'
              : '尚未保存'}
          </span>
        </span>
      </div>

      <div className="notebook-editor-actions flex items-center gap-2">
        <AnchoredPopover
          title="插入内容"
          open={insertOpen}
          onOpenChange={onInsertOpenChange}
          side="bottom"
          align="start"
          className="notebook-insert-popover"
          onCloseAutoFocus={onInsertCloseAutoFocus}
          trigger={
            <Button ref={insertTriggerRef} size="sm" variant="secondary" className="notebook-insert-trigger">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>插入内容</span>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </Button>
          }
        >
          <p className="mb-2 text-xs text-muted">{insertIndex >= 0 ? `插入到第 ${insertIndex + 1} 个内容块后` : '添加到文末'}</p>
          <div className="notebook-insert-options">
            <Button size="sm" variant="ghost" data-popover-focus onClick={() => onAddBlock('text')}><Plus size={16} aria-hidden="true" />段落</Button>
            <Button size="sm" variant="ghost" onClick={() => onChooseImage(insertAfter)}><ImageIcon size={16} aria-hidden="true" />图片</Button>
            <Button size="sm" variant="ghost" onClick={() => onAddBlock('link')}><LinkIcon size={16} aria-hidden="true" />链接</Button>
            <Button size="sm" variant="ghost" onClick={() => onAddBlock('character-reference')}><User size={16} aria-hidden="true" />角色引用</Button>
          </div>
        </AnchoredPopover>
        <Button
          type="button"
          size="sm"
          variant={zenMode ? 'secondary' : 'ghost'}
          className="h-8 px-2.5 text-sm"
          onClick={onToggleZen}
          title={zenMode ? '退出专注模式' : '进入专注模式'}
          aria-pressed={zenMode}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>{zenMode ? '退出专注' : '专注'}</span>
        </Button>

        <NoteKnowledgePanel
          note={{ ...note, id: note.id ?? (localStatus === 'synced' ? effectiveNoteId : undefined) }}
          knowledge={note.knowledge}
          onChange={onKnowledgeChange}
        />
        {adoptAction?.({ noteId: effectiveNoteId, disabled: dirty || savingLocal || !online || localStatus !== 'synced' })}

        <RowActionsMenu label="更多笔记操作" className="notebook-more-actions" items={[
          { label: '立即保存', icon: <Save className="h-4 w-4" aria-hidden="true" />, onSelect: onSave },
          { label: note.favorite ? '取消收藏' : '收藏笔记', icon: <Star className={`h-4 w-4 ${note.favorite ? 'fill-current text-warning' : ''}`} aria-hidden="true" />, onSelect: onToggleFavorite },
          { label: '删除笔记', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, tone: 'danger', separatorBefore: true, onSelect: onDelete },
        ]} />
      </div>
    </header>
  );
}
