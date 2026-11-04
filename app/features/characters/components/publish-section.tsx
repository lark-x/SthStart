'use client';

import React from 'react';
import { Send } from 'lucide-react';
import { compileLinshePrompt, type CharacterDraftAny } from '@sthstart/contracts';
import type { CharacterDetail } from '../api';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';

export function PublishSection({
  detail,
  draft,
  onPublish,
  publishing,
}: {
  detail?: CharacterDetail | null;
  draft: CharacterDraftAny;
  onPublish: () => Promise<void>;
  publishing?: boolean;
}) {
  const previewPrompt = compileLinshePrompt(draft);

  return (
    <div className="space-y-6">
      <div className="pb-3 border-b border-border-subtle">
        <h3 className="text-base font-semibold text-ink">版本发布与应用集成</h3>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          草稿实时供创作笔记等工具编辑；只有点击发布后的稳定快照才会更新给交互应用。
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-[var(--radius-panel)] border border-border-subtle bg-surface">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              发布状态
            </span>
            <Badge variant={detail?.latestVersion ? 'default' : 'outline'}>
              {detail?.latestVersion ? `已发布 v${detail.latestVersion}` : '未发布草稿'}
            </Badge>
          </div>
          <h4 className="text-base font-semibold text-ink mt-1">发布当前草稿为新版本</h4>
          <p className="text-xs text-muted mt-0.5">
            发布后将生成不可变快照，所有连接此角色的运行应用将收到更新通知。
          </p>
        </div>

        <Button
          variant="accent"
          size="md"
          loading={publishing}
          onClick={onPublish}
          disabled={!detail?.id || !draft.displayName.trim()}
          className="flex-shrink-0 font-semibold"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span>发布新版本</span>
        </Button>
      </div>

      {/* Compiled Prompt Preview */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">
          邻舍人格提示词预览 (Compiled Prompt)
        </h4>
        <pre className="p-4 rounded-[var(--radius-panel)] border border-border-subtle bg-surface-sunken text-ink font-mono text-xs leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
          {previewPrompt}
        </pre>
      </div>

      {/* Version History */}
      <div className="pt-4 border-t border-border-subtle space-y-3">
        <h4 className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">
          版本发布记录 ({detail?.versions.length ?? 0})
        </h4>

        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
          {detail?.versions.map((ver) => (
            <div
              key={ver.version}
              className="flex items-center justify-between p-3"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-ink">
                  v{ver.version}
                </span>
                <span className="text-xs text-muted">
                  {new Date(ver.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <Badge variant="outline">已冻结快照</Badge>
            </div>
          ))}

          {(!detail?.versions || detail.versions.length === 0) && (
            <div className="p-6 text-center text-xs text-muted">
              尚未发布过任何版本。
            </div>
          )}
        </div>
      </div>

      {/* Linked Apps */}
      <div className="pt-4 border-t border-border-subtle space-y-3">
        <h4 className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">
          使用此角色的应用 ({detail?.links.length ?? 0})
        </h4>

        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
          {detail?.links.map((link) => (
            <div
              key={`${link.app_id}-${link.local_id}`}
              className="flex items-center justify-between p-3"
            >
              <div className="flex items-center gap-2">
                <strong className="text-xs font-semibold text-ink">{link.app_id}</strong>
                <span className="text-xs text-muted">使用版本 v{link.source_version}</span>
              </div>
              {link.local_modified ? (
                <Badge variant="warning">包含应用私有修改</Badge>
              ) : (
                <Badge variant="default">与主库同步</Badge>
              )}
            </div>
          ))}

          {(!detail?.links || detail.links.length === 0) && (
            <div className="p-6 text-center text-xs text-muted">
              暂无已连接的应用。进入邻舍并载入角色后会在此显示。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
