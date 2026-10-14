'use client';

import React, { useEffect, useRef } from 'react';
import { Bookmark, Sparkles } from 'lucide-react';
import type { NarrativeReading } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Skeleton } from '@/app/components/ui/skeleton';
import { cn } from '@/app/lib/cn';

/**
 * 叙事正文（§8.9）：正文是视觉中心，行宽受控、字号稳定。
 * 沉浸式阅读区保留衬线字体 (--font-serif)，界面控件与标题保持现代无衬线体 (--font-sans)。
 */
export function NarrativeReader({
  reading,
  loading,
  onSaveUtteranceToNotebook,
  onOpenImport,
  onGenerateConcept,
  generatingConcept,
}: {
  reading: NarrativeReading | null;
  loading?: boolean;
  onSaveUtteranceToNotebook: (utteranceId: string) => Promise<void>;
  onOpenImport: () => void;
  onGenerateConcept: () => void;
  generatingConcept: boolean;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const nodeId = reading?.node.id;

  // 阅读容器高度有界（桌面端内部滚动），切换剧情节点后回到顶部，
  // 否则会停留在上一个节点的滚动位置。
  useEffect(() => {
    articleRef.current?.scrollTo({ top: 0 });
  }, [nodeId]);

  // 加载中与“档案为空”是两种状态：请求未返回时显示骨架，而不是
  // 误导用户去导入工作台。
  if (!reading) {
    if (loading) {
      return (
        <article ref={articleRef} className="min-w-0 flex-1 overflow-y-auto bg-surface">
          <div className="mx-auto w-full max-w-[var(--shell-reading)] space-y-5 px-4 py-8 sm:px-8">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-2/3" />
            <div className="space-y-3 pt-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </article>
      );
    }
    return (
      <div className="flex min-h-[50vh] min-w-0 flex-1 flex-col items-center justify-center bg-surface p-8 text-center">
        <h2 className="tpl-section-title">档案仍是空的</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
          从一份规范化的剧情 JSON，或通过虚空终端 MCP 数据源连接器，导入完整剧情任务链后即可在此阅读。
        </p>
        <Button variant="primary" className="mt-5" onClick={onOpenImport}>
          打开导入工作台
        </Button>
      </div>
    );
  }

  return (
    <article ref={articleRef} className="min-w-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-[var(--shell-reading)] px-4 py-8 sm:px-8">
        <header className="narrative-reader-header space-y-3 pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 font-medium text-muted border border-border-subtle">
              {reading.scenes.length} 个场景
            </span>
          </div>

          <h2 className="font-sans text-2xl font-bold tracking-tight leading-snug text-ink">
            {reading.node.title}
          </h2>

          {reading.node.summary && (
            <p className="font-serif text-sm leading-relaxed text-muted">{reading.node.summary}</p>
          )}

          <Button type="button" size="sm" variant="outline" onClick={onGenerateConcept} loading={generatingConcept}>
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>生成概念图</span>
          </Button>
        </header>

        {reading.node.conceptArtifacts.length > 0 && (
          <section className="mt-6 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="tpl-section-title">概念图</h3>
              <span className="text-xs text-fg-subtle">已附加 {reading.node.conceptArtifacts.length} 张</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {reading.node.conceptArtifacts.map((artifact) => (
                <a
                  key={artifact.artifactId}
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-[var(--radius-control)] border border-border-subtle bg-surface"
                >
                  <img src={artifact.url} alt="剧情概念图" loading="lazy" className="aspect-video w-full object-cover" />
                </a>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 space-y-10">
          {reading.scenes.map((scene, index) => (
            <section key={scene.id} className="space-y-3.5">
              <div className="flex items-baseline gap-2.5 border-b border-border-subtle/70 pb-2">
                <span className="font-mono text-xs font-semibold tabular-nums text-accent">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="font-sans text-base font-semibold tracking-tight text-ink">
                  {scene.title || `场景 ${index + 1}`}
                </h3>
              </div>

              {scene.summary && (
                <p className="font-serif text-sm italic leading-relaxed text-muted">{scene.summary}</p>
              )}

              <div className="space-y-2.5 pt-1">
                {scene.utterances.map((line) => {
                  const isNarration = line.kind === 'narration';
                  const isChoice = line.kind === 'choice';

                  return (
                    <div
                      key={line.id}
                      className={cn(
                        'group relative',
                        isChoice
                          ? 'ml-4 rounded-[var(--radius-control)] border border-border-default bg-surface-sunken px-3.5 py-2.5'
                          : cn('border-l-2 pl-3.5', isNarration ? 'border-border-default' : 'border-accent/35'),
                      )}
                    >
                      {line.speaker && (
                        <strong className="mb-1 block font-sans text-sm font-semibold text-accent-dark">
                          {line.speaker}
                        </strong>
                      )}

                      {/* data-reading-surface 供计划 §11.3 的正文≥16px 验收定位真实正文，沉浸式阅读区启用衬线体。 */}
                      <p
                        data-reading-surface="true"
                        className={cn('font-serif text-base leading-loose', isNarration ? 'italic text-muted' : 'text-ink')}
                      >
                        {line.text}
                      </p>

                      {line.condition && (
                        <small className="mt-1.5 block font-sans text-xs text-fg-subtle">条件：{line.condition}</small>
                      )}

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void onSaveUtteranceToNotebook(line.id)}
                        aria-label={`摘录到笔记：${line.speaker || '旁白'}`}
                        className="mt-1.5 h-8 px-2.5 text-sm text-fg-subtle opacity-100 transition-opacity hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      >
                        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>摘录到笔记</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
