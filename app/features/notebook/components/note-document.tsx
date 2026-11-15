'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ExternalLink,
  Plus,
  Trash2,
} from 'lucide-react';
import type { CreativeNote, NoteBlock, NoteKind, NoteStage } from '@sthstart/contracts';
import { kindLabels, stageLabels } from '../schemas';
import { BLOCK_LABELS } from '../model/note-content';
import { TagsInput } from '@/app/components/shared/tags-input';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { LocalNoteImage } from './local-note-image';
import { CharacterReferenceBlock } from './character-reference-block';

export function NoteDocument({
  note,
  zenMode,
  onChange,
  blockListRef,
  insertOpen,
  insertAfter,
  onFocusBlock,
  onStartWriting,
  onUpdateBlock,
  onMoveBlock,
  onDeleteBlock,
}: {
  note: CreativeNote;
  zenMode: boolean;
  onChange: (updater: (prev: CreativeNote) => CreativeNote) => void;
  blockListRef: React.RefObject<HTMLDivElement | null>;
  insertOpen: boolean;
  insertAfter: string | null;
  onFocusBlock: (id: string) => void;
  onStartWriting: () => void;
  onUpdateBlock: (id: string, patch: Partial<NoteBlock>) => void;
  onMoveBlock: (index: number, direction: -1 | 1) => void;
  onDeleteBlock: (id: string) => void;
}) {
  return (
    <div className={`notebook-editor-frame mx-auto px-5 sm:px-8 py-4 space-y-3.5 transition-all ${zenMode ? 'zen-workspace max-w-3xl' : 'max-w-3xl'}`}>
      <section className="notebook-doc-header" aria-label="文档标题与元信息">
        <label className="notebook-title-field">
          <span className="sr-only">笔记标题</span>
          <Input
            value={note.title}
            onChange={(e) => onChange((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="无标题笔记"
            className="notebook-title-input w-full rounded-none border-0 bg-transparent !px-0 py-1 text-2xl font-semibold tracking-tight text-ink placeholder:text-muted focus-visible:shadow-none sm:text-[28px]"
          />
        </label>
        {!zenMode && (
          <div className="notebook-doc-metadata" role="group" aria-label="资料信息">
            <label className="notebook-metadata-field">
              <span>类型</span>
              <Select
                aria-label="资料分类"
                value={note.kind}
                onChange={(e) => onChange((prev) => ({ ...prev, kind: e.target.value as NoteKind }))}
                className="notebook-doc-select text-base sm:text-sm"
              >
                {Object.entries(kindLabels).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </Select>
            </label>

            <label className="notebook-metadata-field">
              <span>阶段</span>
              <Select
                aria-label="阶段状态"
                value={note.stage}
                onChange={(e) => onChange((prev) => ({ ...prev, stage: e.target.value as NoteStage }))}
                className="notebook-doc-select text-base sm:text-sm"
              >
                {Object.entries(stageLabels).map(([s, label]) => (
                  <option key={s} value={s}>{label}</option>
                ))}
              </Select>
            </label>

            <label className="notebook-doc-tags notebook-metadata-field">
              <span>标签</span>
              <TagsInput
                value={note.tags}
                onChange={(newTags) => onChange((prev) => ({ ...prev, tags: newTags }))}
                placeholder="添加标签，用逗号分隔…"
                aria-label="资料标签"
                className="w-full rounded-control border-0 bg-surface-sunken px-2 py-1 text-base sm:text-sm text-ink outline-none placeholder:text-fg-subtle"
              />
            </label>
          </div>
        )}
      </section>

      <section className="notebook-content-section" aria-label="笔记正文">
        <span className="sr-only">{note.content.length} 个内容块</span>
        <div className="notebook-blocks" ref={blockListRef}>
          {note.content.length === 0 && (
            <Button type="button" size="sm" variant="ghost" className="notebook-start-writing" onClick={onStartWriting}>
              <Plus size={16} aria-hidden="true" /> 写下第一段
            </Button>
          )}
          {note.content.map((block, index) => (
            <div
              key={block.id}
              className="notebook-block"
              data-note-block-id={block.id}
              data-block-type={block.type}
              data-insert-anchor={insertOpen && block.id === insertAfter ? 'true' : undefined}
              tabIndex={-1}
              onFocus={() => onFocusBlock(block.id)}
            >

              {block.type === 'text' && (
                <div className="notebook-paragraph">
                  <Textarea
                    data-reading-surface
                    data-block-entry
                    rows={1}
                    aria-label={`第 ${index + 1} 段正文`}
                    value={block.text}
                    onChange={(e) => onUpdateBlock(block.id, { text: e.target.value })}
                    placeholder="写下一段文字记录…"
                    className="notebook-textarea w-full bg-transparent text-base text-ink placeholder:text-muted outline-none"
                  />
                  <span className="notebook-paragraph-sizing" aria-hidden="true">{block.text}{'\u200b'}</span>
                </div>
              )}

              {block.type === 'image' && (
                <div className="notebook-image-block space-y-2 pt-1">
                  <div className="notebook-image-preview relative aspect-video w-full max-w-2xl overflow-hidden rounded-[12px] bg-surface-muted flex items-center justify-center text-muted">
                    {block.src ? (
                      <LocalNoteImage
                        src={block.src}
                        alt={block.caption || '笔记图片'}
                        priority={index < 2}
                      />
                    ) : (
                      <span className="text-sm">等待选择图片</span>
                    )}
                  </div>
                  <label className="notebook-caption-field flex items-center gap-2">
                    <span className="notebook-field-label shrink-0 text-sm text-muted">说明</span>
                  <Input
                      data-block-entry
                      value={block.caption}
                      onChange={(e) => onUpdateBlock(block.id, { caption: e.target.value })}
                      placeholder="为这张图片写一句说明（可选）"
                    className="notebook-caption-input min-w-0 flex-1 border-0 bg-transparent text-sm text-muted"
                    />
                  </label>
                </div>
              )}

              {block.type === 'link' && (
                <div className="space-y-2 mt-1">
                  <Input
                    type="url"
                    data-block-entry
                    aria-label="参考链接地址"
                    value={block.url}
                    onChange={(e) => onUpdateBlock(block.id, { url: e.target.value })}
                    placeholder="https://..."
                    className="w-full border-0 bg-transparent font-mono text-sm text-ink"
                  />
                  <Input
                    value={block.label}
                    onChange={(e) => onUpdateBlock(block.id, { label: e.target.value })}
                    placeholder="链接标题"
                    className="w-full border-0 bg-transparent text-sm font-semibold text-ink"
                  />
                  <Textarea
                    rows={2}
                    value={block.note}
                    onChange={(e) => onUpdateBlock(block.id, { note: e.target.value })}
                    placeholder="为什么收藏此链接？"
                    className="w-full border-0 bg-transparent text-sm text-muted"
                  />
                  {block.url.startsWith('http') && (
                    <a
                      href={block.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-accent-dark font-medium hover:underline"
                    >
                      <span>打开链接</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              {block.type === 'character-reference' && (
                <CharacterReferenceBlock
                  block={block}
                  onChange={(patch) => onUpdateBlock(block.id, patch)}
                />
              )}

              {block.type === 'archive-reference' && (
                <blockquote className="p-4 rounded-control bg-info-bg/70 border border-border-subtle text-sm space-y-2 mt-1">
                  <p className="text-sm sm:text-sm text-ink leading-relaxed italic">
                    “{block.quote}”
                  </p>
                  <Link
                    href={"/apps/narrative?utterance=" + encodeURIComponent(block.targetId)}
                    className="text-info font-semibold inline-flex items-center gap-1 hover:underline text-sm"
                  >
                    <span>{block.locator || '查看叙事档案'}</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </blockquote>
              )}
              <div className="notebook-block-header">
                {block.type !== 'text' && <span className="notebook-block-kind">{BLOCK_LABELS[block.type]}</span>}

                <div className="notebook-block-controls flex items-center gap-1 transition-opacity">
                  {index > 0 && <IconButton
                    icon={ArrowUp}
                    label={"上移第 " + (index + 1) + " 个内容块"}
                    title="上移"
                    onClick={() => onMoveBlock(index, -1)}
                    variant="ghost"
                    size="icon"
                    className="notebook-icon-button text-muted"
                  />}
                  {index < note.content.length - 1 && <IconButton
                    icon={ArrowDown}
                    label={"下移第 " + (index + 1) + " 个内容块"}
                    title="下移"
                    onClick={() => onMoveBlock(index, 1)}
                    variant="ghost"
                    size="icon"
                    className="notebook-icon-button text-muted"
                  />}
                  <IconButton
                    icon={Trash2}
                    label={"删除第 " + (index + 1) + " 个内容块"}
                    title="删除此块"
                    onClick={() => onDeleteBlock(block.id)}
                    variant="danger-ghost"
                    size="icon"
                    className="notebook-icon-button"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
