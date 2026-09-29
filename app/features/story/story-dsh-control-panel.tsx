'use client';

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { BookOpen, ExternalLink, Play, RefreshCw } from 'lucide-react';
import { storyApi } from './api';
import { Alert } from '@/app/components/ui/alert';
import { Button, buttonVariants } from '@/app/components/ui/button';

const isLoopbackHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

function makeLaunchHref(projectId: string) {
  const url = new URL('sthstart-dsh://launch');
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('portal', window.location.origin);
  return url.toString();
}

export function StoryDshControlPanel() {
  const localAccess = typeof window !== 'undefined' && isLoopbackHost(window.location.hostname);
  const projects = useQuery({
    queryKey: ['story', 'projects'],
    queryFn: storyApi.listProjects,
    refetchInterval: 30_000,
  });
  const items = projects.data?.items ?? [];
  const statuses = useQueries({
    queries: items.map((project) => ({
      queryKey: ['story', project.id, 'bridge-status'],
      queryFn: () => storyApi.bridgeStatus(project.id),
      refetchInterval: 10_000,
      retry: 1,
    })),
  });
  const runningProject = items.find((_, index) => statuses[index]?.data?.running);

  return <section className="space-y-4" aria-label="剧情 DSH 控制">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">剧情 DSH 启动与状态</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          DSH 在本机 Windows 启动，SthStart 通过项目桥接心跳检测运行状态。模型选择、会话与流式 Markdown 仍由 DSH 原生页面负责。
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => {
        void projects.refetch();
        for (const query of statuses) void query.refetch();
      }}>
        <RefreshCw className="size-4" />刷新状态
      </Button>
    </div>

    {!localAccess && <Alert variant="warning" title="当前不是在运行 SthStart 的本机浏览器中">
      状态仍显示连接到此 SthStart 服务的启动器心跳，但一键启动会作用于当前浏览器所在电脑，因此已禁用。请在运行 SthStart 的 Windows 电脑上通过 localhost 或 127.0.0.1 打开本页面。
    </Alert>}

    {runningProject && <Alert variant="success" title={`DSH 在线：${runningProject.title}`}>
      DSH Web 使用本机 3081 端口。切换其他项目之前，请先在 DSH 中退出当前会话并关闭 DSH Web；启动器不会强制结束任何占用端口的进程。
    </Alert>}

    {projects.isError && <Alert variant="danger" title="无法读取剧情项目">
      {projects.error instanceof Error ? projects.error.message : '请检查 SthStart 服务连接后重试。'}
    </Alert>}

    {projects.isLoading && <p className="rounded-[var(--radius-panel)] border border-border-default bg-surface p-5 text-sm text-muted">正在检查项目与 DSH 状态…</p>}

    {!projects.isLoading && items.length === 0 && <div className="rounded-[var(--radius-panel)] border border-dashed border-border-default bg-surface p-8 text-center">
      <BookOpen className="mx-auto size-8 text-muted" />
      <p className="mt-3 font-medium">还没有剧情项目</p>
      <p className="mt-1 text-sm text-muted">先创建项目，再为项目配对 DSH。</p>
      <Link href="/apps/story" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4`}>前往剧情工作室</Link>
    </div>}

    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((project, index) => {
        const statusQuery = statuses[index];
        const status = statusQuery?.data;
        const anotherProjectRunning = Boolean(runningProject && runningProject.id !== project.id);
        const stateLabel = statusQuery?.isLoading ? '检测中' : statusQuery?.isError ? '状态不可用'
          : status?.running ? '在线' : status?.paired ? '已配对 · 离线' : '未配对';
        const stateClass = status?.running ? 'bg-emerald-100 text-emerald-800'
          : status?.paired ? 'bg-amber-100 text-amber-900' : 'bg-surface-muted text-muted';
        const startHref = localAccess && status?.paired && !status.running && !anotherProjectRunning
          ? makeLaunchHref(project.id) : undefined;

        return <article key={project.id} className="min-w-0 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{project.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{project.summary || '尚未填写项目简介'}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${stateClass}`} role="status">{stateLabel}</span>
          </div>

          <div className="mt-4 min-h-10 text-xs leading-5 text-muted">
            {statusQuery?.isError ? '无法取得桥接心跳。检查服务后刷新状态。' : status?.running
              ? `最近心跳：${status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toLocaleString('zh-CN') : '刚刚'}`
              : status?.paired ? `已配对${status.lastHeartbeatAt ? ` · 上次心跳 ${new Date(status.lastHeartbeatAt).toLocaleString('zh-CN')}` : ' · 等待启动器连接'}`
                : '尚未配对。前往项目的「DSH 配对」面板完成一次性配对。'}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {status?.running && localAccess ? <a href="http://127.0.0.1:3081" target="_blank" rel="noreferrer noopener"
              className={buttonVariants({ size: 'sm', variant: 'primary' })}>
              <ExternalLink className="size-4" />打开 DSH
            </a> : status?.running ? <Button size="sm" variant="outline" disabled>请在启动器所在电脑打开 DSH</Button>
              : startHref ? <a href={startHref} className={buttonVariants({ size: 'sm', variant: 'primary' })}>
              <Play className="size-4" />一键启动
            </a> : <Button size="sm" variant="outline" disabled>
              <Play className="size-4" />{!localAccess ? '请在本机启动' : !status?.paired ? '先完成配对' : anotherProjectRunning ? '其他项目正在运行' : '检查状态后启动'}
            </Button>}
            <Link href={`/apps/story/${encodeURIComponent(project.id)}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              <BookOpen className="size-4" />项目与配对设置
            </Link>
          </div>
          {anotherProjectRunning && status?.paired && <p className="mt-3 text-xs text-amber-800">端口 3081 当前由“{runningProject?.title}”使用。先关闭该实例，再启动此项目。</p>}
        </article>;
      })}
    </div>

    <details className="rounded-[var(--radius-panel)] border border-border-default bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium">首次启用一键启动 · 注册 Windows 启动协议</summary>
      <div className="mt-3 space-y-3 text-sm leading-6 text-muted">
        <p>浏览器不能直接启动 Windows 进程，因此需要在运行 SthStart 的电脑上注册一次本地协议。它只会调用项目自带启动器，并传递项目 ID 与本机 Portal 地址，不包含桥接 Token。</p>
        <p>在 SthStart 仓库根目录打开 PowerShell，执行：</p>
        <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-surface-muted p-3 text-xs text-ink">powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\story-dsh\register-protocol.ps1</pre>
        <p>注册后刷新本页即可使用。需要移除时运行 <code>unregister-protocol.ps1</code>。若该项目尚未配对，先打开“项目与配对设置”完成配对；DSH 模型仍需在 DSH 页面单独配置。</p>
      </div>
    </details>

    <p className="text-xs leading-5 text-muted">状态定义：启动器每 30 秒向当前 SthStart 服务发送心跳，超过 90 秒未收到即显示离线；这表示 DSH 启动器在线，不代表模型额度或对话服务可用。SthStart 服务重启后状态会暂时显示离线，启动器恢复心跳后自动更新。</p>
  </section>;
}
