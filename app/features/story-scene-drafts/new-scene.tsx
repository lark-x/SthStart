'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Check, Sparkles } from 'lucide-react';
import type { CharacterProfile, CharacterWork, CreateStorySceneDraft, SceneCharacter } from '@sthstart/contracts';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';
import { Alert } from '@/app/components/ui/alert';
import { useCharacterBrowser } from '@/app/features/characters/public';
import { generateId } from '@/app/lib/uuid';
import { createSceneDraft, sceneHref, sceneKeys } from './api';
import { Choice, Field, SceneInput, SceneText, surfaceClass, textClass } from './fields';

const originLabels = { gi: '原神', hsr: '崩坏：星穹铁道', other: '其他作品', original: '原创' } as const;

function inferOrigin(profile: CharacterProfile, works: CharacterWork[] = []): SceneCharacter['origin'] {
  if (profile.draft.originType === 'original') return 'original';
  const name = profile.draft.work;
  const origin = works.find(work => work.name === name || work.aliases.includes(name));
  const work = [name, origin?.parentWork, ...(origin?.aliases ?? [])].filter(Boolean).join(' ');
  if (/原神|genshin/i.test(work)) return 'gi';
  if (/星穹铁道|star\s*rail/i.test(work)) return 'hsr';
  return 'other';
}

