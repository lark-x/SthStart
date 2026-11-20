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
import { characterKeys } from '@/app/features/characters/query-keys';
import { parseAuthoringEnvelope, WORLD_AUTHORING_STORAGE_PREFIX } from './model';
import { createWorldSetup, pendingWorldsKey } from './setup-api';
import { storyWorldKeys } from '../query-keys';
import { WorldAuthoringPage } from './world-authoring-page';
import { QUICK_CREATE_STORAGE_KEY, parseWorkCreationAttempt, workCreationAttempt, type WorkCreationAttempt } from './work-creation';

export function NewWorldPage() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get('projectId');
  const existingWorkName = params.get('work');
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [workNature, setWorkNature] = useState<WorkNature>('original');
  const [parentWork, setParentWork] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const worksBrowser = useCharacterBrowser({ page: 1, pageSize: 20 }, workNature === 'derivative' || Boolean(existingWorkName));
  const existingWork = worksBrowser.facets?.works.find(work => work.name === existingWorkName);
  const canonWorks = useMemo(
    () => (worksBrowser.facets?.works || []).filter((w) => w.workNature !== 'derivative'),
    [worksBrowser.facets],
  );
  const [oldDraft, setOldDraft] = useState(false);
  const busy = useRef(false);
  const composing = useRef(false);
  const attempt = useRef<WorkCreationAttempt | null>(null);

  useEffect(() => {
    try {
      const saved = parseWorkCreationAttempt(sessionStorage.getItem(QUICK_CREATE_STORAGE_KEY));
      if (saved) {
        attempt.current = saved;
        // One-time session restore; later edits never depend on this effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTitle((current) => current || saved.title);
        setWorkNature(saved.workNature);
        setParentWork(saved.parentWork ?? '');
      }
      const legacy = parseAuthoringEnvelope(sessionStorage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'create'));
      setOldDraft(Boolean(legacy?.isDirty || legacy?.suggestion));
    } catch { /* session storage is optional */ }
  }, []);

  if (params.get('resume') === '1' && oldDraft) return <WorldAuthoringPage />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || composing.current) return;
    if (existingWorkName && !existingWork) { setError('作品目录尚未读取，请稍后重试。'); return; }
    const name = existingWork?.name ?? title.trim();
    const selectedNature = existingWork?.workNature ?? workNature;
    const selectedParent = existingWork?.parentWork ?? parentWork;
    if (!name) { setError('请输入作品名称。'); return; }
    if (selectedNature === 'derivative' && !selectedParent.trim()) { setError('请选择所属母原作。'); return; }
    busy.current = true;
    setSaving(true);
    setError('');
    attempt.current = workCreationAttempt(attempt.current, { title: name, workNature: selectedNature, parentWork: selectedParent }, () => crypto.randomUUID());
    try { sessionStorage.setItem(QUICK_CREATE_STORAGE_KEY, JSON.stringify(attempt.current)); } catch { /* optional */ }
    try {
      const setup = await createWorldSetup({
        title: name,
        idempotencyKey: attempt.current.key,
        workNature: attempt.current.workNature,
        parentWork: attempt.current.parentWork,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pendingWorldsKey }),
        queryClient.invalidateQueries({ queryKey: storyWorldKeys.list() }),
        queryClient.invalidateQueries({ queryKey: characterKeys.all }),
      ]);
      try { sessionStorage.removeItem(QUICK_CREATE_STORAGE_KEY); } catch { /* optional */ }
      const next = new URLSearchParams(existingWork ? {} : { created: setup.id });
      if (projectId) next.set('projectId', projectId);
      router.replace(existingWork
        ? `/apps/story-worlds/${encodeURIComponent(setup.id)}/setup${next.size ? `?${next}` : ''}`
        : `/apps/story-worlds?${next}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法创建，请重试。');
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <PageContainer className="py-4">
      <PageHeader title={existingWorkName ? '配置作品故事' : '新建作品'} backHref="/apps/story-worlds" backLabel="作品" />
      <p className="mt-3 text-sm text-muted">{existingWorkName ? '沿用已登记的作品资料，接下来可按需添加地点与人物。' : '填写名称即可创建，故事设定可以稍后补充。'}</p>
      <form onSubmit={submit} className="mt-6 max-w-lg space-y-5"
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
        }}>
        <FormField label="作品名称" required error={error || undefined}>
          <Input name="title" value={existingWork?.name ?? title} maxLength={200} required disabled={saving || Boolean(existingWorkName)}
            placeholder="例如：星枢纪元"
            onChange={(event) => { setTitle(event.target.value); setError(''); }} />
        </FormField>
        <fieldset disabled={saving || Boolean(existingWorkName)} className="space-y-2">
          <legend className="text-sm font-medium text-ink">作品属性</legend>
          <div className="flex flex-wrap gap-4">
            {(
              [
                { value: 'canon', label: '原作', hint: '官方 IP 世界观（如提瓦特），角色保持正典设定' },
                { value: 'derivative', label: '同人', hint: '基于已有原作派生的 IF / AU 世界' },
                { value: 'original', label: '原创', hint: '纯原创作品，角色支持多阶段人设演进' },
              ] as const
            ).map((opt) => {
              const active = (existingWork?.workNature ?? workNature) === opt.value;
              return (
                <label
                  key={opt.value}
                  className="flex min-h-12 cursor-pointer items-center text-ink"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <input type="radio" name="workNature" value={opt.value} checked={active}
                      onChange={() => { setWorkNature(opt.value); setError(''); }} />
                    {opt.label}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {(existingWork?.workNature ?? workNature) === 'derivative' && (
          <FormField label="所属母原作" htmlFor="parent-work" required hint="选择已登记的原作或原创作品，可从母原作角色池选角。">
            <Input
              id="parent-work"
              list="canon-work-suggestions"
              value={existingWork?.parentWork ?? parentWork}
              maxLength={200}
              required
              name="parentWork"
              disabled={saving || Boolean(existingWorkName)}
              placeholder="例如：原神、崩坏：星穹铁道"
              onChange={(event) => { setParentWork(event.target.value); setError(''); }}
            />
            <datalist id="canon-work-suggestions">
              {canonWorks.map((w) => (
                <option key={w.name} value={w.name} />
              ))}
            </datalist>
          </FormField>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={saving}>{existingWorkName ? '继续配置故事' : '创建作品'}</Button>
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
