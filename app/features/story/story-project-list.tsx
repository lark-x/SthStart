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
  const [workId, setWorkId] = useState('');
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const create = useMutation({ mutationFn: () => storyApi.createProject(title.trim(), '', workId.trim() || undefined),
    onSuccess: async (created) => { setCreateOpen(false); setTitle(''); setWorkId(''); setError(''); await queryClient.invalidateQueries({ queryKey: ['story', 'projects'] }); router.push(`/apps/story/${created.id}`); },
    onError: (cause) => setError(cause.message) });
  const closeCreate = () => {
    if (create.isPending) return;
    if (title.trim() || workId.trim()) { setDiscardOpen(true); return; }
    setCreateOpen(false); setError('');
  };
  const submitCreate = () => { if (title.trim() && !create.isPending) create.mutate(); };
  return <div className="min-h-0 w-full bg-paper py-6 text-ink">
    <PageContainer className="space-y-5">
      <PageHeader title="剧情工作室" description="结构化大纲与小说正文创作，支持 AI 辅助构思与剧本流一键编译。" actions={<Button onClick={() => { setError(''); setCreateOpen(true); }}><Plus className="size-4" />新建项目</Button>} />
      {projects.error && <p role="alert" className="text-sm text-danger-fg">{projects.error.message}</p>}
      {projects.isLoading && <p className="text-muted">正在读取项目…</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.data?.items.map((item) => <Link key={item.id} href={`/apps/story/${item.id}`}
          className="story-project-card group rounded-[var(--radius-panel)] border border-border-default/60 bg-surface p-5 transition-all hover:border-border-default hover:shadow-xs">
          <div className="flex items-center justify-between gap-3 font-semibold">
            <div className="flex min-w-0 items-center gap-3">
              <span className="story-project-icon"><BookOpen className="size-5" /></span>
              <span className="truncate">{item.title}</span>
            </div>
            {item.workId && (
              <span className="shrink-0 rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                {item.workId}
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-muted">{item.summary || '尚未填写项目简介'}</p>
          <p className="mt-4 text-xs text-muted">更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}</p>
        </Link>)}
      </div>
      {projects.data?.items.length === 0 && <p className="story-empty-state rounded-[var(--radius-panel)] p-8 text-center text-muted">从新建项目开始，再整理大纲、世界观和角色。</p>}
      <ResponsiveEditOverlay open={createOpen} onOpenChange={(open) => { if (!open) closeCreate(); }} title="新建剧情项目" description="创建后可整理大纲、世界观、场景、角色和章节。" footer={<><Button type="button" variant="outline" onClick={closeCreate} disabled={create.isPending}>取消</Button><Button type="submit" form="story-create-project" disabled={!title.trim() || create.isPending} loading={create.isPending}>创建项目</Button></>}>
        <form id="story-create-project" className="space-y-4" onSubmit={(event) => { event.preventDefault(); submitCreate(); }}>
          <div>
            <label htmlFor="story-project-title" className="block text-sm font-medium text-ink">项目名称</label>
            <Input id="story-project-title" autoFocus className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="例如：雾港夜行" />
          </div>
          <div>
            <label htmlFor="story-project-work" className="block text-sm font-medium text-ink">绑定所属作品（可选）</label>
            <Input id="story-project-work" className="mt-1" value={workId} onChange={(event) => setWorkId(event.target.value)} maxLength={120} placeholder="例如：原神、崩坏：星穹铁道，或原创世界" />
            <p className="mt-1 text-xs text-muted">绑定后将优先推荐并筛选该作品库下的 233 位角色与设定。</p>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-danger-fg">创建失败：{error}</p>}
        </form>
      </ResponsiveEditOverlay>
      <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen} title="放弃项目名称？" description="未创建的项目名称将被清空。" confirmLabel="放弃修改" onConfirm={() => { setTitle(''); setWorkId(''); setError(''); setCreateOpen(false); }} />
    </PageContainer>
  </div>;
}
