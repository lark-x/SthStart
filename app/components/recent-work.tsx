'use client';
import Link from 'next/link';
import { useActivities } from '../features/activities/queries';
import { useNotes } from '../features/notebook/queries';
export function RecentWork() {
  const activities = useActivities();
  const notes = useNotes();
  const groups = [
    { title: '最近活动', query: activities, items: (activities.data?.items ?? []).filter(a => !a.archived).slice().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 3).map(a => ({ id: a.id, title: a.title, href: `/apps/activities/${a.id}` })) },
    { title: '最近笔记', query: notes, items: (notes.data?.items ?? []).slice().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 3).map(a => ({ id: a.id, title: a.title || '未命名笔记', href: `/apps/notebook/${a.id}` })) },
  ];
  return <section className="rounded-xl border border-border-default bg-surface p-5 space-y-5" aria-label="继续创作">
    <h2 className="font-serif text-xl">继续创作</h2>
    {groups.map(group => <div key={group.title} className="space-y-2">
      <h3 className="text-sm font-semibold text-muted">{group.title}</h3>
      {group.query.isLoading ? <p role="status" className="text-sm text-muted">正在读取…</p> : group.query.isError ?
        <button onClick={() => void group.query.refetch()} className="text-sm text-accent-dark">读取失败，点击重试</button> : group.items.length ?
        <ul className="space-y-1">{group.items.map(item => <li key={item.id}><Link className="block rounded px-2 py-2 text-sm hover:bg-surface-hover break-words" href={item.href}>{item.title} →</Link></li>)}</ul> :
        <p className="text-sm text-muted">还没有内容，可从下方新建。</p>}
    </div>)}
  </section>;
}
