'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Code2, Film, Heading2, Italic, List, Quote, RotateCcw, Save, Sparkles,
  ChevronLeft, ChevronRight, Plus,
  SlidersHorizontal, ClipboardPaste, MoreHorizontal, Type,
} from 'lucide-react';
import type { StoryDocument, StoryEntry } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import './story-editor.css';
import { Dialog } from '@/app/components/ui/dialog';
import { StoryMarkdown } from './story-markdown';
import { storyEntryIdentity, useStoryEntryDraft } from './use-story-entry-draft';
import { isImeComposingEvent } from '@/app/lib/hooks/use-cjk-ime-guard';

type ViewMode = 'source' | 'preview' | 'split' | 'script';
export type PaperTheme = 'interface' | 'parchment' | 'pure' | 'midnight' | 'sage';
export type FontChoice = 'serif' | 'sans' | 'kai';

interface CastMember {
  id?: string;
  name: string;
  avatarUrl?: string | null;
  work?: string | null;
  notes?: string;
}

// 独立纸张配色仅作用于阅读/编辑表面，默认跟随全局主题。
const themeNames: Record<PaperTheme, string> = {
  interface: '跟随界面', parchment: '水墨暖白', pure: '素笺明净', midnight: '深阁夜读', sage: '竹简素青',
};
const editorMenuClass = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-hover';

