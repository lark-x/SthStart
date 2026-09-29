'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Code2, Heading2, Italic, List, Quote, RotateCcw, Save } from 'lucide-react';
import type { StoryEntry } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { StoryMarkdown } from './story-markdown';
import { storyEntryIdentity, useStoryEntryDraft } from './use-story-entry-draft';

type ViewMode = 'source' | 'preview' | 'split';

export function StoryEntryEditor({ projectId, entry, onSaved, onConflict, onRegisterFlush }: {
  projectId: string; entry: StoryEntry; onSaved: (entry: StoryEntry) => void; onConflict: () => void;
  onRegisterFlush: (flush: () => Promise<boolean>) => void;
}) {
  const draft = useStoryEntryDraft(projectId, entry, onSaved, onConflict);
  useEffect(() => { onRegisterFlush(draft.flush); return () => onRegisterFlush(async () => true); }, [draft.flush, onRegisterFlush]);
  const [mode, setMode] = useState<ViewMode>('source');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isCharacter = 'name' in entry;
  const kind = isCharacter ? 'character' : entry.kind;
  const label = ({ outline: '大纲', world: '世界观', scene: '场景', chapter: '章节', character: '角色设定' } as const)[kind];
  const headings = useMemo(() => draft.body.split('\n').flatMap((line, index) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    return match ? [{ line: index, text: match[2]!, depth: match[1]!.length }] : [];
  }), [draft.body]);

  const insert = useCallback((prefix: string, suffix = '') => {
    const textarea = bodyRef.current;
    if (!textarea) { draft.update({ body: `${draft.body}${draft.body.endsWith('\n') || !draft.body ? '' : '\n'}${prefix}${suffix}` }); return; }
    const start = textarea.selectionStart; const end = textarea.selectionEnd;
    const selected = draft.body.slice(start, end);
    const replacement = `${prefix}${selected || (suffix ? '文本' : '')}${suffix}`;
    const next = `${draft.body.slice(0, start)}${replacement}${draft.body.slice(end)}`;
    draft.update({ body: next });
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selected || (suffix ? '文本' : '')).length); });
  }, [draft]);

  const save = useCallback(async () => { await draft.flush(); }, [draft]);
  const localText = `${draft.title}\n\n${draft.body}`;
  const statusLabel = draft.status === 'saved' ? '已保存' : draft.status === 'saving' ? '保存中…'
    : draft.status === 'dirty' ? '待保存' : draft.status === 'conflict' ? '版本冲突'
      : draft.status === 'local-only' ? '仅保存在本机' : '保存失败';

  return <section aria-label="正式资料编辑器" className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-default pb-3">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-accent">{label} · v{entry.revision}</p>
        <p className={`mt-1 text-xs ${draft.status === 'conflict' || draft.status === 'local-only' ? 'text-amber-800' : 'text-muted'}`} role="status">{statusLabel}</p></div>
      <div className="flex items-center gap-2">
        <div className="flex rounded-[var(--radius-control)] border border-border-default p-0.5" role="group" aria-label="编辑器视图">
          {([['source', '源码'], ['split', '分屏'], ['preview', '预览']] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded px-2 py-1 text-xs ${mode === value ? 'bg-accent/10 font-semibold text-accent' : 'text-muted hover:bg-surface-hover'}`}>{text}</button>)}
        </div>
        <Button size="sm" onClick={() => void save()} disabled={!draft.dirty || draft.status === 'saving' || draft.status === 'conflict'}><Save className="size-4" />保存</Button>
      </div>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto py-4" data-autohide-scroll>
      {draft.recoveryAvailable && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="min-w-0 flex-1">找到本机未同步的编辑文本。恢复后会先与当前服务器版本核对，不会静默覆盖。</p>
        <Button size="sm" onClick={() => void draft.recoverLocal()}><RotateCcw className="size-4" />恢复本机文本</Button>
        <Button size="sm" variant="outline" onClick={() => void draft.discardLocal()}>使用服务器版本</Button>
      </div>}
      {draft.error && <div role="alert" className="mb-4 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p>{draft.error}</p>
        {draft.status === 'local-only' && <Button size="sm" variant="outline" className="mt-2" onClick={draft.retry}>重新保存</Button>}
      </div>}
      {draft.status === 'conflict' && <div className="mb-4 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3">
        <h3 className="font-semibold text-amber-950">服务器与本机内容冲突</h3>
        <p className="mt-1 text-xs text-amber-900">服务器 v{entry.revision} 的内容不会被自动覆盖。逐项比较下方预览后，可选择丢弃本地文本，或明确确认以本地文本覆盖。</p>
        <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
          <div className="min-w-0 rounded border border-amber-300 bg-surface p-3"><b className="text-xs">服务器版本</b><div className="mt-2 max-h-56 overflow-y-auto"><StoryMarkdown source={'notes' in entry ? entry.notes : entry.body} /></div></div>
          <div className="min-w-0 rounded border border-amber-300 bg-surface p-3"><b className="text-xs">本机保留版本</b><div className="mt-2 max-h-56 overflow-y-auto"><StoryMarkdown source={draft.body} /></div></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(localText).catch(() => {})}>复制本地文本</Button>
          <Button size="sm" variant="outline" onClick={() => void draft.acceptServer(entry)}>丢弃本地，使用服务器版本</Button>
          <Button size="sm" onClick={() => { if (window.confirm(`确认以本机内容覆盖服务器 v${entry.revision}？这会创建新的正式修订。`)) draft.saveLocalOverServer(entry.revision); }}>确认用本地版本覆盖服务器</Button>
        </div>
      </div>}

      <Input aria-label="条目标题" value={draft.title} maxLength={120} onChange={(event) => draft.update({ title: event.target.value })} className="mb-3 text-xl font-semibold" />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {mode !== 'preview' ? <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Markdown 插入工具">
          <Button size="sm" variant="ghost" title="二级标题" onClick={() => insert('## ')}><Heading2 className="size-4" /></Button>
          <Button size="sm" variant="ghost" title="粗体" onClick={() => insert('**', '**')}><Bold className="size-4" /></Button>
          <Button size="sm" variant="ghost" title="斜体" onClick={() => insert('*', '*')}><Italic className="size-4" /></Button>
          <Button size="sm" variant="ghost" title="引用" onClick={() => insert('> ')}><Quote className="size-4" /></Button>
          <Button size="sm" variant="ghost" title="列表项" onClick={() => insert('- ')}><List className="size-4" /></Button>
          <Button size="sm" variant="ghost" title="代码块" onClick={() => insert('```\n', '\n```')}><Code2 className="size-4" /></Button>
        </div> : <span className="text-xs text-muted">Markdown 预览</span>}
        <span className="text-xs text-muted">{[...draft.body].length.toLocaleString('zh-CN')} 字 · {draft.body.split('\n').length} 行</span>
      </div>
      {headings.length > 0 && <details className="mb-3 rounded-[var(--radius-control)] border border-border-default px-3 py-2 lg:hidden"><summary className="cursor-pointer text-xs font-medium">章节目录（{headings.length}）</summary><div className="mt-2 space-y-1">{headings.map((heading) => <button key={`${heading.line}-${heading.text}`} className="block max-w-full truncate text-left text-xs text-muted hover:text-accent" style={{ paddingLeft: `${(heading.depth - 1) * 12}px` }} onClick={() => { bodyRef.current?.focus(); bodyRef.current?.setSelectionRange(draft.body.split('\n').slice(0, heading.line).join('\n').length + (heading.line ? 1 : 0), draft.body.length); }}>{heading.text}</button>)}</div></details>}
      <div className={`grid min-h-[26rem] gap-4 ${mode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
        {mode !== 'preview' && <textarea ref={bodyRef} aria-label="Markdown 正文源码" value={draft.body} onChange={(event) => draft.update({ body: event.target.value })}
          onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }}
          className="min-h-[26rem] w-full resize-y rounded-[var(--radius-control)] border border-border-control bg-surface p-4 font-mono text-sm leading-7 outline-none focus:border-accent" placeholder="在这里整理正式设定…" />}
        {mode !== 'source' && <div className="min-w-0 rounded-[var(--radius-control)] border border-border-default bg-surface p-4">
          {draft.body.trim() ? <StoryMarkdown source={draft.body} /> : <p className="text-sm text-muted">预览区会显示 Markdown 标题、表格、清单、引用与代码。</p>}
        </div>}
      </div>
    </div>
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-default pt-3 text-xs text-muted">
      <span>编辑内容只在点击保存／自动保存成功后成为正式资料；Ctrl/⌘+S 可立即保存。</span>
      <span className="hidden sm:inline">{storyEntryIdentity(entry).kind}</span>
    </footer>
  </section>;
}
