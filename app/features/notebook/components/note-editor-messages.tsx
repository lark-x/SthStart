'use client';

import Link from 'next/link';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import type { NotebookSyncStatus } from '../local-store';

export function NoteEditorMessages({
  errorMessage,
  onDismissError,
  localStatus,
  localSyncError,
  onRetrySync,
  resolvingConflict,
  onResolveConflict,
  preservedCopyId,
}: {
  errorMessage: string;
  onDismissError: () => void;
  localStatus?: NotebookSyncStatus;
  localSyncError?: string;
  onRetrySync: () => void;
  resolvingConflict: boolean;
  onResolveConflict: () => void;
  preservedCopyId: string | null;
}) {
  return (
    <>
      {errorMessage && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="danger" onDismiss={onDismissError}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {localStatus === 'error' && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="warning" title="内容已保存在本机，但后台同步失败">
            <span>{localSyncError || '网络恢复后会自动重试。'}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-2 h-auto min-h-0 px-1 py-0 text-xs font-normal text-current underline hover:bg-transparent sm:min-h-0"
              onClick={onRetrySync}
            >
              立即重试
            </Button>
          </Alert>
        </div>
      )}

      {localStatus === 'conflict' && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="warning" title="笔记版本冲突，本机内容已保留">
            <p>{localSyncError} 自动同步已暂停；继续编辑不会覆盖服务端内容。</p>
            <Button className="mt-2" size="sm" variant="outline" loading={resolvingConflict} onClick={onResolveConflict}>
              保留本机副本并载入服务端版本
            </Button>
          </Alert>
        </div>
      )}
      {preservedCopyId && (
        <div className="notebook-editor-message max-w-4xl mx-auto px-5 sm:px-8 pt-2">
          <Alert variant="info" title="本机草稿已保留为独立笔记">
            <Link className="underline" href={`/apps/notebook/${preservedCopyId}`}>打开保留的副本</Link>
          </Alert>
        </div>
      )}
    </>
  );
}
