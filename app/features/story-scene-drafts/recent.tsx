'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowUpRight, FilePenLine } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { listSceneDrafts, sceneHref, sceneKeys } from './api';

const progressLabels = { start: '选时地', discuss: '讨论讲法', write: '写作', image: '画面', adopted: '已收入作品' };
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function RecentSceneDrafts() {
  const [expanded, setExpanded] = useState(false);
  const query = useInfiniteQuery({
    queryKey: sceneKeys.list,
    queryFn: ({ pageParam, signal }) => listSceneDrafts(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const visible = expanded ? rows : rows.slice(0, 5);

  return (
    <section aria-labelledby="scene-recent-heading" className="my-6 rounded-panel bg-surface px-4 py-4 shadow-[0_0_0_1px_var(--hairline)] sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="scene-recent-heading" className="flex items-center gap-2 text-base font-semibold"><FilePenLine className="size-4 text-muted" aria-hidden="true" />最近草稿</h2>
        {(rows.length > 5 || query.hasNextPage) && <Button size="sm" variant="ghost" aria-expanded={expanded} aria-controls="scene-recent-list" onClick={() => setExpanded(!expanded)}>{expanded ? '收起草稿' : '查看全部草稿'}</Button>}
      </div>
      {query.isPending && <p role="status" className="mt-3 text-sm text-muted">正在读取草稿…</p>}
      {query.isError && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted"><p role="status">草稿暂时无法读取。</p><Button size="sm" variant="ghost" onClick={() => void query.refetch()}>重新读取草稿</Button></div>}
      {query.isSuccess && rows.length === 0 && <p className="mt-2 text-sm text-muted">这里会保留你写到一半的故事。选一个角色，就可以开始一幕。</p>}
      <ul id="scene-recent-list" className="divide-y divide-hairline">
        {visible.map((row) => <li key={row.id}>
          <Link href={sceneHref(row.id)} className="group flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-control px-2 py-2.5 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus-ring">
            <span className="min-w-0 flex-[1_1_12rem] break-words text-sm font-medium">{row.title.trim() || '未命名一幕'} <span className="ms-2 font-normal text-muted">{row.character.name}</span></span>
            <span className="text-xs text-muted">{progressLabels[row.progress]}</span>
            <time dateTime={row.updatedAt} className="text-xs text-muted">{dateFormat.format(new Date(row.updatedAt))}</time>
            <ArrowUpRight className="ms-auto size-4 text-muted group-hover:text-ink sm:ms-0" aria-hidden="true" />
          </Link>
        </li>)}
      </ul>
      {expanded && query.hasNextPage && <Button size="sm" variant="ghost" className="mt-2" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>继续加载草稿</Button>}
    </section>
  );
}
