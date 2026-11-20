'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type {
  RefreshWorldSources,
  WorldSourceUpdateChange,
  WorldSourceUpdateEntity,
  WorldSourceUpdateKind,
  WorldSourceUpdatePreview,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { useToast } from '@/app/providers/ui-provider';
import { fetchWorldSourceUpdatePreview } from '../api';
import { useStoryWorldActions } from '../hooks/use-story-world-actions';
import { describeError, formatTick } from '../hooks/world-format';
import { storyWorldKeys } from '../query-keys';

const KIND_ORDER: WorldSourceUpdateKind[] = ['world', 'actor', 'source', 'location'];
const KIND_LABELS: Record<WorldSourceUpdateKind, string> = {
  world: '世界设定',
  actor: '人物',
  source: '来源',
  location: '地点',
};
const CHANGE_LABELS: Record<WorldSourceUpdateChange, string> = {
  added: '新增',
  modified: '修改',
  removed: '移除',
};
const MODE_LABELS = {
  'canon-gap': '原作留白',
  adaptation: '原作改编',
  alternate: '平行世界',
} as const;

function changeTone(change: WorldSourceUpdateChange) {
  if (change === 'added') return 'online' as const;
  if (change === 'modified') return 'warning' as const;
  return 'offline' as const;
}

function countBadge(kind: WorldSourceUpdateKind, preview: WorldSourceUpdatePreview) {
  const counts = { added: 0, modified: 0, removed: 0 };
  for (const change of preview.changes) {
    if (change.kind === kind) counts[change.change] += 1;
  }
  return (
    <Badge key={kind} variant="outline">
      {KIND_LABELS[kind]} 新增 {counts.added} · 修改 {counts.modified} · 移除 {counts.removed}
    </Badge>
  );
}

function totalCount(preview: WorldSourceUpdatePreview) {
  return preview.counts.added + preview.counts.modified + preview.counts.removed;
}

