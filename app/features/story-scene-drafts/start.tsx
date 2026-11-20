'use client';

import { useMemo, useState } from 'react';
import { BookOpen, MapPin, Sparkles } from 'lucide-react';
import type { SceneCandidate, SceneEvidence, SceneSource, StorySceneDraft } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { SceneInput, SceneText, surfaceClass, textClass } from './fields';
import type { SceneActionInput, SceneEdits } from './use-scene-session';
import { referenceText } from './reference-text';

const evidenceLabels = { supported: '有据', inferred: '推测', unconfirmed: '待确认', author: '作者指定' };
const sourceLabels = { canon: '原作', secondary: '二手资料', unknown: '出处性质待确认', author: '作者提供' };

function Evidence({ title, evidence, sources, showSource }: { title: string; evidence: SceneEvidence; sources: SceneSource[]; showSource: (id: string) => void }) {
  return <div className="space-y-1">
    <p className="flex flex-wrap items-center gap-2 text-sm"><strong className="font-medium">{title}</strong><Badge variant="outline">{evidenceLabels[evidence.status]}</Badge></p>
    {evidence.note && <p className="text-xs leading-relaxed text-muted">{evidence.note}</p>}
    <div className="flex flex-wrap gap-1">
      {evidence.sourceIds.map(id => {
        const source = sources.find(item => item.id === id);
        return source && <Button key={id} variant="ghost" size="sm" className="max-w-full whitespace-normal text-left [&_.mantine-Button-label]:whitespace-normal" onClick={() => showSource(id)}><BookOpen className="size-3.5 shrink-0" aria-hidden="true" />{source.title}</Button>;
      })}
    </div>
  </div>;
}

export function ReferenceSources({ sources, activeId }: { sources: SceneSource[]; activeId: string | null }) {
  const cards = useMemo(() => sources.map(source => ({ ...source, excerpt: referenceText(source.excerpt), fullText: source.fullText && referenceText(source.fullText) })), [sources]);
  const selected = cards.some(source => source.id === activeId) ? activeId : cards[0]?.id;
  if (!sources.length) return <p className={textClass}>这里会显示时地候选引用的原文行段。你也可以在「选时地」贴入自己的资料。</p>;
  return <div className="space-y-2" aria-label="原文出处">
    {cards.map(source => <details key={`${source.id}:${activeId}`} open={selected === source.id || undefined} className="min-w-0 rounded-control bg-surface-sunken/60 px-3 py-2.5">
      <summary className="cursor-pointer wrap-anywhere text-sm font-medium">{source.title}</summary>
      <p className="mt-2 wrap-anywhere text-xs leading-relaxed text-muted">{[sourceLabels[source.kind], source.work, source.locator, `第 ${source.startLine}–${source.endLine} 行`].filter(Boolean).join(' · ')}</p>
      <blockquote className="mt-2 border-s-2 border-border-default ps-3 text-base leading-relaxed whitespace-pre-wrap wrap-anywhere">{source.excerpt.length > 480 ? `${source.excerpt.slice(0, 480)}…` : source.excerpt}</blockquote>
      {source.excerpt.length > 480 && <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">查看引用行段</summary>
        <blockquote className="mt-2 border-s-2 border-border-default ps-3 text-base leading-relaxed whitespace-pre-wrap wrap-anywhere">{source.excerpt}</blockquote>
      </details>}
      {source.fullText ? <details className="mt-3 border-t border-hairline pt-3">
        <summary className="cursor-pointer text-sm font-medium">{source.fullTextComplete ? '查看完整原文' : '查看已记录原文'}<span className="ms-2 text-xs font-normal text-muted">{source.fullText.length.toLocaleString('zh-CN')} 字符</span></summary>
        {source.fullTextComplete === false && <p className="mt-2 text-xs leading-relaxed text-muted">本次记录达到读取上限，详情显示已取得的原文。</p>}
        <blockquote className="mt-3 border-s-2 border-border-default ps-3 text-base leading-relaxed whitespace-pre-wrap wrap-anywhere">{source.fullText}</blockquote>
      </details> : <p className="mt-3 text-xs leading-relaxed text-muted">这份资料仅保存了引用行段，可更新参考资料以读取原文。</p>}
    </details>)}
  </div>;
}

