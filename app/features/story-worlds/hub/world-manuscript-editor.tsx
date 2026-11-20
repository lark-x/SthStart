'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Save, Sparkles, Trash2 } from 'lucide-react';
import type { WorldHubDocSummary } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { useToast } from '@/app/providers/ui-provider';
import { deleteWorldManuscriptDoc, saveWorldManuscriptDoc } from '../api';
import { describeError } from '../hooks/world-format';

const DOC_KIND_LABELS: Record<WorldHubDocSummary['kind'], string> = {
  outline: '全卷大纲',
  world: '设定文档',
  chapter: '正文章节',
  scene: '场景草稿',
};

export interface WorldManuscriptEditorHandle {
  insertProse: (text: string) => void;
}

export interface WorldManuscriptEditorProps {
  worldId: string;
  projectId: string;
  doc: WorldHubDocSummary;
  onDocSaved: (updated: WorldHubDocSummary) => void;
  onDocDeleted?: (deletedDocId: string) => void;
  onOpenIllustration?: () => void;
  onOpenCopilot?: () => void;
  /** 可选：向同级写作助手实时同步未保存草稿内容 */
  onDraftChange?: (draft: { docId: string; title: string; body: string; dirty: boolean }) => void;
}

export const WorldManuscriptEditor = forwardRef<WorldManuscriptEditorHandle, WorldManuscriptEditorProps>(
  function WorldManuscriptEditor(
    {
      worldId,
      projectId,
      doc,
      onDocSaved,
      onDocDeleted,
      onOpenIllustration,
      onOpenCopilot,
      onDraftChange,
    },
    ref,
  ) {
    const toast = useToast();
    const bodyRef = useRef<HTMLTextAreaElement | null>(null);
    const savingRef = useRef(false);

    const [syncedDoc, setSyncedDoc] = useState(() => ({ id: doc.id, revision: doc.revision }));
    const [title, setTitle] = useState(doc.title);
    const [body, setBody] = useState(doc.body);
    const [baseTitle, setBaseTitle] = useState(doc.title);
    const [baseBody, setBaseBody] = useState(doc.body);
    const [baseRevision, setBaseRevision] = useState(doc.revision);

    const [saving, setSaving] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [error, setError] = useState('');
    const [justSaved, setJustSaved] = useState(false);

    // 切换文档或服务端修订外部更新且本地未改动时，同步最新内容
    if (doc.id !== syncedDoc.id) {
      setSyncedDoc({ id: doc.id, revision: doc.revision });
      setTitle(doc.title);
      setBody(doc.body);
      setBaseTitle(doc.title);
      setBaseBody(doc.body);
      setBaseRevision(doc.revision);
      setError('');
      setJustSaved(false);
    } else if (doc.revision !== syncedDoc.revision) {
      setSyncedDoc({ id: doc.id, revision: doc.revision });
      if (title === baseTitle && body === baseBody) {
        setTitle(doc.title);
        setBody(doc.body);
        setBaseTitle(doc.title);
        setBaseBody(doc.body);
        setBaseRevision(doc.revision);
        setError('');
      }
    }

    const isDirty = title !== baseTitle || body !== baseBody;
    const charCount = body.replace(/\s+/g, '').length;

    useImperativeHandle(ref, () => ({
      insertProse(text: string) {
        const snippet = text.trim();
        if (!snippet) return;
        setBody((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${snippet}` : snippet));
        setError('');
        setJustSaved(false);
      },
    }), []);

    useEffect(() => {
      onDraftChange?.({
        docId: doc.id,
        title,
        body,
        dirty: isDirty,
      });
    }, [doc.id, title, body, isDirty, onDraftChange]);

    const handleSave = async (options?: { silentToast?: boolean }) => {
      if (!isDirty || savingRef.current) return;

      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        setError('章节标题不能为空。');
        return;
      }

      const targetDocId = doc.id;
      const targetRevision = baseRevision;
      const sentTitle = title;

      savingRef.current = true;
      setSaving(true);
      setError('');
      try {
        const res = await saveWorldManuscriptDoc(worldId, targetDocId, {
          projectId,
          expectedRevision: targetRevision,
          title: trimmedTitle,
          body,
        });
        setBaseTitle(res.document.title);
        setBaseBody(res.document.body);
        setBaseRevision(res.document.revision);
        setSyncedDoc({ id: res.document.id, revision: res.document.revision });
        setTitle((current) => (current === sentTitle ? res.document.title : current));
        setJustSaved(true);
        onDocSaved(res.document);
        if (!options?.silentToast) {
          toast.success('手稿已保存', `${res.document.title} · 修订 ${res.document.revision}`);
        }
      } catch (saveError) {
        setError(describeError(saveError));
        setJustSaved(false);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    };

    const saveHandlerRef = useRef(handleSave);
    useEffect(() => {
      saveHandlerRef.current = handleSave;
    });

    // Ctrl/Cmd + S 触发显式保存（带 CJK 输入法互锁守卫）
    useEffect(() => {
      const onWindowKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void saveHandlerRef.current();
        }
      };
      window.addEventListener('keydown', onWindowKeyDown);
      return () => window.removeEventListener('keydown', onWindowKeyDown);
    }, []);

    const handleBlurSave = () => {
      if (isDirty && title.trim() && !savingRef.current) {
        void handleSave({ silentToast: true });
      }
    };

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
        {/* 固定在滚动区之外的轻量编辑工具条 */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline">{DOC_KIND_LABELS[doc.kind]}</Badge>
            <span className="text-xs text-muted">修订 {baseRevision}</span>
            <span className="text-xs text-muted">{charCount} 字</span>
            {saving ? (
              <Badge variant="secondary">正在保存…</Badge>
            ) : isDirty ? (
              <Badge variant="warning">未保存修改</Badge>
            ) : justSaved ? (
              <Badge variant="online">
                <Check className="h-3 w-3" aria-hidden="true" />
                已保存
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenCopilot && (
              <Button size="sm" variant="outline" onClick={onOpenCopilot}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                AI 写作助手
              </Button>
            )}
            {onOpenIllustration && (
              <Button size="sm" variant="outline" onClick={onOpenIllustration}>
                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                本章配图
              </Button>
            )}
            {(doc.kind === 'chapter' || doc.kind === 'scene') && onDocDeleted && (
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setDeleteConfirmOpen(true)}
                className="text-muted hover:text-danger-fg"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                删除本章
              </Button>
            )}
            <Button
              size="sm"
              variant={isDirty ? 'primary' : 'secondary'}
              loading={saving}
              disabled={saving || !isDirty}
              onClick={() => void handleSave()}
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              保存
            </Button>
          </div>
        </div>

        {error && (
          <div className="shrink-0 px-4 pt-3 sm:px-6">
            <Alert variant="danger" title="手稿保存失败" onDismiss={() => setError('')}>
              {error}
            </Alert>
          </div>
        )}

        {/* 暖纸沉浸式编辑区 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-6">
          <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] sm:p-8">
            <input
              type="text"
              value={title}
              maxLength={120}
              aria-label="章节标题"
              placeholder="输入章节标题…"
              onChange={(event) => {
                setTitle(event.target.value);
                setError('');
                setJustSaved(false);
              }}
              onBlur={handleBlurSave}
              onKeyDown={(event) => {
                if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  bodyRef.current?.focus();
                }
              }}
              className="w-full shrink-0 border-0 border-b border-transparent bg-transparent p-0 pb-2 text-2xl font-semibold tracking-tight text-ink outline-none transition-colors placeholder:text-muted/60 hover:border-border-default/50 focus:border-accent"
            />

            <textarea
              ref={bodyRef}
              value={body}
              aria-label="章节正文"
              placeholder="在此输入或粘贴章节正文（支持 Markdown）；也可在右侧 AI 写作助手先拟定场纲节拍，再撰写与润色。"
              onChange={(event) => {
                setBody(event.target.value);
                setError('');
                setJustSaved(false);
              }}
              onBlur={handleBlurSave}
              onKeyDown={(event) => {
                if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  void handleSave();
                }
              }}
              className="mt-4 min-h-0 w-full flex-1 resize-none border-0 bg-transparent p-0 font-serif text-base leading-loose text-ink outline-none placeholder:text-muted/55"
            />
          </div>
        </div>

        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="删除手稿章节"
          description={`确定要永久删除「${title.trim() || doc.title}」吗？该章节正文及修订记录将被移除且无法恢复。`}
          confirmLabel="确认删除"
          danger
          onConfirm={async () => {
            try {
              await deleteWorldManuscriptDoc(worldId, doc.id, projectId);
              toast.success('已删除章节', title.trim() || doc.title);
              onDocDeleted?.(doc.id);
            } catch (delError) {
              const message = describeError(delError);
              setError(message);
              toast.error('删除失败', message);
              throw delError;
            }
          }}
        />
      </div>
    );
  },
);
