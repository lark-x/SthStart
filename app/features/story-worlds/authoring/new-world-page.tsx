'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkNature } from '@sthstart/contracts';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { FormField } from '@/app/components/ui/form-field';
import { useCharacterBrowser } from '@/app/features/characters/public';
import { parseAuthoringEnvelope, WORLD_AUTHORING_STORAGE_PREFIX } from './model';
import { createWorldSetup, pendingWorldsKey } from './setup-api';
import { storyWorldKeys } from '../query-keys';
import { WorldAuthoringPage } from './world-authoring-page';

export function NewWorldPage() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get('projectId');
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [workNature, setWorkNature] = useState<WorkNature>('original');
  const [parentWork, setParentWork] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const worksBrowser = useCharacterBrowser({ page: 1, pageSize: 20 }, workNature === 'derivative');
  const canonWorks = useMemo(
    () => (worksBrowser.facets?.works || []).filter((w) => w.workNature !== 'derivative'),
    [worksBrowser.facets],
  );
  const [oldDraft, setOldDraft] = useState(false);
  const busy = useRef(false);
  const composing = useRef(false);
  const attempt = useRef<{ title: string; key: string } | null>(null);
  const key = 'sthstart:story-worlds:quick-create';

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (typeof saved?.title === 'string' && typeof saved?.key === 'string') {
        attempt.current = saved;
        // One-time session restore; later edits never depend on this effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTitle((current) => current || saved.title);
      }
      const legacy = parseAuthoringEnvelope(sessionStorage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'create'));
      setOldDraft(Boolean(legacy?.isDirty || legacy?.suggestion));
    } catch { /* session storage is optional */ }
  }, []);

  if (params.get('resume') === '1' && oldDraft) return <WorldAuthoringPage />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || composing.current) return;
    const name = title.trim();
    if (!name) { setError('请输入世界名称。'); return; }
    busy.current = true;
    setSaving(true);
    setError('');
    if (attempt.current?.title !== name) attempt.current = { title: name, key: crypto.randomUUID() };
    try { sessionStorage.setItem(key, JSON.stringify(attempt.current)); } catch { /* optional */ }
    try {
      const setup = await createWorldSetup({
        title: name,
        idempotencyKey: attempt.current.key,
        workNature,
        ...(workNature === 'derivative' ? { parentWork: parentWork.trim() || null } : {}),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pendingWorldsKey }),
        queryClient.invalidateQueries({ queryKey: storyWorldKeys.list() }),
      ]);
      try { sessionStorage.removeItem(key); } catch { /* optional */ }
      const next = new URLSearchParams({ world: setup.id });
      if (projectId) next.set('projectId', projectId);
      router.replace(`/apps/story-worlds?${next}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法创建，请重试。');
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <PageContainer className="py-4">
      <PageHeader title="新建世界" backHref="/apps/story-worlds" backLabel="故事世界" />
      <form onSubmit={submit} className="mt-6 max-w-lg space-y-5">
        <div className="space-y-2">
          <span className="block text-sm font-medium text-ink">作品属性</span>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3" role="group" aria-label="作品属性">
            {(
              [
                { value: 'canon', label: '原作', hint: '官方 IP 世界观（如提瓦特），角色保持正典设定' },
                { value: 'derivative', label: '同人', hint: '基于已有原作派生的 IF / AU 世界' },
                { value: 'original', label: '原创', hint: '纯原创作品，角色支持多阶段人设演进' },
              ] as const
            ).map((opt) => {
              const active = workNature === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setWorkNature(opt.value)}
                  className={`rounded-panel border p-3 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)]'
                      : 'border-hairline bg-surface text-ink hover:border-border-default'
                  }`}
                >
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="mt-1 text-xs opacity-80 leading-relaxed">{opt.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {workNature === 'derivative' && (
          <FormField label="所属母原作" hint="填写被衍生的原作名（如：原神），将自动共享母原作角色池。">
            <Input
              list="canon-work-suggestions"
              value={parentWork}
              maxLength={200}
              disabled={saving}
              placeholder="例如：原神、崩坏：星穹铁道"
              onChange={(event) => setParentWork(event.target.value)}
            />
            <datalist id="canon-work-suggestions">
              {canonWorks.map((w) => (
                <option key={w.name} value={w.name} />
              ))}
            </datalist>
          </FormField>
        )}

        <FormField label="世界 / 作品名称" required error={error || undefined}>
          <Input value={title} maxLength={200} required disabled={saving}
            placeholder={workNature === 'canon' ? '例如：原神 · 提瓦特' : workNature === 'derivative' ? '例如：枫丹现代歌剧社 AU' : '例如：星枢纪元'}
            onChange={(event) => { setTitle(event.target.value); setError(''); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
            }} />
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={saving}>创建世界</Button>
          {oldDraft && <Button type="button" variant="ghost" onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.set('resume', '1');
            router.push(`/apps/story-worlds/new?${next}`);
          }}>继续旧草稿</Button>}
        </div>
      </form>
    </PageContainer>
  );
}