function EntityCard({ entity }: { entity: WorldSourceUpdateEntity }) {
  return (
    <li className="rounded-control border border-border-subtle bg-surface-sunken/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={changeTone(entity.change)}>{CHANGE_LABELS[entity.change]}</Badge>
        <span className="min-w-0 break-words text-sm font-medium text-ink">{entity.name}</span>
        <span className="text-xs text-muted">{KIND_LABELS[entity.kind]}</span>
        {entity.kind !== 'world' && <span className="text-xs text-muted">#{entity.id}</span>}
      </div>
      {entity.note && <p className="mt-2 text-xs leading-relaxed text-muted">{entity.note}</p>}
      {entity.fields.length > 0 && (
        <dl className="mt-3 space-y-2">
          {entity.fields.map((field) => (
            <div key={field.field}>
              <dt className="text-xs font-medium text-muted">{field.label}</dt>
              <dd className="mt-1 grid gap-1.5 sm:grid-cols-2">
                <div className="rounded-control border border-border-subtle bg-surface px-2.5 py-2">
                  <p className="text-xs font-medium text-muted">当前快照</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">{field.before}</p>
                </div>
                <div className="rounded-control border border-border-subtle bg-surface px-2.5 py-2">
                  <p className="text-xs font-medium text-muted">新版资料</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">{field.after}</p>
                </div>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

export interface SourceUpdatePreviewPanelProps {
  preview?: WorldSourceUpdatePreview;
  loading: boolean;
  error: string | null;
  busy: boolean;
  staleMessage: string | null;
  actionError: string | null;
  onRetry: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onEditWorld?: () => void;
}

export function SourceUpdatePreviewPanel({
  preview,
  loading,
  error,
  busy,
  staleMessage,
  actionError,
  onRetry,
  onConfirm,
  onCancel,
  onEditWorld,
}: SourceUpdatePreviewPanelProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">正在比较世界定义</p>
        <p className="text-xs leading-relaxed text-muted">读取最新世界定义、当前分支快照和角色库已发布版本。</p>
        <AsyncState status="loading" rows={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Alert variant="danger" title="影响预览加载失败">
          <p>{error}</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            重新比较
          </Button>
        </Alert>
      </div>
    );
  }

  if (!preview) {
    return <p className="text-sm text-muted">还没有可显示的影响预览。</p>;
  }

  const changesByKind = new Map(
    KIND_ORDER.map((kind) => [kind, preview.changes.filter((change) => change.kind === kind)]),
  );
  const confirmDisabled = busy || Boolean(staleMessage) || !preview.currentBranchPending;

  return (
    <div className="space-y-5">
      <Alert variant="info" title="只影响以后推进">
        既有事件、正文、记忆和人物状态不会改写。确认后，当前分支从此刻起使用新定义；其他受影响分支需要分别确认。
      </Alert>

      {staleMessage && (
        <Alert variant="warning" title="预览已过期">
          <p>{staleMessage}</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry} disabled={busy}>
            重新比较
          </Button>
        </Alert>
      )}

      <div className="flex flex-wrap gap-1.5">
        {KIND_ORDER.map((kind) => countBadge(kind, preview))}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        世界修订 {preview.worldRevision} · 分支修订 {preview.branchRevision} · 分支来源修订 {preview.branchSourceRevision}
      </p>
      <p className="text-xs leading-relaxed text-muted">
        逐项差异覆盖人物、来源、地点和世界基设；确认后来源刷新会同时采用这些世界字段。
      </p>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">影响分支</h3>
        {preview.affectedBranches.length === 0 ? (
          <p className="text-sm text-muted">没有待更新的分支。</p>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted">
              本次确认只写入当前分支；下面列出的其他分支仍保留各自快照，需要单独查看并确认。
            </p>
            <ul className="space-y-1.5">
              {preview.affectedBranches.map((branch) => (
                <li
                  key={branch.branchId}
                  className="flex flex-wrap items-center gap-2 rounded-control border border-border-subtle bg-surface px-3 py-2"
                >
                  <span className="min-w-0 break-words text-sm font-medium text-ink">{branch.title}</span>
                  {branch.isCurrent && <Badge variant="accent">当前分支</Badge>}
                  <Badge variant="outline">{MODE_LABELS[branch.mode]}</Badge>
                  <span className="text-xs text-muted">{formatTick(branch.currentTick)}</span>
                  <span className="text-xs text-muted">
                    新增 {branch.counts.added} · 修改 {branch.counts.modified} · 移除 {branch.counts.removed}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">逐项差异</h3>
        {totalCount(preview) === 0 ? (
          <Alert variant="info">
            世界定义与当前分支快照在人物、来源、地点和世界基设上没有差异。若来源修订仍未更新，确认后只更新分支的来源版本标记。
          </Alert>
        ) : (
          KIND_ORDER.map((kind) => {
            const changes = changesByKind.get(kind) ?? [];
            if (changes.length === 0) return null;
            return (
              <div key={kind} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{KIND_LABELS[kind]}</p>
                <ul className="space-y-1.5">
                  {changes.map((change) => (
                    <EntityCard key={`${change.kind}-${change.id}`} entity={change} />
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      {preview.characterVersionUpdates.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">角色库新发布版本</h3>
          <Alert variant="info" title="可导入，但不会自动覆盖世界">
            以下公开人物卡的已发布版本比世界快照新；这些版本可导入，但需要你在世界设置中显式更新。预览和纳入来源都不会改写角色卡或世界人物快照。
          </Alert>
          <ul className="space-y-1.5">
            {preview.characterVersionUpdates.map((update) => (
              <li key={update.actorId} className="rounded-control border border-border-subtle bg-surface px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{update.actorName}</span>
                  <span className="text-xs text-muted">{update.characterName}</span>
                  <Badge variant="outline">
                    {update.fromVersion === null ? '未记录版本' : `v${update.fromVersion}`} → v{update.latestVersion}
                  </Badge>
                  {update.publishedAt && <span className="text-xs text-muted">发布于 {update.publishedAt}</span>}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{update.note}</p>
                {onEditWorld && (
                  <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={onEditWorld}>
                    打开世界设置
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview.sourceSnapshotNotices.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">来源快照说明</h3>
          <ul className="space-y-1.5">
            {preview.sourceSnapshotNotices.map((notice) => (
              <li key={notice.sourceId} className="rounded-control border border-border-subtle bg-surface px-3 py-2">
                <p className="text-sm font-medium text-ink">{notice.title}</p>
                <p className="mt-1 text-xs text-muted">
                  当前快照版本 {notice.sourceVersion} · 采集 {notice.capturedAt}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{notice.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {actionError && (
        <Alert variant="danger" title="纳入未完成">
          <p>{actionError}</p>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>取消</Button>
        <Button type="button" variant="outline" onClick={onRetry} disabled={busy}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          重新比较
        </Button>
        <Button type="button" variant="primary" loading={busy} disabled={confirmDisabled} onClick={onConfirm}>
          确认纳入新版
        </Button>
      </div>
      <p className="text-right text-xs text-muted">确认时使用分支修订 {preview.branchRevision} 作版本校验。</p>
    </div>
  );
}

export interface SourceUpdatePreviewProps {
  worldId: string;
  worldRevision: number;
  branchId: string;
  branchRevision: number;
  available: boolean;
  onEditWorld?: () => void;
  /**
   * 受控的对话框开关。来源面板位于作品左栏，窄屏时左栏会在侧栏与底部抽屉之间切换并重新挂载；
   * 由工作台持有开关状态，跨断点调整窗口时影响预览不会被意外关闭。
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * 只渲染触发区（`trigger`）或只渲染对话框（`dialog`）。工作台把触发区放在左栏，
   * 对话框挂在左栏之外，窄屏抽屉关闭时对话框也能保持打开。默认两者都渲染。
   */
  part?: 'both' | 'trigger' | 'dialog';
}

export function sourceUpdateRefreshRequest(preview: WorldSourceUpdatePreview): RefreshWorldSources {
  return {
    expectedRevision: preview.branchRevision,
    expectedWorldRevision: preview.worldRevision,
  };
}

export function SourceUpdatePreview({
  worldId,
  worldRevision,
  branchId,
  branchRevision,
  available,
  onEditWorld,
  open: controlledOpen,
  onOpenChange,
  part = 'both',
}: SourceUpdatePreviewProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const actions = useStoryWorldActions();
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: [...storyWorldKeys.all, 'source-update-preview', worldId, branchId],
    queryFn: ({ signal }) => fetchWorldSourceUpdatePreview(worldId, branchId, signal),
    enabled: part !== 'trigger' && open && Boolean(worldId) && Boolean(branchId),
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
  });

  const preview = query.data;
  const staleMessage = preview && (preview.worldRevision !== worldRevision || preview.branchRevision !== branchRevision)
    ? `预览基于世界修订 ${preview.worldRevision}、分支修订 ${preview.branchRevision}；当前已是世界修订 ${worldRevision}、分支修订 ${branchRevision}。为避免覆盖新编辑，请重新比较后再确认。`
    : null;

  const close = () => {
    setOpen(false);
    setActionError(null);
  };

  const retry = () => {
    setActionError(null);
    void queryClient.invalidateQueries({ queryKey: storyWorldKeys.overview(worldId) });
    void queryClient.invalidateQueries({ queryKey: storyWorldKeys.branch(worldId, branchId) });
    void query.refetch();
  };

  const confirm = async () => {
    if (!preview || staleMessage || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await actions.refreshSources(worldId, branchId, sourceUpdateRefreshRequest(preview));
      toast.success('已纳入新版资料', '只影响以后推进；既有事件、记忆和人物状态保留。');
      close();
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const showTrigger = part !== 'dialog';
  const showDialog = part !== 'trigger';

  return (
    <>
      {!showTrigger ? null : available ? (
        <Alert variant="warning" title="来源有新版本">
          <p>纳入前先比较世界定义与当前分支快照。确认后只影响以后推进，已有事件和记忆不会改写。</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => {
              setActionError(null);
              setOpen(true);
            }}
          >
            查看影响
          </Button>
        </Alert>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setActionError(null);
            setOpen(true);
          }}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          检查来源与人物卡版本
        </Button>
      )}
      {showDialog && open && createPortal(<Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
          else setOpen(true);
        }}
        title="纳入新版资料前的影响预览"
        description="按人物、来源和地点比较最新世界定义与当前分支快照，并读取角色库已发布版本。"
        size="lg"
      >
        <SourceUpdatePreviewPanel
          preview={preview}
          loading={query.isLoading || (query.isFetching && !preview)}
          error={query.isError ? describeError(query.error) : null}
          busy={busy}
          staleMessage={staleMessage}
          actionError={actionError}
          onRetry={retry}
          onConfirm={() => void confirm()}
          onCancel={close}
          onEditWorld={onEditWorld ? () => {
            close();
            onEditWorld();
          } : undefined}
        />
      </Dialog>, document.body)}
    </>
  );
}
