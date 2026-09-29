'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { storyApi } from './api';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Input } from '@/app/components/ui/input';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';

export function StoryProjectList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['story', 'projects'], queryFn: storyApi.listProjects });
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const create = useMutation({ mutationFn: () => storyApi.createProject(title.trim()),
    onSuccess: async (created) => { setCreateOpen(false); setTitle(''); setError(''); await queryClient.invalidateQueries({ queryKey: ['story', 'projects'] }); router.push(`/apps/story/${created.id}`); },
    onError: (cause) => setError(cause.message) });
  const closeCreate = () => {
    if (create.isPending) return;
    if (title.trim()) { setDiscardOpen(true); return; }
    setCreateOpen(false); setError('');
  };
  const submitCreate = () => { if (title.trim() && !create.isPending) create.mutate(); };
  return <div className="min-h-0 w-full bg-paper py-6 text-ink">
    <PageContainer className="space-y-5">
      <PageHeader title="剧情工作室" description="正式剧情由项目保存；AI 会话只负责讨论，修改须先审阅提案。" actions={<Button onClick={() => { setError(''); setCreateOpen(true); }}><Plus className="size-4" />新建项目</Button>} />
      {projects.error && <p role="alert" className="text-sm text-danger-fg">{projects.error.message}</p>}
      {projects.isLoading && <p className="text-muted">正在读取项目…</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.data?.items.map((item) => <Link key={item.id} href={`/apps/story/${item.id}`}
          className="story-project-card rounded-[var(--radius-panel)] bg-surface p-5">
          <div className="flex items-center gap-3 font-semibold"><span className="story-project-icon"><BookOpen className="size-5" /></span><span className="truncate">{item.title}</span></div>
          <p className="mt-2 line-clamp-2 text-sm text-muted">{item.summary || '尚未填写项目简介'}</p>
          <p className="mt-4 text-xs text-muted">更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}</p>
        </Link>)}
      </div>
      {projects.data?.items.length === 0 && <p className="story-empty-state rounded-[var(--radius-panel)] p-8 text-center text-muted">从新建项目开始，再整理大纲、世界观和角色。</p>}
      <ResponsiveEditOverlay open={createOpen} onOpenChange={(open) => { if (!open) closeCreate(); }} title="新建剧情项目" description="创建后可整理大纲、世界观、场景、角色和章节。" footer={<><Button type="button" variant="outline" onClick={closeCreate} disabled={create.isPending}>取消</Button><Button type="submit" form="story-create-project" disabled={!title.trim() || create.isPending} loading={create.isPending}>创建项目</Button></>}>
        <form id="story-create-project" onSubmit={(event) => { event.preventDefault(); submitCreate(); }}>
          <label htmlFor="story-project-title" className="block text-sm font-medium text-ink">项目名称</label>
          <Input id="story-project-title" autoFocus className="mt-2" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="例如：雾港" />
          {error && <p role="alert" className="mt-3 text-sm text-danger-fg">创建失败：{error}</p>}
        </form>
      </ResponsiveEditOverlay>
      <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen} title="放弃项目名称？" description="未创建的项目名称将被清空。" confirmLabel="放弃修改" onConfirm={() => { setTitle(''); setError(''); setCreateOpen(false); }} />
    </PageContainer>
  </div>;
}