export function NewSceneDraft() {
  const router = useRouter();
  const client = useQueryClient();
  const [entry, setEntry] = useState<'library' | 'manual'>('library');
  const [picked, setPicked] = useState<CharacterProfile>();
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState<SceneCharacter['origin']>('original');
  const [work, setWork] = useState('');
  const [setting, setSetting] = useState('');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ serialized: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const library = useCharacterBrowser({ pageSize: 12, collapseDerivatives: false }, entry === 'library');
  const pickedOrigin = picked && inferOrigin(picked, library.facets?.works);
  const manualOrigin = entry === 'manual' ? origin : pickedOrigin;

  async function submit(intent: 'discover' | 'manual') {
    if (inFlight.current) return;
    const character: SceneCharacter | undefined = entry === 'library'
      ? picked && pickedOrigin && { id: picked.id, name: picked.displayName, work: picked.draft.work || undefined, origin: pickedOrigin }
      : name.trim() ? { name: name.trim(), origin, work: (origin === 'gi' || origin === 'hsr' ? originLabels[origin] : work.trim()) || undefined } : undefined;
    if (!character) {
      setError(entry === 'library' ? '请先从角色库选择角色。' : '请输入角色名。');
      return;
    }
    if (setting.trim() && character.origin === 'original') character.setting = setting.trim();
    const payload = { character, notes: notes.trim() || undefined, start: time.trim() || location.trim() ? { time: time.trim(), location: location.trim() } : undefined } satisfies Omit<Extract<CreateStorySceneDraft, { character: unknown }>, 'idempotencyKey'>;
    const serialized = JSON.stringify(payload);
    if (attempt.current?.serialized !== serialized) attempt.current = { serialized, key: generateId() };
    setError('');
    inFlight.current = true;
    setBusy(true);
    try {
      const draft = await createSceneDraft({ ...payload, idempotencyKey: attempt.current.key });
      client.setQueryData(sceneKeys.detail(draft.id), draft);
      void client.invalidateQueries({ queryKey: sceneKeys.list });
      try { sessionStorage.setItem(`sthstart:scene-discover:${draft.id}`, intent); } catch { /* workspace can initiate discovery */ }
      router.replace(sceneHref(draft.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存草稿失败，请重试。');
      setBusy(false);
      inFlight.current = false;
    }
  }

  return <PageContainer className="py-5 sm:py-8">
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/apps/story-worlds" className={buttonVariants({ variant: 'ghost', size: 'sm' })}><ArrowLeft className="size-4" aria-hidden="true" />返回作品目录</Link>
      <PageHeader title="新建一幕" />
      <p className={textClass}>从一个角色开始。时间、地点和想写的事可以留到下一步。</p>
      <section aria-label="选择角色" className={`${surfaceClass} space-y-4`}>
        <Choice label="角色来源" name="characterSource" value={entry} options={[{ value: 'library', label: '从角色库挑选' }, { value: 'manual', label: '手输角色名' }]} onChange={value => { setEntry(value); setError(''); }} disabled={busy} />
        {entry === 'library' ? <>
          <search><SceneInput label="搜索角色库" name="characterSearch" type="search" value={library.filter.q ?? ''} onChange={event => library.change({ q: event.target.value })} placeholder="按角色名、别名搜索" /></search>
          {picked && <p className="flex flex-wrap items-center gap-2 text-sm"><Check className="size-4 text-accent" aria-hidden="true" />已选 {picked.displayName} <span className="text-muted">{picked.draft.work || '未设作品'}</span></p>}
          {(library.isFetching || library.isSearchPending) && <p role="status" className={textClass}>正在查找角色…</p>}
          {library.isError && <p role="status" className={textClass}>角色库暂时无法读取。你可以手输角色名，或 <Button size="sm" variant="ghost" onClick={() => void library.refetch()}>重试</Button>。</p>}
          {library.isSuccess && !library.isFetching && !library.data?.items.length && <p className={textClass}>没有匹配的角色。试试别名，或手输角色名。</p>}
          <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
            {library.data?.items.filter(profile => !profile.archived).slice(0, 8).map(profile => <li key={profile.id} className="min-w-0">
              <button type="button" aria-pressed={picked?.id === profile.id} disabled={busy || library.isSearchPending || library.isPlaceholderData} onClick={() => { setPicked(profile); setError(''); }} className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-control bg-surface-sunken/55 p-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus-ring aria-pressed:bg-[var(--selection-bg)]">
                <BookOpen className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">{profile.displayName}<span className="block text-xs font-normal text-muted">{profile.draft.work || '未设作品'}</span></span>
                {picked?.id === profile.id && <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />}
              </button>
            </li>)}
          </ul>
          {library.data && library.data.total > 8 && <p className="text-xs text-muted">已显示前八个结果。输入作品或角色名可进一步筛选。</p>}
        </> : <div className="grid gap-4 sm:grid-cols-2">
          <SceneInput label="角色名（必填）" name="characterName" required maxLength={160} value={name} onChange={event => { setName(event.target.value); setError(''); }} disabled={busy} />
          <Field label="所属作品类型">{id => <Select id={id} name="origin" value={origin} onChange={event => setOrigin(event.target.value as SceneCharacter['origin'])} disabled={busy}>
            {Object.entries(originLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>}</Field>
          {(origin === 'other' || origin === 'original') && <SceneInput label="作品名（可选）" name="work" maxLength={240} value={work} disabled={busy} onChange={event => setWork(event.target.value)} />}
        </div>}
        {manualOrigin === 'original' && <SceneText label="一句角色设定（可选）" name="setting" rows={2} maxLength={2000} value={setting} disabled={busy} onChange={event => setSetting(event.target.value)} />}
      </section>
      <details className={`${surfaceClass} space-y-4`}>
        <summary className="w-fit cursor-pointer text-sm font-medium">添加时地线索或笔记</summary>
        <div className="grid gap-4 sm:grid-cols-2">
          <SceneInput label="时间（可选）" name="initialTime" maxLength={240} value={time} disabled={busy} onChange={event => setTime(event.target.value)} />
          <SceneInput label="地点（可选）" name="initialLocation" maxLength={240} value={location} disabled={busy} onChange={event => setLocation(event.target.value)} />
        </div>
        <SceneText label="笔记（可选）" name="notes" rows={2} maxLength={2000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} />
      </details>
      {error && <Alert variant="danger" title="暂时无法开始">{error}</Alert>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void submit('manual')}>手动填写</Button>
        <Button variant="primary" loading={busy} onClick={() => void submit('discover')}><Sparkles className="size-4" aria-hidden="true" />联想时地</Button>
      </div>
    </div>
  </PageContainer>;
}
