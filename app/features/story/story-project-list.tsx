'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Lightbulb, Plus, Compass, ArrowRight } from 'lucide-react';
import type { StoryProjectType } from '@sthstart/contracts';
import { storyApi } from './api';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Input } from '@/app/components/ui/input';
import { EmptyState } from '@/app/components/ui/empty-state';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';

export function StoryProjectList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['story', 'projects'], queryFn: storyApi.listProjects });
  const [title, setTitle] = useState('');
  const [workId, setWorkId] = useState('');
  const [projectType, setProjectType] = useState<StoryProjectType>('fiction');
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const create = useMutation({ mutationFn: () => storyApi.createProject(title.trim(), '', workId.trim() || undefined, projectType),
    onSuccess: async (created) => { setCreateOpen(false); setTitle(''); setWorkId(''); setProjectType('fiction'); setError(''); await queryClient.invalidateQueries({ queryKey: ['story', 'projects'] }); router.push(`/apps/story/${created.id}`); },
    onError: (cause) => setError(cause.message) });
  const closeCreate = () => {
    if (create.isPending) return;
    if (title.trim() || workId.trim()) { setDiscardOpen(true); return; }
    setCreateOpen(false); setError(''); setProjectType('fiction');
  };
  const submitCreate = () => { if (title.trim() && !create.isPending) create.mutate(); };
  return <div className="min-h-0 w-full bg-paper py-6 text-ink">
    <PageContainer className="space-y-5">
      <PageHeader title="剧情与记录工作室" description="结构化大纲、小说正文与对话感想记录，支持 AI 辅助构思与标准 MCP 协议协作。" actions={<Button variant="primary" size="sm" onClick={() => { setError(''); setCreateOpen(true); }}><Plus className="size-4" />新建项目</Button>} />
      {projects.error && <p role="alert" className="text-sm text-danger-fg">{projects.error.message}</p>}
      {projects.isLoading && <p className="text-muted">正在读取项目…</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.data?.items.map((item) => {
          const isReflection = item.projectType === 'reflection';
          return (
            <Link
              key={item.id}
              href={`/apps/story/${item.id}`}
              className="story-project-card group flex min-h-[176px] flex-col justify-between rounded-[var(--radius-panel)] bg-surface p-5"
            >
              <div>
                <div className="flex items-start justify-between gap-3 font-semibold">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="story-project-icon">
                      {isReflection ? (
                        <Lightbulb className="size-4 text-warning-fg" />
                      ) : (
                        <BookOpen className="size-4 text-accent" />
                      )}
                    </span>
                    <span className="truncate text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-accent">
                      {item.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        isReflection
                          ? 'bg-warning-bg text-warning-fg'
                          : 'bg-accent/10 text-accent-dark'
                      }`}
                    >
                      {isReflection ? '对话感想' : '剧情创作'}
                    </span>
                    {item.workId && (
                      <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-muted border border-border-subtle">
                        {item.workId}
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted">
                  {item.summary || (isReflection ? '暂无感想记录描述' : '尚未填写项目简介')}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3 text-xs text-muted">
                <span className="tabular-nums">更新于 {new Date(item.updatedAt).toLocaleDateString('zh-CN')}</span>
                <div className="flex items-center gap-1 font-medium text-muted transition-colors group-hover:text-accent">
                  <span>进入工作台</span>
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {projects.data?.items.length === 0 && (
        <EmptyState
          icon={Compass}
          title="暂无剧情项目"
          description="从结构化小说大纲或对话感想记录开始，支持 AI 辅助构思与标准 MCP 协议协作。"
          actions={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-sm"
                onClick={() => {
                  setError('');
                  setProjectType('fiction');
                  setCreateOpen(true);
                }}
              >
                <BookOpen className="size-4 text-accent" />
                <span>新建剧情创作工程</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="gap-2 text-sm"
                onClick={() => {
                  setError('');
                  setProjectType('reflection');
                  setCreateOpen(true);
                }}
              >
                <Lightbulb className="size-4 text-warning-fg" />
                <span>新建对话感想记录</span>
              </Button>
            </div>
          }
        />
      )}
      <ResponsiveEditOverlay
        open={createOpen}
        onOpenChange={(open) => { if (!open) closeCreate(); }}
        title="新建项目"
        description="选择项目类型以适配最合适的工作台布局与协作模式。"
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeCreate} disabled={create.isPending}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              form="story-create-project"
              disabled={!title.trim() || create.isPending}
              loading={create.isPending}
            >
              创建项目
            </Button>
          </>
        }
      >
        <form
          id="story-create-project"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitCreate();
          }}
        >
          <div>
            <label className="block text-sm font-medium text-ink mb-2">项目类型</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setProjectType('fiction')}
                className={`flex flex-col items-start rounded-[var(--radius-control)] border p-3 text-left text-sm transition-all ${
                  projectType === 'fiction'
                    ? 'border-accent bg-accent/10 shadow-xs'
                    : 'border-border-default bg-surface hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4 text-accent" />
                  <span className="font-semibold text-sm text-ink">剧情创作</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  小说章节、大纲、世界观、角色设定与剧本流一键编译。
                </p>
              </button>

              <button
                type="button"
                onClick={() => setProjectType('reflection')}
                className={`flex flex-col items-start rounded-[var(--radius-control)] border p-3 text-left text-sm transition-all ${
                  projectType === 'reflection'
                    ? 'border-warning bg-warning-bg shadow-xs'
                    : 'border-border-default bg-surface hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Lightbulb className="size-4 text-warning-fg" />
                  <span className="font-semibold text-sm text-ink">对话感想</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  记录与角色聊天、剧情体验后的随笔、复盘与灵感摘录。
                </p>
              </button>
            </div>
          </div>

          <label className="block space-y-1.5 text-sm font-medium text-ink">
            <span>{projectType === 'reflection' ? '记录册名称' : '项目名称'}</span>
            <Input
              aria-label="项目名称"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={projectType === 'reflection' ? '例如：芙宁娜日常对话随感' : '例如：枫丹雨夜篇章'}
              autoFocus
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-ink">
            <span>所属作品（选填）</span>
            <Input
              aria-label="所属作品"
              value={workId}
              onChange={(event) => setWorkId(event.target.value)}
              placeholder="例如：原神"
            />
          </label>
          {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
        </form>
      </ResponsiveEditOverlay>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="放弃未保存的新建项目？"
        description="关闭后已填写的名称与作品信息不会保留。"
        confirmLabel="放弃填写"
        danger
        onConfirm={() => {
          setDiscardOpen(false);
          setCreateOpen(false);
          setTitle('');
          setWorkId('');
          setProjectType('fiction');
          setError('');
        }}
      />
    </PageContainer>
  </div>;
}
