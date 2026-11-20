'use client';

/* eslint-disable @next/next/no-img-element -- candidate thumbnails use the same artifact endpoint as the existing workbench. */

import { AlertTriangle, Check, SplitSquareVertical, ExternalLink } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Spinner } from '@/app/components/ui/spinner';
import type { ImageAttemptsState } from '../hooks/use-image-attempts';

type ImageAttemptPanelProps = {
  advanced: boolean;
  slotId: string | undefined;
  attemptsState: ImageAttemptsState;
};

export function ImageAttemptPanel({ advanced, slotId, attemptsState }: ImageAttemptPanelProps) {
  const {
    attempts,
    attemptsQuery,
    currentAttempt,
    compareAttemptId,
    compareAttempt,
    setCompareAttemptId,
    setHiresAttempt,
    adoptingAssetKey,
    adopt,
    retry,
    cancel,
    refresh,
    isRunning,
  } = attemptsState;

  return (
    <div className={`${advanced ? 'xl:col-span-4' : 'xl:col-span-6'} min-w-0 p-4 overflow-y-auto space-y-4 bg-surface/30`}>
      <div className="flex items-center justify-between pb-2 border-b border-border-default">
        <span className="text-sm font-semibold text-muted uppercase tracking-wider">
          图片历史与绘制记录 ({attempts.length})
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-sm px-1 text-muted hover:text-ink"
          onClick={() => void refresh()}
        >
          刷新
        </Button>
      </div>

      {attemptsQuery.isError && (
        <div role="alert">
          图片历史读取失败。
          <Button
            variant="outline"
            disabled={attemptsQuery.isFetching}
            onClick={() => void (attemptsQuery.isFetchNextPageError ? attemptsQuery.fetchNextPage() : attemptsQuery.refetch())}
          >
            重试读取历史
          </Button>
        </div>
      )}
      {attemptsQuery.isLoading && <p role="status">正在读取图片历史…</p>}
      {attemptsQuery.hasNextPage && (
        <Button
          variant="outline"
          disabled={attemptsQuery.isFetching}
          onClick={() => { if (!attemptsQuery.isFetching) void attemptsQuery.fetchNextPage(); }}
        >
          {attemptsQuery.isFetchingNextPage ? '正在加载…' : '加载更多图片历史'}
        </Button>
      )}
      {!attemptsQuery.isError && !attemptsQuery.isFetching && attempts.length > 0 && !attemptsQuery.hasNextPage && (
        <p role="status">已显示全部图片历史</p>
      )}
      {attempts.length === 0 && !attemptsQuery.isError && !attemptsQuery.isLoading ? (
        <div className="p-8 text-center text-sm text-fg-subtle border border-dashed border-border-default rounded-lg">
          还没有绘制记录。选择上方预设后点击“绘制新图”即可开始。
        </div>
      ) : (
        <div className="space-y-3">
          {attempts.map((attempt) => {
            const isSelected = attempt.id === (currentAttempt?.id || '');
            const isComparing = attempt.id === compareAttemptId;
            const running = isRunning(attempt.status);
            const isSucceeded = attempt.status === 'succeeded';
            const isFailed = attempt.status === 'failed';
            const output = attempt.outputs?.[0];

            return (
              <div
                key={attempt.id}
                onClick={() => attemptsState.selectAttempt(attempt.id)}
                className={`rounded-lg border p-3 cursor-pointer transition ${isSelected ? 'bg-surface border-info-border shadow-md ring-1 ring-info-border' : 'bg-paper/60 border-border-default hover:border-border-default'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium border ${
                        isSucceeded
                          ? 'bg-success-bg text-success-fg border-success-border'
                          : running
                            ? 'bg-info-bg text-info-fg border-info-border'
                            : isFailed
                              ? 'bg-danger-bg text-danger-fg border-danger-border'
                              : 'bg-surface-muted text-muted border-border-default'
                      }`}
                    >
                      {running && <Spinner className="w-2.5 h-2.5 mr-1" />}
                      {attempt.status}
                    </span>
                    <span className="text-sm text-muted font-mono">
                      Seed: {attempt.actualSeed}
                    </span>
                    {attempt.imageOperation?.operation === 'hires' && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium border bg-info-bg text-info-fg border-info-border" title="放大细化结果，沿用来源图的实际参数">细化</span>
                    )}
                    {attempt.imageOperation?.operation === 'hires' && attempt.imageOperation.parentArtifactId && (
                      <a
                        className="text-xs text-accent hover:underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`/api/admin/artifacts/${encodeURIComponent(attempt.imageOperation.parentArtifactId)}/file`}
                      >
                        来源图<ExternalLink className="ml-0.5 inline size-3 align-[-1px]" aria-hidden="true" />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {running && (
                      <Button
                        variant="danger"
                        size="sm"
                        className="h-5 text-sm px-1.5"
                        onClick={(event) => { event.stopPropagation(); cancel(attempt.id); }}
                      >
                        取消
                      </Button>
                    )}
                    {isFailed && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 text-sm px-1.5 text-muted"
                        onClick={(event) => { event.stopPropagation(); retry(attempt.id); }}
                      >
                        重试
                      </Button>
                    )}
                    {isSucceeded && output && (
                      <Button
                        variant={isComparing ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-5 text-sm px-1.5"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCompareAttemptId(isComparing ? null : attempt.id);
                        }}
                      >
                        <SplitSquareVertical className="w-2.5 h-2.5 mr-1" />
                        对比
                      </Button>
                    )}
                    {isSucceeded && output && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 text-sm px-1.5"
                        onClick={(event) => {
                          event.stopPropagation();
                          setHiresAttempt({
                            artifactId: output.artifactId,
                            label: `${slotId ?? ''} · ${new Date(attempt.createdAt).toLocaleString()}`,
                          });
                        }}
                      >
                        放大细化
                      </Button>
                    )}
                    {isSucceeded && output && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 text-sm px-1.5"
                        title="复用这张图的配方与参数，换一个新种子重新绘制"
                        onClick={(event) => {
                          event.stopPropagation();
                          retry(attempt.id, Math.floor(Math.random() * 2_147_483_647));
                        }}
                      >
                        按原配置重绘
                      </Button>
                    )}
                  </div>
                </div>

                {isSucceeded && output ? (
                  <div className="space-y-2">
                    <div className="relative aspect-video rounded bg-paper border border-border-default overflow-hidden flex items-center justify-center">
                      <img
                        src={`/api/admin/artifacts/${output.artifactId}/file`}
                        alt="Candidate"
                        className="w-full h-full object-contain"
                        onError={(event) => { (event.target as HTMLElement).style.display = 'none'; }}
                      />
                      <div className="absolute bottom-1 right-1 bg-media-backdrop/70 px-1.5 py-0.5 rounded text-sm font-mono text-muted">
                        {output.width && output.height ? `${output.width}x${output.height}` : output.assetKey}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="text-sm text-fg-subtle font-mono">
                        {output.sha256 ? `${output.sha256.slice(0, 10)}...` : output.assetKey}
                      </div>
                      <Button
                        size="sm"
                        className="h-6 text-sm px-2 bg-accent hover:bg-accent/90 text-paper font-medium"
                        disabled={adoptingAssetKey === output.assetKey}
                        onClick={(event) => { event.stopPropagation(); void adopt(output.assetKey); }}
                      >
                        {adoptingAssetKey === output.assetKey ? <Spinner className="w-3 h-3 mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                        采用为镜头画面
                      </Button>
                    </div>
                  </div>
                ) : running ? (
                  <div className="aspect-video rounded bg-paper border border-border-default/80 flex flex-col items-center justify-center text-sm text-info-fg gap-2">
                    <Spinner className="w-5 h-5 text-info-fg" />
                    <span>ComfyUI 生图中...</span>
                  </div>
                ) : isFailed ? (
                  <div className="p-3 rounded bg-danger-bg border border-danger-border text-sm text-danger-fg space-y-1">
                    <div className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      生成失败: {attempt.errorCode || 'error'}
                    </div>
                    <p className="text-sm text-danger-fg break-words">{attempt.errorMessage || '未知错误'}</p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {compareAttempt && currentAttempt && compareAttempt.id !== currentAttempt.id && (
        <div className="fixed inset-0 z-50 bg-media-backdrop/80 flex items-center justify-center p-6">
          <div className="bg-surface border border-border-default rounded-xl max-w-5xl w-full p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-border-default pb-2">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <SplitSquareVertical className="w-4 h-4 text-info-fg" />
                候选双屏对比 (Side-by-side Candidate Comparison)
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setCompareAttemptId(null)}>关闭对比</Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <CompareCandidate
                label="尝试 A"
                attempt={currentAttempt}
                buttonLabel="采用方案 A"
                onAdopt={(assetKey) => { void adopt(assetKey); setCompareAttemptId(null); }}
              />
              <CompareCandidate
                label="尝试 B"
                attempt={compareAttempt}
                buttonLabel="采用方案 B"
                onAdopt={(assetKey) => { void adopt(assetKey); setCompareAttemptId(null); }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompareCandidate({ label, attempt, buttonLabel, onAdopt }: {
  label: string;
  attempt: ImageAttemptsState['currentAttempt'];
  buttonLabel: string;
  onAdopt(assetKey: string): void;
}) {
  if (!attempt) return null;
  const output = attempt.outputs?.[0];
  return (
    <div className="bg-paper p-3 rounded-lg border border-border-default space-y-2">
      <div className="flex items-center justify-between text-sm text-muted font-semibold">
        <span>{label}: {attempt.id.slice(0, 8)}</span>
        <span className="font-mono text-muted">Seed: {attempt.actualSeed}</span>
      </div>
      <div className="aspect-video bg-media-backdrop rounded overflow-hidden flex items-center justify-center border border-border-default">
        {output ? (
          <img src={`/api/admin/artifacts/${output.artifactId}/file`} alt={`Candidate ${label}`} className="w-full h-full object-contain" />
        ) : (
          <span className="text-sm text-fg-subtle">无画面</span>
        )}
      </div>
      {output && (
        <Button
          size="sm"
          className="w-full bg-accent hover:bg-accent/90 text-paper text-sm h-7"
          onClick={() => onAdopt(output.assetKey)}
        >
          {buttonLabel}
        </Button>
      )}
    </div>
  );
}
