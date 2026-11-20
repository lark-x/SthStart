'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { CreativeTaskResponseSchema, type CreativeTaskResponse } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { buttonVariants } from '@/app/components/ui/button';
import { createCreativeTask } from '@/app/features/creative/api';
import { creativeKeys } from '@/app/features/creative/query-keys';
import { fetchImageGenerationOptions } from '@/app/features/generation/image-api';
import { StoryWorldsWorkspace } from '@/app/features/story-worlds/workspace';
import { getJson } from '@/app/lib/api-client';
import { useToast } from '@/app/providers/ui-provider';
import { ConnectedImageGenerationPanel } from '@/app/workspaces/generation/connected-image-generation-panel';
import { WorkDirectory } from './work-directory';
import { worldImageAdoptAction } from './world-image-adopt-action';

function ChapterIllustrationPanel({
  prompt,
  title,
  contextKey,
}: {
  prompt: string;
  title?: string;
  contextKey?: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pollError, setPollError] = useState('');
  const [result, setResult] = useState<CreativeTaskResponse | null>(null);

  const optionsQuery = useQuery({
    queryKey: ['story-worlds', 'illustration-options', 'creative-center', 'text-to-image'],
    queryFn: () => fetchImageGenerationOptions('creative-center', 'text-to-image'),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!taskId) return;
    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const task = await getJson<CreativeTaskResponse>(
          `creative/tasks/${encodeURIComponent(taskId)}`,
          undefined,
          CreativeTaskResponseSchema,
        );
        if (stopped) return;
        setPollError('');
        if (task.status === 'succeeded') {
          setTaskId(null);
          setResult(task);
          void queryClient.invalidateQueries({ queryKey: creativeKeys.artifacts() });
          void queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
          toast.success('本章配图已生成', title || '已同步存入媒体库');
          return;
        }
        if (['failed', 'cancelled', 'abandoned'].includes(task.status)) {
          setTaskId(null);
          toast.error('本章配图失败', task.errorMessage || '生成任务未能完成');
          return;
        }
        timer = window.setTimeout(() => void poll(), 1800);
      } catch (err) {
        if (!stopped) {
          setPollError(err instanceof Error ? err.message : String(err));
          timer = window.setTimeout(() => void poll(), 4000);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [queryClient, taskId, title, toast]);

  const effectiveKey = contextKey || `story-worlds:illustration:${title || 'chapter'}`;

  return (
    <div className="space-y-4">
      <ConnectedImageGenerationPanel
        key={effectiveKey}
        appId="creative-center"
        purpose="text-to-image"
        contextKey={effectiveKey}
        options={optionsQuery.data}
        loading={optionsQuery.isLoading}
        initialDescription={prompt}
        submitLabel="生成本章配图"
        onRefresh={() => {
          void optionsQuery.refetch();
        }}
        onGenerate={async (input) => {
          const { parameters, ...selection } = input;
          const task = await createCreativeTask({
            mode: 'text-to-image',
            ...selection,
            parameters,
          });
          setResult(null);
          setPollError('');
          setTaskId(task.id);
          toast.success('本章配图任务已提交', '生成完成后将自动显示预览。');
          void queryClient.invalidateQueries({ queryKey: creativeKeys.tasks() });
        }}
      />

      {taskId && (
        <Alert variant="info" title="正在生成配图">
          任务排队或渲染中，可关闭抽屉继续写作，结果将自动保存至媒体库。
        </Alert>
      )}

      {pollError && (
        <Alert variant="warning" title="生图状态轮询受阻">
          {pollError}
        </Alert>
      )}

      {result && (
        <section aria-label="本章配图结果" className="space-y-3 rounded-[var(--radius-panel)] bg-surface-raised p-4 shadow-[0_0_0_1px_var(--hairline)]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">最新配图结果</h3>
            <Link
              href="/apps/creative"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              前往媒体库
            </Link>
          </div>
          {result.artifacts
            .filter((item) => item.mediaKind === 'image')
            .map((item) => {
              const imgUrl = `/api/admin/creative/artifacts/${encodeURIComponent(item.artifactId)}`;
              return (
                <a
                  key={item.artifactId}
                  href={imgUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-[var(--radius-control)] border border-hairline bg-surface-sunken/40"
                >
                  <img
                    src={imgUrl}
                    alt={title ? `${title} 配图` : '章节配图'}
                    className="max-h-80 w-full object-contain"
                  />
                </a>
              );
            })}
        </section>
      )}
    </div>
  );
}

export function StoryWorldWorkspace() {
  const params = useSearchParams();
  if (!params.get('world')?.trim()) return <WorkDirectory />;
  return (
    <StoryWorldsWorkspace
      imageAdoptAction={worldImageAdoptAction}
      renderIllustrationPanel={({ prompt, title, contextKey }) => (
        <ChapterIllustrationPanel prompt={prompt} title={title} contextKey={contextKey} />
      )}
    />
  );
}
