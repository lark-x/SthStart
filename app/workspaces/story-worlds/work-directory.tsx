'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { useCharacterBrowser, characterFilterUrl } from '@/app/features/characters/public';
import { useStoryWorlds } from '@/app/features/story-worlds/queries';
import { fetchWorldSetups, pendingWorldsKey } from '@/app/features/story-worlds/authoring/setup-api';
import { mergeWorkDirectory } from './work-directory-model';

const natureLabels = { canon: '原作', derivative: '同人', original: '原创' } as const;

export function WorkDirectory() {
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const catalog = useCharacterBrowser({ page: 1, pageSize: 20 });
  const worlds = useStoryWorlds();
  const setups = useQuery({ queryKey: pendingWorldsKey, queryFn: fetchWorldSetups });
  const items = mergeWorkDirectory(catalog.facets?.works ?? [], worlds.data?.items ?? [], setups.data?.items ?? []);
  const worldById = new Map((worlds.data?.items ?? []).map((world) => [world.id, world]));
  const query = search.trim().toLocaleLowerCase();
  const visible = items.filter(item => [item.name, ...item.aliases, item.parentWork ?? ''].some(value => value.toLocaleLowerCase().includes(query)));
  const createdId = params.get('created');
  const created = createdId ? items.find(item => item.worldId === createdId) : undefined;
  const loading = catalog.isLoading || worlds.isLoading || setups.isLoading;
  const error = catalog.error || worlds.error || setups.error;
  const projectId = params.get('projectId');
  const newHref = `/apps/story-worlds/new${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`;

  return (
    <PageContainer className="py-5">
      <PageHeader title="作品" actions={<Link href={newHref} className={buttonVariants({ variant: 'primary' })}>新建作品</Link>} />
      <p className="mt-2 text-sm text-muted">选择作品进入章节大纲与设定集，或继续整理角色卡片。</p>
      {created && <p role="status" className="mt-4 text-sm text-ink">已创建《{created.name}》，作品已收录到下方卡片网格。</p>}
      <search className="my-5 block max-w-md">
        <label htmlFor="work-search" className="sr-only">搜索作品</label>
        <Input id="work-search" type="search" name="workSearch" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索作品名称、别名或母原作…" />
      </search>
      {error && (
        <Alert variant="danger" title="部分作品暂时无法读取" className="mb-4">
          <p>{error instanceof Error ? error.message : '请重试。'}</p>
          <Button variant="ghost" onClick={() => void Promise.all([catalog.refetch(), worlds.refetch(), setups.refetch()])}>重新读取</Button>
        </Alert>
      )}
      {loading ? <AsyncState status="loading" rows={3} /> : visible.length === 0 ? (
        <p className="rounded-[var(--radius-panel)] bg-surface p-8 text-center text-sm text-muted shadow-[0_0_0_1px_var(--hairline)]">
          {query ? '没有匹配的作品，试试其他名称或别名。' : error ? '作品列表尚未完整读取。' : '还没有作品，点击右上“新建作品”即可登记。'}
        </p>
      ) : (
        <ul aria-label="作品列表" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(item => {
            const worldMeta = item.worldId ? worldById.get(item.worldId) : undefined;
            const openHref = item.state === 'ready'
              ? `/apps/story-worlds?world=${encodeURIComponent(item.worldId!)}`
              : item.state === 'pending'
                ? `/apps/story-worlds/${encodeURIComponent(item.worldId!)}/setup${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`
                : `/apps/story-worlds/new?${new URLSearchParams({ work: item.name, ...(projectId ? { projectId } : {}) })}`;
            return (
              <li
                key={item.key}
                className="flex min-w-0 flex-col justify-between gap-4 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] transition-shadow hover:shadow-[var(--elev-sm),0_0_0_1px_var(--border-default)]"
              >
                <div className="min-w-0 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="truncate text-base font-semibold text-ink">{item.name}</h2>
                    <Badge variant="outline">{natureLabels[item.workNature]}</Badge>
                  </div>
                  {item.parentWork && <p className="text-xs text-muted">源自《{item.parentWork}》</p>}
                  <p className="line-clamp-3 text-sm leading-relaxed text-muted">
                    {item.summary || (item.state === 'ready' ? '已建立作品设定，可进入查看章节脉络与设定集。' : '故事尚未开始，可先整理角色或配置作品。')}
                  </p>
                </div>
                <div className="space-y-3 border-t border-hairline pt-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {worldMeta ? (
                      <>
                        <span>{worldMeta.regions?.length ?? worldMeta.locations.length} 地域舞台</span>
                        <span>·</span>
                        <span>{worldMeta.actors.length} 位核心角色</span>
                      </>
                    ) : (
                      <span>{item.state === 'ready' ? '已建立作品' : '待补充设定'}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      href={characterFilterUrl('/apps/characters', { works: [item.name], collapseDerivatives: false })}
                    >
                      查看角色
                    </Link>
                    <Link
                      className={buttonVariants({ variant: item.state === 'ready' ? 'primary' : 'secondary', size: 'sm' })}
                      href={openHref}
                    >
                      {item.state === 'ready' ? '进入作品' : '配置故事'}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
