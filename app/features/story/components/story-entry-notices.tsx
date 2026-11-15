'use client';

import { RotateCcw } from 'lucide-react';
import type { StoryEntry } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { StoryMarkdown } from '../story-markdown';

export function StoryEntryNotices({
  recoveryAvailable, onRecover, onDiscard, error, status, onRetry,
  entry, body, onCopyLocal, onAcceptServer, onOverwriteLocal,
}: {
  recoveryAvailable: boolean;
  onRecover: () => void;
  onDiscard: () => void;
  error: string;
  status: 'saved' | 'dirty' | 'saving' | 'local-only' | 'conflict' | 'error';
  onRetry: () => void;
  entry: StoryEntry;
  body: string;
  onCopyLocal: () => void;
  onAcceptServer: () => void;
  onOverwriteLocal: () => void;
}) {
  return <>
    {recoveryAvailable && (
      <Alert
        variant="warning"
        title="找到本机未同步的编辑文本"
        className="mb-4"
      >
        <p>恢复后会先与当前服务器版本核对，不会静默覆盖。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={onRecover}><RotateCcw className="size-4" aria-hidden="true" />恢复本机文本</Button>
          <Button size="sm" variant="outline" onClick={onDiscard}>使用服务器版本</Button>
        </div>
      </Alert>
    )}

    {error && (
      <Alert variant="danger" title="保存未完成" className="mb-4">
        <p>{error}</p>
        {status === 'local-only' && <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>重新保存</Button>}
      </Alert>
    )}

    {status === 'conflict' && (
      <div role="alert" className="mb-4">
      <Alert variant="warning" title="服务器与本机内容冲突">
        <p>服务器 v{entry.revision} 的内容不会被自动覆盖。逐项比较下方预览后，可选择丢弃本地文本，或明确确认以本地文本覆盖。</p>
        <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
          <div className="min-w-0 rounded border border-border-subtle bg-surface p-3"><b className="text-xs">服务器版本</b><div className="mt-2 max-h-56 overflow-y-auto"><StoryMarkdown source={'notes' in entry ? entry.notes : entry.body} /></div></div>
          <div className="min-w-0 rounded border border-border-subtle bg-surface p-3"><b className="text-xs">本机保留版本</b><div className="mt-2 max-h-56 overflow-y-auto"><StoryMarkdown source={body} /></div></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onCopyLocal}>复制本地文本</Button>
          <Button size="sm" variant="outline" onClick={onAcceptServer}>丢弃本地，使用服务器版本</Button>
          <Button size="sm" onClick={onOverwriteLocal}>确认用本地版本覆盖服务器</Button>
        </div>
      </Alert>
      </div>
    )}
  </>;
}
