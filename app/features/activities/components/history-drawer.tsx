'use client';

import React, { useState } from 'react';
import {
  RotateCcw,
  BookmarkPlus,
} from 'lucide-react';
import type { Activity } from '@sthstart/contracts';
import {
  useActivityCheckpoints,
  useActivityContentRevisions,
} from '../queries';
import {
  useCreateCheckpoint,
  useRestoreCheckpoint,
} from '../mutations';
import { Drawer } from '@/app/components/ui/drawer';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  onRestored?: () => void;
}

export function HistoryDrawer({ open, onOpenChange, activity, onRestored }: HistoryDrawerProps) {
  const [newCheckpointName, setNewCheckpointName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: checkpointsData, isLoading: checkpointsLoading } = useActivityCheckpoints(activity.id);
  const { data: revisionsData } = useActivityContentRevisions(activity.id);

  const createCheckpointMutation = useCreateCheckpoint();
  const restoreCheckpointMutation = useRestoreCheckpoint();

  const checkpoints = checkpointsData?.items || [];
  const revisions = revisionsData?.items || [];

  const handleCreateCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCheckpointName.trim()) return;

    setErrorMsg(null);
    try {
      await createCheckpointMutation.mutateAsync({
        id: activity.id,
        name: newCheckpointName.trim(),
      });
      setNewCheckpointName('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '创建检查点失败');
    }
  };

  const handleRestore = async (checkpointId: string) => {
    setErrorMsg(null);
    try {
      await restoreCheckpointMutation.mutateAsync({
        id: activity.id,
        checkpointId,
      });
      onRestored?.();
      onOpenChange(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '恢复检查点失败');
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="版本回溯与检查点快照"
      description="检查点保存当前时刻的“内容 + 媒体选片 + 回放编排”三位一体不可变快照。可随时原子回滚并派生新版本。"
      footer={
        <div className="flex justify-end w-full">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-sm">
            关闭
          </Button>
        </div>
      }
    >
      <div className="p-1 space-y-4">
        {errorMsg && (
          <Alert variant="danger" title="操作提示">
            {errorMsg}
          </Alert>
        )}

        {/* Create new checkpoint form */}
        <form
          onSubmit={handleCreateCheckpoint}
          className="flex items-center gap-2 p-2.5 rounded-lg bg-[#faf8f2] border border-[rgb(24_32_29/10%)]"
        >
          <Input
            value={newCheckpointName}
            onChange={(e) => setNewCheckpointName(e.target.value)}
            placeholder="命名新检查点（如：第一幕初版、晚餐合照已选片）…"
            className="h-8 text-sm bg-white"
          />
          <Button
            type="submit"
            size="sm"
            disabled={createCheckpointMutation.isPending || !newCheckpointName.trim()}
            className="h-8 text-sm bg-accent hover:bg-accent-dark text-white flex items-center gap-1 flex-shrink-0"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            创建检查点
          </Button>
        </form>

        {/* Checkpoints list */}
        <div className="space-y-2">
          <span className="text-sm font-semibold text-ink">已保存检查点 ({checkpoints.length})</span>

          {checkpointsLoading ? (
            <div className="text-sm text-muted py-6 text-center">加载检查点列表中…</div>
          ) : checkpoints.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted bg-stone-50 rounded border border-stone-200">
              尚未创建任何检查点。建议在重要节点保存快照。
            </div>
          ) : (
            checkpoints.map((cp) => (
              <div
                key={cp.id}
                className="p-3 rounded-lg bg-white border border-stone-200 text-sm space-y-2 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{cp.name}</span>
                    <Badge variant="outline" className="text-sm bg-stone-100 font-mono">
                      v{cp.headVersion}
                    </Badge>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={restoreCheckpointMutation.isPending}
                    onClick={() => handleRestore(cp.id)}
                    className="text-sm h-7 text-accent hover:bg-accent/10 flex items-center gap-1"
                  >
                    <RotateCcw className="h-3 w-3" />
                    恢复至此版本
                  </Button>
                </div>

                <div className="text-sm text-stone-500 font-mono flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>内容: {cp.contentRevisionId.slice(0, 10)}…</span>
                  <span>媒体: {cp.mediaRevisionId ? cp.mediaRevisionId.slice(0, 10) + '…' : '无'}</span>
                  <span>回放: {cp.playbackRevisionId ? cp.playbackRevisionId.slice(0, 10) + '…' : '无'}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Content revisions history */}
        <div className="space-y-2 pt-2 border-t border-[rgb(24_32_29/10%)]">
          <span className="text-sm font-semibold text-ink">内容版本历史 ({revisions.length})</span>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {revisions.map((rev) => {
              const isCurrent = rev.id === activity.currentContentRevisionId;
              return (
                <div
                  key={rev.id}
                  className={`flex items-center justify-between p-2 rounded text-sm border ${
                    isCurrent ? 'bg-accent/5 border-accent/40' : 'bg-white border-stone-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-ink">{rev.id.slice(0, 12)}…</span>
                    {isCurrent && (
                      <Badge variant="outline" className="text-sm bg-emerald-50 text-emerald-700 border-emerald-300">
                        当前采用
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm text-stone-500">
                    {new Date(rev.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
