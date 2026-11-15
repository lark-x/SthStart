'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { FormField } from '@/app/components/ui/form-field';
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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
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
      const setup = await createWorldSetup({ title: name, idempotencyKey: attempt.current.key });
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
      <form onSubmit={submit} className="mt-6 max-w-lg space-y-4">
        <FormField label="世界名称" required error={error || undefined}>
          <Input value={title} maxLength={200} required disabled={saving}
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
