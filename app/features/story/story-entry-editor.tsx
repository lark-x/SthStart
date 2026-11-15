'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryDocument, StoryEntry } from '@sthstart/contracts';
import './story-editor.css';
import { isImeComposingEvent } from '@/app/lib/hooks/use-cjk-ime-guard';
import { Alert } from '@/app/components/ui/alert';
import { Input } from '@/app/components/ui/input';
import { useStoryEntryDraft } from './use-story-entry-draft';
import { useStoryEditorPreferences } from './hooks/use-story-editor-preferences';
import { useStoryMentionPicker, type CastMember } from './hooks/use-story-mention-picker';
import {
  appendSnippet, findHeadings, formatChineseIndentation, lineStartOffset, wrapSelection,
} from './model/story-editor-text';
import { fontFamilies, paperWidthClass } from './model/story-editor-preferences';
import { StoryEntryToolbar } from './components/story-entry-toolbar';
import { StoryEntryNotices } from './components/story-entry-notices';
import { StoryEntryFormatBar } from './components/story-entry-format-bar';
import { StoryHeadingOutline } from './components/story-heading-outline';
import { StoryEntryTextCanvas } from './components/story-entry-text-canvas';
import { StoryScriptPreview } from './components/story-script-preview';
import { StoryChapterPager } from './components/story-chapter-pager';
import { StoryClipboardDraftDialog } from './components/story-clipboard-draft-dialog';

export type { PaperTheme, FontChoice } from './model/story-editor-preferences';
export type { CastMember } from './hooks/use-story-mention-picker';