const fontFamilies: Record<FontChoice, { name: string; style: string }> = {
  serif: {
    name: '思源宋体',
    style: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", Georgia, serif',
  },
  sans: {
    name: '思源黑体',
    style: 'var(--font-sans)',
  },
  kai: {
    name: '古风楷体',
    style: '"KaiTi", "STKaiti", "楷体", "STSong", serif',
  },
};

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

  const [mode, setMode] = useState<ViewMode>('source');
  const [theme, setTheme] = useState<PaperTheme>('interface');
  const [font, setFont] = useState<FontChoice>('serif');
  const [indent2em, setIndent2em] = useState(true);
  type CanvasWidth = 'comfortable' | 'wide' | 'full';
  const [canvasWidth, setCanvasWidth] = useState<CanvasWidth>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('sthstart_story_canvas_width');
        if (saved === 'comfortable' || saved === 'wide' || saved === 'full') return saved;
      } catch {}
    }
    return 'wide';
  });
  const handleSetCanvasWidth = (w: CanvasWidth) => {
    setCanvasWidth(w);
    try { localStorage.setItem('sthstart_story_canvas_width', w); } catch {}
  };

  // @ 角色智能补全状态
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isCharacter = 'name' in entry;
  const kind = isCharacter ? 'character' : entry.kind;
  const label = isReflection
    ? ({ outline: '思考纲要', world: '世界观', scene: '场景', chapter: '感想随笔', character: '角色设定' } as const)[kind]
    : ({ outline: '大纲', world: '世界观', scene: '场景', chapter: '章节', character: '角色设定' } as const)[kind];

  const headings = useMemo(() => draft.body.split('\n').flatMap((line, index) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    return match ? [{ line: index, text: match[2]!, depth: match[1]!.length }] : [];
  }), [draft.body]);

  // 过滤 @ 补全候选列表
  const filteredCast = useMemo(() => {
    if (!mentionActive) return [];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return castList;
    return castList.filter((c) => c.name.toLowerCase().includes(q) || (c.work && c.work.toLowerCase().includes(q)));
  }, [mentionActive, mentionQuery, castList]);

  // 工具栏插入函数
  const insert = useCallback((prefix: string, suffix = '') => {
    const textarea = bodyRef.current;
    if (!textarea) {
      draft.update({ body: `${draft.body}${draft.body.endsWith('\n') || !draft.body ? '' : '\n'}${prefix}${suffix}` });
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = draft.body.slice(start, end);
    const replacement = `${prefix}${selected || (suffix ? '文本' : '')}${suffix}`;
    const next = `${draft.body.slice(0, start)}${replacement}${draft.body.slice(end)}`;
    draft.update({ body: next });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selected || (suffix ? '文本' : '')).length);
    });
  }, [draft]);

  // 一键段首空两格格式化
  const formatChineseIndentation = useCallback(() => {
    const lines = draft.body.split('\n');
    const formatted = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      // 跳过标题、代码块与列表
      if (/^(#{1,6}\s|```|[-*+]\s|\d+\.\s|>)/.test(trimmed)) return trimmed;
      // 补齐段首全角双空格
      const content = trimmed.replace(/^[\s\u3000]+/, '');
      return `\u3000\u3000${content}`;
    }).join('\n');
    draft.update({ body: formatted });
  }, [draft]);

  // 确认插入选定角色的标准对白语法并精确定位光标到双引号内部
  const completeCharacterDialogue = useCallback((charName: string) => {
    const textarea = bodyRef.current;
    if (!textarea || mentionAnchor === null) return;
    const currentPos = textarea.selectionStart;
    const beforeMention = draft.body.slice(0, mentionAnchor);
    const afterMention = draft.body.slice(currentPos);
    // 注入：角色名：“”
    const dialogueTemplate = `${charName}：“”`;
    const nextBody = `${beforeMention}${dialogueTemplate}${afterMention}`;
    draft.update({ body: nextBody });

    // 光标精准停在双引号内部：两双引号在结尾前一位
    const insideQuotesIndex = beforeMention.length + dialogueTemplate.length - 1;
    setMentionActive(false);
    setMentionAnchor(null);
    setMentionQuery('');
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(insideQuotesIndex, insideQuotesIndex);
    });
  }, [draft, mentionAnchor]);

  // 监听键盘按键用于 @ 补全导航
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposingEvent(event)) {
      return;
    }
    if (mentionActive && event.key === 'Escape') {
      event.preventDefault(); setMentionActive(false); setMentionAnchor(null); return;
    }
    if (mentionActive && filteredCast.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredCast.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredCast.length) % filteredCast.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const picked = filteredCast[mentionIndex];
        if (picked) {
          completeCharacterDialogue(picked.name);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionActive(false);
        setMentionAnchor(null);
        return;
      }
    }

    // Ctrl+S / Cmd+S 快捷保存
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void draft.flush();
    }
  };

  // 监听输入以唤起 @ 补全
  const handleBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const pos = event.target.selectionStart;
    draft.update({ body: value });

    // 检查光标前最后输入的字符
    const textBeforeCaret = value.slice(0, pos);
    const lastAtIndex = textBeforeCaret.lastIndexOf('@');

    if (lastAtIndex !== -1 && lastAtIndex >= textBeforeCaret.length - 10) {
      // 检查 @ 前是否是行首或空白
      const charBeforeAt = lastAtIndex > 0 ? textBeforeCaret[lastAtIndex - 1] : '\n';
      if (/[\s\n，。！？；：“”"]/.test(charBeforeAt || '')) {
        const query = textBeforeCaret.slice(lastAtIndex + 1);
        if (!/[\s\n]/.test(query)) {
          setMentionActive(true);
          setMentionAnchor(lastAtIndex);
          setMentionQuery(query);
          setMentionIndex(0);
          return;
        }
      }
    }

    if (mentionActive) {
      setMentionActive(false);
      setMentionAnchor(null);
    }
  };

  const [clipboardDraft, setClipboardDraft] = useState<string | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const prefRef = useRef<HTMLDivElement>(null);
  const editorMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部自动关闭编辑器“更多”菜单
  useEffect(() => {
    if (!editorMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (editorMenuRef.current && !editorMenuRef.current.contains(e.target as Node)) setEditorMenuOpen(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [editorMenuOpen]);

  // 从剪贴板采纳外部生成的内容
  const handleAdoptClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        alert('剪贴板中暂无文本可采纳。');
        return;
      }
      setClipboardDraft(text.trim());
    } catch {
      alert('请使用键盘快捷键直接粘贴。');
    }
  }, []);

  const save = useCallback(async () => { await draft.flush(); }, [draft]);
  const localText = `${draft.title}\n\n${draft.body}`;
  const statusLabel = draft.status === 'saved' ? '已保存' : draft.status === 'saving' ? '保存中…'
    : draft.status === 'dirty' ? '待保存' : draft.status === 'conflict' ? '版本冲突'
      : draft.status === 'local-only' ? '仅保存在本机' : '保存失败';

  // 汉字与字数统计及预计阅读用时
  const charCount = [...draft.body.trim()].length;
  const readMinutes = Math.max(1, Math.ceil(charCount / 400));
  const currentTheme = {
    name: themeNames[theme], paperBg: 'var(--story-paper)', textColor: 'var(--story-text)',
    mutedColor: 'var(--story-muted)', borderColor: 'var(--story-line)', bubbleBg: 'var(--story-inset)',
  };
  const currentFont = fontFamilies[font];

  return (
    <section
      aria-label="正式资料编辑器"
      onKeyDown={event => {
        if (isImeComposingEvent(event) || event.defaultPrevented) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); void draft.flush(); }
      }}
      className={`story-entry-editor flex h-full min-h-0 min-w-0 flex-col ${zenMode ? 'zen-workspace' : ''}`}
    >
      {/* 顶部现代化工具栏 */}
      <div className="story-editor-toolbar flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-2 py-1 sm:px-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="hidden text-xs font-medium text-muted sm:inline">{label} · v{entry.revision}</span>
              <span className={`max-w-16 truncate text-xs sm:max-w-none ${draft.status === 'conflict' || draft.status === 'local-only' ? 'text-danger-fg' : 'text-muted'}`} role="status">
                {statusLabel}
              </span>
            </div>
            <p className="mt-0.5 hidden text-xs text-muted font-mono sm:block">
              {charCount.toLocaleString('zh-CN')} 字 · 预计阅读 {readMinutes} 分钟
            </p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <div className="relative" ref={prefRef}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowPreferences((v) => !v)}
              title="调整纸感底色、字体与排版偏好"
              className="hidden gap-1.5 sm:inline-flex"
              aria-expanded={showPreferences}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal className="size-3.5" />
              <span>排版偏好</span>
            </Button>

            <Dialog open={showPreferences} onOpenChange={open => {
              setShowPreferences(open);
              if (!open) requestAnimationFrame(() => {
                const desktopTrigger = prefRef.current?.querySelector('button');
                if (desktopTrigger && desktopTrigger.getClientRects().length) desktopTrigger.focus();
                else editorMenuRef.current?.querySelector('button')?.focus();
              });
            }} title="排版与底色偏好" size="sm">
                {/* 纸感底色 */}
                <div className="mb-3">
                  <label className="text-sm font-medium text-muted block mb-1.5">纸感底色</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['interface', 'parchment', 'pure', 'midnight', 'sage'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={theme === t}
                        onClick={() => setTheme(t)}
                        className={`flex items-center gap-2 min-h-11 min-h-11 rounded border px-2 py-1.5 text-sm text-left transition-all ${
                          theme === t
                            ? 'border-accent bg-accent/10 font-medium text-accent shadow-sm'
                            : 'border-border-default/80 bg-surface-muted/50 text-ink hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          className="story-reading-paper size-3.5 rounded-full border border-border-subtle shrink-0"
                          data-reading-theme={t}
                          style={{ backgroundColor: 'var(--story-paper)' }}
                        />
                        <span className="truncate">{themeNames[t]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 字体家族 */}
                <div className="mb-3">
                  <label className="text-sm font-medium text-muted block mb-1.5">正文字体</label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['serif', 'kai', 'sans'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFont(f)}
                        className={`min-h-11 rounded border px-2 py-1 text-sm text-center transition-all ${
                          font === f
                            ? 'border-accent bg-accent/10 font-semibold text-accent'
                            : 'border-border-default/80 bg-surface-muted/50 text-muted hover:text-ink'
                        }`}
                      >
                        {fontFamilies[f].name.replace('思源', '')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 画布宽度 */}
                <div className="mb-3">
                  <label className="text-sm font-medium text-muted block mb-1.5">写作画布宽度</label>
                  <div className="grid grid-cols-3 gap-1">
                    {([
                      ['wide', '宽屏 (1024)'],
                      ['comfortable', '舒适 (768)'],
                      ['full', '全宽 (100%)'],
                    ] as const).map(([val, labelText]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => handleSetCanvasWidth(val)}
                        className={`min-h-11 rounded border px-1.5 py-1 text-sm text-center transition-all ${
                          canvasWidth === val
                            ? 'border-accent bg-accent/10 font-semibold text-accent'
                            : 'border-border-default/80 bg-surface-muted/50 text-muted hover:text-ink'
                        }`}
                      >
                        {labelText}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 段首缩进 */}
                <div className="pt-2 border-t border-border-default/60 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="font-medium text-ink block">段首空两格</span>
                    <span className="text-sm text-muted">正文段落缩进 2em</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={indent2em}
                    aria-label="段首空两格"
                    onClick={() => setIndent2em((prev) => !prev)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      indent2em ? 'bg-accent' : 'bg-surface-muted border-border-default'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        indent2em ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
            </Dialog>
          </div>

          {/* 视图模式切换 */}
          <div className="flex rounded-control border border-border-default p-0.5 bg-surface" role="group" aria-label="编辑器视图">
            {(
              isReflection
                ? [
                    ['source', '源码'],
                    ['split', '分屏'],
                    ['preview', '预览'],
                  ] as const
                : [
                    ['source', '源码'],
                    ['split', '分屏'],
                    ['preview', '预览'],
                    ['script', '剧本流'],
                  ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`rounded px-1.5 py-1.5 text-sm transition-colors ${
                  mode === value ? 'bg-accent/10 font-semibold text-accent' : 'text-muted hover:bg-surface-hover'
                }`}
              >
                {text}
              </button>
            ))}
          </div>
          {/* 编辑器溢出菜单：排版偏好、专注模式与衍生产物 */}
          <div className="relative" ref={editorMenuRef}>
            <Button
              size="icon"
              variant="ghost"
              aria-haspopup="menu"
              aria-expanded={editorMenuOpen}
              aria-label="更多编辑器操作"
              title="更多编辑器操作"
              onClick={() => setEditorMenuOpen((open) => !open)}
              className="text-muted hover:text-ink"
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {editorMenuOpen && (
              <div role="menu" aria-label="更多编辑器操作" className="absolute right-0 top-full z-50 mt-2 w-56 rounded-panel border border-border-subtle bg-surface p-1.5 shadow-lg">
                <button
                  type="button"
                  role="menuitem"
                  className={editorMenuClass}
                  onClick={() => { setEditorMenuOpen(false); setShowPreferences(true); }}
                >
                  <SlidersHorizontal className="size-4 text-muted" />排版与底色偏好
                </button>
                {onToggleZen && (
                  <button
                    type="button"
                    role="menuitem"
                    className={editorMenuClass}
                    onClick={() => { setEditorMenuOpen(false); onToggleZen(); }}
                  >
                    <Sparkles className="size-4 text-muted" />{zenMode ? '退出专注模式' : '专注写作模式'}
                  </button>
                )}
                {onOpenDerivatives && (
                  <button
                    type="button"
                    role="menuitem"
                    className={editorMenuClass}
                    onClick={() => { setEditorMenuOpen(false); onOpenDerivatives(); }}
                  >
                    <Film className="size-4 text-muted" />衍生产物与导出
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className={editorMenuClass}
                  disabled={!draft.dirty || draft.status === 'saving' || draft.status === 'conflict'}
                  onClick={() => { setEditorMenuOpen(false); void save(); }}
                >
                  <Save className="size-4 text-muted" />保存当前修订
                </button>
              </div>
            )}
          </div>

          <Button
            size="sm"
            variant="primary"
            className="px-2 sm:px-3"
            onClick={() => void save()}
            disabled={!draft.dirty || draft.status === 'saving' || draft.status === 'conflict'}
          >
            <Save className="size-4" />保存
          </Button>
        </div>
      </div>

      {/* 编辑器核心内容滚动区（多列高度隔离，仅自身纵向滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-1" data-autohide-scroll>
        {draft.recoveryAvailable && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-control border border-border-subtle bg-surface-sunken p-3 text-sm text-ink">
            <p className="min-w-0 flex-1">找到本机未同步的编辑文本。恢复后会先与当前服务器版本核对，不会静默覆盖。</p>
            <Button size="sm" onClick={() => void draft.recoverLocal()}><RotateCcw className="size-4" />恢复本机文本</Button>
            <Button size="sm" variant="outline" onClick={() => void draft.discardLocal()}>使用服务器版本</Button>
          </div>
        )}

        {draft.error && (
          <div role="alert" className="mb-4 rounded-control border border-border-subtle bg-surface-sunken p-3 text-sm text-ink">
            <p>{draft.error}</p>
            {draft.status === 'local-only' && <Button size="sm" variant="outline" className="mt-2" onClick={draft.retry}>重新保存</Button>}
          </div>
        )}

        {draft.status === 'conflict' && (
          <div className="mb-4 rounded-control border border-border-subtle bg-surface-sunken p-3">
            <h3 className="font-semibold text-ink">服务器与本机内容冲突</h3>
            <p className="mt-1 text-xs text-muted">服务器 v{entry.revision} 的内容不会被自动覆盖。逐项比较下方预览后，可选择丢弃本地文本，或明确确认以本地文本覆盖。</p>
            <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
              <div className="min-w-0 rounded border border-border-subtle bg-surface p-3"><b className="text-xs">服务器版本</b><div className="mt-2 max-h-56 overflow-y-auto"><StoryMarkdown source={'notes' in entry ? entry.notes : entry.body} /></div></div>
              <div className="min-w-0 rounded border border-border-subtle bg-surface p-3"><b className="text-xs">本机保留版本</b><div className="mt-2 max-h-56 overflow-y-auto"><StoryMarkdown source={draft.body} /></div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(localText).catch(() => {})}>复制本地文本</Button>
              <Button size="sm" variant="outline" onClick={() => void draft.acceptServer(entry)}>丢弃本地，使用服务器版本</Button>
              <Button size="sm" onClick={() => { if (window.confirm(`确认以本机内容覆盖服务器 v${entry.revision}？这会创建新的正式修订。`)) draft.saveLocalOverServer(entry.revision); }}>确认用本地版本覆盖服务器</Button>
            </div>
          </div>
        )}

        {/* 快捷排版工具条（仅在源码/分屏且有必要时出现） */}
        {mode !== 'preview' && mode !== 'script' && (
          <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 w-full mx-auto transition-all ${
            canvasWidth === 'full' ? 'max-w-none' : (canvasWidth === 'comfortable' ? 'max-w-3xl' : 'max-w-5xl')
          }`}>
            {showFormatBar ? (
              <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="排版工具">
                <Button size="sm" variant="ghost" title="二级标题" onClick={() => insert('## ')}><Heading2 className="size-4" /></Button>
                <Button size="sm" variant="ghost" title="粗体" onClick={() => insert('**', '**')}><Bold className="size-4" /></Button>
                <Button size="sm" variant="ghost" title="斜体" onClick={() => insert('*', '*')}><Italic className="size-4" /></Button>
                <Button size="sm" variant="ghost" title="引用" onClick={() => insert('> ')}><Quote className="size-4" /></Button>
                <Button size="sm" variant="ghost" title="列表项" onClick={() => insert('- ')}><List className="size-4" /></Button>
                <Button size="sm" variant="ghost" title="代码块" onClick={() => insert('```\n', '\n```')}><Code2 className="size-4" /></Button>
                <Button size="sm" variant="ghost" title="一键全书段首空两格" onClick={formatChineseIndentation} className="text-xs">
                  段首空两格
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="一键将剪贴板中的草稿采纳到正文"
                  onClick={() => void handleAdoptClipboard()}
                  className="text-xs gap-1 font-medium"
                >
                  <ClipboardPaste className="size-3.5" />
                  <span>采纳草稿</span>
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowFormatBar(true)}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <Type className="size-3.5" />
                <span>排版工具</span>
              </button>
            )}
            <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
              <span>输入 <code className="rounded bg-surface-sunken px-1">@</code> 快速录入角色对白</span>
            </div>
          </div>
        )}

        {/* 目录折叠面板 */}
        {headings.length > 0 && (
          <details className={`mb-4 mx-auto w-full rounded-control border border-border-default bg-surface/60 px-3 py-2 transition-all ${
            canvasWidth === 'full' ? 'max-w-none' : (canvasWidth === 'comfortable' ? 'max-w-3xl' : 'max-w-5xl')
          }`}>
            <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">章节目录（{headings.length}）</summary>
            <div className="mt-2 space-y-1">
              {headings.map((heading) => (
                <button
                  key={`${heading.line}-${heading.text}`}
                  className="block max-w-full truncate text-left text-xs text-muted hover:text-ink"
                  style={{ paddingLeft: `${(heading.depth - 1) * 12}px` }}
                  onClick={() => {
                    bodyRef.current?.focus();
                    bodyRef.current?.setSelectionRange(draft.body.split('\n').slice(0, heading.line).join('\n').length + (heading.line ? 1 : 0), draft.body.length);
                  }}
                >
                  {heading.text}
                </button>
              ))}
            </div>
          </details>
        )}

        {/* 沉浸式稿纸核心主画布 */}
        <div
          data-reading-theme={theme}
          className={`story-reading-paper relative mx-auto w-full motion-reduce:transition-none transition-colors rounded-panel p-4 sm:p-8 border ${
            mode === 'split' ? 'max-w-7xl' : (
              canvasWidth === 'full' ? 'max-w-none' : (
                canvasWidth === 'comfortable' ? 'max-w-3xl' : 'max-w-5xl'
              )
            )
          }`}
          style={{
            backgroundColor: currentTheme.paperBg,
            color: currentTheme.textColor,
            borderColor: currentTheme.borderColor,
            fontFamily: currentFont.style,
          }}
        >
          {/* 无边框典雅大标题 */}
          <input
            aria-label="条目标题"
            value={draft.title}
            maxLength={120}
            onChange={(event) => draft.update({ title: event.target.value })}
            onKeyDown={(event) => {
              if (isImeComposingEvent(event)) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                bodyRef.current?.focus();
                bodyRef.current?.setSelectionRange(0, 0);
              }
            }}
            placeholder="无标题章节…"
            className="w-full bg-transparent border-0 border-b border-transparent hover:border-border-default/50 focus:border-accent p-0 pb-2 mb-6 text-2xl sm:text-3xl font-semibold tracking-tight outline-none transition-colors"
            style={{ color: currentTheme.textColor, fontFamily: 'var(--font-sans)' }}
          />

          {/* 模式渲染分流 */}
          {mode === 'script' ? (
            /* 互动剧本流模式：对白气泡与场景分幕可视化 */
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border-default/40 pb-2 text-xs text-muted">
                <span>剧本流演出预览（已识别台词与场景）</span>
                <span>{charCount} 字</span>
              </div>
              {draft.body.split('\n').map((line, index) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={index} className="h-3" />;

                // 场景标头
                if (/^#{1,3}\s+(.+)$/.test(trimmed) || trimmed.startsWith('场景：') || trimmed.startsWith('场景:')) {
                  const sceneText = trimmed.replace(/^#{1,3}\s+/, '');
                  return (
                    <div key={index} className="my-6 flex min-w-0 items-center gap-3 break-words">
                      <div className="h-px flex-1 bg-border-default/60" />
                      <div className="flex items-center gap-1.5 rounded-full border border-border-default/80 bg-surface/80 px-3 py-1 text-xs font-semibold text-accent shadow-2xs">
                        <Film className="size-3.5" />
                        <span>{sceneText}</span>
                      </div>
                      <div className="h-px flex-1 bg-border-default/60" />
                    </div>
                  );
                }

                // 角色对白：支持 角色名：“台词” 或 角色名: “台词”
                const dialogueMatch = /^([^：“:「\n]{1,16})[：“:「]\s*(.+?)[”」"]?\s*$/.exec(trimmed);
                if (dialogueMatch) {
                  const speaker = dialogueMatch[1]!.trim();
                  const dialogue = dialogueMatch[2]!.trim();
                  const charInfo = castList.find((c) => c.name === speaker);

                  return (
                    <div key={index} className="my-3 flex items-start gap-3">
                      {/* 角色小头像 */}
                      <div className="size-8 shrink-0 rounded-full overflow-hidden border border-border-default bg-surface-muted flex items-center justify-center text-xs font-semibold text-muted shadow-2xs">
                        {charInfo?.avatarUrl ? (
                          <img src={charInfo.avatarUrl} alt="" className="size-full object-cover" />
                        ) : (
                          speaker.slice(0, 1)
                        )}
                      </div>

                      {/* 对白气泡 */}
                      <div className="min-w-0 max-w-[85%]">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-semibold text-muted">{speaker}</span>
                          {charInfo?.work && (
                            <span className="rounded border border-border-default/60 px-1 py-0.2 text-[9px] text-muted">
                              {charInfo.work}
                            </span>
                          )}
                        </div>
                        <div
                          className="rounded-control px-4 py-3 text-base leading-relaxed break-words"
                          style={{
                            backgroundColor: currentTheme.bubbleBg,
                            borderColor: currentTheme.borderColor,
                            color: currentTheme.textColor,
                          }}
                        >
                          “{dialogue}”
                        </div>
                      </div>
                    </div>
                  );
                }

                // 普通旁白与动作叙事
                return (
                  <p
                    key={index}
                    className={`break-words text-base leading-relaxed ${
                      indent2em ? 'indent-[2em]' : ''
                    }`}
                    style={{ color: currentTheme.mutedColor }}
                  >
                    {trimmed}
                  </p>
                );
              })}
            </div>
          ) : (
            /* 常规写作画布（源码 / 分屏 / 预览） */
            <div className={`grid gap-6 ${mode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
              {mode !== 'preview' && (
                <div className="relative min-w-0 flex flex-col">
                  {/* @ 角色补全浮层 */}
                  {mentionActive && filteredCast.length > 0 && (
                    <div
                      className="absolute z-30 left-4 top-12 w-64 max-h-56 overflow-y-auto rounded-lg border border-border-default bg-surface p-1.5 shadow-lg backdrop-blur"
                      role="listbox"
                      aria-label="角色对白补全"
                    >
                      <div className="px-2 py-1 text-xs font-medium text-muted border-b border-border-default/60">
                        登场角色（回车填入对白引号）
                      </div>
                      {filteredCast.map((char, idx) => (
                        <button
                          key={char.id || char.name}
                          type="button"
                          role="option"
                          aria-selected={idx === mentionIndex}
                          onMouseDown={event => event.preventDefault()}
                          onMouseEnter={() => setMentionIndex(idx)}
                          onClick={() => completeCharacterDialogue(char.name)}
                          className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            idx === mentionIndex ? 'bg-accent/15 text-accent font-semibold' : 'text-ink hover:bg-surface-hover'
                          }`}
                        >
                          <div className="size-5 shrink-0 rounded-full overflow-hidden border border-border-default bg-surface-muted flex items-center justify-center text-xs">
                            {char.avatarUrl ? (
                              <img src={char.avatarUrl} alt="" className="size-full object-cover" />
                            ) : (
                              char.name.slice(0, 1)
                            )}
                          </div>
                          <span className="truncate flex-1">{char.name}</span>
                          {char.work && (
                            <span className="shrink-0 text-xs text-muted">{char.work}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <textarea
                    ref={bodyRef}
                    data-reading-surface
                    aria-label="小说正文编辑"
                    value={draft.body}
                    onChange={handleBodyChange}
                    onKeyDown={handleKeyDown}
                    placeholder="在此倾泻思绪… 输入 @ 快捷填入登场角色对白"
                    className={`min-h-[30rem] w-full resize-none bg-transparent outline-none text-base sm:text-lg leading-[1.85] ${
                      indent2em ? 'indent-[2em]' : ''
                    }`}
                    style={{
                      color: currentTheme.textColor,
                      fontFamily: currentFont.style,
                    }}
                  />
                </div>
              )}

              {mode !== 'source' && (
                <div
                  className="min-w-0 rounded-lg p-4 text-base break-words"
                  style={{
                    backgroundColor: currentTheme.bubbleBg,
                    borderColor: currentTheme.borderColor,
                  }}
                >
                  {draft.body.trim() ? (
                    <div className={indent2em ? '[&_p]:indent-[2em]' : ''}>
                      <StoryMarkdown source={draft.body} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted">预览区将渲染小说排版效果。</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 沉浸式章节穿梭翻页条 */}
          {kind === 'chapter' && (prevChapter || nextChapter || onCreateNextChapter) && (
            <div className="mt-10 pt-6 border-t border-border-default/40 flex flex-wrap items-center justify-between gap-3 text-xs">
              {prevChapter ? (
                <button
                  type="button"
                  onClick={() => onSwitchChapter?.(prevChapter.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-border-default/60 px-3 py-1.5 text-muted hover:border-border-default hover:text-ink transition-colors"
                >
                  <ChevronLeft className="size-3.5" />
                  <span>上一章：{prevChapter.title}</span>
                </button>
              ) : <div />}

              <span className="text-xs text-muted font-mono">
                第 {(entry as StoryDocument).position + 1} 章 · {charCount} 字
              </span>

              {nextChapter ? (
                <button
                  type="button"
                  onClick={() => onSwitchChapter?.(nextChapter.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-border-default/60 px-3 py-1.5 text-muted hover:border-border-default hover:text-ink transition-colors"
                >
                  <span>下一章：{nextChapter.title}</span>
                  <ChevronRight className="size-3.5" />
                </button>
              ) : onCreateNextChapter ? (
                <button
                  type="button"
                  onClick={onCreateNextChapter}
                  className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-accent hover:bg-accent/10 transition-colors"
                >
                  <Plus className="size-3.5" />
                  <span>写下一章</span>
                </button>
              ) : <div />}
            </div>
          )}
        </div>
      </div>

      <Dialog open={clipboardDraft !== null} onOpenChange={open => { if (!open) setClipboardDraft(null); }} title="采纳剪贴板草稿"
        description="先预览内容，再选择追加或替换。取消会保留当前正文。"
        footer={<>
          <Button variant="ghost" onClick={() => setClipboardDraft(null)}>取消</Button>
          <Button variant="outline" onClick={() => {
            if (clipboardDraft === null || !window.confirm('确认替换当前全文？建议先复制保留原稿。')) return;
            draft.update({ body: clipboardDraft }); setClipboardDraft(null);
          }}>替换全文</Button>
          <Button onClick={() => {
            if (clipboardDraft === null) return;
            draft.update({ body: `${draft.body}${draft.body.trim() ? '\n\n' : ''}${clipboardDraft}` }); setClipboardDraft(null);
          }}>追加到文末</Button>
        </>}>
        <p className="max-h-64 whitespace-pre-wrap break-words text-sm text-muted">{clipboardDraft}</p>
      </Dialog>

      {/* 底部极简状态指示器 */}
      <footer className="hidden shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-2 text-xs text-muted sm:flex">
        <div className="flex flex-wrap items-center gap-2">
          <span>Ctrl/⌘+S 随时保存</span>
          <span>·</span>
          <span>当前字体：{currentFont.name}</span>
          <span>·</span>
          <span>主题：{currentTheme.name}</span>
        </div>
        <span className="hidden sm:inline font-mono">{storyEntryIdentity(entry).kind}</span>
      </footer>
    </section>
  );
}