type Start = NonNullable<SceneEdits['start']>;
export function SceneStartPanel({ draft, busy, edit, act, showSource, onConfirm, onFork }: {
  draft: StorySceneDraft; busy: boolean; edit: (patch: SceneEdits) => void;
  act: (input: SceneActionInput) => void; showSource: (id: string) => void;
  onConfirm: (start: Start) => void; onFork: () => void;
}) {
  const [selected, setSelected] = useState<Start>(() => draft.start ?? { time: '', location: '', hook: '' });
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceLocator, setSourceLocator] = useState('');
  const readonly = !!draft.body.trim();
  const original = draft.character.origin === 'original';
  const failedDiscovery = draft.discovery && draft.discovery.status !== 'ready';
  const originalChoice = draft.candidates.find(candidate => candidate.id === selected.candidateId) ?? (draft.start?.candidateId === selected.candidateId ? draft.start : undefined);
  const choose = (candidate: SceneCandidate) => setSelected({ candidateId: candidate.id, time: candidate.time, location: candidate.location, hook: candidate.hook });

  return <section className={`${surfaceClass} space-y-5`} aria-labelledby="scene-stage-heading">
    <header className="space-y-1">
      <h2 tabIndex={-1} id="scene-stage-heading" className="text-lg font-semibold">为 {draft.character.name} 选时地</h2>
      <p className={textClass}>挑一个值得写的瞬间。时间可以用相对描述，地点不确定时可以留空。</p>
    </header>
    {failedDiscovery && <Alert variant="warning" title="资料检索需要补充">{draft.discovery?.message}</Alert>}
    {!readonly && <div className="flex flex-wrap gap-2">
      <Button variant={draft.candidates.length ? 'secondary' : 'primary'} disabled={busy} onClick={() => act({ action: 'discover' })}><Sparkles className="size-4" aria-hidden="true" />{draft.discovery ? '重试检索' : '联想时地'}</Button>
      {(failedDiscovery || original || draft.character.origin === 'other') && <Button variant="ghost" disabled={busy} onClick={() => act({ action: 'discover', hypothesis: true })}>联想创作假设</Button>}
    </div>}
    {draft.candidates.length > 0 && <div className="grid gap-2">
      {draft.candidates.map(candidate => <article key={candidate.id} className="min-w-0 space-y-2 rounded-control bg-surface-sunken/55 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="flex items-start gap-2 text-base font-semibold"><MapPin className="mt-1 size-4 shrink-0 text-muted" aria-hidden="true" /><span className="wrap-anywhere">{candidate.location || '地点待定'} <span className="font-normal text-muted">· {candidate.time || '时间待定'}</span></span></h3>
          {!readonly && <Button size="sm" variant={selected.candidateId === candidate.id ? 'secondary' : 'ghost'} aria-pressed={selected.candidateId === candidate.id} onClick={() => choose(candidate)}>{selected.candidateId === candidate.id ? '已选这组' : '选这组时地'}</Button>}
        </div>
        {candidate.hook && <p className={textClass}>{candidate.hook}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Evidence title="时间依据" evidence={candidate.timeEvidence} sources={draft.sources} showSource={showSource} />
          <Evidence title="地点依据" evidence={candidate.locationEvidence} sources={draft.sources} showSource={showSource} />
        </div>
      </article>)}
    </div>}

    <div className="space-y-3 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">当前时地</h3>
        {!readonly && selected.candidateId && <Button variant="ghost" size="sm" onClick={() => setSelected({ time: '', location: '', hook: '' })}>手动填写</Button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <SceneInput label="时间" name="sceneTime" maxLength={240} value={selected.time} readOnly={readonly} placeholder="例如：越狱前夜" onChange={event => setSelected({ ...selected, time: event.target.value })} />
          {originalChoice && <Evidence title="当前时间" evidence={selected.time.trim() === originalChoice.time ? originalChoice.timeEvidence : { ...originalChoice.timeEvidence, status: 'author' }} sources={draft.sources} showSource={showSource} />}
        </div>
        <div className="min-w-0 space-y-1">
          <SceneInput label="地点" name="sceneLocation" maxLength={240} value={selected.location} readOnly={readonly} placeholder="留空即地点待定" onChange={event => setSelected({ ...selected, location: event.target.value })} />
          {originalChoice && <Evidence title="当前地点" evidence={selected.location.trim() === originalChoice.location ? originalChoice.locationEvidence : { ...originalChoice.locationEvidence, status: 'author' }} sources={draft.sources} showSource={showSource} />}
        </div>
      </div>
      <SceneText label="想写的一件事（可选）" name="sceneHook" rows={2} maxLength={2000} value={selected.hook ?? ''} readOnly={readonly} onChange={event => setSelected({ ...selected, hook: event.target.value })} />
      <div className="flex flex-wrap justify-end gap-2">
        {readonly ? <Button variant="primary" disabled={busy} onClick={onFork}>从这里另开一幕</Button> : <Button variant="primary" disabled={busy} onClick={() => onConfirm({ ...selected, time: selected.time.trim(), location: selected.location.trim(), hook: selected.hook?.trim() ?? '' })}>确认时地</Button>}
      </div>
    </div>
    <details className="space-y-3 border-t border-hairline pt-4">
      <summary className="cursor-pointer text-sm font-medium">贴入资料{draft.authorSources.length ? `（${draft.authorSources.length}）` : ''}</summary>
      {draft.authorSources.map((source, index) => <div key={`${source.title}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-sunken/70 p-2 text-sm"><span className="min-w-0 wrap-anywhere">{source.title} · 作者提供{source.locator && ` · ${source.locator}`}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => edit({ authorSources: draft.authorSources.filter((_, itemIndex) => itemIndex !== index) })}>移除资料</Button></div>)}
      {draft.authorSources.length < 8 && <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SceneInput label="资料标题" name="sourceTitle" maxLength={240} value={sourceTitle} onChange={event => setSourceTitle(event.target.value)} />
          <SceneInput label="出处说明（可选）" name="sourceLocator" maxLength={240} value={sourceLocator} onChange={event => setSourceLocator(event.target.value)} />
        </div>
        <SceneText label="资料内容" name="sourceText" maxLength={12000} rows={4} value={sourceText} onChange={event => setSourceText(event.target.value)} />
        <Button variant="secondary" disabled={busy || !sourceTitle.trim() || !sourceText.trim()} onClick={() => {
          edit({ authorSources: [...draft.authorSources, { title: sourceTitle.trim(), text: sourceText.trim(), ...(sourceLocator.trim() ? { locator: sourceLocator.trim() } : {}) }] });
          setSourceTitle(''); setSourceText(''); setSourceLocator('');
        }}>添加资料</Button>
      </div>}
    </details>
  </section>;
}