export function StoryEntryEditor({
  projectId,
  entry,
  castList = [],
  prevChapter,
  nextChapter,
  onSwitchChapter,
  onCreateNextChapter,
  onSaved,
  onConflict,
  onRegisterFlush,
  zenMode,
  onToggleZen,
  onOpenDerivatives,
  isReflection,
}: {
  projectId: string;
  entry: StoryEntry;
  castList?: CastMember[];
  prevChapter?: StoryDocument | null;
  nextChapter?: StoryDocument | null;
  onSwitchChapter?: (chapterId: string) => void;
  onCreateNextChapter?: () => void;
  onSaved: (entry: StoryEntry) => void;
  onConflict: () => void;
  onRegisterFlush: (flush: () => Promise<boolean>) => void;
  zenMode?: boolean;
  onToggleZen?: () => void;
  onOpenDerivatives?: () => void;
  isReflection?: boolean;
}) {
  const draft = useStoryEntryDraft(projectId, entry, onSaved, onConflict);
  useEffect(() => {
    onRegisterFlush(draft.flush);
    return () => onRegisterFlush(async () => true);
  }, [draft.flush, onRegisterFlush]);

  const preferences = useStoryEditorPreferences();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isCharacter = 'name' in entry;
  const kind = isCharacter ? 'character' : entry.kind;
  const label = isReflection
    ? ({ outline: '思考纲要', world: '世界观', scene: '场景', chapter: '感想随笔', character: '角色设定' } as const)[kind]
    : ({ outline: '大纲', world: '世界观', scene: '场景', chapter: '章节', character: '角色设定' } as const)[kind];

  const headings = useMemo(() => findHeadings(draft.body), [draft.body]);

  const insert = useCallback((prefix: string, suffix = '') => {
    const textarea = bodyRef.current;
    if (!textarea) {
      draft.update({ body: appendSnippet(draft.body, prefix, suffix) });
      return;
    }
    const next = wrapSelection(draft.body, textarea.selectionStart, textarea.selectionEnd, prefix, suffix);
    draft.update({ body: next.body });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }, [draft]);

  const formatIndentation = useCallback(() => {
    draft.update({ body: formatChineseIndentation(draft.body) });
  }, [draft]);

  const mention = useStoryMentionPicker({
    body: draft.body,
    castList,
    bodyRef,
    updateBody: draft.update,
  });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposingEvent(event)) return;
    if (mention.handleMentionKeyDown(event)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void draft.flush();
    }
  };

  const [clipboardDraft, setClipboardDraft] = useState<string | null>(null);
  const [clipboardError, setClipboardError] = useState('');
  const [showFormatBar, setShowFormatBar] = useState(false);

  const handleAdoptClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setClipboardError('剪贴板中暂无文本可采纳。');
        return;
      }
      setClipboardError('');
      setClipboardDraft(text.trim());
    } catch {
      setClipboardError('浏览器未允许读取剪贴板，请使用键盘快捷键直接粘贴。');
    }
  }, []);

  const save = useCallback(async () => { await draft.flush(); }, [draft]);
  const localText = `${draft.title}\n\n${draft.body}`;
  const statusLabel = draft.status === 'saved' ? '已保存' : draft.status === 'saving' ? '保存中…'
    : draft.status === 'dirty' ? '待保存' : draft.status === 'conflict' ? '版本冲突'
      : draft.status === 'local-only' ? '仅保存在本机' : '保存失败';

  const charCount = [...draft.body.trim()].length;
  const readMinutes = Math.max(1, Math.ceil(charCount / 400));
  const currentTheme = {
    paperBg: 'var(--story-paper)', textColor: 'var(--story-text)',
    mutedColor: 'var(--story-muted)', borderColor: 'var(--story-line)', bubbleBg: 'var(--story-inset)',
  };
  const saveDisabled = !draft.dirty || draft.status === 'saving' || draft.status === 'conflict';

  return (
    <section
      aria-label="正式资料编辑器"
      onKeyDown={event => {
        if (isImeComposingEvent(event) || event.defaultPrevented) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); void draft.flush(); }
      }}
      className={`story-entry-editor flex h-full min-h-0 min-w-0 flex-col ${zenMode ? 'zen-workspace' : ''}`}
    >
      <StoryEntryToolbar
        label={label}
        revision={entry.revision}
        statusLabel={statusLabel}
        statusDanger={draft.status === 'conflict' || draft.status === 'local-only'}
        charCount={charCount}
        readMinutes={readMinutes}
        mode={preferences.mode}
        onModeChange={preferences.setMode}
        isReflection={Boolean(isReflection)}
        saveDisabled={saveDisabled}
        onSave={() => void save()}
        theme={preferences.theme}
        onThemeChange={preferences.setTheme}
        font={preferences.font}
        onFontChange={preferences.setFont}
        indent2em={preferences.indent2em}
        onIndent2emChange={preferences.setIndent2em}
        canvasWidth={preferences.canvasWidth}
        onCanvasWidthChange={preferences.setCanvasWidth}
        zenMode={zenMode}
        onToggleZen={onToggleZen}
        onOpenDerivatives={onOpenDerivatives}
      />

      {/* 编辑器核心内容滚动区（多列高度隔离，仅自身纵向滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4" data-autohide-scroll>
        <StoryEntryNotices
          recoveryAvailable={draft.recoveryAvailable}
          onRecover={() => void draft.recoverLocal()}
          onDiscard={() => void draft.discardLocal()}
          error={draft.error}
          status={draft.status}
          onRetry={draft.retry}
          entry={entry}
          body={draft.body}
          onCopyLocal={() => void navigator.clipboard.writeText(localText).catch(() => {})}
          onAcceptServer={() => void draft.acceptServer(entry)}
          onOverwriteLocal={() => {
            if (window.confirm(`确认以本机内容覆盖服务器 v${entry.revision}？这会创建新的正式修订。`)) draft.saveLocalOverServer(entry.revision);
          }}
        />

        {clipboardError && (
          <Alert variant="info" title="无法读取剪贴板" className="mb-3" onDismiss={() => setClipboardError('')}>
            {clipboardError}
          </Alert>
        )}

        {preferences.mode !== 'preview' && preferences.mode !== 'script' && (
          <StoryEntryFormatBar
            canvasWidth={preferences.canvasWidth}
            expanded={showFormatBar}
            onExpand={() => setShowFormatBar(true)}
            onInsert={insert}
            onFormatIndentation={formatIndentation}
            onAdoptClipboard={() => void handleAdoptClipboard()}
          />
        )}

        <StoryHeadingOutline
          headings={headings}
          canvasWidth={preferences.canvasWidth}
          onJump={(line) => {
            bodyRef.current?.focus();
            bodyRef.current?.setSelectionRange(lineStartOffset(draft.body, line), draft.body.length);
          }}
        />

        {/* 沉浸式稿纸核心主画布 */}
        <div
          data-reading-theme={preferences.theme}
          className={`story-reading-paper relative mx-auto w-full motion-reduce:transition-none transition-colors rounded-panel p-4 sm:p-6 border ${paperWidthClass(preferences.canvasWidth, preferences.mode === 'split')}`}
          style={{
            backgroundColor: currentTheme.paperBg,
            color: currentTheme.textColor,
            borderColor: currentTheme.borderColor,
            fontFamily: fontFamilies[preferences.font].style,
          }}
        >
          {/* 无边框典雅大标题 */}
          <Input
            aria-label="条目标题"
            value={draft.title}
            maxLength={120}
            onChange={(event) => draft.update({ title: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent?.isComposing || event.keyCode === 229 || isImeComposingEvent(event)) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                bodyRef.current?.focus();
                bodyRef.current?.setSelectionRange(0, 0);
              }
            }}
            placeholder="无标题章节…"
            className="h-auto min-h-0 w-full rounded-none bg-transparent border-0 border-b border-transparent hover:border-border-default/50 focus:border-accent p-0 pb-2 mb-6 text-2xl sm:text-3xl font-semibold tracking-tight outline-none transition-colors"
            style={{ color: currentTheme.textColor, fontFamily: 'var(--font-sans)' }}
          />

          {preferences.mode === 'script' ? (
            <StoryScriptPreview
              body={draft.body}
              castList={castList}
              indent2em={preferences.indent2em}
              charCount={charCount}
              colors={{
                text: currentTheme.textColor,
                muted: currentTheme.mutedColor,
                bubble: currentTheme.bubbleBg,
                border: currentTheme.borderColor,
              }}
            />
          ) : (
            <StoryEntryTextCanvas
              mode={preferences.mode}
              body={draft.body}
              bodyRef={bodyRef}
              theme={{
                text: currentTheme.textColor,
                muted: currentTheme.mutedColor,
                bubble: currentTheme.bubbleBg,
                border: currentTheme.borderColor,
              }}
              font={preferences.font}
              indent2em={preferences.indent2em}
              mentionActive={mention.filteredCast.length > 0}
              filteredCast={mention.filteredCast}
              mentionIndex={mention.mentionIndex}
              onMentionHover={mention.setMentionIndex}
              onMentionPick={mention.completeCharacterDialogue}
              onBodyChange={mention.handleBodyChange}
              onBodyKeyDown={handleKeyDown}
            />
          )}

          {kind === 'chapter' && (prevChapter || nextChapter || onCreateNextChapter) && (
            <StoryChapterPager
              position={(entry as StoryDocument).position ?? 0}
              charCount={charCount}
              previous={prevChapter ?? null}
              next={nextChapter ?? null}
              onSwitchChapter={onSwitchChapter}
              onCreateNextChapter={onCreateNextChapter}
            />
          )}
        </div>
      </div>

      <StoryClipboardDraftDialog
        draft={clipboardDraft}
        onClose={() => setClipboardDraft(null)}
        onReplace={(text) => { draft.update({ body: text }); setClipboardDraft(null); }}
        onAppend={(text) => {
          draft.update({ body: `${draft.body}${draft.body.trim() ? '\n\n' : ''}${text}` });
          setClipboardDraft(null);
        }}
      />
    </section>
  );
}
