'use client';

import { useState, type KeyboardEvent } from 'react';
import { ArrowDown, Send, Sparkles } from 'lucide-react';
import type { SceneBrief, SceneDirection, StorySceneDraft } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { useScrollFade } from '@/app/components/ui/use-scroll-fade';
import { useScrollPinning } from '@/app/lib/hooks/use-scroll-pinning';
import { Choice, SceneInput, SceneText, surfaceClass, textClass } from './fields';
import type { SceneActionInput, SceneEdits } from './use-scene-session';

export const directionLabels: Record<SceneDirection, string> = {
  'canon-gap': '原作走向 · 补写留白', 'canon-adaptation': '原作走向 · 画面改编', if: 'IF 线', original: '原创',
};

const emptyBrief: SceneBrief = { viewpoint: '', action: '', change: '', constraints: [] };
const toLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 16);

type StageHandlers = {
  draft: StorySceneDraft;
  busy: boolean;
  edit: (patch: SceneEdits) => void;
  act: (input: SceneActionInput) => Promise<unknown>;
};

export function SceneDiscussPanel({ draft, busy, edit, act, onWrite, onManual, onFork }: StageHandlers & {
  onWrite: () => void; onManual: () => void; onFork: () => void;
}) {
  const [message, setMessage] = useState('');
  const chat = useScrollPinning([draft.messages.length]);
  useScrollFade(chat.containerRef, 'vertical', 12);
  const original = draft.character.origin === 'original';
  const isIf = draft.direction === 'if';
  const brief = draft.brief ?? emptyBrief;
  const ready = !!(brief.viewpoint.trim() && brief.action.trim() && brief.change.trim() && (!isIf || (brief.canonEvent?.trim() && brief.divergence?.trim())));
  const writeBrief = (patch: Partial<SceneBrief>) => edit({ brief: { ...brief, ...patch }, briefConfirmed: false });

  async function send() {
    const content = message.trim();
    if (busy || !content || !draft.direction) return;
    if (await act({ action: 'discuss', message: content })) setMessage(value => value.trim() === content ? '' : value);
  }

  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void send();
  }

  return <section className={`${surfaceClass} space-y-5`} aria-labelledby="scene-stage-heading">
    <header>
      <h2 id="scene-stage-heading" tabIndex={-1} className="text-lg font-semibold">讨论这一幕怎么讲</h2>
      {draft.start && <p className={`mt-1 ${textClass}`}>{draft.start.time || '时间待定'} · {draft.start.location || '地点待定'}</p>}
    </header>

    {original ? <p className="text-sm text-muted">原创走向 · 你可以把后续写作要遵守的设定写进提要。</p> : <Choice label="故事走向" name="sceneDirection" value={draft.direction} options={[
      { value: 'canon-gap', label: directionLabels['canon-gap'], description: '补上相容的动作、动机或对白' },
      { value: 'canon-adaptation', label: directionLabels['canon-adaptation'], description: '保留经过，换一种方式呈现' },
      { value: 'if', label: directionLabels.if, description: '改变一个明确的选择' },
    ]} disabled={!!draft.body.trim() || busy} onChange={direction => edit({ direction, briefConfirmed: false })} />}
    {!!draft.body.trim() && !original && <Button variant="ghost" size="sm" disabled={busy} onClick={onFork}>从这里另开一幕</Button>}
    {!!draft.messages.length && !draft.briefConfirmed && <p role="status" className="text-xs text-muted">对话已保留。写成一幕前，请确认提要仍符合当前时地和走向。</p>}

    <div className="min-w-0 space-y-3 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">讨论记录</h3>
        {chat.showJumpToBottom && <Button variant="ghost" size="sm" onClick={() => chat.scrollToBottom()}><ArrowDown className="size-4" aria-hidden="true" />跳到最新</Button>}
      </div>
      {!draft.messages.length && <p className={textClass}>让 AI 给出几个讲法，或先说说你想看的动作、视角与情绪。</p>}
      <div ref={chat.containerRef} tabIndex={draft.messages.length ? 0 : undefined} data-autohide-scroll data-scroll-fade="vertical" aria-label="讨论消息" className="max-h-[min(24rem,45dvh)] min-w-0 space-y-3 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] [--scroll-fade-size:12px]">
        {draft.messages.map(item => <article key={item.id} className={`min-w-0 rounded-control p-3 ${item.role === 'author' ? 'ms-5 bg-[var(--selection-bg)]' : 'me-2 bg-surface-sunken/60'}`}>
          <p className="mb-1 text-xs font-medium text-muted">{item.role === 'author' ? '你' : 'AI'}</p>
          <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{item.text}</p>
          {item.approaches?.map(approach => <div key={approach.id} className="mt-3 border-t border-hairline pt-2">
            <p className="wrap-anywhere text-sm font-medium">{approach.title}</p>
            <p className={`mt-1 wrap-anywhere ${textClass}`}>{approach.description}</p>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => edit({ brief: approach.brief, briefConfirmed: false })}>用这个讲法</Button>
          </div>)}
          {item.suggestedBrief && <Button variant="ghost" size="sm" disabled={busy} onClick={() => edit({ brief: item.suggestedBrief, briefConfirmed: false })}>将建议填入提要</Button>}
        </article>)}
      </div>
      <SceneText label="反馈给 AI" name="chatMessage" maxLength={8000} rows={2} placeholder="例如：换成主角视角，保留见面，收掉旁白。" value={message} onChange={event => setMessage(event.target.value)} onKeyDown={sendOnEnter} />
      <div className="flex flex-wrap justify-end gap-2">
        {!draft.messages.length && <Button variant="secondary" disabled={busy || !draft.direction} onClick={() => void act({ action: 'discuss' })}><Sparkles className="size-4" aria-hidden="true" />想几个讲法</Button>}
        <Button variant="secondary" disabled={busy || !draft.direction || !message.trim()} onClick={() => void send()}><Send className="size-4" aria-hidden="true" />发送</Button>
      </div>
    </div>

    <div className="space-y-4 border-t border-hairline pt-4">
      <h3 className="text-base font-semibold">创作提要</h3>
      {isIf && <div className="grid gap-3 sm:grid-cols-2">
        <SceneText label="原来发生了什么" name="canonEvent" maxLength={2000} value={brief.canonEvent ?? ''} onChange={event => writeBrief({ canonEvent: event.target.value })} />
        <SceneText label="这次改变哪一件事" name="divergence" maxLength={2000} value={brief.divergence ?? ''} onChange={event => writeBrief({ divergence: event.target.value })} />
      </div>}
      <SceneInput label="视角人物" name="viewpoint" maxLength={240} value={brief.viewpoint} onChange={event => writeBrief({ viewpoint: event.target.value })} />
      <SceneText label="这一幕的行动或选择" name="briefAction" maxLength={2000} value={brief.action} onChange={event => writeBrief({ action: event.target.value })} />
      <SceneText label="结束时的变化" name="briefChange" maxLength={2000} value={brief.change} onChange={event => writeBrief({ change: event.target.value })} />
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm font-medium">创作约束{brief.constraints.length || draft.lockedConstraints.length ? `（${brief.constraints.length + draft.lockedConstraints.length}）` : ''}</summary>
        <LinesField label="需要遵守的约束（每行一条）" name="briefConstraints" lines={brief.constraints} onChange={constraints => writeBrief({ constraints })} />
        <LinesField label="作者锁定的设定（每行一条）" name="lockedConstraints" lines={draft.lockedConstraints} onChange={lockedConstraints => edit({ lockedConstraints })} />
      </details>
      <Choice label="正文形式" name="sceneFormat" value={draft.format} options={[{ value: 'story', label: '短故事' }, { value: 'script', label: '短剧本' }]} onChange={format => edit({ format })} disabled={busy} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy || !draft.direction} onClick={onManual}>手写正文</Button>
        <Button variant="primary" disabled={busy || !draft.direction || !ready} onClick={onWrite}><Sparkles className="size-4" aria-hidden="true" />写成一幕</Button>
      </div>
    </div>
  </section>;
}

