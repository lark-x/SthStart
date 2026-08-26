'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Star,
  Save,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
  Link as LinkIcon,
  User,
  ExternalLink,
} from 'lucide-react';
import type { CreativeNote, NoteBlock, NoteKind, NoteStage } from '@sthstart/contracts';
import { useNoteDetail } from '../queries';
import { useCreateNote, useUpdateNote, useDeleteNote, useUploadNoteAsset } from '../mutations';
import { useCharacters } from '@/app/features/characters/queries';
import { kindLabels, stageLabels, newBlock, summaryFromBlocks } from '../schemas';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { useToast } from '@/app/providers/ui-provider';

const initialNote: CreativeNote = {
  title: '',
  kind: 'note',
  summary: '',
  content: [newBlock('text')],
  tags: [],
  stage: 'draft',
  favorite: false,
};

export function NoteEditor({
  noteId,
  initialKind = 'note',
}: {
  noteId?: string;
  initialKind?: NoteKind;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [note, setNote] = useState<CreativeNote>({
    ...initialNote,
    kind: initialKind,
  });
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'error'>('clean');
  const [errorMessage, setErrorMessage] = useState('');

  const { data: detailData } = useNoteDetail(noteId);
  const { data: charData } = useCharacters();
  const characters = charData?.items ?? [];

  const createMutation = useCreateNote();
  const updateMutation = useUpdateNote();
  const deleteMutation = useDeleteNote();
  const uploadMutation = useUploadNoteAsset();

  const handleSave = useCallback(async (quiet = false) => {
    setStatus('saving');
    setErrorMessage('');

    const payload: Partial<CreativeNote> = {
      ...note,
      title: note.title.trim() || '未命名笔记',
      summary: summaryFromBlocks(note.content),
    };

    try {
      if (!noteId) {
        const created = await createMutation.mutateAsync(payload);
        toast.success('笔记已保存');
        router.replace(`/apps/notebook/${created.id}`);
        return created.id;
      }

      await updateMutation.mutateAsync({ id: noteId, payload });
      setStatus('saved');
      setTimeout(() => setStatus('clean'), 1000);
      if (!quiet) toast.success('笔记已保存');
      return noteId;
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      if (!quiet) toast.error('保存失败', msg);
      return null;
    }
  }, [createMutation, note, noteId, router, toast, updateMutation]);

  useEffect(() => {
    if (detailData && status === 'clean') {
      // Query refreshes may hydrate a clean editor, but never overwrite dirty input.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNote(detailData);
      setStatus('clean');
    }
  }, [detailData, status]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [handleSave]);

  // Debounced auto-save
  useEffect(() => {
    if (!noteId || status !== 'dirty') return;
    const timer = setTimeout(() => {
      void handleSave(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [handleSave, noteId, status]);

  const updateNoteState = (updater: (prev: CreativeNote) => CreativeNote) => {
    setNote((prev) => updater(prev));
    setStatus('dirty');
  };

  const handleDelete = async () => {
    if (!noteId || !window.confirm('确定删除此条笔记及其本地图片素材吗？')) return;
    try {
      await deleteMutation.mutateAsync(noteId);
      toast.success('笔记已删除');
      router.push('/apps/notebook');
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddBlock = (type: NoteBlock['type']) => {
    updateNoteState((prev) => ({
      ...prev,
      content: [...prev.content, newBlock(type)],
    }));
  };

  const handleUpdateBlock = (id: string, patch: Partial<NoteBlock>) => {
    updateNoteState((prev) => ({
      ...prev,
      content: prev.content.map((b) => (b.id === id ? ({ ...b, ...patch } as NoteBlock) : b)),
    }));
  };

  const handleMoveBlock = (index: number, direction: -1 | 1) => {
    updateNoteState((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.content.length) return prev;
      const content = [...prev.content];
      [content[index], content[target]] = [content[target], content[index]];
      return { ...prev, content };
    });
  };

  const handleDeleteBlock = (id: string) => {
    updateNoteState((prev) => ({
      ...prev,
      content: prev.content.filter((b) => b.id !== id),
    }));
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      toast.error('图片过大', '单张图片大小不能超过 8MB');
      return;
    }

    const targetId = noteId ?? (await handleSave());
    if (!targetId) return;

    try {
      const result = await uploadMutation.mutateAsync({ noteId: targetId, file });
      updateNoteState((prev) => ({
        ...prev,
        content: [
          ...prev.content,
          {
            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
            type: 'image',
            src: result.url,
            caption: '',
          },
        ],
      }));
      toast.success('图片已上传');
    } catch (err) {
      toast.error('上传失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f0e7] text-[#18201d] pb-16">
      {/* Top sticky bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-8 py-3 bg-[#f4f0e7]/90 backdrop-blur-md border-b border-[rgb(24_32_29/12%)]">
        <Link
          href="/apps/notebook"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>返回笔记列表</span>
        </Link>

        <span className="text-xs text-[#68716d]">
          {status === 'saving'
            ? '正在保存…'
            : status === 'dirty'
            ? '等待自动保存…'
            : status === 'saved'
            ? '已保存'
            : '本地笔记'}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              updateNoteState((prev) => ({ ...prev, favorite: !prev.favorite }))
            }
            className={`p-2 rounded-full hover:bg-[rgb(24_32_29/6%)] transition-colors cursor-pointer ${
              note.favorite ? 'text-[#d0a731]' : 'text-[#68716d]'
            }`}
            aria-label={note.favorite ? '取消收藏' : '收藏笔记'}
          >
            <Star className={`h-4 w-4 ${note.favorite ? 'fill-current' : ''}`} />
          </button>

          <Button size="sm" variant="primary" onClick={() => void handleSave()}>
            <Save className="h-3.5 w-3.5" />
            <span>保存</span>
          </Button>
        </div>
      </header>

      {errorMessage && (
        <div className="max-w-3xl mx-auto px-4 sm:px-12 pt-6">
          <Alert variant="danger" onDismiss={() => setErrorMessage('')}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* Editor Paper */}
      <article className="max-w-3xl mx-auto mt-6 px-4 sm:px-12 py-8 bg-[#fffdf8] rounded-[4px_24px_4px_4px] border border-[rgb(24_32_29/14%)] shadow-sm space-y-6">
        {/* Meta controls */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={note.kind}
            onChange={(e) =>
              updateNoteState((prev) => ({ ...prev, kind: e.target.value as NoteKind }))
            }
            className="h-8 rounded-full border border-[rgb(24_32_29/16%)] bg-transparent px-3 text-xs text-[#68716d] font-semibold outline-none focus:border-[#e45d35]"
          >
            {Object.entries(kindLabels).map(([val, label]) => (
              <option value={val} key={val}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={note.stage}
            onChange={(e) =>
              updateNoteState((prev) => ({ ...prev, stage: e.target.value as NoteStage }))
            }
            className="h-8 rounded-full border border-[rgb(24_32_29/16%)] bg-transparent px-3 text-xs text-[#68716d] font-semibold outline-none focus:border-[#e45d35]"
          >
            {Object.entries(stageLabels).map(([val, label]) => (
              <option value={val} key={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Title Input */}
        <input
          value={note.title}
          onChange={(e) => updateNoteState((prev) => ({ ...prev, title: e.target.value }))}
          placeholder="给这一页一个标题…"
          className="w-full bg-transparent font-serif text-3xl sm:text-4xl font-medium text-[#18201d] placeholder:text-[#68716d]/40 outline-none border-b border-transparent focus:border-[rgb(24_32_29/12%)] pb-2"
        />

        {/* Tags */}
        <input
          value={note.tags.join('，')}
          onChange={(e) =>
            updateNoteState((prev) => ({
              ...prev,
              tags: e.target.value
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            }))
          }
          placeholder="添加标签，以逗号分隔（如：灵感，第 2 章）"
          className="w-full bg-transparent text-xs text-[#68716d] placeholder:text-[#68716d]/50 outline-none pb-2 border-b border-[rgb(24_32_29/10%)]"
        />

        {/* Blocks List */}
        <div className="space-y-6 pt-2">
          {note.content.map((block, index) => (
            <div
              key={block.id}
              className="group relative pb-4 border-b border-dashed border-[rgb(24_32_29/12%)] space-y-2"
            >
              <div className="flex items-center justify-between opacity-50 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#68716d]">
                  {block.type === 'text'
                    ? '段落文本'
                    : block.type === 'image'
                    ? '图片素材'
                    : block.type === 'link'
                    ? '参考链接'
                    : block.type === 'character-reference'
                    ? '角色资料引用'
                    : '叙事档案引用'}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => handleMoveBlock(index, -1)}
                    className="p-1 text-[#68716d] hover:text-[#18201d] disabled:opacity-20"
                    title="上移"
                    aria-label={`上移第 ${index + 1} 个内容块`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={index === note.content.length - 1}
                    onClick={() => handleMoveBlock(index, 1)}
                    className="p-1 text-[#68716d] hover:text-[#18201d] disabled:opacity-20"
                    title="下移"
                    aria-label={`下移第 ${index + 1} 个内容块`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBlock(block.id)}
                    className="p-1 text-[#c9674a] hover:opacity-80"
                    title="删除此块"
                    aria-label={`删除第 ${index + 1} 个内容块`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Block Types */}
              {block.type === 'text' && (
                <textarea
                  rows={Math.max(4, block.text.split('\n').length + 1)}
                  value={block.text}
                  onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                  placeholder="写下一段文字记录…"
                  className="w-full bg-transparent font-serif text-base leading-relaxed text-[#18201d] placeholder:text-[#68716d]/40 outline-none resize-y"
                />
              )}

              {block.type === 'image' && (
                <div className="space-y-2">
                  <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-[#e6e4dc] flex items-center justify-center text-[#68716d]">
                    {block.src ? (
                      <Image
                        src={block.src}
                        alt={block.caption || '笔记图片'}
                        fill
                        unoptimized
                        className="object-contain"
                      />
                    ) : (
                      <span className="text-xs">等待选择图片</span>
                    )}
                  </div>
                  <input
                    value={block.caption}
                    onChange={(e) => handleUpdateBlock(block.id, { caption: e.target.value })}
                    placeholder="图片附注说明（可选）"
                    className="w-full bg-transparent text-xs text-[#68716d] outline-none"
                  />
                </div>
              )}

              {block.type === 'link' && (
                <div className="p-3 rounded bg-[rgb(24_32_29/4%)] border border-[rgb(24_32_29/10%)] space-y-2">
                  <input
                    type="url"
                    value={block.url}
                    onChange={(e) => handleUpdateBlock(block.id, { url: e.target.value })}
                    placeholder="https://..."
                    className="w-full bg-transparent text-xs font-mono text-[#18201d] outline-none"
                  />
                  <input
                    value={block.label}
                    onChange={(e) => handleUpdateBlock(block.id, { label: e.target.value })}
                    placeholder="链接标题"
                    className="w-full bg-transparent text-xs font-semibold text-[#18201d] outline-none"
                  />
                  <textarea
                    rows={2}
                    value={block.note}
                    onChange={(e) => handleUpdateBlock(block.id, { note: e.target.value })}
                    placeholder="为什么收藏此链接？"
                    className="w-full bg-transparent text-xs text-[#68716d] outline-none"
                  />
                  {block.url.startsWith('http') && (
                    <a
                      href={block.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#b83b1b] font-medium hover:underline"
                    >
                      <span>打开链接</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              {block.type === 'character-reference' && (
                <div className="p-4 rounded bg-[#f3f1e8] border border-[rgb(108_107_91/20%)] space-y-3">
                  <select
                    value={block.characterId}
                    onChange={(e) =>
                      handleUpdateBlock(block.id, { characterId: e.target.value })
                    }
                    className="w-full h-9 rounded border border-[rgb(24_32_29/14%)] bg-[#fffdf8] px-3 text-xs text-[#18201d] outline-none"
                  >
                    <option value="">选择资料库中的角色</option>
                    {characters.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.displayName}
                        {c.draft.work ? ` · ${c.draft.work}` : ''}
                      </option>
                    ))}
                  </select>

                  {block.characterId && (
                    <div className="p-3 rounded bg-white/70 border-l-4 border-[#777865] text-xs space-y-1">
                      <strong className="font-serif text-sm text-[#18201d] block">
                        {characters.find((c) => c.id === block.characterId)?.displayName}
                      </strong>
                      <p className="text-[#68716d] line-clamp-2">
                        {characters.find((c) => c.id === block.characterId)?.draft.summary ||
                          '尚未填写摘要'}
                      </p>
                      <Link
                        href={`/apps/characters/${block.characterId}`}
                        className="inline-block text-[#b83b1b] font-medium hover:underline pt-1"
                      >
                        前往角色资料库 →
                      </Link>
                    </div>
                  )}

                  <textarea
                    rows={2}
                    value={block.note}
                    onChange={(e) => handleUpdateBlock(block.id, { note: e.target.value })}
                    placeholder="这条笔记与该角色的关系（可选）"
                    className="w-full bg-transparent text-xs text-[#68716d] outline-none"
                  />
                </div>
              )}

              {block.type === 'archive-reference' && (
                <blockquote className="p-4 rounded bg-[#eef0f2] border-l-4 border-[#4d6684] text-xs space-y-2">
                  <p className="font-serif text-sm text-[#18201d] leading-relaxed">
                    “{block.quote}”
                  </p>
                  <Link
                    href={`/apps/narrative?utterance=${encodeURIComponent(block.targetId)}`}
                    className="text-[#4d6684] font-semibold inline-flex items-center gap-1 hover:underline"
                  >
                    <span>{block.locator || '查看叙事档案'}</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </blockquote>
              )}
            </div>
          ))}
        </div>

        {/* Insert Bar */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-6">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAddBlock('text')}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>段落文本</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>图片素材</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAddBlock('link')}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            <span>参考链接</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAddBlock('character-reference')}
          >
            <User className="h-3.5 w-3.5" />
            <span>角色引用</span>
          </Button>
        </div>

        {noteId && (
          <div className="pt-6 border-t border-[rgb(24_32_29/10%)] text-center">
            <button
              type="button"
              onClick={handleDelete}
              className="text-xs text-[#c9674a] hover:underline cursor-pointer"
            >
              删除这条笔记
            </button>
          </div>
        )}
      </article>

      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleUploadImage}
      />
    </main>
  );
}