function LinesField({ label, name, lines, onChange }: { label: string; name: string; lines: string[]; onChange: (lines: string[]) => void }) {
  const [value, setValue] = useState<string>();
  return <SceneText label={label} name={name} value={value ?? lines.join('\n')} maxLength={32000} onChange={event => {
    const text = event.target.value;
    setValue(text);
    onChange(toLines(text).map(line => line.slice(0, 2000)));
  }} onBlur={() => setValue(undefined)} />;
}

export function SceneWritingPanel({ draft, busy, edit, act, onImage }: StageHandlers & { onImage: () => void }) {
  const [instruction, setInstruction] = useState('');
  const candidate = draft.writingCandidate;
  return <section className={`${surfaceClass} space-y-4`} aria-labelledby="scene-stage-heading">
    <header><h2 id="scene-stage-heading" tabIndex={-1} className="text-lg font-semibold">写成一幕</h2><p className={`mt-1 ${textClass}`}>正文支持 Markdown，标题和正文会自动保存。</p></header>
    <SceneText label="正文" name="sceneBody" className="min-h-72 !text-base !leading-relaxed" rows={14} maxLength={60000} value={draft.body} onChange={event => edit({ body: event.target.value })} />
    {candidate && <div className="space-y-3 rounded-control bg-surface-sunken/65 p-3">
      <h3 className="text-base font-semibold">改写候选</h3>
      <p tabIndex={0} className="max-h-96 overflow-y-auto whitespace-pre-wrap wrap-anywhere text-base leading-relaxed">{candidate.body}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => edit({ writingCandidateDecision: { id: candidate.id, decision: 'accept' } })}>替换正文</Button>
        <Button variant="ghost" disabled={busy} onClick={() => edit({ writingCandidateDecision: { id: candidate.id, decision: 'discard' } })}>舍弃候选</Button>
      </div>
    </div>}
    {draft.briefConfirmed && <details className="space-y-3 border-t border-hairline pt-4">
      <summary className="cursor-pointer text-sm font-medium">{draft.body.trim() ? '请 AI 改写' : '请 AI 起草'}</summary>
      <SceneText label="写作补充指示（可选）" name="rewriteInstruction" maxLength={2000} rows={2} value={instruction} onChange={event => setInstruction(event.target.value)} />
      <Button variant="secondary" disabled={busy || !!candidate} onClick={() => void act({ action: 'write', instruction: instruction.trim() || undefined })}>{draft.body.trim() ? '生成改写候选' : '生成正文'}</Button>
    </details>}
    {!draft.briefConfirmed && <Alert variant="info" title="可以直接手写">需要 AI 起草时，返回「讨论讲法」确认创作提要。</Alert>}
    <div className="flex justify-end"><Button variant="primary" disabled={!draft.body.trim() || busy} onClick={onImage}>前往画面设计</Button></div>
  </section>;
}
